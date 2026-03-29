/**
 * excel_view/components/dashboard_manager.js  — V3.4
 *
 * DashboardManager — Dashboard sheet type:
 *   - Number Cards  (Count / Sum / Average / Min / Max on any sheet column,
 *                   including formula ⚡ and SmartLookup join ⤵ columns)
 *   - Charts        (Bar / Line / Pie / Donut; Raw-row or Group-By mode)
 *   - Date Filters  (from/to date range pickers)
 *
 * Widget UX:
 *   - Centered custom modal (matches Field Picker pattern, both themes)
 *   - Draggable + resizable via pointer events
 *   - Auto-refresh every 30 s (re-reads in-memory sheet data — zero extra API calls)
 *   - State persisted via sheet_manager._auto_persist_sheets() → user_settings + workbook
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.DashboardManager = class DashboardManager {
	constructor({ board }) {
		this.board = board;
		this._active_sheet = null;
		this._refresh_timer = null;
	}

	// ── Canvas accessor ───────────────────────────────────────────────────────

	_get_canvas() {
		return this.board.$dashboard_canvas;
	}

	// ── Activate / Deactivate ─────────────────────────────────────────────────

	_activate(sheet) {
		this._active_sheet = sheet;
		this.board.$hot_container?.hide();
		this.board.$status_bar_container?.hide();
		this._get_canvas()?.show();
		this._render_all(sheet);
		if (this._refresh_timer) clearInterval(this._refresh_timer);
		this._refresh_timer = setInterval(() => this._refresh_data(), 30000);
	}

	_deactivate() {
		clearInterval(this._refresh_timer);
		this._refresh_timer = null;
		this._get_canvas()?.hide();
		this.board.$hot_container?.show();
		this.board.$status_bar_container?.show();
		this.board.hot?.render();
		this._active_sheet = null;
	}

	// ── Render ────────────────────────────────────────────────────────────────

	_render_all(sheet) {
		const $canvas = this._get_canvas();
		if (!$canvas) return;
		$canvas.empty();
		(sheet.dashboard_widgets || []).forEach((cfg) => this._render_widget(cfg));
	}

	_render_widget(cfg) {
		const $canvas = this._get_canvas();
		if (!$canvas) return;

		const $widget = $(`
			<div class="ev-dash-widget ev-dash-widget--${frappe.utils.escape_html(cfg.type)}"
				style="left:${cfg.left || 20}px; top:${cfg.top || 20}px; width:${cfg.width || 280}px; height:${cfg.height || 140}px;"
				data-id="${frappe.utils.escape_html(cfg.id)}">
				<div class="ev-dash-widget__header">
					<div class="ev-dash-widget__drag-handle" title="${__("Drag to move")}">⠿</div>
					<span class="ev-dash-widget__title">${frappe.utils.escape_html(cfg.title || "")}</span>
					<button class="ev-dash-widget__edit btn btn-xs btn-default" title="${__("Edit")}">✎</button>
					<button class="ev-dash-widget__remove btn btn-xs btn-danger" title="${__("Remove")}">✕</button>
				</div>
				<div class="ev-dash-widget__body"></div>
				<div class="ev-dash-widget__resize-handle"></div>
			</div>
		`);

		if (cfg.type === "number_card")  this._render_number_card_body($widget, cfg);
		else if (cfg.type === "chart")   this._render_chart_body($widget, cfg);
		else if (cfg.type === "date_filter") this._render_date_filter_body($widget, cfg);

		this._bind_drag($widget[0], cfg);
		this._bind_resize($widget[0], cfg);

		$widget.find(".ev-dash-widget__edit").on("click", () => this._open_widget_modal(cfg.type, cfg));
		$widget.find(".ev-dash-widget__remove").on("click", () => {
			frappe.confirm(
				__("Remove widget <b>{0}</b>?", [frappe.utils.escape_html(cfg.title || cfg.type)]),
				() => this._remove_widget(cfg.id)
			);
		});

		$canvas.append($widget);
	}

	// ── Row filter helper ────────────────────────────────────────────────────

	/**
	 * Filter a data array using an array of {col, op, val} objects.
	 * Called before any aggregate (count/sum/avg/…) or chart rendering.
	 */
	_apply_row_filters(data, filters) {
		if (!filters?.length) return data;
		return data.filter((row) => filters.every((f) => {
			if (!f.col) return true;
			const cell = String(row[f.col] ?? "");
			const fv   = String(f.val ?? "");
			switch (f.op) {
				case "=":        return cell === fv;
				case "!=":       return cell !== fv;
				case "contains": return cell.toLowerCase().includes(fv.toLowerCase());
				case ">":        return parseFloat(cell) > parseFloat(fv);
				case "<":        return parseFloat(cell) < parseFloat(fv);
				case ">=":       return parseFloat(cell) >= parseFloat(fv);
				case "<=":       return parseFloat(cell) <= parseFloat(fv);
				default:         return true;
			}
		}));
	}

	// ── Sheet / Column helpers ────────────────────────────────────────────────

	/** [{label, id}] of all non-dashboard sheets in the workbook. */
	_get_sheet_options() {
		const opts = [];
		this.board.sheet_manager?._sheets.forEach((s) => {
			if (!s.is_dashboard) opts.push({ label: s.label || s.doctype || __("Sheet"), id: s.id });
		});
		return opts;
	}

	/** In-memory row array for a sheet_id. */
	_sheet_data(sheet_id) {
		return this.board.sheet_manager?._sheets.get(sheet_id)?.data || [];
	}

	/**
	 * Like _sheet_data but enriches each row with HyperFormula-computed values
	 * for formula columns (⚡). Raw data stores the formula string; only
	 * formula_bridge.get_display_value() returns the actual evaluated result.
	 */
	_enriched_sheet_data(sheet_id) {
		const base = this._sheet_data(sheet_id);
		if (!base.length) return base;

		const bridge = this.board.formula_bridge;
		if (!bridge?.hf) return base;

		const cols = this.board.columns || [];
		// Build list: formula-col key → HOT/HF column index
		const formula_cols = [];
		cols.forEach((c, i) => {
			if ((c._is_formula_col || c.is_formula_col) && (c.data || c.fieldname)) {
				formula_cols.push({ key: c.data || c.fieldname, idx: i });
			}
		});
		if (!formula_cols.length) return base;

		return base.map((row, row_idx) => {
			const enriched = Object.assign({}, row);
			formula_cols.forEach(({ key, idx }) => {
				const computed = bridge.get_display_value(row_idx, idx);
				if (computed !== null && computed !== undefined) enriched[key] = computed;
			});
			return enriched;
		});
	}

	/**
	 * Column options for a sheet.
	 * Includes formula columns (⚡) and SmartLookup join columns (⤵)
	 * that are present in the in-memory data.
	 * @param {string} sheet_id
	 * @returns {Array<{label, value}>}
	 */
	_get_col_options(sheet_id) {
		const s = this.board.sheet_manager?._sheets.get(sheet_id);
		if (!s) return [];

		// Active base sheet → use board.columns (includes live formula + join cols)
		const sm = this.board.sheet_manager;
		const is_active = sheet_id === sm?._active_id && !s.is_dashboard;
		const cols = is_active ? this.board.columns : s.columns_config;

		if (cols?.length) {
			return cols.map((c) => {
				const is_formula = c._is_formula_col || c.is_formula_col;
				const is_join    = c._is_join_col;
				const label = c.title || c.label || c.fieldname || c.data || c.key || "";
				const value = c.fieldname || c.data || c.key || "";
				if (!value || value === "_meta" || value === "_social") return null;
				const suffix = is_formula ? " ⚡" : is_join ? " ⤵" : "";
				return { label: label + suffix, value };
			}).filter(Boolean);
		}

		// Fallback: derive from first data row keys
		const first = s.data?.[0];
		if (first) {
			return Object.keys(first)
				.filter((k) => !k.startsWith("_"))
				.map((k) => ({ label: k, value: k }));
		}
		return [];
	}

	// ── Number Card ───────────────────────────────────────────────────────────

	_render_number_card_body($widget, cfg) {
		$widget.find(".ev-dash-widget__body").html(`
			<div class="ev-dash-numcard ev-dash-numcard--${frappe.utils.escape_html(cfg.color || "blue")}">
				<div class="ev-dash-numcard__value">—</div>
				<div class="ev-dash-numcard__label">${frappe.utils.escape_html(cfg.title || "")}</div>
			</div>
		`);
		this._compute_number_card($widget, cfg);
	}

	_compute_number_card($widget, cfg) {
		const sheet_id = cfg.sheet_id;
		const filters  = cfg.filters || [];

		// ── Detect formula-column filters → server-side path ──────────────────
		// Formula col keys look like _formula_0, _formula_1, etc.
		// We need to evaluate them for ALL rows (not just the loaded page_length).
		const formula_templates =
			frappe.get_user_settings(this.board.doctype)?.excel_formula_col_templates || [];
		const formula_filter = filters.find(f =>
			f.col && formula_templates.some(t => t.key === f.col)
		);

		if (formula_filter) {
			const template = formula_templates.find(t => t.key === formula_filter.col);
			if (template?.formula) {
				this._compute_number_card_server($widget, cfg, formula_filter, template.formula);
				return;
			}
		}

		// ── Standard client-side path ─────────────────────────────────────────
		this._show_card_value($widget, cfg,
			this._apply_row_filters(this._enriched_sheet_data(sheet_id), filters)
		);
	}

	/** Display the computed number card value. */
	_show_card_value($widget, cfg, data_or_val) {
		let val;
		if (typeof data_or_val === "number") {
			val = data_or_val;
		} else {
			const data = data_or_val;
			const fn   = cfg.aggregate || "count";
			if (fn === "count") {
				val = data.length;
			} else if (fn === "sum") {
				val = parseFloat(
					data.reduce((a, r) => a + (parseFloat(r[cfg.fieldname]) || 0), 0).toFixed(2)
				);
			} else if (fn === "avg") {
				const s = data.reduce((a, r) => a + (parseFloat(r[cfg.fieldname]) || 0), 0);
				val = data.length ? parseFloat((s / data.length).toFixed(2)) : 0;
			} else if (fn === "min") {
				val = data.reduce((a, r) => {
					const v = parseFloat(r[cfg.fieldname]);
					return isNaN(v) ? a : Math.min(a, v);
				}, Infinity);
				if (!isFinite(val)) val = 0;
				val = parseFloat(val.toFixed(2));
			} else if (fn === "max") {
				val = data.reduce((a, r) => {
					const v = parseFloat(r[cfg.fieldname]);
					return isNaN(v) ? a : Math.max(a, v);
				}, -Infinity);
				if (!isFinite(val)) val = 0;
				val = parseFloat(val.toFixed(2));
			}
		}

		const formatted = typeof val === "number"
			? val.toLocaleString("en-IN", { maximumFractionDigits: 2 })
			: "—";
		$widget.find(".ev-dash-numcard__value").text(formatted);
	}

	/**
	 * Server-side number card computation for formula columns (⚡).
	 * Calls excel_view.api.compute_card_aggregate which fetches ALL rows,
	 * evaluates the HyperFormula formula in Python, and returns the aggregate.
	 * Falls back to client-side on error.
	 */
	_compute_number_card_server($widget, cfg, formula_filter, formula_str) {
		const sheet_id = cfg.sheet_id;
		const sheet    = this.board.sheet_manager?._sheets.get(sheet_id);
		if (!sheet) { this._show_card_value($widget, cfg, []); return; }

		// Ordered column fieldnames (A→col[0], B→col[1], …)
		const sm = this.board.sheet_manager;
		const is_active = sheet_id === sm?._active_id && !sheet.is_dashboard;
		const cols = is_active ? this.board.columns : sheet.columns_config;
		const col_fieldnames = (cols || []).map(c => c.data || c.fieldname || "").filter(Boolean);

		// Current list filters for the sheet
		const list_filters = is_active
			? (this.board.list_view?.get_filters_for_args?.() || [])
			: (sheet.filters || []);

		// Non-formula card filters (plain DB fields) applied server-side too
		const extra_filters = (cfg.filters || []).filter(f => f.col !== formula_filter.col);

		$widget.find(".ev-dash-numcard__value").text("…");

		const fm = frappe.views.excel.formula_manager;
		frappe.call({
			method: "excel_view.api.compute_card_aggregate",
			args: {
				doctype:        sheet.doctype || this.board.doctype,
				formula:        formula_str,
				col_fieldnames: JSON.stringify(col_fieldnames),
				filter_op:      formula_filter.op  || "=",
				filter_val:     formula_filter.val || "",
				aggregate:      cfg.aggregate || "count",
				agg_fieldname:  cfg.fieldname || null,
				list_filters:   JSON.stringify(list_filters),
				extra_filters:  JSON.stringify(extra_filters),
				period_start:   fm?.period_start || null,
				period_end:     fm?.period_end   || null,
			},
			callback: (r) => {
				if (r?.message?.value !== undefined) {
					this._show_card_value($widget, cfg, r.message.value);
					if (r.message.truncated) {
						frappe.show_alert({
							message: __("Result based on first 50,000 rows (formula too complex for full SQL push-down)"),
							indicator: "orange",
						}, 6);
					}
				}
			},
			error: () => {
				// Fall back to client-side on any error
				this._show_card_value($widget, cfg,
					this._apply_row_filters(this._enriched_sheet_data(sheet_id), cfg.filters)
				);
			},
		});
	}

	// ── Chart ─────────────────────────────────────────────────────────────────

	_render_chart_body($widget, cfg) {
		if (!cfg.sheet_id || !cfg.x_key) return;
		const all_data = this._apply_row_filters(this._enriched_sheet_data(cfg.sheet_id), cfg.filters);
		if (!all_data.length) return;

		let labels, values;

		if (cfg.mode === "group_by") {
			// Aggregate rows by x_key value
			const groups = new Map();
			all_data.forEach((r) => {
				const x = String(r[cfg.x_key] ?? "(blank)");
				if (!groups.has(x)) groups.set(x, []);
				groups.get(x).push(r);
			});

			const entries = [...groups.entries()].slice(0, cfg.row_limit || 30);
			labels = entries.map(([k]) => k);
			const agg = cfg.y_aggregate || "count";
			values = entries.map(([, rows]) => {
				if (agg === "count") return rows.length;
				const nums = rows.map((r) => parseFloat(r[cfg.y_keys?.[0]]) || 0);
				if (agg === "sum") return parseFloat(nums.reduce((a, b) => a + b, 0).toFixed(2));
				if (agg === "avg") return nums.length
					? parseFloat((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2))
					: 0;
				return rows.length;
			});
		} else {
			// Raw: one point per row
			const rows = cfg.row_limit ? all_data.slice(0, cfg.row_limit) : all_data;
			labels = rows.map((r) => String(r[cfg.x_key] ?? ""));
			values = rows.map((r) => parseFloat(r[cfg.y_keys?.[0]]) || 0);
		}

		const $body = $widget.find(".ev-dash-widget__body");
		$body.empty();
		const $mount = $("<div>").css({ width: "100%", height: ((cfg.height || 320) - 60) + "px" }).appendTo($body);
		const chart_h = (cfg.height || 320) - 60;
		// rAF: let browser lay out the widget before frappe.Chart reads clientWidth.
		requestAnimationFrame(() => {
			try {
				new frappe.Chart($mount[0], {
					type: cfg.chart_type || "bar",
					title: cfg.title || "",
					data: { labels, datasets: [{ values }] },
					height: chart_h,
					colors: ["#5e64ff"],
				});
			} catch (_) {
				// frappe.Chart not available — silently skip
			}
		});
	}

	// ── Date Filter ───────────────────────────────────────────────────────────

	_render_date_filter_body($widget, cfg) {
		const $body = $widget.find(".ev-dash-widget__body");
		$body.html(`
			<div class="ev-dash-datefilter">
				<div>
					<label>${__("From")}</label>
					<input type="date" class="ev-dash-df-from" value="${frappe.utils.escape_html(cfg.from_date || "")}">
				</div>
				<div>
					<label>${__("To")}</label>
					<input type="date" class="ev-dash-df-to" value="${frappe.utils.escape_html(cfg.to_date || "")}">
				</div>
			</div>
		`);
		$body.find(".ev-dash-df-from").on("change", (e) => { cfg.from_date = e.target.value; this._persist(); });
		$body.find(".ev-dash-df-to").on("change",   (e) => { cfg.to_date   = e.target.value; this._persist(); });
	}

	// ── Drag ──────────────────────────────────────────────────────────────────

	_bind_drag(el, cfg) {
		// Use the whole header as the drag zone (but not Edit/Remove buttons)
		const header = el.querySelector(".ev-dash-widget__header");
		let drag = false, sx = 0, sy = 0, ol = 0, ot = 0;

		const on_move = (e) => {
			if (!drag) return;
			const canvas = this._get_canvas()?.[0];
			if (!canvas) return;
			const rect = canvas.getBoundingClientRect();
			const nl = Math.max(0, Math.min(ol + (e.clientX - sx), canvas.clientWidth - el.offsetWidth));
			const nt = Math.max(0, Math.min(ot + (e.clientY - sy), canvas.scrollHeight - el.offsetHeight));
			cfg.left = nl; cfg.top = nt;
			el.style.left = nl + "px"; el.style.top = nt + "px";
		};
		const on_up = () => {
			if (!drag) return;
			drag = false;
			document.removeEventListener("pointermove", on_move);
			document.removeEventListener("pointerup",   on_up);
			el.style.cursor = "";
			this._persist();
		};

		header.addEventListener("pointerdown", (e) => {
			// Ignore clicks on buttons (edit, remove)
			if (e.target.closest("button")) return;
			if (e.button !== 0) return;
			drag = true;
			sx = e.clientX; sy = e.clientY;
			ol = cfg.left || 0; ot = cfg.top || 0;
			el.style.cursor = "grabbing";
			e.preventDefault();
			document.addEventListener("pointermove", on_move);
			document.addEventListener("pointerup",   on_up);
		});
	}

	// ── Resize ────────────────────────────────────────────────────────────────

	_bind_resize(el, cfg) {
		const handle = el.querySelector(".ev-dash-widget__resize-handle");
		let rsz = false, sx = 0, sy = 0, ow = 0, oh = 0;

		handle.addEventListener("pointerdown", (e) => {
			if (e.button !== 0) return;
			rsz = true; sx = e.clientX; sy = e.clientY; ow = cfg.width || 280; oh = cfg.height || 140;
			handle.setPointerCapture(e.pointerId);
			e.preventDefault();
		});
		handle.addEventListener("pointermove", (e) => {
			if (!rsz) return;
			const canvas = this._get_canvas()?.[0];
			if (!canvas) return;
			const nw = Math.max(200, Math.min(ow + (e.clientX - sx), canvas.clientWidth - (cfg.left || 0)));
			const nh = Math.max(100, oh + (e.clientY - sy));
			cfg.width = nw; cfg.height = nh;
			el.style.width = nw + "px"; el.style.height = nh + "px";
		});
		handle.addEventListener("pointerup", () => { if (rsz) { rsz = false; this._persist(); } });
	}

	// ── Widget Modal ──────────────────────────────────────────────────────────

	/**
	 * Open the centered custom modal for adding (existing_cfg=null) or editing a widget.
	 * @param {"number_card"|"chart"|"date_filter"} type
	 * @param {Object|null} existing_cfg
	 */
	_open_widget_modal(type, existing_cfg = null) {
		const is_edit = !!existing_cfg;
		const title_map = {
			number_card:  is_edit ? __("Edit Number Card")  : __("Add Number Card"),
			chart:        is_edit ? __("Edit Chart")        : __("Add Chart"),
			date_filter:  is_edit ? __("Edit Date Filter")  : __("Add Date Filter"),
		};

		const $overlay = $(`<div class="ev-wm-overlay">`).appendTo(document.body);
		const $dialog  = $(`<div class="ev-wm-dialog">`).appendTo($overlay);

		$dialog.html(`
			<div class="ev-wm-header">
				<span class="ev-wm-title">${frappe.utils.escape_html(title_map[type] || "")}</span>
				<button class="ev-wm-close" title="${__("Close")}">✕</button>
			</div>
			<div class="ev-wm-body"></div>
			<div class="ev-wm-footer">
				<button class="ev-wm-cancel btn btn-default btn-sm">${__("Cancel")}</button>
				<button class="ev-wm-submit btn btn-primary btn-sm">
					${is_edit ? __("Update") : __("Add")}
				</button>
			</div>
		`);

		const $body = $dialog.find(".ev-wm-body");

		if (type === "number_card")  this._build_numcard_form($body, existing_cfg);
		else if (type === "chart")   this._build_chart_form($body, existing_cfg);
		else if (type === "date_filter") this._build_datefilter_form($body, existing_cfg);

		const close = () => { $overlay.removeClass("ev-wm-overlay--visible"); setTimeout(() => $overlay.remove(), 200); };
		$overlay.on("click", (e) => { if (e.target === $overlay[0]) close(); });
		$dialog.find(".ev-wm-close, .ev-wm-cancel").on("click", close);
		$(document).on("keydown.ev-wm", (e) => { if (e.key === "Escape") { close(); $(document).off("keydown.ev-wm"); } });

		$dialog.find(".ev-wm-submit").on("click", () => {
			const vals = this._collect_widget_vals($body, type);
			if (!vals) return;
			close();
			$(document).off("keydown.ev-wm");
			if (is_edit) this._apply_edit(existing_cfg, vals, type);
			else         this._apply_add(vals, type);
		});

		requestAnimationFrame(() => $overlay.addClass("ev-wm-overlay--visible"));
	}

	// ── Modal form builders ───────────────────────────────────────────────────

	_row(label, html, hint = "") {
		return `
			<div class="ev-wm-row">
				<label class="ev-wm-label">${label}</label>
				${html}
				${hint ? `<div class="ev-wm-hint">${hint}</div>` : ""}
			</div>`;
	}

	_select_opts(options, selected) {
		return options.map((o) => {
			const val = typeof o === "string" ? o : o.value;
			const lbl = typeof o === "string" ? o : o.label;
			return `<option value="${frappe.utils.escape_html(val)}"${val === selected ? " selected" : ""}>${frappe.utils.escape_html(lbl)}</option>`;
		}).join("");
	}

	_field_select(data_field, options, selected, extra_attrs = "") {
		return `
			<select class="ev-wm-select" data-field="${data_field}" ${extra_attrs}>
				<option value="">— ${__("pick a column")} —</option>
				${this._select_opts(options, selected)}
			</select>`;
	}

	_sheet_select(data_field, selected_id) {
		const opts = this._get_sheet_options();
		const html_opts = opts.map((o) =>
			`<option value="${frappe.utils.escape_html(o.id)}"${o.id === selected_id ? " selected" : ""}>${frappe.utils.escape_html(o.label)}</option>`
		).join("");
		return `
			<select class="ev-wm-select ev-wm-sheet-sel" data-field="${data_field}" required>
				<option value="">— ${__("pick a sheet")} —</option>
				${html_opts}
			</select>`;
	}

	_seg_buttons(data_field, options, selected) {
		const btns = options.map((o) => {
			const val = typeof o === "string" ? o : o.value;
			const lbl = typeof o === "string" ? o : o.label;
			return `<button type="button" class="ev-wm-seg-btn${val === selected ? " ev-wm-seg-btn--active" : ""}"
				data-val="${frappe.utils.escape_html(val)}">${frappe.utils.escape_html(lbl)}</button>`;
		}).join("");
		return `<div class="ev-wm-seg" data-field="${data_field}">${btns}</div>`;
	}

	_color_swatches(selected = "blue") {
		const colors = [
			{ val: "blue",   hex: "#2490ef" },
			{ val: "green",  hex: "#28a745" },
			{ val: "orange", hex: "#fd7e14" },
			{ val: "red",    hex: "#dc3545" },
			{ val: "purple", hex: "#9b59b6" },
		];
		const swatches = colors.map((c) => `
			<label class="ev-wm-color-opt${c.val === selected ? " ev-wm-color-opt--active" : ""}">
				<input type="radio" name="ev_wm_color" value="${c.val}"${c.val === selected ? " checked" : ""}>
				<span class="ev-wm-color-dot" style="background:${c.hex}" title="${__(c.val)}"></span>
			</label>`).join("");
		return `<div class="ev-wm-colors" data-field="color">${swatches}</div>`;
	}

	// ── Filter section helpers ────────────────────────────────────────────────

	_filter_op_opts(selected = "=") {
		return [
			{ v: "=",        l: "= (equals)" },
			{ v: "!=",       l: "≠ (not equals)" },
			{ v: "contains", l: "contains" },
			{ v: ">",        l: "> (greater)" },
			{ v: "<",        l: "< (less)" },
			{ v: ">=",       l: ">= (≥)" },
			{ v: "<=",       l: "<= (≤)" },
		].map((o) => `<option value="${o.v}"${o.v === selected ? " selected" : ""}>${o.l}</option>`).join("");
	}

	_filter_row_html(cols, f = {}) {
		const col_opts = `<option value="">— column —</option>` +
			cols.map((c) => `<option value="${frappe.utils.escape_html(c.value)}"${c.value === f.col ? " selected" : ""}>${frappe.utils.escape_html(c.label)}</option>`).join("");
		return `<div class="ev-wm-filter-row">
			<select class="ev-wm-select ev-wm-filter-col">${col_opts}</select>
			<select class="ev-wm-select ev-wm-filter-op">${this._filter_op_opts(f.op || "=")}</select>
			<input type="text" class="ev-wm-input ev-wm-filter-val" placeholder="${__("value")}" value="${frappe.utils.escape_html(f.val || "")}">
			<button type="button" class="ev-wm-filter-rm" title="${__("Remove filter")}">×</button>
		</div>`;
	}

	_filters_section_html(cols, filters = []) {
		const rows = filters.map((f) => this._filter_row_html(cols, f)).join("");
		return `<div class="ev-wm-filter-section">
			<div class="ev-wm-filter-hdr">
				<span class="ev-wm-filter-title">${__("Filters")}</span>
				<button type="button" class="ev-wm-filter-add">+ ${__("Add Filter")}</button>
			</div>
			<div class="ev-wm-filter-list">${rows}</div>
		</div>`;
	}

	_build_numcard_form($body, cfg) {
		const sheet_id = cfg?.sheet_id || "";
		const agg      = cfg?.aggregate || "count";
		const cols     = this._get_col_options(sheet_id);

		$body.html(
			this._row(__("Title") + " <span class='ev-wm-req'>*</span>",
				`<input type="text" class="ev-wm-input" data-field="title" placeholder="${__("e.g. Total Active Employees")}"
					value="${frappe.utils.escape_html(cfg?.title || "")}" required>`) +
			this._row(__("Sheet") + " <span class='ev-wm-req'>*</span>",
				this._sheet_select("sheet_id", sheet_id)) +
			this._row(__("Function"),
				this._seg_buttons("aggregate", [
					{ value: "count", label: __("Count") },
					{ value: "sum",   label: __("Sum") },
					{ value: "avg",   label: __("Average") },
					{ value: "min",   label: __("Min") },
					{ value: "max",   label: __("Max") },
				], agg)) +
			this._row(__("Column"),
				this._field_select("fieldname", cols, cfg?.fieldname || ""),
				__("Required for Sum / Average / Min / Max")) +
			this._row(__("Color"), this._color_swatches(cfg?.color || "blue")) +
			this._filters_section_html(cols, cfg?.filters || [])
		);

		this._bind_modal_events($body, "number_card");
	}

	_build_chart_form($body, cfg) {
		const sheet_id  = cfg?.sheet_id || "";
		const mode      = cfg?.mode || "group_by";
		const cols      = this._get_col_options(sheet_id);
		const chart_type = cfg?.chart_type || "bar";
		const y_agg     = cfg?.y_aggregate || "count";

		$body.html(
			this._row(__("Title") + " <span class='ev-wm-req'>*</span>",
				`<input type="text" class="ev-wm-input" data-field="title" placeholder="${__("e.g. Employees by Department")}"
					value="${frappe.utils.escape_html(cfg?.title || "")}" required>`) +
			this._row(__("Sheet") + " <span class='ev-wm-req'>*</span>",
				this._sheet_select("sheet_id", sheet_id)) +
			this._row(__("Chart Type"),
				this._seg_buttons("chart_type", [
					{ value: "bar",        label: __("Bar") },
					{ value: "line",       label: __("Line") },
					{ value: "pie",        label: __("Pie") },
					{ value: "donut",      label: __("Donut") },
					{ value: "percentage", label: __("%") },
				], chart_type)) +
			this._row(__("Mode"),
				this._seg_buttons("mode", [
					{ value: "group_by", label: __("Group By") },
					{ value: "raw",      label: __("Raw Rows") },
				], mode),
				__("Group By aggregates rows by X value. Raw plots each row directly.")) +
			this._row(__("X Axis") + " <span class='ev-wm-req'>*</span>",
				this._field_select("x_key", cols, cfg?.x_key || "")) +

			// Y Axis — Raw mode
			`<div class="ev-wm-row ev-wm-row--raw${mode === "raw" ? "" : " ev-wm-row--hidden"}">
				<label class="ev-wm-label">${__("Y Axis")} <span class='ev-wm-req'>*</span></label>
				${this._field_select("y_key", cols, cfg?.y_keys?.[0] || "")}
			</div>` +

			// Y Aggregation — Group By mode
			`<div class="ev-wm-row ev-wm-row--groupby${mode !== "raw" ? "" : " ev-wm-row--hidden"}">
				<label class="ev-wm-label">${__("Aggregation")}</label>
				${this._seg_buttons("y_aggregate", [
					{ value: "count", label: __("Count") },
					{ value: "sum",   label: __("Sum") },
					{ value: "avg",   label: __("Average") },
				], y_agg)}
			</div>` +

			// Y Field for Group By + sum/avg
			`<div class="ev-wm-row ev-wm-row--groupby-field${(mode !== "raw" && y_agg !== "count") ? "" : " ev-wm-row--hidden"}">
				<label class="ev-wm-label">${__("Y Column")}</label>
				${this._field_select("y_agg_field", cols, cfg?.y_keys?.[0] || "")}
			</div>` +

			this._row(__("Row Limit"),
				`<input type="number" class="ev-wm-input" data-field="row_limit" min="1" max="500"
					value="${cfg?.row_limit || 30}">`) +
			this._filters_section_html(cols, cfg?.filters || [])
		);

		this._bind_modal_events($body, "chart");
	}

	_build_datefilter_form($body, cfg) {
		$body.html(
			this._row(__("Label"),
				`<input type="text" class="ev-wm-input" data-field="title"
					value="${frappe.utils.escape_html(cfg?.title || "Date Range")}"
					placeholder="${__("Date Range")}">`)
		);
	}

	// ── Modal event binding ───────────────────────────────────────────────────

	_bind_modal_events($body, type) {
		// Segmented button toggle
		$body.on("click", ".ev-wm-seg-btn", (e) => {
			const $btn = $(e.currentTarget);
			const $seg = $btn.closest(".ev-wm-seg");
			$seg.find(".ev-wm-seg-btn").removeClass("ev-wm-seg-btn--active");
			$btn.addClass("ev-wm-seg-btn--active");

			// Chart mode toggle
			if (type === "chart" && $seg.attr("data-field") === "mode") {
				const is_raw = $btn.attr("data-val") === "raw";
				$body.find(".ev-wm-row--raw").toggleClass("ev-wm-row--hidden", !is_raw);
				$body.find(".ev-wm-row--groupby").toggleClass("ev-wm-row--hidden", is_raw);
				const y_agg = $body.find("[data-field='y_aggregate'] .ev-wm-seg-btn--active").attr("data-val") || "count";
				$body.find(".ev-wm-row--groupby-field").toggleClass("ev-wm-row--hidden", is_raw || y_agg === "count");
			}

			// Y aggregate toggle (show/hide y field)
			if (type === "chart" && $seg.attr("data-field") === "y_aggregate") {
				const is_raw  = $body.find("[data-field='mode'] .ev-wm-seg-btn--active").attr("data-val") === "raw";
				const no_field = $btn.attr("data-val") === "count";
				$body.find(".ev-wm-row--groupby-field").toggleClass("ev-wm-row--hidden", is_raw || no_field);
			}
		});

		// Color swatch radio
		$body.on("change", "[name='ev_wm_color']", (e) => {
			$body.find(".ev-wm-color-opt").removeClass("ev-wm-color-opt--active");
			$(e.currentTarget).closest(".ev-wm-color-opt").addClass("ev-wm-color-opt--active");
		});

		// Sheet change → rebuild column selects dynamically (including filter cols)
		$body.on("change", ".ev-wm-sheet-sel", (e) => {
			const sheet_id = e.target.value;
			const cols = this._get_col_options(sheet_id);
			const html_opts = `<option value="">— ${__("pick a column")} —</option>` +
				this._select_opts(cols, "");
			$body.find("select[data-field='fieldname'], select[data-field='x_key'], select[data-field='y_key'], select[data-field='y_agg_field']")
				.each((_, el) => { el.innerHTML = html_opts; });
			// Reset filter rows — columns are no longer valid after sheet change
			$body.find(".ev-wm-filter-list").empty();
		});

		// Add a new blank filter row
		$body.on("click", ".ev-wm-filter-add", () => {
			const sheet_id = $body.find(".ev-wm-sheet-sel").val() || "";
			const cols = this._get_col_options(sheet_id);
			$body.find(".ev-wm-filter-list").append(this._filter_row_html(cols, {}));
		});

		// Remove a filter row
		$body.on("click", ".ev-wm-filter-rm", (e) => {
			$(e.currentTarget).closest(".ev-wm-filter-row").remove();
		});
	}

	// ── Collect + validate modal values ──────────────────────────────────────

	_collect_widget_vals($body, type) {
		const get = (field) => {
			const el = $body.find(`[data-field="${field}"]`)[0];
			if (!el) return "";
			if (el.tagName === "INPUT" || el.tagName === "SELECT") return el.value?.trim() || "";
			if (el.classList.contains("ev-wm-seg")) {
				return el.querySelector(".ev-wm-seg-btn--active")?.getAttribute("data-val") || "";
			}
			if (el.classList.contains("ev-wm-colors")) {
				return el.querySelector("input:checked")?.value || "blue";
			}
			return "";
		};

		const collect_filters = () => {
			const result = [];
			$body.find(".ev-wm-filter-row").each((_, row) => {
				const col = $(row).find(".ev-wm-filter-col").val()?.trim() || "";
				const op  = $(row).find(".ev-wm-filter-op").val() || "=";
				const val = $(row).find(".ev-wm-filter-val").val()?.trim() || "";
				if (col && val !== "") result.push({ col, op, val });
			});
			return result;
		};

		if (type === "number_card") {
			const title    = get("title");
			const sheet_id = get("sheet_id");
			if (!title)    { frappe.show_alert({ message: __("Title is required"),    indicator: "red" }, 3); return null; }
			if (!sheet_id) { frappe.show_alert({ message: __("Sheet is required"),    indicator: "red" }, 3); return null; }
			return { title, sheet_id, aggregate: get("aggregate") || "count", fieldname: get("fieldname"), color: get("color") || "blue", filters: collect_filters() };
		}

		if (type === "chart") {
			const title    = get("title");
			const sheet_id = get("sheet_id");
			const x_key    = get("x_key");
			const mode     = get("mode") || "group_by";
			const y_key    = mode === "raw" ? get("y_key") : null;
			const y_agg    = mode !== "raw" ? (get("y_aggregate") || "count") : null;
			const y_field  = (mode !== "raw" && y_agg !== "count") ? get("y_agg_field") : null;
			if (!title)    { frappe.show_alert({ message: __("Title is required"),    indicator: "red" }, 3); return null; }
			if (!sheet_id) { frappe.show_alert({ message: __("Sheet is required"),    indicator: "red" }, 3); return null; }
			if (!x_key)    { frappe.show_alert({ message: __("X Axis is required"),   indicator: "red" }, 3); return null; }
			return {
				title, sheet_id,
				chart_type:   get("chart_type") || "bar",
				mode,
				x_key,
				y_keys:       [y_key || y_field || ""],
				y_aggregate:  y_agg,
				row_limit:    parseInt(get("row_limit")) || 30,
				filters:      collect_filters(),
			};
		}

		if (type === "date_filter") {
			return { title: get("title") || "Date Range" };
		}

		return null;
	}

	// ── Apply add / edit ──────────────────────────────────────────────────────

	_apply_add(vals, type) {
		const sizes = {
			number_card: { width: 280, height: 140 },
			chart:       { width: 480, height: 320 },
			date_filter: { width: 300, height: 120, from_date: null, to_date: null },
		};
		// Place new widget below the previous one (clear of its full height + gap)
		const existing = this._active_sheet?.dashboard_widgets || [];
		const GAP = 16;
		let left = 20, top = 20;
		if (existing.length) {
			const last = existing[existing.length - 1];
			left = last.left || 20;
			top  = (last.top || 20) + (last.height || 140) + GAP;
		}
		this._add_widget({
			id: "dw_" + frappe.utils.get_random(8),
			type,
			left,
			top,
			...sizes[type],
			...vals,
		});
	}

	_apply_edit(cfg, vals, type) {
		Object.assign(cfg, vals);
		const $w = this._get_canvas()?.find(`[data-id="${cfg.id}"]`);
		if ($w?.length) {
			$w.find(".ev-dash-widget__title").text(cfg.title);
			if (type === "number_card")  this._render_number_card_body($w, cfg);
			else if (type === "chart")   this._render_chart_body($w, cfg);
		}
		this._persist();
	}

	// ── Widget CRUD ───────────────────────────────────────────────────────────

	_add_widget(cfg) {
		if (!this._active_sheet) return;
		if (!cfg.id) cfg.id = "dw_" + frappe.utils.get_random(8);
		this._active_sheet.dashboard_widgets = this._active_sheet.dashboard_widgets || [];
		this._active_sheet.dashboard_widgets.push(cfg);
		this._render_widget(cfg);
		this._persist();
	}

	_remove_widget(id) {
		if (!this._active_sheet) return;
		this._active_sheet.dashboard_widgets = (this._active_sheet.dashboard_widgets || []).filter((w) => w.id !== id);
		this._get_canvas()?.find(`[data-id="${id}"]`).remove();
		this._persist();
	}

	// ── Auto-refresh ──────────────────────────────────────────────────────────

	_refresh_data() {
		if (!this._active_sheet) return;
		const $canvas = this._get_canvas();
		(this._active_sheet.dashboard_widgets || []).forEach((cfg) => {
			const $w = $canvas?.find(`[data-id="${cfg.id}"]`);
			if (!$w?.length) return;
			if (cfg.type === "number_card") this._compute_number_card($w, cfg);
			else if (cfg.type === "chart")  this._render_chart_body($w, cfg);
		});
	}

	// ── Persistence ───────────────────────────────────────────────────────────

	_persist() {
		this.board.sheet_manager?._auto_persist_sheets();
	}

	// ── Destroy ───────────────────────────────────────────────────────────────

	destroy() {
		clearInterval(this._refresh_timer);
		this._refresh_timer = null;
		this._active_sheet = null;
		$(document).off("keydown.ev-wm");
	}
};
