/**
 * excel_view/components/sheet_manager.js  — V2.5
 *
 * Manages multiple sheet tabs within one ExcelBoard session.
 * Each tab is an independent DocType view with its own columns, data,
 * filters, formula columns, and HyperFormula sheet registration.
 *
 * Architecture:
 *  - SheetManager owns the tab strip DOM (appended below ev-grid-wrapper).
 *  - ExcelBoard delegates data-loading and column-building per sheet.
 *  - Switching tabs saves HOT scroll/widths → swaps columns + data → restores.
 *  - Sheet 0 (base doctype) cannot be removed or have its doctype changed.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.SheetManager = class SheetManager {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.board      - ExcelBoard instance
	 * @param {string} opts.doctype    - Base DocType (Sheet 0)
	 */
	constructor(opts) {
		this.board = opts.board;
		this._sheets = new Map(); // id → SheetState
		this._active_id = null;
		this._uid = 0;
		this.$tabs = null; // tab strip jQuery element
		this.$ilk_banner = null; // IntelliLookup banner element
	}

	// ── Public API ────────────────────────────────────────────────────────

	setup() {
		// Create Sheet 0 for the base doctype
		const s0 = this._make_state({
			label: this.board.doctype,
			doctype: this.board.doctype,
		});
		s0.hf_sheet_id = this.board.formula_bridge.sheet_id; // already Sheet1
		this._sheets.set(s0.id, s0);
		this._active_id = s0.id;

		this._build_tab_strip();
		this._render_tabs();

		// V3.3 — Live Pivot Refresh: recompute all pivot sheets when source data changes
		this._setup_live_pivot_refresh();
	}

	// V3.3 — Subscribe to frappe.realtime list_update for the base doctype so that
	// pivot sheets auto-recompute when another user creates/updates a record.
	_setup_live_pivot_refresh() {
		const doctype = this.board.doctype;
		frappe.realtime.on("list_update", (data) => {
			if (data?.doctype !== doctype) return;
			// Debounce — batch rapid fire updates
			clearTimeout(this._live_pivot_timer);
			this._live_pivot_timer = setTimeout(() => {
				// Only recompute if there are pivot sheets
				const pivot_sheets = [...this._sheets.values()].filter(s => s.pivot_config);
				if (!pivot_sheets.length) return;
				// Mark base sheet stale and refresh
				const base = [...this._sheets.values()].find(s => s.doctype === doctype && !s.is_blank);
				if (base) base._data_is_stale = true;
				// If a pivot sheet is currently active, trigger full refresh chain
				const active = this.get_current();
				if (active?.pivot_config) {
					this.board.list_view.refresh();
				} else {
					// Otherwise just recompute pivot sheets silently using current data
					pivot_sheets.forEach(s => this._recompute_pivot_sheet(s));
				}
			}, 1500);
		});
	}

	/** Add a new sheet tab via dialog. */
	prompt_add_sheet() {
		const d = new frappe.ui.Dialog({
			title: __("Add Sheet"),
			fields: [
				{
					label: __("Sheet Type"),
					fieldname: "sheet_type",
					fieldtype: "Select",
					options: [
						__("Data from DocType"),
						__("Blank Sheet"),
						__("Dashboard"),
					],
					default: __("Data from DocType"),
					onchange() { d.refresh_dependency(); },
				},
				{
					label: __("DocType"),
					fieldname: "doctype",
					fieldtype: "Link",
					options: "DocType",
					depends_on: `eval: doc.sheet_type === "${__("Data from DocType")}"`,
					mandatory_depends_on: `eval: doc.sheet_type === "${__("Data from DocType")}"`,
					get_query: () => ({
						filters: { istable: 0, issingle: 0 },
					}),
				},
				{
					label: __("Tab Label"),
					fieldname: "label",
					fieldtype: "Data",
				},
			],
			primary_action_label: __("Add"),
			primary_action: (vals) => {
				d.hide();
				if (vals.sheet_type === __("Blank Sheet")) {
					this.add_blank_sheet(vals.label || __("Sheet"));
				} else if (vals.sheet_type === __("Dashboard")) {
					this.add_dashboard_sheet(vals.label || __("Dashboard"));
				} else {
					if (!vals.doctype) return;
					this.add_sheet(vals.doctype, vals.label || vals.doctype);
				}
			},
		});
		d.show();
	}

	/**
	 * Add a new Dashboard sheet tab.
	 * @param {string} label
	 * @returns {Object} new sheet state
	 */
	add_dashboard_sheet(label = __("Dashboard")) {
		const state = this._make_state({ label, doctype: null, is_blank: false, is_dashboard: true });
		this._sheets.set(state.id, state);
		this._render_tabs();
		this.switch_to(state.id); // saves outgoing HOT state, sets _active_id, calls _lazy_fetch → _activate
		this._auto_persist_sheets();
		return state;
	}

	/**
	 * Add a blank (no-DocType) sheet with A–Z columns and empty rows.
	 * @param {string} label
	 * @returns {string} new sheet id
	 */
	add_blank_sheet(label) {
		const s = this._make_state({ doctype: null, label: label || __("Sheet"), is_blank: true });
		s.hf_sheet_id = this.board.formula_bridge.add_hf_sheet(s.label);
		s.is_blank = true;
		s.columns_config = this._blank_columns();
		s.data = this._blank_data();
		this._sheets.set(s.id, s);
		this._render_tabs();
		this.switch_to(s.id);
		this._auto_persist_sheets();
		return s.id;
	}

	/**
	 * Add a blank sheet pre-loaded with custom columns + data (used by PivotBuilder).
	 * @param {string}   label
	 * @param {Object[]} col_configs  - HOT column descriptors [{data, title, type, width}, ...]
	 * @param {Object[]} data_rows    - array of row objects keyed by col.data
	 * @returns {string} new sheet id
	 */
	add_blank_sheet_with_data(label, col_configs, data_rows, report_meta = null, query_ast = null) {
		const s = this._make_state({ doctype: null, label: label || __("Pivot"), is_blank: true });
		s.hf_sheet_id    = this.board.formula_bridge.add_hf_sheet(s.label);
		s.is_blank       = true;
		s.columns_config = col_configs;
		s.data           = data_rows;
		if (report_meta) s.report_meta = report_meta;
		// DuckDB query sheets: store the serialized AST instead of data rows.
		// On restore the query re-runs against fresh data automatically.
		if (query_ast) s.query_ast = typeof query_ast === "string" ? query_ast : JSON.stringify(query_ast);
		this._sheets.set(s.id, s);
		this._render_tabs();
		this.switch_to(s.id);
		this._auto_persist_sheets();
		return s.id;
	}

	/** 26 letter columns (A–Z) for blank sheets. */
	_blank_columns() {
		return Array.from({ length: 26 }, (_, i) => {
			const key = String.fromCharCode(65 + i);
			return { data: key, title: key, type: "text", width: 100 };
		});
	}

	/** 100 empty rows for blank sheets. */
	_blank_data() {
		return Array.from({ length: 100 }, () =>
			Object.fromEntries(
				Array.from({ length: 26 }, (_, i) => [String.fromCharCode(65 + i), ""])
			)
		);
	}

	/**
	 * Add a new sheet tab programmatically.
	 * @param {string} doctype
	 * @param {string} label
	 * @returns {string} new sheet id
	 */
	add_sheet(doctype, label) {
		const s = this._make_state({ doctype, label });
		// Register HF sheet
		s.hf_sheet_id = this.board.formula_bridge.add_hf_sheet(label);
		this._sheets.set(s.id, s);
		this._render_tabs();
		this.switch_to(s.id);
		this._auto_persist_sheets();

		return s.id;
	}

	/**
	 * Switch to a sheet tab by id.
	 * @param {string} id
	 */
	switch_to(id) {
		if (id === this._active_id) return;

		// Save HOT scroll + col widths + column config for current sheet
		this._save_hot_state(this._active_id);
		this._capture_col_config(this._active_id);

		// Save outgoing sheet's hidden col state before switching
		const _outgoing = this._sheets.get(this._active_id);
		if (_outgoing) _outgoing._hidden_col_keys = new Set(this.board._hidden_col_keys);

		const next = this._sheets.get(id);
		if (!next) return;

		// Recompute pivot sheet from live source data on every tab switch
		if (next.pivot_config) this._recompute_pivot_sheet(next);

		// DuckDB query sheet handling:
		//  - stale → trigger re-run with apply_when_done=true
		//  - not stale but data ready (background pre-warm finished) → apply directly below
		if (next.query_ast && next._data_is_stale) this._rerun_query_ast_sheet(next, true);

		this._active_id = id;
		this._render_tabs();
		// Reset secondary-sheet loading flag on every tab switch (prevents stuck state)
		this.board._sec_sheet_loading = false;

		if (next.data && next.data.length) {
			// Data already fetched (or pre-warmed in background) — swap directly
			this._apply_sheet(next);
		} else if (!next.query_ast) {
			// Lazy fetch — show loading state, fetch data for next doctype
			this._lazy_fetch(next);
		}
		// else: query_ast sheet with no data yet → _rerun_query_ast_sheet will call _apply_sheet
	}

	/** Remove a non-base sheet tab. */
	remove_sheet(id) {
		if (id === this._get_sheet0_id()) return; // cannot remove base sheet
		const s = this._sheets.get(id);
		if (!s) return;
		frappe.confirm(
			__("Remove sheet <b>{0}</b>?", [s.label]),
			() => {
				this._sheets.delete(id);
				if (this._active_id === id) {
					this.switch_to(this._get_sheet0_id());
				}
				this._render_tabs();
				this._auto_persist_sheets();
			}
		);
	}

	/** Get the active SheetState. */
	get_current() {
		return this._sheets.get(this._active_id);
	}

	/** Get all SheetStates as array. */
	get_all() {
		return [...this._sheets.values()];
	}

	/** Return the base (Sheet 0) id. */
	_get_sheet0_id() {
		return this._sheets.keys().next().value;
	}

	/**
	 * Serialize all sheets for workbook persistence.
	 * Omits runtime-only fields (data, hot_scroll).
	 * @returns {Array}
	 */
	/**
	 * Auto-persist sheet tabs to user_settings so page refresh restores them
	 * without requiring an explicit workbook save.
	 */
	_auto_persist_sheets() {
		const doctype = this.board?.doctype;
		if (!doctype) return;
		const serialized = this.serialize();
		// Synchronously patch in-memory cache BEFORE the async update() call so
		// concurrent saves (smart_lookups, cf_rules, etc.) don't overwrite with stale data.
		if (!frappe.model.user_settings[doctype]) frappe.model.user_settings[doctype] = {};
		frappe.model.user_settings[doctype].excel_sheets = serialized;
		// Debounced: batch rapid sheet ops (add/remove/rename) into single POST
		this._persist_sheets_debounced(doctype);
	}

	_persist_sheets_debounced(doctype) {
		clearTimeout(this._persist_timer);
		this._persist_timer = setTimeout(() => {
			frappe.model.user_settings.update(doctype, frappe.model.user_settings[doctype]);
		}, 400);
	}

	serialize() {
		return [...this._sheets.values()].map((s) => {
			const entry = {
				id: s.id,
				label: s.label,
				doctype: s.doctype,
				is_blank: s.is_blank || false,
				is_dashboard: s.is_dashboard || false,
				dashboard_widgets: s.dashboard_widgets || [],
				hf_sheet_id: s.hf_sheet_id,
				col_widths: s.col_widths,
				frozen: s.frozen,
				columns_config: s.columns_config,
				formula_columns: s.formula_columns,
				filters: s.filters,
				sort_by: s.sort_by,
				lookup_cols: s.lookup_cols,
				// Strip _controls (Frappe UI objects) — not JSON-serializable; rebuilt by filter bar on restore.
			report_meta: s.report_meta ? {
				name: s.report_meta.name,
				filter_defs: s.report_meta.filter_defs,
				current_filters: s.report_meta.current_filters,
			} : null,
				pivot_config: s.pivot_config || null,
			};
			// Pivot sheets: config only — data recomputed on restore.
			// Report sheets: report_meta saved; data re-fetched on restore (auto-refresh).
			// DuckDB query sheets: save only the AST — query re-runs on restore (fresh data, compact).
			// Plain blank sheets (CSV/JSON import): persist up to 200 rows.
			if (s.is_blank && !s.pivot_config && !s.report_meta?.name) {
				if (s.query_ast) {
					entry.query_ast = s.query_ast;  // compact serialized AST, never inflated by rows
				} else if (s.data?.length) {
					entry.blank_data = s.data.slice(0, 200);
				}
			}
			return entry;
		});
	}

	/**
	 * Restore sheets from workbook config.
	 * Sheet 0 already exists; additional sheets are created and lazy-fetched.
	 * @param {Array} sheets_config
	 */
	restore(sheets_config) {
		if (!sheets_config || !sheets_config.length) return;

		// Skip first entry (Sheet 0 = base doctype, already set up)
		sheets_config.slice(1).forEach((cfg) => {
			// Dashboard sheet — no DocType, no HOT data
			if (cfg.is_dashboard) {
				const state = this._make_state({
					label: cfg.label || __("Dashboard"),
					doctype: null,
					id: cfg.id,
					is_blank: false,
					is_dashboard: true,
				});
				state.dashboard_widgets = cfg.dashboard_widgets || [];
				this._sheets.set(state.id, state);
				return;
			}

			const s = this._make_state({
				doctype: cfg.doctype,
				label: cfg.label,
				id: cfg.id, // restore original id for cross-sheet refs
				is_blank: cfg.is_blank,
			});
			Object.assign(s, {
				hf_sheet_id: this.board.formula_bridge.add_hf_sheet(cfg.label),
				col_widths: cfg.col_widths || {},
				frozen: cfg.frozen || 0,
				columns_config: cfg.columns_config || (cfg.is_blank ? this._blank_columns() : null),
				formula_columns: cfg.formula_columns || [],
				filters: cfg.filters || [],
				sort_by: cfg.sort_by || null,
				lookup_cols: cfg.lookup_cols || [],
				report_meta: cfg.report_meta || null,
				pivot_config: cfg.pivot_config || null,
			});
			if (cfg.is_blank) {
				if (cfg.pivot_config) {
					// Pivot sheet: start with empty data; recomputed after all sheets are restored.
					s.data = this._blank_data();
				} else if (cfg.query_ast) {
					// DuckDB query sheet: start empty; query re-runs asynchronously after restore.
					s.data = this._blank_data();
					s.query_ast = cfg.query_ast;
					s._data_is_stale = true;
				} else {
					// Regular blank sheet: restore saved data or generate empty rows.
					s.data = cfg.blank_data?.length ? cfg.blank_data : this._blank_data();
					// Report sheets never save blank_data → mark stale so filter bar auto-refreshes
					// and so _reapply_smart_lookups won't use blank rows for the join.
					if (cfg.report_meta?.name || cfg.blank_data?.length) s._data_is_stale = true;
				}
			}
			this._sheets.set(s.id, s);
		});

		// Restore Sheet 0 config from first entry if provided
		const s0_cfg = sheets_config[0];
		if (s0_cfg) {
			const s0 = this._sheets.get(this._get_sheet0_id());
			if (s0) {
				s0.lookup_cols = s0_cfg.lookup_cols || [];
				// Restore original Sheet 0 id so cross-sheet refs (e.g. dashboard widget
				// sheet_id) remain valid after a page reload.  setup() always generates a
				// new id via Date.now(); restore() must restamp it to the saved value.
				//
				// IMPORTANT: use Map-rebuild (not delete+set) to preserve insertion order.
				// Map.delete+set moves the entry to the END — _get_sheet0_id() returns the
				// first key, so a reordered map would make Dashboard the "base" sheet.
				if (s0_cfg.id && s0_cfg.id !== s0.id) {
					const rebuilt = new Map();
					for (const [k, v] of this._sheets) {
						if (k === s0.id) {
							s0.id = s0_cfg.id;
							rebuilt.set(s0.id, s0);
						} else {
							rebuilt.set(k, v);
						}
					}
					this._sheets = rebuilt;
					this._active_id = s0.id;
				}
			}
		}

		this._render_tabs();
		this._auto_persist_sheets();

		// Recompute all pivot sheets now that source sheets are registered
		for (const s of this._sheets.values()) {
			if (s.pivot_config) this._recompute_pivot_sheet(s);
		}

		// Pre-warm DuckDB + re-run query sheets in background (fire and forget)
		// Kick off WASM init immediately so it's ready before the user clicks the tab.
		this._prewarm_and_rerun_ast_sheets();
	}

	/**
	 * Store data for the active sheet (called by board.refresh).
	 * @param {Array} data
	 */
	set_current_data(data) {
		const s = this.get_current();
		if (s) s.data = data;
	}

	/** Save current column config into active sheet state (for workbook save). */
	save_current_columns(columns_config, formula_columns, filters, sort_by) {
		const s = this.get_current();
		if (!s) return;
		s.columns_config = columns_config;
		s.formula_columns = formula_columns;
		s.filters = filters;
		s.sort_by = sort_by;
	}

	destroy() {
		if (this.$tabs) this.$tabs.remove();
	}


	// ── Tab Strip DOM ─────────────────────────────────────────────────────

	_build_tab_strip() {
		this.$tabs = $(`<div class="ev-sheet-tabs"></div>`);
		// this.board.$wrapper IS .ev-grid-wrapper (not a parent of it), so append directly
		this.board.$wrapper.append(this.$tabs);
	}

	_render_tabs() {
		if (!this.$tabs) return;

		const html = [...this._sheets.values()]
			.map((s) => {
				const is_active = s.id === this._active_id;
				const is_base   = s.id === this._get_sheet0_id();
				const tip       = s.is_dashboard
					? __("Dashboard")
					: s.is_blank
						? __("Blank Sheet")
						: frappe.utils.escape_html(s.doctype || "");
				const icon      = s.is_dashboard
					? `<span class="ev-tab-blank-icon" title="${__("Dashboard")}">⊞</span>`
					: s.is_blank
						? `<span class="ev-tab-blank-icon" title="${__("Blank Sheet")}">✎</span>`
						: "";
				return `
				<div class="ev-sheet-tab${is_active ? " ev-sheet-tab--active" : ""}${s.is_blank ? " ev-sheet-tab--blank" : ""}"
					data-id="${s.id}" title="${tip}">
					${icon}
					<span class="ev-tab-label">${frappe.utils.escape_html(s.label)}</span>
					${!is_base ? `<button class="ev-tab-close" data-id="${s.id}" title="${__("Remove")}">×</button>` : ""}
				</div>`;
			})
			.join("");

		this.$tabs.html(
			html + `<button class="ev-sheet-add" title="${__("Add Sheet")}">+</button>`
		);

		// Events
		this.$tabs.find(".ev-sheet-tab").on("click", (e) => {
			if ($(e.target).hasClass("ev-tab-close")) return;
			const id = $(e.currentTarget).data("id");
			if (id && id !== this._active_id) this.switch_to(id);
		});
		this.$tabs.find(".ev-tab-close").on("click", (e) => {
			e.stopPropagation();
			this.remove_sheet($(e.currentTarget).data("id"));
		});
		this.$tabs.find(".ev-sheet-add").on("click", () => this.prompt_add_sheet());

		// Double-click label → inline rename
		this.$tabs.find(".ev-tab-label").on("dblclick", (e) => {
			e.stopPropagation();
			const $tab = $(e.currentTarget).closest(".ev-sheet-tab");
			const id = $tab.data("id");
			const s = this._sheets.get(id);
			if (!s) return;
			const $lbl = $(e.currentTarget);
			const old = s.label;
			const $inp = $(`<input class="ev-tab-rename" value="${frappe.utils.escape_html(old)}">`);
			$lbl.replaceWith($inp);
			$inp.focus().select();
			const commit = () => {
				const val = $inp.val().trim() || old;
				s.label = val;
				this._render_tabs();
			};
			$inp.on("blur", commit).on("keydown", (ev) => {
				if (ev.key === "Enter") $inp.blur();
				if (ev.key === "Escape") { s.label = old; this._render_tabs(); }
			});
		});
	}

	// ── HOT swap helpers ──────────────────────────────────────────────────

	_save_hot_state(id) {
		if (!id) return;
		const s = this._sheets.get(id);
		if (!s || s.is_dashboard || !this.board.hot) return;
		const holder = this.board.hot.rootElement?.querySelector(".wtHolder");
		if (holder) s.hot_scroll = { left: holder.scrollLeft, top: holder.scrollTop };
	}

	/** Snapshot current board columns into the sheet state (non-blank, non-dashboard sheets only). */
	_capture_col_config(id) {
		if (!id) return;
		const s = this._sheets.get(id);
		if (!s || s.is_blank || s.is_dashboard || !this.board.columns) return;
		const plugin = this.board.hot?.getPlugin("manualColumnResize");
		s.columns_config = this.board.columns.map((col, i) => {
			const width = plugin?.columnWidthsMap?.get(i) ?? col.width ?? 140;
			if (col._is_formula_col) return { key: col.data, label: col.title, is_formula_col: true, width };
			if (col._is_join_col) return null;
			return { fieldname: col.data, title: col.title, width };
		}).filter(Boolean);
	}

	_apply_sheet(sheet) {
		// Dashboard sheets — delegate entirely to DashboardManager
		if (sheet.is_dashboard) {
			this.board.dashboard_manager?._activate(sheet);
			this._render_tabs();
			return;
		}
		// Deactivate dashboard if switching away from it
		this.board.dashboard_manager?._deactivate();

		const board = this.board;

		// Rebuild columns for this sheet's doctype
		board._switch_sheet_context(sheet);

		// Swap HF active sheet
		board.formula_bridge.set_active_sheet(sheet.hf_sheet_id);
		const mat = board.data_manager.to_matrix(sheet.data, board.columns);
		board.formula_bridge.reload_for_sheet(sheet.hf_sheet_id, mat);
		board.matrix = mat;

		// Load into HOT
		board.hot.updateSettings({
			columns: board.columns,
			fixedColumnsLeft: sheet.frozen || 0,
		});
		board.hot.loadData(sheet.data);

		// Restore scroll
		setTimeout(() => {
			const holder = board.hot.rootElement?.querySelector(".wtHolder");
			if (holder && sheet.hot_scroll) {
				holder.scrollLeft = sheet.hot_scroll.left;
				holder.scrollTop = sheet.hot_scroll.top;
			}
		}, 0);

		// Secondary sheet proactive fill: fetch more pages until container overflows.
		// Fires on first load AND every tab switch-back (covers both paths).
		if (sheet.doctype && sheet.doctype !== board.doctype) {
			if (!sheet._no_more_data && sheet._fetch_fields) {
				setTimeout(() => board._sec_sheet_fetch?.(sheet), 100);
			}
		}

		board.toolbar?.sync?.();
		board.status_bar?.clear?.();
		// Show report filter bar if this sheet was loaded from a report
		board.toolbar_component?._show_report_filter_bar?.(sheet);

		// Show only charts that belong to this sheet
		board.chart_manager?._show_overlays_for_sheet(sheet.id);

		// If this is a blank sheet with charts, silently refresh the underlying
		// list_view data so the charts always reflect the latest records.
		// board.refresh() will be called back by list_view after the fetch; the
		// blank-sheet guard in board.refresh() skips the HOT loadData (so the
		// A-Z blank grid is not clobbered) but still calls rerender_all_visible().
		if (sheet.is_blank) {
			const cm = board.chart_manager;
			const has_charts = cm?._overlays?.some(
				(o) => !o.cfg.sheet_id || o.cfg.sheet_id === sheet.id
			);
			if (has_charts) {
				board.list_view.last_args = null;
				board.list_view.refresh();
			}
		}
	}

	_lazy_fetch(sheet) {
		// Dashboard and blank sheets have no DocType — apply immediately
		if (sheet.is_dashboard || sheet.is_blank) {
			this._apply_sheet(sheet);
			return;
		}
		const board = this.board;
		// Show placeholder columns immediately while meta/data loads
		board._switch_sheet_context(sheet);
		board.hot.updateSettings({ columns: board.columns });
		board.hot.loadData([]);

		if (sheet.columns_config) {
			// Saved column config — restore sheet._columns so _switch_sheet_context uses the full
			// saved layout (including _meta/_social virtual col defs) without rebuilding from scratch.
			if (!sheet._columns) sheet._columns = sheet.columns_config;

			const META_FIELDS   = ["owner", "creation", "modified_by", "modified"];
			const SOCIAL_FIELDS = ["_user_tags", "_comments", "_assign", "_liked_by", "docstatus", "idx"];
			const has_meta   = sheet.columns_config.some(c => c._is_meta_col  || c.data === "_meta");
			const has_social = sheet.columns_config.some(c => c._is_social_col || c.data === "_social");

			// Extract only real Frappe fieldnames (skip virtual/formula/join cols)
			const fields = sheet.columns_config
				.filter((c) => !c.is_formula_col && !c._is_meta_col && !c._is_social_col)
				.map((c) => c.fieldname || c.key)
				.filter((f) => f && !f.startsWith("_") && !f.includes("__"));
			if (!fields.includes("name")) fields.unshift("name");
			// Add raw backing fields so renderers can paint meta/social cells
			if (has_meta)   META_FIELDS.forEach(f => !fields.includes(f) && fields.push(f));
			if (has_social) SOCIAL_FIELDS.forEach(f => !fields.includes(f) && fields.push(f));

			// Cache submittable flag (meta likely already in frappe cache from previous load)
			frappe.model.with_doctype(sheet.doctype, () => {
				sheet._is_submittable = !!frappe.get_meta(sheet.doctype)?.is_submittable;
			});
			this._do_fetch_sheet(sheet, fields);
		} else {
			// New/restored secondary sheet — need doctype meta to build columns + fetch fields
			frappe.model.with_doctype(sheet.doctype, () => {
				const meta = frappe.get_meta(sheet.doctype);
				// Cache submittable flag per-sheet (used by social column docstatus badge)
				sheet._is_submittable = !!meta?.is_submittable;
				const _NON_DATA = new Set(["Section Break", "Column Break", "HTML", "Table", "Tab Break", "Fold", "Heading"]);
				// Mirror Frappe's Report/List view: show only in_list_view fields; fall back to first 5
				let show_fields = meta.fields.filter(f => f.in_list_view && !_NON_DATA.has(f.fieldtype));
				if (!show_fields.length) show_fields = meta.fields.filter(f => !_NON_DATA.has(f.fieldtype)).slice(0, 5);

				// Build sheet._columns if _switch_sheet_context async hasn't finished yet
				if (!sheet._columns) {
					sheet._columns = [
						{ data: "name", title: "ID", type: "text", width: 160, readOnly: true, _readonly: true },
						...show_fields.map((f) => ({
							data: f.fieldname,
							title: f.label || f.fieldname,
							type: "text",
							width: 140,
							readOnly: f.read_only ? true : !board.list_view.can_write,
							_readonly: !!f.read_only,
						})),
					];
				}

				// Inject _meta virtual column (idempotent)
				const META_FIELDS = ["owner", "creation", "modified_by", "modified"];
				if (!sheet._columns.some((c) => c.data === "_meta")) {
					sheet._columns = sheet._columns.filter((c) => !META_FIELDS.includes(c.data));
					sheet._columns.splice(1, 0, {
						data: "_meta", title: "Created / Updated",
						readOnly: true, _readonly: true, _is_meta_col: true,
						width: 200, renderer: "text", className: "htDimmed",
					});
				}

				// Inject _social virtual column (idempotent)
				const SOCIAL_FIELDS = ["_user_tags", "_comments", "_assign", "_liked_by", "docstatus", "idx"];
				if (!sheet._columns.some((c) => c.data === "_social")) {
					sheet._columns = sheet._columns.filter((c) => !SOCIAL_FIELDS.includes(c.data));
					sheet._columns.push({
						data: "_social", title: "Activity",
						readOnly: true, _readonly: true, _is_social_col: true,
						width: 180, renderer: "text", className: "htDimmed",
					});
				}

				// Update HOT columns if this sheet is still active
				if (this.get_current()?.id === sheet.id) {
					board.columns = sheet._columns;
					board.hot.updateSettings({ columns: board.columns });
				}

				// Fetch all fields: display fields + raw meta + social (for cell renderers)
				const fields = [
					"name",
					...show_fields.map((f) => f.fieldname),
					...META_FIELDS,
					...SOCIAL_FIELDS,
				];
				this._do_fetch_sheet(sheet, fields);
			});
		}
	}

	_do_fetch_sheet(sheet, fields) {
		const board = this.board;
		const page_size = 20; // Fixed for secondary sheets — list_view.page_length belongs to base sheet
		// Persist fetch fields so infinite-scroll appends use the same field list
		sheet._fetch_fields = fields;
		sheet._no_more_data = false;
		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: sheet.doctype,
				fields,
				filters: sheet.filters || [],
				order_by: sheet.sort_by ? `${sheet.sort_by.field} ${sheet.sort_by.order}` : "modified desc",
				limit: page_size,
				limit_start: 0,
			},
			callback: (r) => {
				const data = r.message || [];
				if (data.length < page_size) sheet._no_more_data = true;
				sheet.data = data;
				this._apply_sheet(sheet);
				// Re-apply any smart lookups that target this sheet as source
				board._reapply_smart_lookups?.();
			},
		});
	}

	// ── Pivot recompute ───────────────────────────────────────────────────

	/**
	 * Recompute a pivot sheet's data from its source sheet's current live data.
	 * Updates sheet.columns_config + sheet.data in-place (no HOT reload — that
	 * happens naturally in switch_to / _apply_sheet after this returns).
	 */
	_recompute_pivot_sheet(sheet) {
		const cfg = sheet.pivot_config;
		if (!cfg) return;

		const src = this._sheets.get(cfg.source_sheet_id);
		// If source exists but is stale (report not yet refreshed), skip recompute.
		// Pivot will be recomputed when the user switches to it after source refreshes.
		if (src && src._data_is_stale) return;
		const data = src?.data?.length
			? src.data
			: (this.board.list_view?.data || []);

		const PivotBuilder = frappe.views.excel.PivotBuilder;
		if (!PivotBuilder?.compute) return;

		const result = PivotBuilder.compute(data, cfg.row_fields, cfg.col_fields, cfg.val_configs);
		if (!result) return;

		const { col_configs, data_rows } = PivotBuilder._result_to_hot(result);
		sheet.columns_config  = col_configs;
		sheet.data            = data_rows;
		sheet._data_is_stale  = false; // recomputed fresh — clear stale flag
	}

	/**
	 * Re-run a DuckDB query sheet from its stored AST against live data.
	 * @param {Object} sheet - SheetState with query_ast set
	 * @param {boolean} apply_when_done - call _apply_sheet after success (used from switch_to)
	 */
	/**
	 * Pre-warm DuckDB WASM + pre-load tables from IDB cache, then re-run all stale
	 * query_ast sheets in background.  Separating WASM init from query execution
	 * means perceived latency when the user clicks a query sheet is near-zero.
	 */
	async _prewarm_and_rerun_ast_sheets() {
		const engine = frappe.views?.excel?.duckdb_v2;
		if (!engine) return;
		const ast_sheets = [...this._sheets.values()].filter(s => s.query_ast && s._data_is_stale);
		if (!ast_sheets.length) return;

		// Step 1 — init WASM (idempotent — returns existing promise if already started)
		try { await engine._init(); } catch (_) { return; }

		// Step 2 — pre-load source tables from IDB in parallel (before query runs)
		const pre_fetch = [];
		const seen_doctypes = new Set();
		for (const s of ast_sheets) {
			try {
				const plain = JSON.parse(s.query_ast);
				const doctypes = [plain.source?.doctype, ...(plain.joins || []).map(j => j.tgt_doctype)]
					.filter(Boolean);
				for (const dt of doctypes) {
					if (!seen_doctypes.has(dt) && !engine._loaded_tables.has(dt)) {
						seen_doctypes.add(dt);
						pre_fetch.push(engine.bulk_fetch(dt).catch(() => {}));
					}
				}
			} catch (_) {}
		}
		if (pre_fetch.length) await Promise.all(pre_fetch);

		// Step 3 — run queries (tables already loaded → only SQL execution cost)
		for (const s of ast_sheets) {
			this._rerun_query_ast_sheet(s);
		}
	}

	async _rerun_query_ast_sheet(sheet, apply_when_done = false) {
		// Upgrade to apply if caller wants it even when a run is already in progress
		if (apply_when_done) sheet._apply_on_done = true;
		if (sheet._rerun_in_progress) return;
		sheet._rerun_in_progress = true;

		const engine = frappe.views.excel?.duckdb_v2;
		if (!engine) { sheet._rerun_in_progress = false; return; }

		try {
			// Reconstruct a proper QueryAST instance so class methods are available
			// to SQLGenerator (plain JSON objects lack prototype methods).
			const { QueryAST } = frappe.views.excel;
			const plain = JSON.parse(sheet.query_ast);
			const ast = (QueryAST && typeof QueryAST === "function")
				? Object.assign(new QueryAST(), plain)
				: plain;

			// First-page load: cap at 100 rows; more loaded on scroll via _query_sheet_fetch
			ast.offset = 0;
			ast.limit  = 100;

			const { headers, rows } = await engine.run_ast(ast);

			sheet.columns_config = headers.map(h => ({
				data: h, title: h, type: "text",
				width: Math.min(200, Math.max(80, h.length * 9)),
			}));
			sheet.data = rows.map(r => {
				const obj = {};
				headers.forEach((h, i) => { obj[h] = r[i] ?? ""; });
				return obj;
			});
			sheet._data_is_stale  = false;
			sheet._no_more_data   = rows.length < 100;  // fewer than page size → exhausted

			if (sheet._apply_on_done || this._active_id === sheet.id) {
				sheet._apply_on_done = false;
				this._apply_sheet(sheet);
			}
		} catch (e) {
			console.error(`[ExcelView] query_ast re-run failed for "${sheet.label}":`, e);
		} finally {
			sheet._rerun_in_progress = false;
		}
	}

	// ── State helpers ─────────────────────────────────────────────────────

	_make_state({ doctype, label, id, is_blank, is_dashboard }) {
		return {
			id: id || `ev_sheet_${++this._uid}_${Date.now()}`,
			label: label || doctype || __("Sheet"),
			doctype,
			is_blank: !!is_blank,
			is_dashboard: !!is_dashboard,
			dashboard_widgets: [],
			hf_sheet_id: 0,
			data: null,
			hot_scroll: { left: 0, top: 0 },
			col_widths: {},
			frozen: 0,
			columns_config: null,
			formula_columns: [],
			filters: [],
			sort_by: null,
			lookup_cols: [],
			report_meta: null,
			pivot_config: null,
		};
	}
};
