/**
 * excel_view/utils/duckdb_engine.js
 *
 * DuckDBEngine — wraps @duckdb/duckdb-wasm for client-side analytical SQL.
 * Serves WASM and worker files from the app's own node_modules (no CDN, air-gap safe).
 *
 * Used by PivotBuilder._generate() and _insert_to_sheet() to replace the
 * JS array-iteration GROUP BY with a real SQL engine running in WebAssembly.
 *
 * Features:
 *  - Lazy init: DuckDB only loads when the pivot builder first runs
 *  - Singleton: one connection reused across all pivot operations
 *  - Graceful fallback: any WASM error → transparent JS fallback, zero UI disruption
 *  - Performance badge: engine name + query time shown in pivot output
 */

import * as duckdb from "@duckdb/duckdb-wasm";

frappe.provide("frappe.views.excel");

frappe.views.excel.DuckDBEngine = class DuckDBEngine {
	constructor() {
		this._db           = null;
		this._conn         = null;
		this._init_promise = null;
		this._available    = null; // null = untested, true/false after first attempt
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Compute a pivot table using DuckDB SQL GROUP BY.
	 * Falls back to PivotBuilder.compute() (JS) on any failure.
	 *
	 * @param {Object[]} data        — flat row objects (current sheet data)
	 * @param {string[]} row_fields  — fields for Rows zone
	 * @param {string[]} col_fields  — fields for Columns zone
	 * @param {Object[]} val_cfgs   — [{field, agg}] for Values zone
	 * @returns {Promise<{ headers, rows, row_field_count, engine, query_ms }>}
	 */
	async pivot(data, row_fields, col_fields, val_cfgs) {
		if (this._available === false) {
			return this._js_fallback(data, row_fields, col_fields, val_cfgs);
		}
		try {
			await this._init();
			return await this._duck_pivot(data, row_fields, col_fields, val_cfgs);
		} catch (e) {
			console.warn("[DuckDB] pivot failed, falling back to JS:", e.message);
			this._available = false;
			return this._js_fallback(data, row_fields, col_fields, val_cfgs);
		}
	}

	// ── Init (lazy, singleton) ────────────────────────────────────────────────

	async _init() {
		if (this._conn) return;
		if (this._init_promise) return this._init_promise;

		this._init_promise = (async () => {
			// Serve WASM + worker from the app's own node_modules —
			// same pattern as HOT CSS in excel_view.bundle.js (/assets/{app}/node_modules/…)
			const BASE = `${location.origin}/assets/excel_view/node_modules/@duckdb/duckdb-wasm/dist`;

			// MVP bundle: no SharedArrayBuffer required (works on all Frappe setups)
			const bundle = {
				mainModule:   `${BASE}/duckdb-mvp.wasm`,
				mainWorker:   `${BASE}/duckdb-browser-mvp.worker.js`,
				pthreadWorker: null,
			};

			// Inline worker via Blob to avoid CORS issues with the worker script
			const worker_src = `importScripts("${bundle.mainWorker}");`;
			const worker_url = URL.createObjectURL(
				new Blob([worker_src], { type: "text/javascript" })
			);

			const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR);
			const worker = new Worker(worker_url);
			this._db = new duckdb.AsyncDuckDB(logger, worker);
			await this._db.instantiate(bundle.mainModule, bundle.pthreadWorker);
			URL.revokeObjectURL(worker_url);

			this._conn      = await this._db.connect();
			this._available = true;
		})();

		return this._init_promise;
	}

	// ── DuckDB pivot ──────────────────────────────────────────────────────────

	async _duck_pivot(data, row_fields, col_fields, val_cfgs) {
		if (!data?.length) {
			return { headers: [], rows: [], row_field_count: row_fields.length, engine: "duckdb", query_ms: 0 };
		}

		const t0 = performance.now();

		// ── 1. Load data as CSV into a DuckDB in-memory table ──────────────────
		const all_keys = Object.keys(data[0]);
		const header   = all_keys.join(",");
		const csv_body = data.map(r =>
			all_keys.map(k => {
				const v = String(r[k] ?? "");
				// Quote if contains comma or quote
				return (v.includes(",") || v.includes('"') || v.includes("\n"))
					? `"${v.replace(/"/g, '""')}"`
					: v;
			}).join(",")
		);
		const csv = [header, ...csv_body].join("\n");

		await this._conn.query(`DROP TABLE IF EXISTS _ev_pivot`);
		await this._conn.insertCSVFromString(csv, {
			name:   "_ev_pivot",
			detect: true,
			header: true,
		});

		// ── 2. Build SQL ────────────────────────────────────────────────────────
		const safe     = c => `"${c.replace(/"/g, '""')}"`;
		const group_by = [...row_fields, ...col_fields];

		// col_fields pivot → multiple SELECT passes (one per column combo).
		// For simplicity (and correctness for large datasets), we use a flat
		// GROUP BY that matches what JS compute() produces.
		const agg_exprs = val_cfgs.map(vc => {
			const fn  = (vc.agg || "SUM").toUpperCase();
			const fld = safe(vc.field);
			// CAST to DOUBLE for numeric agg; COUNT needs no cast
			const expr = fn === "COUNT"
				? `COUNT(*)`
				: `ROUND(${fn}(TRY_CAST(${fld} AS DOUBLE)), 2)`;
			return `${expr} AS ${safe(`${fn}(${vc.field})`)}`;
		});

		const select_list = [
			...group_by.map(safe),
			...agg_exprs,
		].join(", ");

		const group_clause = group_by.length
			? `GROUP BY ${group_by.map(safe).join(", ")} ORDER BY ${group_by.map(safe).join(", ")}`
			: "";

		const col_pivot = col_fields.length > 0;

		let result_rows;
		let headers;

		if (!col_pivot) {
			// No column dimension — flat GROUP BY
			const sql = `SELECT ${select_list} FROM _ev_pivot ${group_clause}`;
			const res = await this._conn.query(sql);
			const schema_names = res.schema.fields.map(f => f.name);
			const arr = res.toArray();

			const field_label = f => f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
			headers = schema_names.map(field_label);

			result_rows = arr.map(r => schema_names.map(k => {
				const v = r[k];
				return (v === null || v === undefined) ? "" : (typeof v === "bigint" ? Number(v) : v);
			}));
		} else {
			// Column dimension: fall back to JS for now (multi-pass pivot is complex in SQL)
			// DuckDB PIVOT syntax is available but requires knowing all column values upfront
			const res = await this._conn.query(`SELECT ${select_list} FROM _ev_pivot ${group_clause}`);
			const schema_names = res.schema.fields.map(f => f.name);
			const arr = res.toArray();

			// Re-implement the JS pivot logic on the already-aggregated DuckDB rows
			const { headers: h, rows: r } = this._pivot_from_agg_rows(
				arr, schema_names, row_fields, col_fields, val_cfgs
			);
			headers     = h;
			result_rows = r;
		}

		// ── 3. Grand total row ─────────────────────────────────────────────────
		const grand = this._compute_grand_total(result_rows, row_fields.length, headers.length);
		result_rows.push(grand);

		const t1 = performance.now();

		return {
			headers,
			rows:            result_rows,
			row_field_count: row_fields.length,
			engine:          "duckdb",
			query_ms:        Math.round(t1 - t0),
		};
	}

	/** Build multi-column pivot from already-grouped DuckDB rows */
	_pivot_from_agg_rows(arr, schema_names, row_fields, col_fields, val_cfgs) {
		// Identify which schema columns are row/col/val
		const row_idxs = row_fields.map(f => schema_names.indexOf(f));
		const col_idxs = col_fields.map(f => schema_names.indexOf(f));
		const val_idxs = val_cfgs.map(vc => {
			const fn = (vc.agg || "SUM").toUpperCase();
			return schema_names.indexOf(`${fn}(${vc.field})`);
		});

		// Unique column combos
		const col_combo_map = new Map();
		arr.forEach(r => {
			const ck = col_idxs.map(i => String(r[schema_names[i]] ?? "")).join("\x00");
			if (!col_combo_map.has(ck)) col_combo_map.set(ck, col_idxs.map(i => r[schema_names[i]]));
		});
		const col_combos = [...col_combo_map.values()];

		// Row groups
		const row_group_map = new Map();
		arr.forEach(r => {
			const rk = row_idxs.map(i => String(r[schema_names[i]] ?? "")).join("\x00");
			if (!row_group_map.has(rk)) row_group_map.set(rk, []);
			row_group_map.get(rk).push(r);
		});

		const field_label = f => f.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

		const headers = [
			...row_fields.map(field_label),
			...col_combos.flatMap(combo =>
				val_cfgs.map(vc => {
					const col_lbl = combo.map(v => String(v ?? "")).join(" / ");
					const val_lbl = `${(vc.agg || "SUM").toUpperCase()}(${field_label(vc.field)})`;
					return col_lbl ? `${col_lbl} › ${val_lbl}` : val_lbl;
				})
			),
		];

		const rows = [...row_group_map.entries()].map(([rk, group]) => {
			const row_vals = rk.split("\x00");
			const val_cells = col_combos.flatMap(combo => {
				const ck = col_idxs.map(i => String(combo[col_fields.indexOf(col_fields[i])] ?? "")).join("\x00");
				const matched = group.filter(r =>
					col_idxs.map(i => String(r[schema_names[i]] ?? "")).join("\x00") === ck
				);
				return val_idxs.map((vi, vii) => {
					if (!matched.length) return "";
					// Sum up pre-aggregated values for this row group + col combo
					const sum = matched.reduce((acc, r) => {
						const v = r[schema_names[vi]];
						return acc + (Number(v) || 0);
					}, 0);
					return val_cfgs[vii].agg === "COUNT"
						? matched.length
						: +sum.toFixed(2);
				});
			});
			return [...row_vals, ...val_cells];
		});

		return { headers, rows };
	}

	/** Compute grand total row for the final result_rows matrix */
	_compute_grand_total(rows, row_field_count, total_cols) {
		const grand = [];
		for (let ci = 0; ci < total_cols; ci++) {
			if (ci < row_field_count) {
				grand.push(ci === 0 ? "Grand Total" : "");
			} else {
				const nums = rows.map(r => Number(r[ci])).filter(v => !isNaN(v));
				grand.push(nums.length ? +nums.reduce((a, b) => a + b, 0).toFixed(2) : "");
			}
		}
		return grand;
	}

	// ── JS Fallback ───────────────────────────────────────────────────────────

	_js_fallback(data, row_fields, col_fields, val_cfgs) {
		const result = frappe.views.excel.PivotBuilder?.compute(data, row_fields, col_fields, val_cfgs);
		if (!result) return Promise.resolve({ headers: [], rows: [], row_field_count: row_fields.length, engine: "js", query_ms: 0 });
		return Promise.resolve({
			...result,
			row_field_count: row_fields.length,
			engine:          "js",
			query_ms:        0,
		});
	}
};

// ── Singleton ─────────────────────────────────────────────────────────────────
frappe.views.excel.duckdb_engine = new frappe.views.excel.DuckDBEngine();
