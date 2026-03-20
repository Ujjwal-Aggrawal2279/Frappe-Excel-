/**
 * frappe_formula_plugin.js — V2.3 Frappe Formula Library
 *
 * Registers custom HyperFormula functions that pull live data from the
 * Frappe / ERPNext backend:
 *
 *   FRAPPE_GET(doctype, name, fieldname)
 *   FRAPPE_SUM(doctype, fieldname [, fk, fv …×3])
 *   FRAPPE_COUNT(doctype [, fk, fv …×3])
 *   FRAPPE_AVG(doctype, fieldname [, fk, fv …×3])
 *   GL_BALANCE(account, company [, from_date, to_date, cost_center, finance_book])
 *   STOCK_QTY(item_code, warehouse [, as_of_date])
 *   ITEM_PRICE(item_code, price_list [, qty, customer, uom])
 *
 * ── Async two-pass pattern ──────────────────────────────────────────────────
 * HyperFormula evaluation is synchronous.  Network calls are async.
 * Strategy:
 *   1. On first evaluation (cache miss): return "#LOADING…" immediately and
 *      fire the frappe.call() in the background.
 *   2. When the call resolves: write the value into the cache, then
 *      force-reeval the waiting cells via hf.setCellContents() (marks dirty)
 *      and call hot.render() so HOT reads the new value from HF.
 *
 * This means each formula cell flickers once (loading → value).
 * Subsequent evaluations within the TTL window are instant (cache hit).
 *
 * ── Registration timing ─────────────────────────────────────────────────────
 * This file is imported BEFORE formula_bridge.js in excel_view.bundle.js.
 * HyperFormula.registerFunctionPlugin() runs at module-eval time, which
 * happens before any ExcelBoard instantiation calls HyperFormula.buildEmpty().
 * This ordering is mandatory — plugins registered after buildEmpty() are
 * ignored by that HF instance.
 *
 * @module frappe_formula_plugin
 */

import { HyperFormula, FunctionPlugin, FunctionArgumentType } from "hyperformula";

frappe.provide("frappe.views.excel");

// ── AsyncFormulaManager ──────────────────────────────────────────────────────

/**
 * Manages the async data-fetch lifecycle for all custom formula functions.
 *
 * Responsibilities:
 *   - Maintain a TTL-based value cache (cacheKey → entry).
 *   - Track which HF cells are waiting on a given cache key.
 *   - After a fetch resolves, batch-reeval all waiting cells in one HF batch
 *     and schedule a single hot.render() call via microtask coalescing.
 *
 * Exposed as frappe.views.excel.formula_manager so ExcelBoard can wire
 * set_hf() and set_rerender() after initialization.
 */
class AsyncFormulaManager {
	/** @param {number} ttl   Cache TTL in ms (default 30 s). */
	/** @param {number} errCooldown  Error re-fetch cooldown in ms (default 5 s). */
	constructor({ ttl = 30_000, errCooldown = 5_000 } = {}) {
		/** @type {Map<string, {status:"ok"|"loading"|"error", data:*, ts:number}>} */
		this._cache = new Map();

		/** @type {Map<string, Array<{sheet:number, row:number, col:number}>>} */
		this._pending = new Map();

		/** @type {import("hyperformula").HyperFormula|null} */
		this._hf = null;

		/** @type {(()=>void)|null} */
		this._rerender = null;

		this._TTL          = ttl;
		this._ERR_COOLDOWN = errCooldown;
		this._batch_timer  = null;

		// ── Period state (used by PERIOD_START / PERIOD_END formula functions) ──
		this._period = this._compute_period("this_month");
	}

	// ── Period management ─────────────────────────────────────────────────────

	_compute_period(key) {
		const today = frappe.datetime.get_today();   // "YYYY-MM-DD"
		const [y, m] = today.split("-").map(Number);
		const pad = (n) => String(n).padStart(2, "0");

		// Last day of a month
		const last_day = (yr, mo) => new Date(yr, mo, 0).getDate();

		const qtr    = Math.ceil(m / 3);
		const qStart = (qtr - 1) * 3 + 1;
		const qEnd   = qStart + 2;

		const lm     = m === 1 ? 12 : m - 1;
		const lmY    = m === 1 ? y - 1 : y;

		const periods = {
			today:        { from: today, to: today, label: __("Today") },
			this_week: (() => {
				const d = new Date(today);
				const day = d.getDay() || 7;
				const mon = new Date(d); mon.setDate(d.getDate() - day + 1);
				const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
				return {
					from:  mon.toISOString().slice(0, 10),
					to:    sun.toISOString().slice(0, 10),
					label: __("This Week"),
				};
			})(),
			this_month:   { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${last_day(y, m)}`,   label: __("This Month") },
			last_month:   { from: `${lmY}-${pad(lm)}-01`, to: `${lmY}-${pad(lm)}-${last_day(lmY, lm)}`, label: __("Last Month") },
			this_quarter: { from: `${y}-${pad(qStart)}-01`, to: `${y}-${pad(qEnd)}-${last_day(y, qEnd)}`, label: __("This Quarter") },
			last_quarter: (() => {
				const pq = qtr === 1 ? 4 : qtr - 1;
				const pqY = qtr === 1 ? y - 1 : y;
				const pqS = (pq - 1) * 3 + 1;
				const pqE = pqS + 2;
				return { from: `${pqY}-${pad(pqS)}-01`, to: `${pqY}-${pad(pqE)}-${last_day(pqY, pqE)}`, label: __("Last Quarter") };
			})(),
			this_year:    { from: `${y}-01-01`, to: `${y}-12-31`, label: __("This Year") },
			last_year:    { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: __("Last Year") },
		};
		return periods[key] || periods["this_month"];
	}

	/**
	 * Change the active period and invalidate all formula cache.
	 * @param {string} key  One of: today, this_week, this_month, last_month,
	 *                              this_quarter, last_quarter, this_year, last_year, custom
	 * @param {string} [from_date]  Required when key="custom"
	 * @param {string} [to_date]    Required when key="custom"
	 */
	set_period(key, from_date, to_date) {
		if (key === "custom") {
			this._period = { from: from_date, to: to_date, label: __("Custom") };
		} else {
			this._period = this._compute_period(key);
		}
		// Wipe all cached values — period change affects every FRAPPE_SUM with date filters
		this._cache.clear();
		this._pending.clear();
		if (this._rerender) this._rerender();
	}

	/** Current period start date string "YYYY-MM-DD". */
	get period_start() { return this._period.from; }
	/** Current period end date string "YYYY-MM-DD". */
	get period_end()   { return this._period.to;   }
	/** Human label for current period (e.g. "This Month"). */
	get period_label() { return this._period.label; }

	/** Wire the active HyperFormula instance (called by ExcelBoard after init). */
	set_hf(hf) {
		this._hf = hf;
	}

	/** Wire the HOT render callback (called by ExcelBoard after _init_hot). */
	set_rerender(fn) {
		this._rerender = fn;
	}

	/**
	 * Return a cached value synchronously, or "#LOADING…" while a fetch runs.
	 *
	 * @param {string}   cacheKey  Unique key for this data point.
	 * @param {()=>Promise<*>} fetchFn  Zero-arg function that returns a Promise.
	 * @param {{sheet:number, row:number, col:number}} addr  HF cell address.
	 * @returns {*}  Cached value, "#LOADING…", or an error sentinel.
	 */
	getOrFetch(cacheKey, fetchFn, addr) {
		const entry = this._cache.get(cacheKey);
		const now   = Date.now();

		if (entry) {
			const age = now - entry.ts;
			if (entry.status === "ok" && age < this._TTL) return entry.data;
			if (entry.status === "loading") {
				this._track(cacheKey, addr);
				return "#LOADING\u2026";
			}
			if (entry.status === "error" && age < this._ERR_COOLDOWN) return entry.data;
		}

		// Cache miss (or expired) — kick off async fetch
		this._cache.set(cacheKey, { status: "loading", ts: now });
		this._track(cacheKey, addr);

		// frappe.call() returns a jQuery Deferred, not a native Promise.
		// Wrap with Promise.resolve() so .then/.catch/.finally are native Promise
		// methods — jQuery Deferreds don't have .finally().
		Promise.resolve(fetchFn())
			.then((val) => {
				this._cache.set(cacheKey, { status: "ok", data: val ?? 0, ts: Date.now() });
			})
			.catch((err) => {
				const msg = String(err?.exc_type ?? err?.message ?? "");
				const sentinel = msg.includes("PermissionError") ? "#PERM_DENIED" : "#ERR!";
				this._cache.set(cacheKey, { status: "error", data: sentinel, ts: Date.now() });
			})
			.finally(() => {
				this._schedule_reeval(cacheKey);
			});

		return "#LOADING\u2026";
	}

	/**
	 * Invalidate all cache entries whose key starts with *prefix*.
	 * Useful when a document is saved and cached values may be stale.
	 *
	 * @param {string} prefix
	 */
	invalidate(prefix) {
		for (const k of this._cache.keys()) {
			if (k.startsWith(prefix)) this._cache.delete(k);
		}
	}

	/** Clear the entire cache and pending map (called on grid refresh). */
	clear() {
		this._cache.clear();
		this._pending.clear();
	}

	// ── Private ───────────────────────────────────────────────────────────────

	/** Add *addr* to the pending list for *cacheKey* (dedup by row/col/sheet). */
	_track(cacheKey, addr) {
		if (!addr) return;
		const list = this._pending.get(cacheKey) ?? [];
		const dup  = list.some(
			(p) => p.row === addr.row && p.col === addr.col && p.sheet === addr.sheet,
		);
		if (!dup) list.push({ sheet: addr.sheet, row: addr.row, col: addr.col });
		this._pending.set(cacheKey, list);
	}

	/**
	 * Schedule a flush of ALL pending re-evaluations (50 ms debounce).
	 *
	 * Multiple fetches completing in rapid succession each call this method.
	 * We clear the previous timer so they coalesce into a single _flush_pending
	 * call — that way every waiting cell is re-evaluated, not just the cells
	 * for the last-completing cache key.
	 */
	_schedule_reeval(_cacheKey) {
		clearTimeout(this._batch_timer);
		this._batch_timer = setTimeout(() => {
			this._batch_timer = null;
			this._flush_pending();
		}, 50);
	}

	/**
	 * Force-reeval ALL HF cells that are waiting on any cache key.
	 *
	 * Collects every pending address across all keys (deduplicating by
	 * sheet/row/col), then writes each formula back so HF marks the cell dirty
	 * and re-evaluates it on the next getCellValue() call.
	 */
	_flush_pending() {
		// Deduplicate across all pending cache keys
		const seen    = new Set();
		const addrs   = [];
		for (const cells of this._pending.values()) {
			for (const addr of cells) {
				const key = `${addr.sheet}:${addr.row}:${addr.col}`;
				if (!seen.has(key)) {
					seen.add(key);
					addrs.push(addr);
				}
			}
		}
		this._pending.clear();

		if (this._hf && addrs.length) {
			this._hf.batch(() => {
				for (const addr of addrs) {
					const formula = this._hf.getCellFormula(addr);
					if (formula) this._hf.setCellContents(addr, [[formula]]);
				}
			});
		}

		this._rerender?.();
	}
}

// ── Module-level singleton ────────────────────────────────────────────────────

const formula_manager = new AsyncFormulaManager();
frappe.views.excel.formula_manager = formula_manager;

// ── Utility helpers ───────────────────────────────────────────────────────────

/** Coerce null/undefined to empty string (HF may pass either for omitted args). */
const _s = (v) => (v == null ? "" : v);

/**
 * Build a filter-pairs object from up to three key/value pairs.
 * Mirrors the server-side _parse_filter_pairs() helper.
 */
function _build_filters(fk1, fv1, fk2, fv2, fk3, fv3) {
	const f = {};
	if (fk1 != null && fk1 !== "" && fv1 != null) f[String(fk1)] = fv1;
	if (fk2 != null && fk2 !== "" && fv2 != null) f[String(fk2)] = fv2;
	if (fk3 != null && fk3 !== "" && fv3 != null) f[String(fk3)] = fv3;
	return f;
}

// ── FrappeFunctionPlugin ─────────────────────────────────────────────────────

/**
 * HyperFormula FunctionPlugin that implements the Frappe Formula Library.
 *
 * Each method follows the same pattern:
 *   1. Use this.runFunction() to unwrap AST arguments.
 *   2. Validate required args early (return sentinel string on failure).
 *   3. Build a deterministic cache key.
 *   4. Delegate to formula_manager.getOrFetch() with a fetchFn closure.
 *
 * state.formulaAddress is the HF cell address {sheet, row, col} needed to
 * track which cells are awaiting re-evaluation after the fetch completes.
 */
class FrappeFunctionPlugin extends FunctionPlugin {
	/** Shortcut to the module-level singleton. */
	get _fm() {
		return frappe.views.excel.formula_manager;
	}

	// ── FRAPPE_GET ────────────────────────────────────────────────────────────

	frappe_get(ast, state) {
		return this.runFunction(
			ast.args,
			state,
			this.metadata("FRAPPE_GET"),
			(doctype, name, fieldname) => {
				doctype   = _s(doctype);
				name      = _s(name);
				fieldname = _s(fieldname);

				if (!doctype || !name || !fieldname) return "#ARG!";

				const key = `FRAPPE_GET:${doctype}:${name}:${fieldname}`;
				return this._fm.getOrFetch(
					key,
					() =>
						frappe
							.call({
								method: "excel_view.api.frappe_get",
								args:   { doctype, name, fieldname },
							})
							.then((r) => r.message?.value ?? ""),
					state.formulaAddress,
				);
			},
		);
	}

	// ── PERIOD_START / PERIOD_END ────────────────────────────────────────────
	// Synchronous — no network call, just reads current period from formula_manager.
	// Usage: =FRAPPE_SUM("Sales Order","grand_total","ev_sales_person",A2,"transaction_date >=",PERIOD_START(),"transaction_date <=",PERIOD_END())

	period_start(ast, state) {
		return this.runFunction(ast.args, state, this.metadata("PERIOD_START"), () => {
			return frappe.views.excel.formula_manager?.period_start
				|| frappe.datetime.month_start();
		});
	}

	period_end(ast, state) {
		return this.runFunction(ast.args, state, this.metadata("PERIOD_END"), () => {
			return frappe.views.excel.formula_manager?.period_end
				|| frappe.datetime.month_end();
		});
	}

	// ── FRAPPE_SUM ────────────────────────────────────────────────────────────

	frappe_sum(ast, state) {
		return this.runFunction(
			ast.args,
			state,
			this.metadata("FRAPPE_SUM"),
			(doctype, fieldname, fk1, fv1, fk2, fv2, fk3, fv3, fk4, fv4) => {
				doctype   = _s(doctype);
				fieldname = _s(fieldname);

				if (!doctype || !fieldname) return "#ARG!";

				const key = `FRAPPE_SUM:${doctype}:${fieldname}:${_s(fk1)}:${_s(fv1)}:${_s(fk2)}:${_s(fv2)}:${_s(fk3)}:${_s(fv3)}:${_s(fk4)}:${_s(fv4)}`;

				return this._fm.getOrFetch(
					key,
					() =>
						frappe
							.call({
								method: "excel_view.api.frappe_aggregate",
								args:   {
									doctype,
									fieldname,
									aggr_type: "sum",
									fk1, fv1, fk2, fv2, fk3, fv3, fk4, fv4,
								},
							})
							.then((r) => r.message?.value ?? 0),
					state.formulaAddress,
				);
			},
		);
	}

	// ── FRAPPE_COUNT ──────────────────────────────────────────────────────────

	frappe_count(ast, state) {
		return this.runFunction(
			ast.args,
			state,
			this.metadata("FRAPPE_COUNT"),
			(doctype, fk1, fv1, fk2, fv2, fk3, fv3) => {
				doctype = _s(doctype);

				if (!doctype) return "#ARG!";

				const filters = _build_filters(fk1, fv1, fk2, fv2, fk3, fv3);
				const key = `FRAPPE_COUNT:${doctype}:${JSON.stringify(filters)}`;

				return this._fm.getOrFetch(
					key,
					() =>
						frappe
							.call({
								method: "excel_view.api.frappe_aggregate",
								args:   {
									doctype,
									fieldname: "name",
									aggr_type: "count",
									fk1, fv1, fk2, fv2, fk3, fv3,
								},
							})
							.then((r) => r.message?.value ?? 0),
					state.formulaAddress,
				);
			},
		);
	}

	// ── FRAPPE_AVG ────────────────────────────────────────────────────────────

	frappe_avg(ast, state) {
		return this.runFunction(
			ast.args,
			state,
			this.metadata("FRAPPE_AVG"),
			(doctype, fieldname, fk1, fv1, fk2, fv2, fk3, fv3) => {
				doctype   = _s(doctype);
				fieldname = _s(fieldname);

				if (!doctype || !fieldname) return "#ARG!";

				const filters = _build_filters(fk1, fv1, fk2, fv2, fk3, fv3);
				const key = `FRAPPE_AVG:${doctype}:${fieldname}:${JSON.stringify(filters)}`;

				return this._fm.getOrFetch(
					key,
					() =>
						frappe
							.call({
								method: "excel_view.api.frappe_aggregate",
								args:   {
									doctype,
									fieldname,
									aggr_type: "avg",
									fk1, fv1, fk2, fv2, fk3, fv3,
								},
							})
							.then((r) => r.message?.value ?? 0),
					state.formulaAddress,
				);
			},
		);
	}

	// ── GL_BALANCE ────────────────────────────────────────────────────────────

	gl_balance(ast, state) {
		return this.runFunction(
			ast.args,
			state,
			this.metadata("GL_BALANCE"),
			(account, company, from_date, to_date, cost_center, finance_book) => {
				account = _s(account);
				company = _s(company);

				if (!account || !company) return "#ARG!";

				const key = `GL_BALANCE:${account}:${company}:${from_date}:${to_date}:${cost_center}:${finance_book}`;

				return this._fm.getOrFetch(
					key,
					() =>
						frappe
							.call({
								method: "excel_view.api.gl_balance",
								args:   {
									account,
									company,
									from_date:    _s(from_date)    || null,
									to_date:      _s(to_date)      || null,
									cost_center:  _s(cost_center)  || null,
									finance_book: _s(finance_book) || null,
								},
							})
							.then((r) => r.message?.value ?? 0),
					state.formulaAddress,
				);
			},
		);
	}

	// ── STOCK_QTY ─────────────────────────────────────────────────────────────

	stock_qty(ast, state) {
		return this.runFunction(
			ast.args,
			state,
			this.metadata("STOCK_QTY"),
			(item_code, warehouse, as_of_date) => {
				item_code = _s(item_code);
				warehouse = _s(warehouse);

				if (!item_code || !warehouse) return "#ARG!";

				const key = `STOCK_QTY:${item_code}:${warehouse}:${as_of_date}`;

				return this._fm.getOrFetch(
					key,
					() =>
						frappe
							.call({
								method: "excel_view.api.stock_qty",
								args:   {
									item_code,
									warehouse,
									as_of_date: _s(as_of_date) || null,
								},
							})
							.then((r) => r.message?.value ?? 0),
					state.formulaAddress,
				);
			},
		);
	}

	// ── ITEM_PRICE ────────────────────────────────────────────────────────────

	item_price(ast, state) {
		return this.runFunction(
			ast.args,
			state,
			this.metadata("ITEM_PRICE"),
			(item_code, price_list, qty, customer, uom) => {
				item_code  = _s(item_code);
				price_list = _s(price_list);

				if (!item_code || !price_list) return "#ARG!";

				const key = `ITEM_PRICE:${item_code}:${price_list}:${qty}:${customer}:${uom}`;

				return this._fm.getOrFetch(
					key,
					() =>
						frappe
							.call({
								method: "excel_view.api.item_price",
								args:   {
									item_code,
									price_list,
									qty:      qty  ?? null,
									customer: _s(customer) || null,
									uom:      _s(uom)      || null,
								},
							})
							.then((r) => r.message?.value ?? 0),
					state.formulaAddress,
				);
			},
		);
	}

	// ── SMART_LOOKUP ─────────────────────────────────────────────────────────────────────
	// SMART_LOOKUP(lookup_value, target_doctype, return_field [, source_doctype])
	//
	// Traverses the Frappe schema graph to resolve the relationship and fetch
	// a field from a related DocType — no manual VLOOKUP range required.
	//
	// Strategy 1: lookup_value matches target_doctype’s `name` field directly.
	// Strategy 2: target_doctype has a Link field back to source_doctype;
	//             fetches the most-recent matching row.
	//
	// Examples:
	//   =SMART_LOOKUP(A2,"Customer","customer_group")
	//   =SMART_LOOKUP(B5,"Sales Order","grand_total","Customer")

	smart_lookup(ast, state) {
		return this.runFunction(
			ast.args,
			state,
			this.metadata("SMART_LOOKUP"),
			(lookup_value, target_doctype, return_field, source_doctype) => {
				const lv  = _s(lookup_value);
				const tdt = _s(target_doctype);
				const rf  = _s(return_field);
				const sdt = _s(source_doctype) || "";

				if (!lv || !tdt || !rf) return "#ARG!";

				const key = `SMART_LOOKUP:${tdt}:${rf}:${sdt}:${lv}`;
				return this._fm.getOrFetch(
					key,
					() =>
						frappe
							.call({
								method: "excel_view.api.smart_lookup_fetch",
								args:   {
									lookup_value:   lv,
									target_doctype: tdt,
									return_field:   rf,
									source_doctype: sdt,
								},
							})
							.then((r) => r.message ?? ""),
					state.formulaAddress,
				);
			},
		);
	}
}

// ── Argument type shorthands ──────────────────────────────────────────────────

/** Required string argument. */
const _S  = { argumentType: FunctionArgumentType.STRING };
/** Optional string argument. */
const _Sn = { argumentType: FunctionArgumentType.STRING, optionalArg: true };
/** Optional scalar (string or number) argument — for filter values. */
const _An = { argumentType: FunctionArgumentType.SCALAR, optionalArg: true };
/** Optional number argument. */
const _Nn = { argumentType: FunctionArgumentType.NUMBER, optionalArg: true };

// ── Function metadata ─────────────────────────────────────────────────────────

FrappeFunctionPlugin.implementedFunctions = {
	FRAPPE_GET: {
		method:     "frappe_get",
		parameters: [_S, _S, _S],
	},
	FRAPPE_SUM: {
		method:     "frappe_sum",
		// doctype, fieldname, then up to 4 filter key/value pairs (fk4/fv4 for date range)
		parameters: [_S, _S, _An, _An, _An, _An, _An, _An, _An, _An],
	},
	// Synchronous period helpers — no network call
	PERIOD_START: {
		method:     "period_start",
		parameters: [],
	},
	PERIOD_END: {
		method:     "period_end",
		parameters: [],
	},
	FRAPPE_COUNT: {
		method:     "frappe_count",
		// doctype, then up to 3 filter key/value pairs
		parameters: [_S, _An, _An, _An, _An, _An, _An],
	},
	FRAPPE_AVG: {
		method:     "frappe_avg",
		parameters: [_S, _S, _An, _An, _An, _An, _An, _An],
	},
	GL_BALANCE: {
		method:     "gl_balance",
		parameters: [_S, _S, _Sn, _Sn, _Sn, _Sn],
	},
	STOCK_QTY: {
		method:     "stock_qty",
		parameters: [_S, _S, _Sn],
	},
	ITEM_PRICE: {
		method:     "item_price",
		parameters: [_S, _S, _Nn, _Sn, _Sn],
	},
	// V3.2 — Graph-aware cross-doctype lookup (no manual range required)
	SMART_LOOKUP: {
		method:     "smart_lookup",
		// lookup_value, target_doctype, return_field [, source_doctype]
		parameters: [_S, _S, _S, _Sn],
	},
};

// ── Register with HyperFormula ────────────────────────────────────────────────
// This runs at module-eval time — before any HyperFormula.buildEmpty() call.
//
// The second argument is a *translations* dict (NOT the implementedFunctions).
// HF's getFunction() gate-checks isFunctionTranslated() — if a function is not
// in the translation table the evaluator returns #NAME? even when the plugin is
// registered.  We register for enGB (HF default) with identity translations
// (function name = its own formula-language name).

const _fn_translations = Object.fromEntries(
	Object.keys(FrappeFunctionPlugin.implementedFunctions).map((name) => [name, name]),
);

HyperFormula.registerFunctionPlugin(FrappeFunctionPlugin, { enGB: _fn_translations });
