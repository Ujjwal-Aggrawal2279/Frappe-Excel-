/**
 * excel_view/components/pivot_builder.js
 *
 * PivotBuilder — pure client-side pivot table (no external library).
 * Opens a dialog with field assignment (Rows / Columns / Values / Filters)
 * and renders a pivot table HTML in a preview pane.
 *
 * No persistence (dialog-only, stateless for V2.6).
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.PivotBuilder = class PivotBuilder {
	constructor({ board }) {
		this.board = board;
		this._row_fields    = [];
		this._col_fields    = [];
		this._val_configs   = []; // [{field, agg: "SUM"|"COUNT"|"AVG"|"MIN"|"MAX"}]
		this._filter_fields = [];
	}

	open_dialog() {
		this._build_dialog();
	}

	// ── Dialog ───────────────────────────────────────────────────────────────

	_build_dialog() {
		const cols = this.board.columns || [];

		const field_list_html = cols.map((c) =>
			`<div class="ev-pv-field-item" data-key="${c.data}" draggable="true" style="padding:4px 8px;cursor:grab;font-size:12px;background:var(--bg-color);border:1px solid var(--border-color);border-radius:3px;margin-bottom:3px;user-select:none">
				${frappe.utils.escape_html(c.title || c.data)}
			</div>`
		).join("");

		const zone = (id, label) => `
			<div style="margin-bottom:8px">
				<div style="font-size:11px;font-weight:600;color:var(--text-muted);margin-bottom:4px">${label}</div>
				<div class="ev-pv-zone" data-zone="${id}" style="min-height:40px;background:var(--bg-color);border:2px dashed var(--border-color);border-radius:4px;padding:4px;display:flex;flex-wrap:wrap;gap:4px">
				</div>
			</div>
		`;

		this.$modal = $(`
			<div style="position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center">
				<div class="ev-pv-dialog" style="border-radius:6px;width:940px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.22)">
					<div style="padding:14px 20px;border-bottom:1px solid var(--border-color);display:flex;align-items:center;justify-content:space-between">
						<strong>${__("PivotTable Builder")}</strong>
						<button class="ev-pv-close btn btn-sm btn-default">&#x2715;</button>
					</div>
					<div style="display:flex;flex:1;overflow:hidden">
						<!-- Left: field list + zones -->
						<div style="width:260px;border-right:1px solid var(--border-color);padding:14px;overflow-y:auto;flex-shrink:0">
							<div style="font-size:12px;font-weight:600;margin-bottom:8px">${__("Fields")}</div>
							<div class="ev-pv-field-list" style="margin-bottom:16px">${field_list_html}</div>
							${zone("rows",    "▦ " + __("Rows"))}
							${zone("columns", "▤ " + __("Columns"))}
							${zone("values",  "Σ " + __("Values"))}
						</div>
						<!-- Right: pivot preview -->
						<div style="flex:1;padding:16px;overflow:auto;display:flex;flex-direction:column">
							<div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:10px">
								<button class="ev-pv-insert btn btn-default btn-sm">${__("↓ Insert to Sheet")}</button>
								<button class="ev-pv-generate btn btn-primary btn-sm">${__("Generate Pivot")}</button>
							</div>
							<div class="ev-pv-output" style="overflow:auto;flex:1"></div>
						</div>
					</div>
					<div style="padding:10px 20px;border-top:1px solid var(--border-color);display:flex;justify-content:flex-end;gap:8px">
						<button class="ev-pv-close-btn btn btn-default btn-sm">${__("Close")}</button>
					</div>
				</div>
			</div>
		`).appendTo(document.body);

		this.$modal.find(".ev-pv-close, .ev-pv-close-btn").on("click", () => this.$modal.remove());
		this.$modal.find(".ev-pv-generate").on("click", () => this._generate());
		this.$modal.find(".ev-pv-insert").on("click", () => this._insert_to_sheet());

		// Drag-and-drop from field list → zones
		this._bind_dnd();
	}

	// ── Drag-and-drop ────────────────────────────────────────────────────────

	_bind_dnd() {
		// Source: field items
		this.$modal.on("dragstart", ".ev-pv-field-item, .ev-pv-zone-chip", (e) => {
			const $el = $(e.currentTarget);
			e.originalEvent.dataTransfer.setData("text/plain", JSON.stringify({
				key:   $el.data("key"),
				from:  $el.closest(".ev-pv-zone").data("zone") || "list",
			}));
		});

		// Drop targets: zones
		this.$modal.on("dragover", ".ev-pv-zone", (e) => { e.preventDefault(); });
		this.$modal.on("drop", ".ev-pv-zone", (e) => {
			e.preventDefault();
			const payload = JSON.parse(e.originalEvent.dataTransfer.getData("text/plain") || "{}");
			const zone_id = $(e.currentTarget).data("zone");
			if (!payload.key || !zone_id) return;
			this._assign_field(payload.key, payload.from, zone_id);
		});
	}

	_assign_field(key, from_zone, to_zone) {
		// Remove from previous zone
		if (from_zone === "rows")    this._row_fields    = this._row_fields.filter((k) => k !== key);
		if (from_zone === "columns") this._col_fields    = this._col_fields.filter((k) => k !== key);
		if (from_zone === "values")  this._val_configs   = this._val_configs.filter((v) => v.field !== key);
		if (from_zone === "filters") this._filter_fields = this._filter_fields.filter((k) => k !== key);

		// Add to new zone
		if (to_zone === "rows")    this._row_fields.push(key);
		if (to_zone === "columns") this._col_fields.push(key);
		if (to_zone === "values")  this._val_configs.push({ field: key, agg: "SUM" });
		if (to_zone === "filters") this._filter_fields.push(key);

		this._refresh_zones();
	}

	_refresh_zones() {
		const zone_data = {
			rows:    this._row_fields.map((k) => ({ key: k, label: this._field_label(k) })),
			columns: this._col_fields.map((k) => ({ key: k, label: this._field_label(k) })),
			values:  this._val_configs.map((v) => ({ key: v.field, label: `${v.agg}(${this._field_label(v.field)})`, agg: v.agg })),
		};

		Object.entries(zone_data).forEach(([zone_id, items]) => {
			const $zone = this.$modal.find(`.ev-pv-zone[data-zone="${zone_id}"]`);
			$zone.empty();
			items.forEach((item) => {
				const chip = $(`
					<div class="ev-pv-zone-chip" data-key="${item.key}" draggable="true"
						style="font-size:11px;border-radius:3px;padding:2px 6px;display:flex;align-items:center;gap:4px;cursor:grab">
						${frappe.utils.escape_html(item.label)}
						${zone_id === "values" ? this._agg_select_html(item.key, item.agg) : ""}
						<span class="ev-pv-chip-remove" data-key="${item.key}" data-zone="${zone_id}" style="cursor:pointer;color:var(--text-muted);font-size:13px;line-height:1">×</span>
					</div>
				`);
				chip.find(".ev-pv-chip-remove").on("click", (e) => {
					e.stopPropagation();
					const k    = $(e.currentTarget).data("key");
					const zone = $(e.currentTarget).data("zone");
					this._assign_field(k, zone, "list");
				});
				if (zone_id === "values") {
					chip.find(".ev-pv-agg-sel").on("change", (e) => {
						const cfg = this._val_configs.find((v) => v.field === item.key);
						if (cfg) cfg.agg = e.target.value;
					});
				}
				$zone.append(chip);
			});
		});
	}

	_agg_select_html(key, current_agg) {
		const aggs = ["SUM", "COUNT", "AVG", "MIN", "MAX"];
		return `<select class="ev-pv-agg-sel" data-key="${key}" style="font-size:10px;border:none;background:transparent;cursor:pointer">
			${aggs.map((a) => `<option value="${a}" ${a===current_agg?"selected":""}>${a}</option>`).join("")}
		</select>`;
	}

	_field_label(key) {
		return this.board.columns?.find((c) => c.data === key)?.title || key;
	}

	// ── Pivot computation ────────────────────────────────────────────────────

	/** Return the data for the currently active sheet (DocType or report/blank). */
	_get_active_data() {
		const active = this.board.sheet_manager?.get_current();  // get_current() is the correct API
		// Fresh data on a sub-sheet → use it. Pivot sheets are always fresh after recompute.
		if (active?.data?.length && (!active._data_is_stale || active.pivot_config)) return active.data;
		// No sub-sheet active → base list_view data (doctype sheet).
		if (!active) return this.board.list_view?.data || [];
		// Sub-sheet exists but stale/empty → return empty (don't pollute with wrong doctype rows).
		return [];
	}

	_generate() {
		if (!this._row_fields.length && !this._col_fields.length) {
			frappe.show_alert({ message: __("Add at least one Row or Column field"), indicator: "orange" }, 3);
			return;
		}
		if (!this._val_configs.length) {
			frappe.show_alert({ message: __("Add at least one Value field"), indicator: "orange" }, 3);
			return;
		}
		const $out = this.$modal.find(".ev-pv-output");
		$out.html(`<div class="ev-pv-loading"><div class="ev-pv-spinner"></div>${__("Computing…")}</div>`);

		const data = this._get_active_data();
		const engine = frappe.views.excel.duckdb_engine;

		engine.pivot(data, this._row_fields, this._col_fields, this._val_configs)
			.then(result => {
				if (!this.$modal.closest("body").length) return; // dialog closed
				$out.html(this._render_from_result(result));
			})
			.catch(() => {
				// Final fallback: synchronous JS render
				const html = this._render_pivot(data, this._row_fields, this._col_fields, this._val_configs);
				if (this.$modal.closest("body").length) $out.html(html);
			});
	}

	// ── Insert to Sheet ──────────────────────────────────────────────────────

	_insert_to_sheet() {
		if ((!this._row_fields.length && !this._col_fields.length) || !this._val_configs.length) {
			frappe.show_alert({ message: __("Configure the pivot first"), indicator: "orange" }, 3);
			return;
		}

		const data          = this._get_active_data();
		const source_sheet_id = this.board.sheet_manager?._active_id || null;
		const row_fields    = [...this._row_fields];
		const col_fields    = [...this._col_fields];
		const val_configs   = JSON.parse(JSON.stringify(this._val_configs));

		frappe.views.excel.duckdb_engine
			.pivot(data, row_fields, col_fields, val_configs)
			.then(result => {
				if (!result?.headers?.length) return;

				const hot_result = PivotBuilder._result_to_hot(result);
				const new_sheet_id = this.board.sheet_manager?.add_blank_sheet_with_data(
					"Pivot", hot_result.col_configs, hot_result.data_rows
				);

				if (new_sheet_id) {
					const new_sheet = this.board.sheet_manager._sheets.get(new_sheet_id);
					if (new_sheet) {
						new_sheet.pivot_config = { row_fields, col_fields, val_configs, source_sheet_id };
						this.board.sheet_manager._auto_persist_sheets?.();
					}
					const eng = result.engine === "duckdb" ? `⚡ DuckDB · ${result.query_ms}ms` : "JS";
					frappe.show_alert({ message: `${__("Pivot inserted")} (${eng})`, indicator: "green" }, 3);
				}
			})
			.catch(() => {
				// Sync fallback
				const result = this._compute_pivot_2d();
				if (!result) return;
				const hot_result = PivotBuilder._result_to_hot(result);
				this.board.sheet_manager?.add_blank_sheet_with_data("Pivot", hot_result.col_configs, hot_result.data_rows);
			})
			.finally(() => {
				if (this.$modal.closest("body").length) this.$modal.remove();
			});
	}

	/** Compute pivot as { headers: string[], rows: (string|number)[][] } */
	_compute_pivot_2d() {
		return PivotBuilder.compute(
			this._get_active_data(),
			this._row_fields,
			this._col_fields,
			this._val_configs,
		);
	}

	// ── Static helpers (used by sheet_manager for dynamic restore) ───────────

	/**
	 * Compute a pivot from raw data + config.
	 * Returns { headers, rows } or null on empty data.
	 */
	static compute(data, row_fields, col_fields, val_cfgs) {
		if (!data?.length) return null;

		const col_combos = col_fields.length
			? [...new Map(data.map((r) => {
				const key = col_fields.map((f) => String(r[f] ?? "")).join("\x00");
				return [key, col_fields.map((f) => r[f])];
			})).values()]
			: [[]];

		const row_groups = new Map();
		data.forEach((row) => {
			const rk = row_fields.map((f) => String(row[f] ?? "")).join("\x00");
			if (!row_groups.has(rk)) row_groups.set(rk, []);
			row_groups.get(rk).push(row);
		});

		const agg = (rows, field, fn) => {
			const vals = rows.map((r) => parseFloat(r[field])).filter((v) => !isNaN(v));
			if (!vals.length) return "";
			switch (fn) {
				case "SUM":   return +vals.reduce((a, b) => a + b, 0).toFixed(2);
				case "COUNT": return vals.length;
				case "AVG":   return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
				case "MIN":   return Math.min(...vals);
				case "MAX":   return Math.max(...vals);
				default:      return "";
			}
		};

		const field_label = (f) => f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

		const headers = [
			...row_fields.map(field_label),
			...col_combos.flatMap((combo) =>
				val_cfgs.map((v) => {
					const col_lbl = combo.length ? combo.map((c) => String(c ?? "")).join(" / ") : "";
					const val_lbl = `${v.agg}(${field_label(v.field)})`;
					return col_lbl ? `${col_lbl} › ${val_lbl}` : val_lbl;
				})
			),
		];

		const rows = [...row_groups.entries()].map(([rk, grp]) => {
			const row_vals = rk.split("\x00");
			const val_cells = col_combos.flatMap((combo) => {
				const filtered = combo.length
					? grp.filter((r) => col_fields.every((f, i) => String(r[f] ?? "") === String(combo[i] ?? "")))
					: grp;
				return val_cfgs.map((v) => agg(filtered, v.field, v.agg));
			});
			return [...row_vals, ...val_cells];
		});

		// Grand total row
		const grand = [
			...row_fields.map(() => "Grand Total"),
			...col_combos.flatMap((combo) => {
				const filtered = combo.length
					? data.filter((r) => col_fields.every((f, i) => String(r[f] ?? "") === String(combo[i] ?? "")))
					: data;
				return val_cfgs.map((v) => agg(filtered, v.field, v.agg));
			}),
		];
		rows.push(grand);

		return { headers, rows, row_field_count: row_fields.length, engine: "js", query_ms: 0 };
	}

	/** Render a pre-computed pivot result (from DuckDB or JS) as an HTML table. */
	_render_from_result(result) {
		if (!result?.headers?.length) {
			return `<div style="padding:16px;color:var(--text-muted);font-size:13px">${__("No data to pivot")}</div>`;
		}
		const { headers, rows, row_field_count = 0, engine, query_ms } = result;

		const badge = engine === "duckdb"
			? `<div class="ev-pv-engine-badge ev-pv-engine-duck">⚡ DuckDB-WASM · ${query_ms}ms · ${rows.length - 1} ${__("groups")}</div>`
			: `<div class="ev-pv-engine-badge ev-pv-engine-js">JS · ${rows.length - 1} ${__("groups")}</div>`;

		const thead = headers.map(h =>
			`<th class="ev-pv-th-col">${frappe.utils.escape_html(String(h))}</th>`
		).join("");

		const tbody = rows.map((row, ri) => {
			const is_grand = ri === rows.length - 1;
			const style    = is_grand ? "border-top:2px solid var(--border-color)" : "";
			const tds = row.map((v, ci) => {
				const is_num = ci >= row_field_count && !isNaN(Number(v)) && v !== "";
				const align  = is_num ? "right" : "left";
				const weight = (is_grand || ci < row_field_count) ? "font-weight:500" : "";
				return `<td style="text-align:${align};${weight}">${frappe.utils.escape_html(String(v ?? ""))}</td>`;
			}).join("");
			return `<tr style="${style}">${tds}</tr>`;
		}).join("");

		return `${badge}
			<table class="ev-pivot-table" style="border-collapse:collapse;font-size:12px;min-width:100%;margin-top:6px">
				<thead><tr>${thead}</tr></thead>
				<tbody>${tbody}</tbody>
			</table>`;
	}

	/** Convert a compute() result to HOT col_configs + data_rows. */
	static _result_to_hot({ headers, rows }) {
		const col_configs = headers.map((h, i) => ({
			data:  `_pv${i}`,
			title: h,
			type:  "text",
			width: Math.max(110, h.length * 7),
		}));
		const to_obj = (row) => {
			const obj = {};
			headers.forEach((_, i) => { obj[`_pv${i}`] = row[i] ?? ""; });
			return obj;
		};
		const data_rows = rows.map(to_obj);
		// Pad with empty rows
		const empty = {};
		headers.forEach((_, i) => { empty[`_pv${i}`] = ""; });
		for (let i = 0; i < 15; i++) data_rows.push({ ...empty });
		return { col_configs, data_rows };
	}

	_render_pivot(data, row_fields, col_fields, val_configs) {
		// Collect unique column-dimension combos
		const col_combos = col_fields.length
			? [...new Map(data.map((r) => {
				const key = col_fields.map((f) => String(r[f] ?? "")).join("\x00");
				return [key, col_fields.map((f) => r[f])];
			  })).values()]
			: [[]]; // single "total" column when no col dimension

		// Group rows by row_fields
		const row_groups = new Map();
		data.forEach((row) => {
			const rk = row_fields.map((f) => String(row[f] ?? "")).join("\x00");
			if (!row_groups.has(rk)) row_groups.set(rk, []);
			row_groups.get(rk).push(row);
		});

		// Aggregate
		const agg = (rows, field, fn) => {
			const vals = rows.map((r) => parseFloat(r[field])).filter((v) => !isNaN(v));
			if (!vals.length) return "";
			switch (fn) {
				case "SUM":   return vals.reduce((a, b) => a + b, 0).toFixed(2);
				case "COUNT": return vals.length;
				case "AVG":   return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
				case "MIN":   return Math.min(...vals);
				case "MAX":   return Math.max(...vals);
				default:      return "";
			}
		};

		// Build HTML table
		const ths_row_fields = row_fields.map((f) => `<th class="ev-pv-th-row">${frappe.utils.escape_html(this._field_label(f))}</th>`).join("");
		const ths_col_dim = col_combos.map((combo) => {
			const lbl = combo.length ? combo.map((v) => frappe.utils.escape_html(String(v ?? ""))).join(" / ") : __("Total");
			const span = val_configs.length;
			return `<th colspan="${span}" class="ev-pv-th-col" style="text-align:center">${lbl}</th>`;
		}).join("");
		const ths_val = col_combos.map(() =>
			val_configs.map((v) => `<th class="ev-pv-th-col" style="font-size:11px">${frappe.utils.escape_html(v.agg + "(" + this._field_label(v.field) + ")")}</th>`).join("")
		).join("");

		const rows_html = [...row_groups.entries()].map(([rk, group_rows]) => {
			const row_vals = rk.split("\x00");
			const td_row = row_fields.map((_, i) => `<td style="font-weight:500">${frappe.utils.escape_html(String(row_vals[i] ?? ""))}</td>`).join("");
			const td_vals = col_combos.map((combo) => {
				const filtered = combo.length
					? group_rows.filter((r) => col_fields.every((f, i) => String(r[f] ?? "") === String(combo[i] ?? "")))
					: group_rows;
				return val_configs.map((v) => `<td style="text-align:right">${agg(filtered, v.field, v.agg)}</td>`).join("");
			}).join("");
			return `<tr>${td_row}${td_vals}</tr>`;
		}).join("");

		// Grand total row
		const grand_td_row = row_fields.map(() => `<td><strong>${__("Grand Total")}</strong></td>`).join("");
		const grand_td_vals = col_combos.map((combo) => {
			const filtered = combo.length
				? data.filter((r) => col_fields.every((f, i) => String(r[f] ?? "") === String(combo[i] ?? "")))
				: data;
			return val_configs.map((v) => `<td style="text-align:right;font-weight:600">${agg(filtered, v.field, v.agg)}</td>`).join("");
		}).join("");

		return `
			<table class="ev-pivot-table" style="border-collapse:collapse;font-size:12px;min-width:100%">
				<thead>
					<tr>${ths_row_fields}${ths_col_dim}</tr>
					<tr>${row_fields.map(() => "<th></th>").join("")}${ths_val}</tr>
				</thead>
				<tbody>
					${rows_html}
					<tr style="border-top:2px solid var(--border-color)">${grand_td_row}${grand_td_vals}</tr>
				</tbody>
			</table>
		`;
	}
};
