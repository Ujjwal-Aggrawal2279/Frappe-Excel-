/**
 * excel_view/components/excel_board.js
 *
 * Main controller for the Excel View grid.
 * Owns the Handsontable instance and coordinates all sub-components:
 *   Toolbar, FormulaBar, ColumnManager, DataManager, FormulaBridge, ContextMenu.
 *
 * Lifecycle:
 *   new ExcelBoard(opts) → _setup() → HOT initialised → ready
 *   board.refresh(data)  → HOT reloaded with new data
 */

import Handsontable from "handsontable";

frappe.provide("frappe.views");
frappe.provide("frappe.views.excel");

frappe.views.ExcelBoard = class ExcelBoard {
	/**
	 * @param {Object}  opts
	 * @param {Element} opts.wrapper       - DOM container for the HOT grid
	 * @param {Element} opts.formula_bar   - DOM container for the formula bar
	 * @param {Element} [opts.toolbar]     - DOM container for the toolbar (optional)
	 * @param {string}  opts.doctype
	 * @param {Object}  opts.meta          - Frappe DocType meta
	 * @param {Object[]} opts.data         - Array of row objects from server
	 * @param {Array[]} opts.fields        - [[fieldname, doctype], ...]
	 * @param {Object}  opts.list_view     - ExcelView (ListView) instance
	 */
	constructor(opts) {
		Object.assign(this, opts);
		this.hot = null;
		this.matrix = [];
		this.columns = [];
		// Sparse map of per-cell formatting: { "row:col": { bold, italic, ... } }
		this.format_store = {};
		// Snapshot of list_view.fields at board creation time so _deselect() can
		// restore it after a workbook (which overwrites list_view.fields) is closed.
		this._default_list_view_fields = [...(this.list_view.fields || [])];
		// V2.6 — Conditional formatting rules, overlays, and flags
		this.cond_fmt_rules = [];
		this.chart_overlays = [];
		this._show_formulas = false;
		this._has_unsaved_changes = false;
		// Inline insert: index of the pending _is_new row (-1 = none)
		this._new_row_idx = -1;
		// V3.1 — Hidden rows (board-level Set, HOT 6 uses updateSettings not getPlugin)
		this._hidden_rows = new Set();
		// V3.1 — Focus Cell (crosshair)
		this._focus_enabled = false;
		this._focus_color = "#217346"; // Excel green default
		this._focus_color_rgb = { r: 33, g: 115, b: 70 }; // cached parsed RGB (avoid per-cell parseInt)
		this._focus_row = -1;
		this._focus_col = -1;
		// V3.1 — Formula Precedent Highlighting
		this._precedent_cells = new Set();
		// Perf: tree-child CF lookup (avoids O(n) findIndex per cell in afterRenderer)
		this._tree_parent_map = null;
		// Perf: meta-cell HTML cache (avoids repeated innerHTML builds + date parses)
		this._meta_html_cache = new Map();
		// Social column cache
		this._social_html_cache = new Map();
		// Submittable doctype flag — cached once; controls whether docstatus chip is shown
		this._is_submittable = !!frappe.get_meta?.(this.doctype)?.is_submittable;
		// Perf: column fieldname → index Map (O(1) lookup vs O(n) findIndex)
		this._col_index_map = null;
		// Perf: CF cell cache — "row:col" → {bg,color,bold} pre-computed on data load
		this._cf_cell_cache = new Map();
		// Perf: hidden row dirty flag — only sync DOM when Set changes, not every render
		this._dirty_hidden_rows = false;
		// V3.1 — Repeat Last Action (F4)
		this._last_action = null;

		// V3.3 — Bulk Add Mode
		// _bulk_add_start: index in list_view.data where new (unsaved) rows begin (-1 = inactive)
		this._bulk_add_start = -1;
		this._bulk_renderer_hook = null; // HOT afterRenderer hook ref, removed on exit

		this._setup();
	}

	// ── Setup ─────────────────────────────────────────────────────────────────

	_setup() {
		// 1. Sub-components
		this.column_manager = new frappe.views.excel.ColumnManager({
			board: this,
			meta: this.meta,
			fields: this.fields,
			can_write: this.list_view.can_write,
		});

		this.data_manager = new frappe.views.excel.DataManager({ board: this });

		this.formula_bridge = new frappe.views.excel.FormulaBridge({ board: this });

		this.context_menu = new frappe.views.excel.ContextMenu({ board: this });

		this.formula_bar_component = new frappe.views.excel.FormulaBar({
			board: this,
			wrapper: this.formula_bar,
		});

		this.export_manager = new frappe.views.excel.ExportManager({ board: this });

		// Toolbar (optional — only if wrapper provided)
		if (this.toolbar) {
			this.toolbar_component = new frappe.views.excel.ExcelToolbar({
				board: this,
				wrapper: this.toolbar,
			});
		}

		// Workbook manager — handles Save / Load view persistence.
		// Must be created before setup() so it can bind to toolbar buttons
		// that toolbar_component.setup() renders.
		this.workbook_manager = new frappe.views.excel.WorkbookManager({ board: this });

		// V2.6 — Chart / CF / Pivot managers (toolbar delegates to these)
		this.cf_manager       = new frappe.views.excel.CFManager({ board: this });
		this.chart_manager    = new frappe.views.excel.ChartManager({ board: this });
		this.pivot_builder    = new frappe.views.excel.PivotBuilder({ board: this });
		this.dashboard_manager = new frappe.views.excel.DashboardManager({ board: this });

		// 2. Load persisted freeze state (needed before _init_hot)
		this._frozen_cols = this.column_manager.load_freeze();
		this._frozen_rows = 0; // will be overwritten from user_settings below

		// ── CT fields: restore saved child-table column selection ────────────
		// excel_ct_columns is stored separately so CT fieldnames never end up in
		// list_view.fields (the Frappe server doesn't know table__field names).
		this._ct_fieldnames = frappe.get_user_settings(this.doctype)?.excel_ct_columns || [];
		if (this._ct_fieldnames.length) {
			this.column_manager.fields = [
				...this.column_manager.fields,
				...this._ct_fieldnames.map(f => [f, this.doctype]),
			];
		}

		// Build columns + matrix
		this.columns = this.column_manager.get_columns();
		// _master_columns is the authoritative list of ALL columns (visible + hidden).
		// this.columns = visible subset. Slicing keeps them independent.
		this._master_columns = [...this.columns];
		this._hidden_col_keys = new Set(); // data keys of hidden columns
		// V3.1 — Inject combined meta column (Created/Updated info) if std fields present
		this._inject_meta_column();
		// Inject combined social column (Tags/Comments/Assign/Liked/Status/Idx) if present
		this._inject_social_column();
		// V3.3 — Apply persisted column order (drag-reorder)
		this._apply_saved_col_order();
		// Snapshot the physical column order HOT will be initialized with.
		// toPhysicalColumn(v) is ALWAYS relative to this original order — never changes.
		this._original_columns = [...this.columns];
		this.matrix = this.data_manager.to_matrix(this.data, this.columns);

		// Initialise formula engine
		this.formula_bridge.init(this.matrix);

		// V2.3 — Wire the async formula manager to the live HF instance.
		// Must happen after formula_bridge.init() which calls HyperFormula.buildEmpty().
		frappe.views.excel.formula_manager?.set_hf(this.formula_bridge.hf);

		// 4. Render formula bar + toolbar, then set up workbook manager bindings
		this.formula_bar_component.setup();
		this.toolbar_component?.setup();
		this.workbook_manager.setup(); // binds to toolbar buttons rendered above

		// 5. Build HOT container and initialise
		this._init_container();
		// Restore frozen-column class from user_settings (before HOT init)
		if (this._frozen_cols > 0) this.$hot_container.addClass("ev-cols-frozen");
		// V3.1 — Load hidden rows BEFORE _init_hot() so afterRenderer/afterGetRowHeader
		// apply display:none on the very first render (no setTimeout patch needed)
		const _saved_hidden = frappe.get_user_settings(this.doctype)?.excel_hidden_rows;
		if (Array.isArray(_saved_hidden) && _saved_hidden.length) {
			this._hidden_rows = new Set(_saved_hidden);
		}
		this._init_hot();
		// Restore hidden columns AFTER HOT init so _sync_visible_columns can call updateSettings
		const _saved_hidden_cols = frappe.get_user_settings(this.doctype)?.excel_hidden_cols;
		if (Array.isArray(_saved_hidden_cols) && _saved_hidden_cols.length) {
			_saved_hidden_cols.forEach(key => this._hidden_col_keys.add(key));
			this._sync_visible_columns();
		}
		// Restore Smart Lookup configs (column defs only — data re-joined after first refresh)
		const _saved_slk = frappe.get_user_settings(this.doctype)?.excel_smart_lookups;
		if (Array.isArray(_saved_slk) && _saved_slk.length) {
			this._applied_lookups = _saved_slk;
		}
		// V3.1 — Restore manual row heights AFTER HOT init (plugin must exist)
		const _saved_rh = frappe.get_user_settings(this.doctype)?.excel_row_heights;
		if (Array.isArray(_saved_rh) && _saved_rh.some(h => h != null)) {
			setTimeout(() => {
				const rh_plugin = this.hot?.getPlugin("manualRowResize");
				if (rh_plugin) {
					rh_plugin.manualRowHeights = [..._saved_rh];
					this.hot.render();
				}
			}, 0);
		}

		// V2.3 — Wire the re-render callback now that this.hot exists.
		// Also refresh dashboard widgets when async formula results (e.g. FRAPPE_COUNT)
		// resolve — without this, number card filters on formula columns show stale 0
		// until the 30s auto-refresh fires.
		frappe.views.excel.formula_manager?.set_rerender(() => {
			this.hot?.render();
			if (this.dashboard_manager?._active_sheet) {
				this.dashboard_manager._refresh_data();
			}
		});

		// ── Unified realtime handler ──────────────────────────────────────────
		// Formula-cache realtime handler is registered via _register_formula_realtime()
		// which is called by ExcelView.setup_realtime_updates() — this ensures the handler
		// survives Frappe's frappe.realtime.off("list_update") that runs on every refresh().
		this._register_formula_realtime();

		// Status bar — after container is ready so $status_bar_container exists
		this.status_bar = new frappe.views.excel.StatusBar({
			board: this,
			wrapper: this.$status_bar_container[0],
		});

		// 6. Sheet tabs (V2.5) — setup after HOT and status bar exist
		this.sheet_manager = new frappe.views.excel.SheetManager({ board: this });
		this.sheet_manager.setup();
		// Restore extra sheet tabs from user_settings (if no workbook is auto-loading).
		// Workbook auto-restore happens at setTimeout(0) and will overwrite this if present.
		{
			const _us = frappe.get_user_settings(this.doctype) || {};
			const _saved_sheets = _us.excel_sheets;
			const _has_wb = !!_us.excel_current_workbook?.name;
			if (!_has_wb && Array.isArray(_saved_sheets) && _saved_sheets.length > 1) {
				setTimeout(() => this.sheet_manager?.restore(_saved_sheets), 0);
			}
		}

		// 7. V2.6 — Load CF rules + format_store + gridlines from user_settings
		const saved_cf = frappe.get_user_settings(this.doctype)?.excel_cf_rules;
		if (Array.isArray(saved_cf)) this.cond_fmt_rules = saved_cf;

		const saved_fmt = frappe.get_user_settings(this.doctype)?.excel_format_store;
		if (saved_fmt && typeof saved_fmt === "object") this.format_store = saved_fmt;

		const saved_gridlines = frappe.get_user_settings(this.doctype)?.excel_hide_gridlines;
		if (saved_gridlines) this.$hot_container?.addClass("ev-hide-gridlines");

		const saved_freeze_rows = frappe.get_user_settings(this.doctype)?.excel_view_freeze_rows || 0;
		this._frozen_rows = saved_freeze_rows;
		if (saved_freeze_rows > 0) {
			setTimeout(() => this.hot?.updateSettings({ fixedRowsTop: saved_freeze_rows }), 0);
		}

		// V2.6 — Restore chart overlays from user_settings (not just workbook)
		const saved_charts = frappe.get_user_settings(this.doctype)?.excel_chart_overlays;
		if (Array.isArray(saved_charts) && saved_charts.length) {
			setTimeout(() => this._restore_chart_overlays(saved_charts), 100);
		}

		// Restore formula column templates from user_settings (no workbook needed).
		// Deduplicate by key — a past bug could produce two entries with the same
		// __fml_N__ key; keep only the last occurrence (most recently saved).
		const saved_formula_col_templates = frappe.get_user_settings(this.doctype)?.excel_formula_col_templates;
		if (Array.isArray(saved_formula_col_templates) && saved_formula_col_templates.length) {
			const seen_keys = new Map();
			for (const fc of saved_formula_col_templates) {
				if (fc?.key) seen_keys.set(fc.key, fc);
			}
			this._pending_formula_col_templates = [...seen_keys.values()];
		}

		// Restore blank column configs from user_settings
		const saved_blank_col_configs = frappe.get_user_settings(this.doctype)?.excel_blank_col_configs;
		if (Array.isArray(saved_blank_col_configs) && saved_blank_col_configs.length) {
			this._pending_blank_col_configs = saved_blank_col_configs;
		}

		// V3.1 — Restore Focus Cell settings
		const saved_focus = frappe.get_user_settings(this.doctype)?.excel_focus_cell;
		if (saved_focus) {
			this._focus_enabled = !!saved_focus.enabled;
			if (saved_focus.color) this._focus_color = saved_focus.color;
		}

		// 8. Read-only banner — shown when the user has no write access
		this._show_readonly_banner_if_needed();

		// 8. Keyboard shortcuts
		this._bind_shortcuts();
	}

	/** Show a read-only indicator above the grid when the user cannot write. */
	/**
	 * Mark the workbook as having unsaved changes.
	 * Shows a pulsing dot on the Save button so the user knows to save.
	 * Called by chart_manager, cf_manager, and format changes.
	 */
	_mark_unsaved() {
		if (this._has_unsaved_changes) return;
		this._has_unsaved_changes = true;
		$(this.toolbar).find(".ev-wb-save-btn").addClass("ev-wb-save-btn--dirty");
	}

	/** Clear the unsaved indicator (called by WorkbookManager after a successful save). */
	_mark_saved() {
		this._has_unsaved_changes = false;
		$(this.toolbar).find(".ev-wb-save-btn").removeClass("ev-wb-save-btn--dirty");
	}

	_show_readonly_banner_if_needed() {
		if (this.list_view.can_write) return;
		this.$readonly_banner = $(`
			<div class="ev-readonly-banner">
				<span class="ev-readonly-lock">🔒</span>
				${__("Read-only — you don't have write access to {0}", [__(this.doctype)])}
			</div>
		`);
		this.$wrapper.prepend(this.$readonly_banner);
	}

	_init_container() {
		this.$wrapper = $(this.wrapper);
		this.$wrapper.empty().addClass("ev-grid-wrapper");

		// $grid_area — flex-ROW container: grid_main + right sidebar sit side by side.
		// $wrapper stays flex-col so the sheet tab strip (appended later by sheet_manager)
		// appears below the grid area as normal.
		this.$grid_area = $('<div class="ev-grid-area">').appendTo(this.$wrapper);

		// $grid_main — flex-col: HOT + status bar stack vertically, flex:1 in $grid_area.
		this.$grid_main = $('<div class="ev-grid-main">').appendTo(this.$grid_area);

		this.$hot_container = $('<div class="ev-hot-container">').appendTo(this.$grid_main);

		// Dashboard canvas — shown when a Dashboard sheet is active, hidden otherwise
		this.$dashboard_canvas = $('<div class="ev-dashboard-canvas">').appendTo(this.$grid_main);
		this.$dashboard_canvas.hide();

		// Status bar — fixed footer below the grid
		this.$status_bar_container = $('<div class="ev-status-bar-container">').appendTo(this.$grid_main);

		// Right sidebar slot — used by Smart Lookup, Agent Mode, etc.
		// Width transitions 0 → 300px; grid_main shrinks automatically (flex).
		this.$right_sidebar = $('<div class="ev-right-sidebar">').appendTo(this.$grid_area);

		// ResizeObserver — fires whenever $grid_main changes size (sidebar toggle,
		// window resize, panel open/close). Debounced so rapid events don't pile up.
		// Must also update HOT's height setting so scrollbars recalculate correctly.
		this._resize_observer = new ResizeObserver(
			frappe.utils.debounce(() => {
				if (!this.hot) return;
				const h = this.$hot_container[0].clientHeight;
				if (h > 0) this.hot.updateSettings({ height: h });
				this.hot.render();
			}, 60)
		);
		this._resize_observer.observe(this.$grid_main[0]);

		// Social column CRUD: delegated click handler on hot container
		this._bind_social_clicks();
	}

	_init_hot() {
		this.hot = new Handsontable(this.$hot_container[0], {
			// Data — array-of-objects mode
			data: this.data,
			columns: this.columns,

			// Headers — function so we can show col letter + field name
			colHeaders: (col) => this._col_header_html(col),
			rowHeaders: true,

			// Behaviour
			manualColumnResize: true,
			manualColumnMove: true,
			manualRowResize: true,
			// V3.1 — rowHeights: 0 for hidden rows, 42px when meta col present, else 23px
			rowHeights: (row) => {
				if (this._hidden_rows?.has(row)) return 0;
				return this.columns?.some(c => c._is_meta_col || c._is_social_col) ? 42 : 23;
			},
			columnSorting: true,
			allowInsertRow: this.list_view.can_create,
			allowRemoveRow: this.list_view.can_write,
			copyPaste: true,
			undo: true,
			search: true,
			comments: true,
			observeChanges: false,
			// Keep selection alive when clicking toolbar buttons outside the grid.
			// Default (true) clears selection on outside click → toolbar becomes a no-op.
			outsideClickDeselects: false,

			// Column sort via dropdown — full autoFilter disabled; Frappe's sidebar
		// handles filtering so we expose only sort_asc / sort_desc in the header menu.
			filters: false,
			dropdownMenu: ["sort_asc", "sort_desc"],

			// Context menu (right-click)
			contextMenu: this.context_menu.get_config(),

			// V2.6 — Merge cells plugin enabled
			mergeCells: true,


			// Frozen columns — restored from user_settings
			fixedColumnsLeft: this._frozen_cols,

			// Layout — flex child, so height: "100%" fills the ev-hot-container flex slot
			height: "100%",
			// "last" stretches only the final column to fill remaining space;
			// all other columns keep their configured widths and a horizontal
			// scrollbar appears when total width exceeds the container.
			// "all" compresses columns proportionally — breaks with 20+ fields.
			stretchH: "last",
			wordWrap: false,
			autoWrapRow: false,
			autoWrapCol: false,

			// Cell-level meta (readOnly, className)
			cells: (row, col) => {
				const meta = this.data_manager.get_cell_meta(row, col);
				// V2.5 AI Analysis: anomaly + cluster row coloring
				const d = this.list_view?.data?.[row];
				if (d) {
					if (d._is_anomaly) {
						meta.className = ((meta.className || "") + " ev-anomaly-row").trim();
					} else if (d._cluster !== undefined && d._cluster !== null) {
						meta.className = ((meta.className || "") + ` ev-cluster-${d._cluster % 6}`).trim();
					}
					// Inline insert: make all editable columns writable for the pending new row
					if (d._is_new && row === this._new_row_idx) {
						const col_def = this.columns[col];
						if (col_def && !col_def._is_name_col && !col_def._is_join_col) {
							if (col_def._df?.fetch_from) {
								// fetch_from fields stay read-only — auto-filled when source changes
								meta.readOnly = true;
								meta.className = "htDimmed ev-new-row-cell ev-fetch-auto-cell";
							} else {
								// Clear htDimmed so the field is visually (and functionally) editable
								meta.readOnly = false;
								meta.className = "ev-new-row-cell";
							}
						}
					}
				}
				return meta;
			},

			// Hooks
			beforeChange: (changes, source) => this._validate_changes(changes, source),
			afterChange: (changes, source) => this._on_change(changes, source),
			afterSelection: (r, c, r2, c2) => this._on_selection(r, c, r2, c2),
			afterColumnResize: (col, size) => this._on_col_resize(col, size),
			// HOT 6.2.2 compat: always handle — afterColumnMove fires on actual user drags.
			// clearTimeout guard ensures only one _on_col_move() fires per drag gesture.
			afterColumnMove: () => {
				clearTimeout(this._col_move_timer);
				this._col_move_timer = setTimeout(() => this._on_col_move(), 50);
			},
			afterRowResize: (row, size) => this._on_row_resize(row, size),
			afterRender: () => this._on_render(),
			afterRenderer: (TD, row, col, prop, value) => this._apply_cell_format(TD, row, col, value),
			afterGetColHeader: (col, TH) => this._apply_col_header_format(TH, col),
			afterOnCellMouseDown: (e, coords) => this._on_tree_row_click(e, coords),
			afterGetRowHeader: (row, TH) => {
				// V3.1 — Hide row header TR for hidden rows (left clone overlay)
				if (TH.parentNode) {
					if (this._hidden_rows?.has(row)) {
						TH.parentNode.style.cssText = "display:none!important;height:0!important;";
					} else {
						TH.parentNode.style.cssText = "";
						// ▲ indicator: this row follows a hidden block
						const prev_hidden = row > 0 && this._hidden_rows?.has(row - 1);
						// ▼ indicator: this row precedes a hidden block (next row is hidden)
						const next_hidden = this._hidden_rows?.has(row + 1);
						TH.classList.toggle("ev-unhide-indicator-top", !!prev_hidden);
						TH.classList.toggle("ev-unhide-indicator-bottom", !!next_hidden);
						// Inject/remove ▲ button (top — unhide block above)
						let btn_top = TH.querySelector(".ev-unhide-btn--top");
						if (prev_hidden && !btn_top) {
							btn_top = document.createElement("div");
							btn_top.className = "ev-unhide-btn ev-unhide-btn--top";
							btn_top.title = "Click to unhide rows";
							btn_top.innerHTML = "&#9650;";
							btn_top.addEventListener("click", (e) => {
								e.stopPropagation();
								this._unhide_rows_group(row);
							});
							TH.appendChild(btn_top);
						} else if (!prev_hidden && btn_top) {
							btn_top.remove();
						}
						// Inject/remove ▼ button (bottom — unhide block below)
						let btn_bot = TH.querySelector(".ev-unhide-btn--bot");
						if (next_hidden && !btn_bot) {
							btn_bot = document.createElement("div");
							btn_bot.className = "ev-unhide-btn ev-unhide-btn--bot";
							btn_bot.title = "Click to unhide rows";
							btn_bot.innerHTML = "&#9660;";
							btn_bot.addEventListener("click", (e) => {
								e.stopPropagation();
								// unhide block below: find first hidden row after this row
								this._unhide_rows_group_below(row);
							});
							TH.appendChild(btn_bot);
						} else if (!next_hidden && btn_bot) {
							btn_bot.remove();
						}
					}
				}
				const row_data = this.list_view.data?.[row];
				if (row_data?._tree_is_header && row_data._tree_size > 1) {
					const expanded = this._expanded_keys?.has(row_data._tree_group_key);
					TH.innerHTML = `<div class="ev-tree-th" title="Click to ${expanded ? 'collapse' : 'expand'}">${expanded ? '▼' : '▶'} <span class="ev-tree-badge">${row_data._tree_size}</span></div>`;
				} else if (row_data?._tree_is_child) {
					TH.innerHTML = `<div class="ev-tree-child-th">└</div>`;
				}
			},
			// V3.1 — intercept F4; V3.3 — intercept Ctrl+E (Flash Fill); V3.3 — Ctrl+D (Fill Down)
			beforeKeyDown: (e) => {
				if (e.key === "F4" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
					e.stopImmediatePropagation();
					e.preventDefault();
					setTimeout(() => this._repeat_last_action(), 0);
				}
				if (e.key === "e" && e.ctrlKey && !e.altKey && !e.shiftKey) {
					e.stopImmediatePropagation();
					e.preventDefault();
					setTimeout(() => this._flash_fill(), 0);
				}
				if (e.key === "d" && e.ctrlKey && !e.altKey && !e.shiftKey) {
					e.stopImmediatePropagation();
					e.preventDefault();
					setTimeout(() => this._fill_down(), 0);
				}
			},
			// i18n
			language: frappe.boot.lang === "ar" || frappe.boot.lang === "he" ? "ar-AR" : undefined,

		});

		// HOT height:"100%" reads clientHeight at init time — in a flex layout that
		// value may be 0 before the browser has painted. Force a correct pixel height
		// after the next paint so HOT's scroll containers initialise properly.
		setTimeout(() => {
			if (!this.hot) return;
			const h = this.$hot_container[0].clientHeight;
			if (h > 0) this.hot.updateSettings({ height: h });
			this.hot.render();

			// ── Infinite scroll via native scroll on HOT's inner scrollable div ──
			// afterScrollVertically only fires when HOT has internal scroll.
			// If all rows fit in the visible area, HOT won't scroll internally.
			// Instead we listen to the master scrollable container (.wtHolder) or
			// fall back to the window scroll event.
			const holder = this.$hot_container[0].querySelector(".wtHolder");
			const scroll_target = (holder && holder.scrollHeight > holder.clientHeight)
				? holder
				: window;

			const on_scroll = () => this._on_scroll_vertical();
			scroll_target.addEventListener("scroll", on_scroll, { passive: true });
			// Store reference for cleanup on destroy
			this._scroll_listener = { target: scroll_target, fn: on_scroll };
		}, 0);
	}

	// ── Column header HTML ─────────────────────────────────────────────────────

	/**
	 * Returns HTML for a column header showing:
	 *  - Small Excel column letter (A, B, C...) at top
	 *  - Field label below (bold)
	 */
	_col_header_html(col) {
		const letter = this._col_idx_to_letter(col);
		const col_cfg = this.columns[col];
		const name = frappe.utils.escape_html(col_cfg?.title || letter);
		const ct_badge = col_cfg?._is_ct_col
			? `<span class="ev-col-ct-badge">CT</span>` : "";
		return `<div class="ev-col-header">${ct_badge}<span class="ev-col-letter">${letter}</span><span class="ev-col-name">${name}</span></div>`;
	}

	/**
	 * Convert 0-based column index → Excel-style letter(s): 0→A, 25→Z, 26→AA …
	 */
	_col_idx_to_letter(n) {
		let result = "";
		n = n + 1;
		while (n > 0) {
			const rem = (n - 1) % 26;
			result = String.fromCharCode(65 + rem) + result;
			n = Math.floor((n - 1) / 26);
		}
		return result;
	}

	// ── Cell formatting (afterRenderer hook) ──────────────────────────────────

	/**
	 * Apply stored formatting (bold, italic, color, etc.) to a rendered cell TD.
	 * Called by HOT's afterRenderer hook after each cell is drawn.
	 */
	_apply_cell_format(TD, row, col, value) {
		// Join skeleton: shimmer animation while api.get_joined_data is in-flight
		if (this.columns[col]?._is_join_loading) {
			TD.classList.add("ev-cell-join-loading");
			return;
		}

		// V3.1 — Meta column: render combined Created/Updated cell
		if (this.columns[col]?._is_meta_col) {
			// Secondary sheets store data in sheet.data; base sheet falls back to list_view.data
			const _row_src = this.sheet_manager?.get_current()?.data || this.list_view?.data;
			this._render_meta_cell(TD, _row_src?.[row]);
			TD.style.padding = "0";
			TD.style.verticalAlign = "middle";
			return;
		}

		// Social column: render Tags/Comments/Assign/Liked/Status/Idx
		if (this.columns[col]?._is_social_col) {
			const _row_src = this.sheet_manager?.get_current()?.data || this.list_view?.data;
			this._render_social_cell(TD, _row_src?.[row]);
			TD.style.padding = "0";
			TD.style.verticalAlign = "middle";
			return;
		}

		// docstatus: render 0/1/2 as a coloured badge instead of raw number
		if (this.columns[col]?._is_docstatus) {
			const v = parseInt(value, 10);
			const map = [
				{ label: "Draft",     cls: "ev-doc-draft"     },
				{ label: "Submitted", cls: "ev-doc-submitted"  },
				{ label: "Cancelled", cls: "ev-doc-cancelled"  },
			];
			const entry = map[v];
			TD.innerHTML = entry
				? `<span class="ev-doc-status ${entry.cls}">${__(entry.label)}</span>`
				: String(value ?? "");
			return;
		}

		// Formula display: replace raw formula string with the HyperFormula-computed result.
		// HOT stores the literal "=SUM(B1:B3)" string; we swap it with the evaluated value.
		// For V2.3 async ERP functions the value may be "#LOADING…", "#PERM_DENIED", "#ERR!",
		// or "#ARG!" — each gets a distinct CSS class for visual feedback.
		// V2.6 — "Show Formulas" toggle: display raw formula string instead of computed value.
		const is_formula = this.formula_bridge?.is_formula(value);
		if (is_formula) {
			if (this._show_formulas) {
				TD.textContent = String(value);
				TD.classList.add("ev-formula-raw");
			} else {
				const computed = this.formula_bridge.get_display_value(row, col);
				const display  = computed !== null && computed !== undefined ? String(computed) : "";
				TD.textContent = display;

				if (typeof computed === "number") {
					TD.classList.add("htRight"); // right-align numeric results like Excel
				} else if (display === "#LOADING\u2026") {
					TD.classList.add("ev-formula-loading");
				} else if (display === "#PERM_DENIED") {
					TD.classList.add("ev-formula-perm");
				} else if (display === "#ERR!" || display === "#ARG!") {
					TD.classList.add("ev-formula-error");
				}
			}
		}

		// Reset all custom styles first — prevents stale styles from recycled TDs
		// (HOT reuses DOM elements; without reset, a previously-bold cell's TD keeps bold)
		TD.style.removeProperty("--ev-cell-fill");
		TD.style.fontWeight     = "";
		TD.style.fontStyle      = "";
		TD.style.textDecoration = "";
		TD.style.color          = "";
		TD.style.textAlign      = "";
		TD.style.fontSize       = "";
		TD.style.fontFamily     = "";
		TD.style.whiteSpace     = "";
		TD.style.verticalAlign  = "";
		TD.style.paddingLeft    = "";
		TD.style.borderTop      = "";
		TD.style.borderRight    = "";
		TD.style.borderBottom   = "";
		TD.style.borderLeft     = "";
		TD.style.removeProperty("background-image");
		TD.style.removeProperty("background-color");

		// Tree row styling — use inline style for bg (so CF inline !important can override it)
		const row_data = this.list_view.data?.[row];
		if (row_data?._tree_is_header && row_data._tree_size > 1) {
			TD.classList.add("ev-tree-header");
		} else if (row_data?._tree_is_child) {
			TD.classList.add("ev-tree-child");
			const _dark = document.documentElement.dataset.theme === "dark";
			TD.style.backgroundColor = _dark ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.025)";
		}

		const fmt = this.format_store?.[`${row}:${col}`];

		if (fmt) {
			if (fmt.bold)   TD.style.fontWeight = "bold";
			if (fmt.italic) TD.style.fontStyle  = "italic";

			const decs = [];
			if (fmt.underline) decs.push("underline");
			if (fmt.strike)    decs.push("line-through");
			if (decs.length)   TD.style.textDecoration = decs.join(" ");

			if (fmt.color) TD.style.color = fmt.color;
			if (fmt.bg) {
				TD.style.setProperty("--ev-cell-fill", fmt.bg);
				TD.style.setProperty("background-color", fmt.bg, "important");
				TD.style.setProperty("background-image", "none", "important");
			}
			if (fmt.align) TD.style.textAlign = fmt.align;
			if (fmt.size)  TD.style.fontSize  = fmt.size + "px";
			if (fmt.font)  TD.style.fontFamily = fmt.font;
			if (fmt.wrap)  TD.style.whiteSpace = "normal";
			TD.style.verticalAlign = fmt.valign || "middle";

			if (fmt.indent) TD.style.paddingLeft = (fmt.indent * 8 + 4) + "px";

			if (fmt.borders) {
				if (fmt.borders.top)    TD.style.borderTop    = fmt.borders.top;
				if (fmt.borders.right)  TD.style.borderRight  = fmt.borders.right;
				if (fmt.borders.bottom) TD.style.borderBottom = fmt.borders.bottom;
				if (fmt.borders.left)   TD.style.borderLeft   = fmt.borders.left;
			}

			if (fmt.numfmt && fmt.numfmt !== "general" && !is_formula) {
				const raw = this.list_view?.data?.[row]?.[this.columns[col]?.data];
				const num = parseFloat(raw);
				if (!isNaN(num)) {
					TD.textContent = ExcelBoard._format_num(num, fmt.numfmt, fmt.decimals ?? 2, fmt.currency_sym ?? "$");
					if (!fmt.align) TD.style.textAlign = "right";
				}
			}
		}

		// V2.6 — Conditional formatting (applied last so it can override user formats)
		if (this.cond_fmt_rules?.length) {
			// Perf: check pre-computed cache first (O(1)) for "cell" type rules.
			// colorscale/topbottom/dupuniq still use full eval path (need column scan).
			const cache_hit = this._cf_cell_cache?.get(`${row}:${col}`);
			if (cache_hit) {
				if (cache_hit.bg) {
					TD.style.setProperty("--ev-cell-fill", cache_hit.bg);
					TD.style.setProperty("background-color", cache_hit.bg, "important");
					TD.style.setProperty("background-image", "none", "important");
				}
				if (cache_hit.color) TD.style.color = cache_hit.color;
			} else {
				// Fallback: full eval for colorscale / topbottom / dupuniq rules only
				const raw_val = this.list_view?.data?.[row]?.[this.columns[col]?.data];
				const row_data = this.list_view?.data?.[row];
				let _cf_bg_set = false, _cf_color_set = false;
				for (const rule of this.cond_fmt_rules) {
					if (_cf_bg_set && _cf_color_set) break;
					if (rule.type === "cell") continue; // already handled by cache above
					const rng = rule.range || {};
					const minC = Math.min(rng.c1, rng.c2), maxC = Math.max(rng.c1, rng.c2);
					if (col < minC || col > maxC) continue;
					if (_cf_bg_set && rule.fmt?.bg && !rule.fmt?.color) continue;
					if (_cf_color_set && rule.fmt?.color && !rule.fmt?.bg) continue;
					const minR = Math.min(rng.r1, rng.r2), maxR = Math.max(rng.r1, rng.r2);
					if (row_data?._tree_is_child) {
						const parent_idx = this._tree_parent_map?.get(row_data._tree_group_key) ?? -1;
						if (parent_idx < 0 || parent_idx < minR || parent_idx > maxR) continue;
					} else if (row < minR || row > maxR) {
						continue;
					}
					const result = this._eval_cf_rule(rule, raw_val);
					if (result === true) {
						if (rule.fmt?.bg && !_cf_bg_set) {
							TD.style.setProperty("--ev-cell-fill", rule.fmt.bg);
							TD.style.setProperty("background-color", rule.fmt.bg, "important");
							TD.style.setProperty("background-image", "none", "important");
							_cf_bg_set = true;
						}
						if (rule.fmt?.color && !_cf_color_set) {
							TD.style.color = rule.fmt.color;
							_cf_color_set = true;
						}
					} else if (result && result.colorscale_bg && !_cf_bg_set) {
						TD.style.setProperty("--ev-cell-fill", result.colorscale_bg);
						TD.style.setProperty("background-color", result.colorscale_bg, "important");
						TD.style.setProperty("background-image", "none", "important");
						_cf_bg_set = true;
					}
				}
			}
		}

		// V3.1 — Hide rows: collapse the TR for hidden rows (HOT 6.2.2 has no hiddenRows plugin)
		if (TD.parentNode) {
			if (this._hidden_rows?.has(row)) {
				TD.parentNode.style.cssText = "display:none!important;height:0!important;";
			} else {
				if (TD.parentNode.style.display === "none") TD.parentNode.style.cssText = "";
				// Green top-border indicator on the data row that follows a hidden block
				if (col === 0) {
					const after_hidden = row > 0 && this._hidden_rows?.has(row - 1);
					TD.parentNode.classList.toggle("ev-after-hidden-row", after_hidden);
				}
			}
		}

		// V3.1 — Focus Cell crosshair (applied after CF so it can override)
		this._apply_focus_overlay(TD, row, col);

		// V3.1 — Formula Precedent highlighting (green outline on referenced cells)
		if (this._precedent_cells?.has(`${row}:${col}`)) {
			TD.style.setProperty("outline", "2px solid #4caf50", "important");
			TD.style.setProperty("outline-offset", "-2px", "important");
		} else {
			TD.style.removeProperty("outline");
			TD.style.removeProperty("outline-offset");
		}
	}

	// V3.1 — Focus Cell crosshair overlay (applied after CF so it has priority)
	_apply_focus_overlay(TD, row, col) {
		if (!this._focus_enabled || this._focus_row < 0) return;
		const on_row = (row === this._focus_row);
		const on_col = (col === this._focus_col);
		if (!on_row && !on_col) return;
		const { r, g, b } = this._focus_color_rgb || { r: 33, g: 115, b: 70 };
		const is_dark = document.documentElement.getAttribute("data-theme") === "dark";
		let bg_color;
		if (is_dark) {
			// rgba blends against HOT's internal white backing in dark mode → use opaque blend over dark base
			const bg = 28; // ≈ Frappe dark bg (#1c1c1c)
			const a  = (on_row && on_col) ? 0.65 : 0.28;
			const mx = (c) => Math.round(bg * (1 - a) + c * a);
			bg_color = `rgb(${mx(r)},${mx(g)},${mx(b)})`;
		} else {
			const alpha = (on_row && on_col) ? 0.38 : 0.18;
			bg_color = `rgba(${r},${g},${b},${alpha})`;
		}
		TD.style.setProperty("background-color", bg_color, "important");
		TD.style.setProperty("background-image", "none", "important");
	}

	// V3.1 — Toggle Focus Cell crosshair
	_toggle_focus_cell(enabled) {
		this._focus_enabled = enabled !== undefined ? enabled : !this._focus_enabled;
		this.hot?.render();
		frappe.model.user_settings.save(this.doctype, "excel_focus_cell",
			{ enabled: this._focus_enabled, color: this._focus_color });
	}

	// V3.1 — Set focus cell color
	_set_focus_color(color) {
		this._focus_color = color;
		// Cache parsed RGB so afterRenderer doesn't parseInt on every cell
		const hex = color || "#217346";
		this._focus_color_rgb = { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
		if (this._focus_enabled) this.hot?.render();
		frappe.model.user_settings.save(this.doctype, "excel_focus_cell",
			{ enabled: this._focus_enabled, color: this._focus_color });
	}

	// V3.1 — Hide rows (HOT 6.2.2 community: no hiddenRows plugin)
	// State update + hot.render() — afterRenderer/afterGetRowHeader/afterRender handle the DOM
	_hide_rows(rows_to_hide) {
		rows_to_hide.forEach(r => { this._hidden_rows.add(r); });
		this._dirty_hidden_rows = true;
		this.hot?.render();
		this._save_hidden_rows();
	}

	// V3.1 — Unhide a specific group of hidden rows (rows between prev_visible and next_visible)
	_unhide_rows_group(next_visible_row) {
		// Find the contiguous block of hidden rows just above next_visible_row
		const to_show = [];
		let r = next_visible_row - 1;
		while (r >= 0 && this._hidden_rows.has(r)) {
			to_show.push(r);
			r--;
		}
		to_show.forEach(x => this._hidden_rows.delete(x));
		this._dirty_hidden_rows = true;
		this.hot?.render();
		this._save_hidden_rows();
	}

	// V3.1 — Unhide contiguous hidden block below a visible row
	_unhide_rows_group_below(prev_visible_row) {
		const to_show = [];
		const total = this.list_view?.data?.length || 0;
		let r = prev_visible_row + 1;
		while (r < total && this._hidden_rows.has(r)) {
			to_show.push(r);
			r++;
		}
		to_show.forEach(x => this._hidden_rows.delete(x));
		this._dirty_hidden_rows = true;
		this.hot?.render();
		this._save_hidden_rows();
	}

	// V3.1 — Unhide all hidden rows
	_unhide_all_rows() {
		this._hidden_rows = new Set();
		this.hot?.render();
		this._save_hidden_rows();
	}

	// V3.1 — Save hidden rows to user_settings
	_save_hidden_rows() {
		frappe.model.user_settings.save(this.doctype, "excel_hidden_rows", [...this._hidden_rows]);
	}

	// V3.1 — Repeat Last Action
	_repeat_last_action() {
		if (!this._last_action) return;
		const sel = this.hot?.getSelectedLast();
		if (!sel) return;
		const [r1, c1, r2, c2] = sel;
		const min_r = Math.min(r1, r2), max_r = Math.max(r1, r2);
		const min_c = Math.min(c1, c2), max_c = Math.max(c1, c2);
		const act = this._last_action;
		switch (act.type) {
			case "format":
				this.toolbar_component?._apply_format_to_range(act.fmt, r1, c1, r2, c2);
				break;
			case "border":
				this.toolbar_component?._apply_border_preset(act.preset, r1, c1, r2, c2);
				break;
			case "numfmt":
				this.toolbar_component?._apply_format({ numfmt: act.numfmt });
				break;
			case "col_resize": {
				const cols = Array.from({ length: max_c - min_c + 1 }, (_, i) => min_c + i);
				this._apply_col_resize(cols, act.size);
				break;
			}
			case "row_resize": {
				const rows = Array.from({ length: max_r - min_r + 1 }, (_, i) => min_r + i);
				this._apply_row_resize(rows, act.size);
				break;
			}
		}
	}

	// ── V3.3 — Flash Fill (Ctrl+E) ────────────────────────────────────────────

	/**
	 * Flash Fill: detect the pattern from filled cells in the selected column
	 * and auto-fill blank cells below (or in selection) using that pattern.
	 *
	 * Supported patterns:
	 *   1. Numeric sequence   — 1, 2, 3 → 4, 5, …
	 *   2. Code prefix+num   — CUST-001, CUST-002 → CUST-003, …
	 *   3. Date sequence      — detects Date objects/strings; day/week/month step
	 *   4. Text fill          — all filled = same value → fill blanks with it
	 *   5. Initials extract   — "John Smith" → "JS" pattern from example in next col
	 */
	/**
	 * Ctrl+D — Fill Down.
	 * Copies the value from the top row of each selected column to all rows below
	 * within the selection. Works for ALL field types including Check (checkbox).
	 *
	 * Directly mutates list_view.data + calls hot.render() to avoid HOT's internal
	 * change-pipeline quirks with custom cell types. Save is triggered via queue_save.
	 */
	_fill_down() {
		const sel = this.hot?.getSelectedLast();
		if (!sel) {
			frappe.show_alert({ message: __("Select cells first"), indicator: "orange" }, 2);
			return;
		}

		const r1 = Math.min(sel[0], sel[2]);
		const r2 = Math.max(sel[0], sel[2]);
		const c1 = Math.min(sel[1], sel[3]);
		const c2 = Math.max(sel[1], sel[3]);

		if (r2 <= r1) {
			frappe.show_alert({ message: __("Select 2+ rows to fill down"), indicator: "orange" }, 2);
			return;
		}

		const data = this.list_view.data;
		const save_changes = [];   // format: [row, fieldname, oldVal, newVal] for queue_save

		for (let c = c1; c <= c2; c++) {
			const col_def = this.columns[c];
			if (!col_def || col_def._readonly) continue;

			const prop = col_def.data;
			const src_row = data[r1];
			if (!src_row) continue;

			// Read source value directly from the data array (bypasses HOT rendering)
			let src_val = src_row[prop];
			// Coerce Check boolean → 0/1 for Frappe
			if (col_def._df?.fieldtype === "Check" && typeof src_val === "boolean") {
				src_val = src_val ? 1 : 0;
			}

			for (let r = r1 + 1; r <= r2; r++) {
				const row_data = data[r];
				if (!row_data || row_data._is_new) continue;
				const old_val = row_data[prop];
				if (old_val === src_val) continue;

				// Mutate data array directly — hot.render() below will pick this up
				row_data[prop] = src_val;
				save_changes.push([r, prop, old_val, src_val]);
			}
		}

		if (!save_changes.length) {
			frappe.show_alert({ message: __("Nothing to fill"), indicator: "blue" }, 2);
			return;
		}

		// Re-render grid so visual cells reflect the mutated data
		this.hot.render();
		// Persist to Frappe DB via the normal debounced save path
		this.data_manager.queue_save(save_changes);
	}

	_flash_fill() {
		const sel = this.hot?.getSelectedLast();
		if (!sel) return;
		const col = Math.min(sel[1], sel[3]);
		const data = this.list_view?.data || [];
		if (!data.length) return;

		const col_key = this.columns[col]?.data;
		if (!col_key) return;

		const all_vals = data.map(row => String(row[col_key] ?? "").trim());
		const filled   = all_vals.map((v, i) => ({ v, i })).filter(x => x.v !== "");
		const blanks   = all_vals.map((v, i) => i).filter(i => all_vals[i] === "");

		if (!blanks.length) {
			frappe.show_alert({ message: __("No blank cells to fill."), indicator: "blue" });
			return;
		}

		// ── 1. In-column pattern (sequence / prefix / constant) ─────────────
		if (filled.length >= 2) {
			const pattern = this._ff_detect_pattern(filled.map(x => x.v));
			if (pattern) {
				const changes = blanks.map(ri => {
					const v = this._ff_predict(pattern, ri, all_vals);
					return v !== null ? [ri, col, v] : null;
				}).filter(Boolean);
				if (changes.length) {
					changes.forEach(([r, , v]) => { data[r][col_key] = v; });
					this.hot.setDataAtCell(changes, "flash_fill");
					frappe.show_alert({ message: __(`Flash Fill: filled ${changes.length} cells.`), indicator: "green" });
					return;
				}
			}
		}

		// ── 2. Cross-column transform (1+ example enough) ───────────────────
		// Check adjacent columns: left-1, right+1, left-2 (skips virtual cols)
		if (filled.length >= 1) {
			const adj = [col - 1, col + 1, col - 2, col + 2]
				.filter(c => c >= 0 && c < this.columns.length && c !== col);

			for (const ac of adj) {
				const ak = this.columns[ac]?.data;
				if (!ak) continue;

				// Build examples from rows that have BOTH columns filled
				const examples = filled
					.map(({ v, i }) => ({ my: v, adj: String(data[i]?.[ak] ?? "").trim() }))
					.filter(e => e.adj !== "");

				if (!examples.length) continue;

				const transform = this._ff_detect_transform(examples);
				if (!transform) continue;

				const changes = blanks.map(ri => {
					const adj_val = String(data[ri]?.[ak] ?? "").trim();
					if (!adj_val) return null;
					const v = transform.fn(adj_val);
					return v !== null && v !== "" ? [ri, col, v] : null;
				}).filter(Boolean);

				if (changes.length) {
					changes.forEach(([r, , v]) => { data[r][col_key] = v; });
					this.hot.setDataAtCell(changes, "flash_fill");
					// Save transform config for lazy-load auto-fill + persistence
					if (this.columns[col]?._is_blank_col) {
						this._blank_col_configs = this._blank_col_configs || new Map();
						const existing = this._blank_col_configs.get(col_key) || {};
						this._blank_col_configs.set(col_key, { ...existing,
							ff_transform: { adj_col_key: ak, fn_idx: transform.fn_idx, example_len: transform.example_len }
						});
						this._save_blank_col_settings();
					}
					frappe.show_alert({ message: __(`Flash Fill: filled ${changes.length} cells.`), indicator: "green" });
					return;
				}
			}
		}

		frappe.show_alert({ message: __("Could not detect a pattern. Fill 1–2 example cells first."), indicator: "orange" });
	}

	// Detect a cross-column transform function from {my, adj} example pairs.
	// Returns a transform fn(adj_val) → my_val, or null if none match all examples.
	_ff_detect_transform(examples) {
		const n = examples[0]?.my?.length || 0;

		const candidates = [
			// Initials: "Preeti Shah" → "PS"
			v => v.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join(""),
			// First word / first name: "Preeti Shah" → "Preeti"
			v => v.split(/\s+/)[0],
			// Last word / last name: "Preeti Shah" → "Shah"
			v => v.split(/\s+/).pop(),
			// Uppercase
			v => v.toUpperCase(),
			// Lowercase
			v => v.toLowerCase(),
			// First N chars (same length as example)
			v => v.slice(0, n),
			// First token before comma/paren/dash
			v => v.split(/[,;(\-]/)[0].trim(),
			// Digits only
			v => v.replace(/\D/g, ""),
			// Letters only
			v => v.replace(/[^a-zA-Z]/g, ""),
			// Remove spaces
			v => v.replace(/\s+/g, ""),
		];

		for (let i = 0; i < candidates.length; i++) {
			try {
				if (examples.every(e => candidates[i](e.adj) === e.my))
					return { fn: candidates[i], fn_idx: i, example_len: n };
			} catch (_) { /* skip */ }
		}
		return null;
	}

	_ff_detect_pattern(filled_vals) {
		// 1. Numeric sequence: all values are numbers
		const nums = filled_vals.map(Number);
		if (filled_vals.every(v => !isNaN(Number(v)) && v !== "")) {
			const diffs = nums.slice(1).map((n, i) => n - nums[i]);
			const step = diffs[0];
			if (diffs.every(d => d === step)) {
				return { type: "numeric", last_val: nums[nums.length - 1], step };
			}
		}

		// 2. Code prefix+num: "PREFIX-001", "PREFIX-002" → prefix + zero-padded number
		const prefix_re = /^(.*?)(\d+)$/;
		const matches = filled_vals.map(v => v.match(prefix_re));
		if (matches.every(m => m && m[1] === matches[0][1])) {
			const prefix = matches[0][1];
			const pad = matches[0][2].length;
			const nums_p = matches.map(m => parseInt(m[2], 10));
			const diffs_p = nums_p.slice(1).map((n, i) => n - nums_p[i]);
			const step_p = diffs_p[0] || 1;
			if (diffs_p.every(d => d === step_p)) {
				return { type: "prefix_num", prefix, pad, last_num: nums_p[nums_p.length - 1], step: step_p };
			}
		}

		// 3. Constant fill: all same value → fill blanks with that value
		if (new Set(filled_vals).size === 1) {
			return { type: "constant", value: filled_vals[0] };
		}

		return null; // no pattern detected
	}

	_ff_predict(pattern, row_idx, all_vals) {
		// For sequence patterns, extrapolate based on position in the full array
		// (row_idx = absolute row index, all_vals = full column array)
		if (pattern.type === "numeric") {
			// Find closest filled value before this blank to anchor prediction
			let anchor_val = pattern.last_val;
			let anchor_idx = all_vals.length - 1;
			for (let i = all_vals.length - 1; i >= 0; i--) {
				if (String(all_vals[i]).trim() !== "" && i < row_idx) {
					anchor_val = Number(all_vals[i]);
					anchor_idx = i;
					break;
				}
			}
			return anchor_val + pattern.step * (row_idx - anchor_idx);
		}
		if (pattern.type === "prefix_num") {
			let anchor_num = pattern.last_num;
			let anchor_idx = all_vals.length - 1;
			for (let i = all_vals.length - 1; i >= 0; i--) {
				const m = String(all_vals[i]).trim().match(/^(.*?)(\d+)$/);
				if (m && m[1] === pattern.prefix && i < row_idx) {
					anchor_num = parseInt(m[2], 10);
					anchor_idx = i;
					break;
				}
			}
			const next_num = anchor_num + pattern.step * (row_idx - anchor_idx);
			return pattern.prefix + String(next_num).padStart(pattern.pad, "0");
		}
		if (pattern.type === "constant") {
			return pattern.value;
		}
		return null;
	}

	// ── V3.1 — Combined Meta Column ────────────────────────────────────────────

	/**
	 * If the current column list includes the 4 Frappe std audit fields
	 * (owner, creation, modified_by, modified), inject a single virtual "_meta"
	 * column right after the name column and hide the 4 originals.
	 */
	_inject_meta_column() {
		// Idempotent guard — never add a second _meta column
		if (this._master_columns.some(c => c.data === "_meta")) return;

		const META_FIELDS = new Set(["owner", "creation", "modified_by", "modified"]);

		// Check if any raw meta fields exist in master
		if (!this._master_columns.some(c => META_FIELDS.has(c.data))) return;

		// Find insert position (right after name = index 1, or wherever first meta field is)
		const first_idx = this._master_columns.findIndex(c => META_FIELDS.has(c.data));
		const insert_at = first_idx >= 1 ? first_idx : 1;

		// Permanently remove the 4 raw meta fields from _master_columns.
		// They must NEVER appear as HOT columns — only the combined _meta col shows.
		this._master_columns = this._master_columns.filter(c => !META_FIELDS.has(c.data));

		// Build the combined virtual column
		const meta_col = {
			data:       "_meta",
			title:      "Created / Updated",
			readOnly:   true,
			_readonly:  true,
			_is_meta_col: true,
			width:      200,
			renderer:   "text",    // overridden in afterRenderer
			className:  "htDimmed",
		};

		this._master_columns.splice(insert_at, 0, meta_col);

		// Belt-and-suspenders: keep hidden_col_keys in sync so _sync_visible_columns
		// never re-admits them even if they appear on a sheet switch.
		META_FIELDS.forEach(f => this._hidden_col_keys.add(f));

		// Rebuild visible columns
		this.columns = this._master_columns.filter(c => !this._hidden_col_keys.has(c.data)); this._col_index_map = null;
	}

	/**
	 * Render the combined meta cell HTML.
	 * Shows Created By (avatar + name + date) and Updated By rows.
	 */
	_render_meta_cell(TD, row_data) {
		if (!row_data) { TD.textContent = ""; return; }
		// Cache keyed by name+modified — reuse within session (relative dates are stable enough)
		const _cache_key = `${row_data.name || ""}:${row_data.modified || ""}`;
		const _cached = this._meta_html_cache?.get(_cache_key);
		if (_cached) { TD.innerHTML = _cached; return; }

		// Avatar — image or color-coded letter chip (16px, no title — tooltip is on the row)
		const _avatar = (user, fullname) => {
			const info = frappe.boot?.user_info?.[user];
			const img  = info?.image;
			if (img) {
				return `<img src="${frappe.utils.escape_html(img)}" class="ev-meta-avatar ev-meta-avatar--img" alt="">`;
			}
			const initials = (fullname || user || "?").substring(0, 1).toUpperCase();
			const colors = ["#e53935","#8e24aa","#1565c0","#00838f","#2e7d32","#ef6c00","#6d4c41","#546e7a"];
			const bg = colors[((user || " ").charCodeAt(0) || 0) % colors.length];
			return `<span class="ev-meta-avatar" style="background:${bg}">${frappe.utils.escape_html(initials)}</span>`;
		};

		// First name only (max 10 chars) — email-safe: splits on space, dot, @
		const _first = (name) => {
			if (!name) return "?";
			const part = name.split("@")[0].split(/[\s.]+/)[0] || name;
			return frappe.utils.escape_html(part.substring(0, 10));
		};

		// Relative time for cell; full datetime for tooltip
		const _rel  = (val) => { try { return frappe.datetime.comment_when(val) || ""; } catch (_) { return ""; } };
		const _full = (val) => { try { return frappe.datetime.str_to_user(val) || val || ""; } catch (_) { return String(val || "").substring(0, 16); } };

		const owner       = row_data.owner || "";
		const owner_name  = frappe.boot?.user_info?.[owner]?.fullname || owner;
		const mod_by      = row_data.modified_by || "";
		const mod_name    = frappe.boot?.user_info?.[mod_by]?.fullname || mod_by;

		// Pencil icon for "last edited" row — same Bootstrap icon, 10px, inherits color
		const _pencil = `<svg class="ev-meta-pencil" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/></svg>`;

		const _html = `<div class="ev-meta-cell">
			<div class="ev-meta-row ev-meta-row--cr" title="${frappe.utils.escape_html(owner_name)} \u00b7 ${frappe.utils.escape_html(_full(row_data.creation))}">
				${_avatar(owner, owner_name)}
				<span class="ev-meta-who">${_first(owner_name)}</span>
				<span class="ev-meta-sep"></span>
				<span class="ev-meta-ts">${_rel(row_data.creation)}</span>
			</div>
			<div class="ev-meta-row ev-meta-row--md" title="${frappe.utils.escape_html(mod_name)} \u00b7 ${frappe.utils.escape_html(_full(row_data.modified))}">
				${_pencil}
				<span class="ev-meta-who ev-meta-who--mod">${_first(mod_name)}</span>
				<span class="ev-meta-sep"></span>
				<span class="ev-meta-ts ev-meta-ts--mod">${_rel(row_data.modified)}</span>
			</div>
		</div>`;
		this._meta_html_cache?.set(_cache_key, _html);
		TD.innerHTML = _html;
	}

	/**
	 * Group _user_tags, _comments, _assign, _liked_by, docstatus, idx into a single
	 * virtual "_social" column. Mirrors _inject_meta_column() pattern exactly.
	 */
	_inject_social_column() {
		if (this._master_columns.some(c => c.data === "_social")) return;

		const SOCIAL_FIELDS = new Set(["_user_tags", "_comments", "_assign", "_liked_by", "docstatus", "idx"]);
		if (!this._master_columns.some(c => SOCIAL_FIELDS.has(c.data))) return;

		const first_idx = this._master_columns.findIndex(c => SOCIAL_FIELDS.has(c.data));
		if (first_idx < 0) return;

		this._master_columns = this._master_columns.filter(c => !SOCIAL_FIELDS.has(c.data));

		this._master_columns.splice(first_idx, 0, {
			data:            "_social",
			title:           "Activity",
			readOnly:        true,
			_readonly:       true,
			_is_social_col:  true,
			width:           180,
			renderer:        "text",
			className:       "htDimmed",
		});

		SOCIAL_FIELDS.forEach(f => this._hidden_col_keys.add(f));
		this.columns = this._master_columns.filter(c => !this._hidden_col_keys.has(c.data)); this._col_index_map = null;
	}

	/**
	 * Render the combined social cell.
	 * Row 1: docstatus badge + assigned avatars + idx
	 * Row 2: tags pill + like count + comment count
	 * Clicking ♥ toggles like inline; clicking avatars/tags opens frappe dialogs.
	 */
	_render_social_cell(TD, row_data) {
		if (!row_data) { TD.textContent = ""; return; }

		// Cache key — any social field change invalidates
		const _ck = `${row_data.name}|${row_data.docstatus}|${row_data._user_tags || ""}|${(row_data._assign || "").substring(0, 80)}|${(row_data._liked_by || "").substring(0, 80)}|${(row_data._comments || "").substring(0, 30)}`;
		const _cached = this._social_html_cache?.get(_ck);
		if (_cached) { TD.innerHTML = _cached; return; }

		const _esc = s => frappe.utils.escape_html(String(s ?? ""));
		const _colors = ["#e53935","#8e24aa","#1565c0","#00838f","#2e7d32","#ef6c00","#6d4c41","#546e7a"];
		const _avatar = (u) => {
			const info = frappe.boot?.user_info?.[u];
			const name = info?.fullname || u;
			const code = (u || " ").charCodeAt(0) || 0;
			if (info?.image) return `<img src="${_esc(info.image)}" class="ev-sc-av ev-sc-av--img" title="${_esc(name)}" alt="">`;
			return `<span class="ev-sc-av" style="background:${_colors[code % _colors.length]}" title="${_esc(name)}">${_esc(name.substring(0, 1).toUpperCase())}</span>`;
		};

		// ── Docstatus (only for submittable doctypes) ────────────────────
		// For secondary sheets the flag is cached on the sheet state object
		const _submittable = this.sheet_manager?.get_current()?._is_submittable ?? this._is_submittable;
		let ds_html = "";
		if (_submittable) {
			const ds = row_data.docstatus ?? 0;
			const DS = [
				{ label: __("Draft"),     cls: "ev-sc-ds--draft" },
				{ label: __("Submitted"), cls: "ev-sc-ds--submitted" },
				{ label: __("Cancelled"), cls: "ev-sc-ds--cancelled" },
			];
			const d = DS[ds] || DS[0];
			ds_html = `<span class="ev-sc-ds ${d.cls}">${d.label}</span>`;
		}

		// ── Assigned To ──────────────────────────────────────────────────
		let assigned = [];
		try { assigned = JSON.parse(row_data._assign || "[]"); } catch(_) {}
		const all_names = assigned.map(u => frappe.boot?.user_info?.[u]?.fullname || u).join(", ");
		const av_html = assigned.length
			? `<span class="ev-sc-avatars" data-sc="assign" data-name="${_esc(row_data.name)}" title="${_esc(all_names)}">${assigned.slice(0, 3).map(_avatar).join("")}${assigned.length > 3 ? `<span class="ev-sc-av ev-sc-av--more">+${assigned.length - 3}</span>` : ""}</span>`
			: `<button class="ev-sc-add-btn" data-sc="assign" data-name="${_esc(row_data.name)}" title="${__("Assign to someone")}"><svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4zm-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.029 10 8 10c-2.029 0-3.516.68-4.168 1.332-.678.678-.83 1.418-.832 1.664h10z"/></svg></button>`;

		// ── Tags ─────────────────────────────────────────────────────────
		let tags = [];
		try { tags = (row_data._user_tags || "").split(",").map(t => t.trim()).filter(Boolean); } catch(_) {}
		const tag_html = `<button class="ev-sc-btn${tags.length ? " ev-sc-btn--active" : ""}" data-sc="tags" data-name="${_esc(row_data.name)}" title="${tags.length ? _esc(tags.join(", ")) : __("Add tag")}">
			<svg class="ev-sc-ic" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a1 1 0 0 1 1-1h4.586a1 1 0 0 1 .707.293l7 7a1 1 0 0 1 0 1.414l-4.586 4.586a1 1 0 0 1-1.414 0l-7-7A1 1 0 0 1 2 6.586V2zm3.5 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/></svg>
			${tags.length ? `<span class="ev-sc-count">${tags.length}</span>` : ""}
		</button>`;

		// ── Liked By ─────────────────────────────────────────────────────
		let liked = [];
		try { liked = JSON.parse(row_data._liked_by || "[]"); } catch(_) {}
		const me_liked = liked.includes(frappe.session?.user);
		const liked_names = liked.map(u => frappe.boot?.user_info?.[u]?.fullname || u).join(", ");
		const like_html = `<button class="ev-sc-btn ev-sc-btn--heart${me_liked ? " ev-sc-btn--liked" : ""}" data-sc="like" data-name="${_esc(row_data.name)}" data-liked="${me_liked ? "1" : "0"}" title="${_esc(liked.length ? liked_names : __("Like"))}">
			<svg class="ev-sc-ic ev-sc-ic--heart" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314z"/></svg>
			${liked.length ? `<span class="ev-sc-count">${liked.length}</span>` : ""}
		</button>`;

		// ── Comments ─────────────────────────────────────────────────────
		let cc = 0;
		try { const c = JSON.parse(row_data._comments || "[]"); cc = Array.isArray(c) ? c.length : 0; } catch(_) {}
		const comment_html = `<button class="ev-sc-btn${cc ? " ev-sc-btn--active" : ""}" data-sc="comment" data-name="${_esc(row_data.name)}" title="${cc ? cc + " " + __("comment(s)") : __("Add comment")}">
			<svg class="ev-sc-ic" viewBox="0 0 16 16" fill="currentColor"><path d="M2.678 11.894a1 1 0 0 1 .287.801 10.97 10.97 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8.06 8.06 0 0 0 8 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 0 1-2.347-.306c-.52.263-1.639.742-3.468 1.105z"/></svg>
			${cc ? `<span class="ev-sc-count">${cc}</span>` : ""}
		</button>`;

		const _html = `<div class="ev-social-cell" data-name="${_esc(row_data.name)}">
			<div class="ev-sc-row ev-sc-row--top">${ds_html}${av_html}</div>
			<div class="ev-sc-row ev-sc-row--bottom">${tag_html}${like_html}${comment_html}</div>
		</div>`;
		this._social_html_cache?.set(_ck, _html);
		TD.innerHTML = _html;
	}

	/** Handle CRUD actions for social column cells (like toggle, assign, tags). */
	_bind_social_clicks() {
		const _dlg_colors = ["#e53935","#8e24aa","#1565c0","#00838f","#2e7d32","#ef6c00","#6d4c41","#546e7a"];
		const _dlg_av = (email, fullname) => {
			const info = frappe.boot?.user_info?.[email];
			const img  = info?.image;
			const name = fullname || info?.fullname || email || "?";
			if (img) return `<img src="${frappe.utils.escape_html(img)}" class="ev-dlg-av ev-dlg-av--img" alt="">`;
			const bg = _dlg_colors[((email || "").charCodeAt(0) || 0) % _dlg_colors.length];
			return `<span class="ev-dlg-av" style="background:${bg}">${frappe.utils.escape_html(name.substring(0, 1).toUpperCase())}</span>`;
		};

		this.$hot_container.on("click.social", "[data-sc]", (e) => {
			const $el    = $(e.target).closest("[data-sc]");
			const action = $el.data("sc");
			const name   = $el.data("name");
			// Use current sheet's doctype so secondary sheets operate on the right DocType
			const dt     = this.sheet_manager?.get_current()?.doctype || this.doctype;
			if (!name) return;
			e.stopPropagation();

			// ── Like toggle ─────────────────────────────────────────────────
			if (action === "like") {
				const add = $el.attr("data-liked") === "1" ? "No" : "Yes";
				frappe.call({
					method: "frappe.desk.like.toggle_like",
					args: { doctype: dt, name, add },
					callback: (r) => {
						const _cur_data = this.sheet_manager?.get_current()?.data || this.list_view?.data;
						const row = _cur_data?.find(d => d.name === name);
						if (row) {
							row._liked_by = r.message;
							[...this._social_html_cache.keys()]
								.filter(k => k.startsWith(`${name}|`))
								.forEach(k => this._social_html_cache.delete(k));
							this.hot?.render();
						}
					},
				});

			// ── Assign dialog ────────────────────────────────────────────────
			} else if (action === "assign") {
				const can_write = frappe.model.can_write(dt);
				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: "ToDo",
						filters: { reference_type: dt, reference_name: name, status: ["!=", "Cancelled"] },
						fields: ["owner", "description", "allocated_to"],
						limit: 50,
					},
					callback: (r) => {
						const current = r.message || [];
						const list_html = current.length
							? current.map(a => {
								const user  = a.allocated_to || a.owner;
								const info  = frappe.boot?.user_info?.[user];
								const fname = info?.fullname || user;
								return `<div class="ev-dlg-user-row">
									${_dlg_av(user, fname)}
									<div class="ev-dlg-user-info">
										<div class="ev-dlg-user-name">${frappe.utils.escape_html(fname)}</div>
										${a.description ? `<div class="ev-dlg-user-note">${frappe.utils.escape_html(a.description)}</div>` : ""}
									</div>
									${can_write ? `<button class="ev-dlg-icon-btn ev-dlg-icon-btn--danger" data-remove-user="${frappe.utils.escape_html(user)}" title="${__("Remove")}"><svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg></button>` : ""}
								</div>`;
							}).join("")
							: `<div class="ev-dlg-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg><div>${__("No one assigned yet")}</div></div>`;

						const fields = [
							{ fieldtype: "HTML", fieldname: "assign_list", options: `<div class="ev-dlg-list">${list_html}</div>` },
						];
						if (can_write) {
							fields.push(
								{ fieldtype: "Section Break", label: __("Add Assignment") },
								{ fieldtype: "Link", fieldname: "user", label: __("Assign To"), options: "User", reqd: 1 },
								{ fieldtype: "Small Text", fieldname: "description", label: __("Note (optional)") },
							);
						}
						const d = new frappe.ui.Dialog({
							title: __("Assignments — {0}", [name]),
							fields,
							primary_action_label: can_write ? __("Assign") : __("Close"),
							primary_action: (vals) => {
								if (!can_write) { d.hide(); return; }
								if (!vals.user) return;
								frappe.call({
									method: "frappe.desk.form.assign_to.add",
									args: { doctype: dt, name, assign_to: [vals.user], description: vals.description || "", bulk_assign: false },
									callback: () => { d.hide(); this.list_view.refresh(); },
								});
							},
						});
						d.show();
						d.$body.on("click", "[data-remove-user]", (ev) => {
							const user = $(ev.currentTarget).data("remove-user");
							frappe.call({
								method: "frappe.desk.form.assign_to.remove",
								args: { doctype: dt, name, assign_to: user },
								callback: () => { d.hide(); this.list_view.refresh(); },
							});
						});
					},
				});

			// ── Tags dialog ──────────────────────────────────────────────────
			} else if (action === "tags") {
				const can_write = frappe.model.can_write(dt);
				const row = this.list_view.data?.find(d => d.name === name);
				const current_tags = (row?._user_tags || "").split(",").map(t => t.trim()).filter(Boolean);
				frappe.call({
					method: "excel_view.api.get_doctype_tags",
					args: { doctype: dt },
					callback: (r) => {
						const available = (r.message || []).filter(Boolean);
						const d = new frappe.ui.Dialog({
							title: __("Tags — {0}", [name]),
							fields: [{
								fieldtype: "MultiSelectList",
								fieldname: "tags",
								label: __("Tags"),
								get_data: (txt) => available
									.filter(t => !txt || t.toLowerCase().includes(txt.toLowerCase()))
									.map(t => ({ label: t, value: t })),
							}],
							primary_action_label: can_write ? __("Save") : __("Close"),
							primary_action: (vals) => {
								if (!can_write) { d.hide(); return; }
								const new_tags  = vals.tags || [];
								const to_add    = new_tags.filter(t => !current_tags.includes(t));
								const to_remove = current_tags.filter(t => !new_tags.includes(t));
								Promise.all([
									...to_add.map(tag => frappe.call({ method: "excel_view.api.add_doc_tag", args: { doctype: dt, docname: name, tag } })),
									...to_remove.map(tag => frappe.call({ method: "excel_view.api.remove_doc_tag", args: { doctype: dt, docname: name, tag } })),
								]).then(() => { d.hide(); this.list_view.refresh(); });
							},
						});
						d.get_field("tags").set_value(current_tags);
						d.show();
					},
				});

			// ── Comments dialog ──────────────────────────────────────────────
			} else if (action === "comment") {
				const can_write = frappe.model.can_write(dt);
				const me = frappe.session?.user;
				const is_manager = frappe.boot?.user?.roles?.includes("System Manager");
				frappe.call({
					method: "frappe.client.get_list",
					args: {
						doctype: "Comment",
						filters: { reference_doctype: dt, reference_name: name, comment_type: "Comment" },
						fields: ["name", "content", "comment_email", "comment_by", "creation"],
						order_by: "creation asc",
						limit: 50,
					},
					callback: (r) => {
						const comments = r.message || [];
						const comments_html = comments.length
							? comments.map(c => {
								const fname = c.comment_by || frappe.boot?.user_info?.[c.comment_email]?.fullname || c.comment_email;
								const can_del = c.comment_email === me || is_manager;
								return `<div class="ev-dlg-comment">
									<div class="ev-dlg-comment-head">
										${_dlg_av(c.comment_email, fname)}
										<span class="ev-dlg-comment-by">${frappe.utils.escape_html(fname)}</span>
										<span class="ev-dlg-comment-when">${frappe.datetime.comment_when(c.creation) || ""}</span>
										${can_del ? `<button class="ev-dlg-icon-btn ev-dlg-icon-btn--danger" data-remove-comment="${frappe.utils.escape_html(c.name)}" title="${__("Delete")}"><svg viewBox="0 0 16 16" fill="currentColor" width="10" height="10"><path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/></svg></button>` : ""}
									</div>
									<div class="ev-dlg-comment-body">${c.content}</div>
								</div>`;
							}).join("")
							: `<div class="ev-dlg-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/></svg><div>${__("No comments yet")}</div></div>`;

						const fields = [
							{ fieldtype: "HTML", fieldname: "comments_list", options: `<div class="ev-dlg-comments">${comments_html}</div>` },
						];
						if (can_write) {
							fields.push(
								{ fieldtype: "Section Break", label: __("Add Comment") },
								{ fieldtype: "Text Editor", fieldname: "new_comment" },
							);
						}
						const d = new frappe.ui.Dialog({
							title: `${__("Comments")}${comments.length ? " (" + comments.length + ")" : ""}`,
							fields,
							primary_action_label: can_write ? __("Post") : __("Close"),
							primary_action: (vals) => {
								if (!can_write) { d.hide(); return; }
								const content = (vals.new_comment || "").trim();
								if (!content) { frappe.show_alert({ message: __("Enter a comment"), indicator: "orange" }, 2); return; }
								frappe.call({
									method: "frappe.desk.form.utils.add_comment",
									args: { reference_doctype: dt, reference_name: name, content, comment_email: me, comment_by: frappe.boot?.user?.full_name || me },
									callback: () => { d.hide(); this.list_view.refresh(); },
								});
							},
						});
						d.show();
						d.$body.on("click", "[data-remove-comment]", (ev) => {
							const cname = $(ev.currentTarget).data("remove-comment");
							frappe.confirm(__("Delete this comment?"), () => {
								frappe.call({
									method: "frappe.client.delete",
									args: { doctype: "Comment", name: cname },
									callback: () => { d.hide(); this.list_view.refresh(); },
								});
							});
						});
					},
				});
			}
		});
	}



	/**
	 * Format a numeric value according to numfmt type.
	 * @param {number} value
	 * @param {string} numfmt   - "number"|"currency"|"accounting"|"percentage"|"fraction"|"scientific"|"text"
	 * @param {number} decimals
	 * @param {string} sym      - currency symbol
	 */
	static _format_num(value, numfmt, decimals = 2, sym = "$") {
		switch (numfmt) {
			case "number":
				return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
			case "currency":
				return sym + Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
			case "accounting":
				if (value < 0) return `(${sym}${Math.abs(value).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })})`;
				return sym + value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
			case "percentage":
				return (value * 100).toFixed(decimals) + "%";
			case "fraction": {
				const int_part = Math.trunc(value);
				const frac = Math.abs(value - int_part);
				// Find best fraction denominator up to 16
				let best_num = 0, best_den = 1, best_diff = frac;
				for (let d = 2; d <= 16; d++) {
					const n = Math.round(frac * d);
					const diff = Math.abs(frac - n / d);
					if (diff < best_diff) { best_diff = diff; best_num = n; best_den = d; }
				}
				if (best_num === 0) return String(int_part || 0);
				return (int_part ? int_part + " " : "") + `${best_num}/${best_den}`;
			}
			case "scientific":
				return value.toExponential(decimals).replace("e+", "E+").replace("e-", "E-");
			case "text":
				return String(value);
			default:
				return value.toLocaleString();
		}
	}

	/**
	 * Evaluate a single conditional formatting rule against a cell value.
	 * Returns true if matched, {colorscale_bg: '#hex'} for color-scale rules, or false.
	 */
	_eval_cf_rule(rule, value) {
		const num = parseFloat(value);
		switch (rule.type) {
			case "cell": {
				const v1 = parseFloat(rule.val1);
				const v2 = parseFloat(rule.val2);
				switch (rule.op) {
					case ">":        return !isNaN(num) && num > v1;
					case "<":        return !isNaN(num) && num < v1;
					case "=":        return String(value) === String(rule.val1);
					case "!=":       return String(value) !== String(rule.val1);
					case ">=":       return !isNaN(num) && num >= v1;
					case "<=":       return !isNaN(num) && num <= v1;
					case "between":  return !isNaN(num) && num >= Math.min(v1, v2) && num <= Math.max(v1, v2);
					case "contains": return String(value).includes(String(rule.val1 ?? ""));
					default:         return false;
				}
			}
			case "colorscale": {
				// Color scale: interpolate — use precomputed cache
				const cache_key = `cf_cs_${rule.id}`;
				if (!this._cf_cs_cache) this._cf_cs_cache = {};
				if (!this._cf_cs_cache[cache_key]) {
					const { r1, c1, r2, c2 } = rule.range;
					let mn = Infinity, mx = -Infinity;
					for (let r = r1; r <= r2; r++) {
						for (let c = c1; c <= c2; c++) {
							const v = parseFloat(this.list_view?.data?.[r]?.[this.columns[c]?.data]);
							if (!isNaN(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
						}
					}
					this._cf_cs_cache[cache_key] = { mn, mx };
				}
				const { mn, mx } = this._cf_cs_cache[cache_key];
				if (isNaN(num) || mn === mx) return false;
				const t = (num - mn) / (mx - mn); // 0..1
				const lerp_ch = (a, b, lt) => Math.round(a + (b - a) * lt);
				const parse_hex = (h) => {
					const hx = h.replace("#", "");
					return [parseInt(hx.slice(0,2),16), parseInt(hx.slice(2,4),16), parseInt(hx.slice(4,6),16)];
				};
				const to_hex = (rgb) => "#" + rgb.map(v => v.toString(16).padStart(2,"0")).join("");
				let color;
				const min_c = parse_hex(rule.min_color || "#ffffff");
				const max_c = parse_hex(rule.max_color || "#ff0000");
				if (rule.mid_color && t <= 0.5) {
					const mid_c = parse_hex(rule.mid_color);
					const t2 = t * 2;
					color = to_hex([lerp_ch(min_c[0],mid_c[0],t2), lerp_ch(min_c[1],mid_c[1],t2), lerp_ch(min_c[2],mid_c[2],t2)]);
				} else if (rule.mid_color) {
					const mid_c = parse_hex(rule.mid_color);
					const t2 = (t - 0.5) * 2;
					color = to_hex([lerp_ch(mid_c[0],max_c[0],t2), lerp_ch(mid_c[1],max_c[1],t2), lerp_ch(mid_c[2],max_c[2],t2)]);
				} else {
					color = to_hex([lerp_ch(min_c[0],max_c[0],t), lerp_ch(min_c[1],max_c[1],t), lerp_ch(min_c[2],max_c[2],t)]);
				}
				return { colorscale_bg: color };
			}
			case "topN": {
				const cache_key = `cf_topn_${rule.id}`;
				if (!this._cf_cs_cache) this._cf_cs_cache = {};
				if (!this._cf_cs_cache[cache_key]) {
					const { r1, c1, r2, c2 } = rule.range;
					const vals = [];
					for (let r = r1; r <= r2; r++) {
						for (let c = c1; c <= c2; c++) {
							const v = parseFloat(this.list_view?.data?.[r]?.[this.columns[c]?.data]);
							if (!isNaN(v)) vals.push(v);
						}
					}
					vals.sort((a, b) => b - a);
					const n = rule.percent ? Math.ceil(vals.length * (rule.n / 100)) : rule.n;
					this._cf_cs_cache[cache_key] = {
						top_threshold: vals[n - 1] ?? -Infinity,
						bottom_threshold: [...vals].reverse()[n - 1] ?? Infinity,
					};
				}
				const { top_threshold, bottom_threshold } = this._cf_cs_cache[cache_key];
				if (isNaN(num)) return false;
				return rule.top ? num >= top_threshold : num <= bottom_threshold;
			}
			case "duplicate": {
				const cache_key = `cf_dup_${rule.id}`;
				if (!this._cf_cs_cache) this._cf_cs_cache = {};
				if (!this._cf_cs_cache[cache_key]) {
					const { r1, c1, r2, c2 } = rule.range;
					const counts = {};
					for (let r = r1; r <= r2; r++) {
						for (let c = c1; c <= c2; c++) {
							const v = String(this.list_view?.data?.[r]?.[this.columns[c]?.data] ?? "");
							counts[v] = (counts[v] || 0) + 1;
						}
					}
					this._cf_cs_cache[cache_key] = counts;
				}
				return (this._cf_cs_cache[cache_key][String(value ?? "")] || 0) > 1;
			}
			case "unique": {
				const cache_key = `cf_uniq_${rule.id}`;
				if (!this._cf_cs_cache) this._cf_cs_cache = {};
				if (!this._cf_cs_cache[cache_key]) {
					const { r1, c1, r2, c2 } = rule.range;
					const counts = {};
					for (let r = r1; r <= r2; r++) {
						for (let c = c1; c <= c2; c++) {
							const v = String(this.list_view?.data?.[r]?.[this.columns[c]?.data] ?? "");
							counts[v] = (counts[v] || 0) + 1;
						}
					}
					this._cf_cs_cache[cache_key] = counts;
				}
				return (this._cf_cs_cache[cache_key][String(value ?? "")] || 0) === 1;
			}
			default:
				return false;
		}
	}

	/** Clear the CF colorscale/topN/dup cache (call after data reload or rule change). */
	_clear_cf_cache() {
		this._cf_cs_cache = {};
		this._cf_cell_cache = new Map();
		// Link validator cache — invalidate on data refresh so stale checks don't persist
		this._link_check_cache = null;
	}

	/** Rebuild per-cell CF cache — called after data load or rule change. O(rows×rules) once. */
	_rebuild_cf_cache() {
		this._cf_cell_cache = new Map();
		if (!this.cond_fmt_rules?.length || !this.list_view?.data?.length) return;
		const data = this.list_view.data;
		this.cond_fmt_rules.forEach(rule => {
			const { r1, c1, r2, c2 } = rule.range || {};
			if (r1 == null || rule.type === "colorscale" || rule.type === "topbottom" || rule.type === "dupuniq") return;
			// colorscale/topbottom/dupuniq need full column scan — keep their per-cell path
			for (let r = r1; r <= Math.min(r2, data.length - 1); r++) {
				for (let c = c1; c <= c2; c++) {
					if (!this.columns[c]) continue;
					const val = data[r]?.[this.columns[c].data];
					const match = this._eval_cf_rule(rule, val);
					if (match === true) {
						const key = `${r}:${c}`;
						const existing = this._cf_cell_cache.get(key) || {};
						if (rule.fmt?.bg)    existing.bg    = rule.fmt.bg;
						if (rule.fmt?.color) existing.color = rule.fmt.color;
						this._cf_cell_cache.set(key, existing);
					}
				}
			}
		});
	}

	/** O(1) column index lookup — builds Map lazily, invalidated when columns change. */
	_get_col_idx(fieldname) {
		// Always rebuild when stale — nulled whenever this.columns is mutated (push/splice)
		// or reassigned. Rebuild is cheap (10-20 cols typical), correctness is critical.
		if (!this._col_index_map) {
			this._col_index_map = new Map(this.columns.map((c, i) => [c.data, i]));
		}
		const idx = this._col_index_map.get(fieldname);
		return idx !== undefined ? idx : -1;
	}

	/** Invalidate the _col_index_map cache. Call after any push/splice on this.columns. */
	_invalidate_col_map() {
		this._col_index_map = null;
	}

	/** Debounced persist of format_store to user_settings (800ms). */
	_schedule_format_store_save() {
		clearTimeout(this._fmt_save_timer);
		this._fmt_save_timer = setTimeout(() => {
			frappe.model.user_settings.save(this.doctype, "excel_format_store", this.format_store);
		}, 800);
	}

	/** Restore chart overlays from serialized config (called by WorkbookManager). */
	_restore_chart_overlays(overlays) {
		if (!overlays?.length) return;
		this.chart_overlays = [];
		this.chart_manager?.restore(overlays);
	}

	// ── Event handlers ────────────────────────────────────────────────────────

	// ── V3.3 — Frappe-Native Validators (beforeChange hook) ──────────────────

	/**
	 * Validate cell changes before HOT commits them.
	 * Returning false cancels the change; setting changes[i] = null cancels one cell.
	 * Visual feedback: brief red flash on the cell TD.
	 */
	_validate_changes(changes, source) {
		if (!changes || source === "loadData" || source === "autofetch" || source === "flash_fill" || source === "fill_down") return;

		const _reject = (row, col, msg) => {
			// Flash cell red for 600ms
			setTimeout(() => {
				const td = this.hot?.getCell(row, col);
				if (td) {
					td.style.transition = "background-color 0s";
					td.style.backgroundColor = "#ffcccc";
					setTimeout(() => {
						td.style.transition = "background-color 0.4s";
						td.style.backgroundColor = "";
					}, 600);
				}
			}, 0);
			frappe.show_alert({ message: msg, indicator: "red" }, 3);
		};

		for (let i = changes.length - 1; i >= 0; i--) {
			const [row, prop, , new_val] = changes[i];
			if (new_val === null || new_val === "") continue; // allow clearing

			const col_idx = typeof prop === "number" ? prop : this._get_col_idx(prop);
			const col_def = this.columns[col_idx];
			if (!col_def?._df) continue;
			const df = col_def._df;

			// Numeric types: Currency, Float, Int, Percent
			if (["Currency", "Float", "Int", "Percent"].includes(df.fieldtype)) {
				if (isNaN(Number(new_val)) || String(new_val).trim() === "") {
					_reject(row, col_idx, __(`{0}: must be a number`, [df.label || df.fieldname]));
					changes[i] = null;
					continue;
				}
				if (df.fieldtype === "Int" && !Number.isInteger(Number(new_val))) {
					_reject(row, col_idx, __(`{0}: must be a whole number`, [df.label || df.fieldname]));
					changes[i] = null;
					continue;
				}
			}

			// Select: value must be in options list
			if (df.fieldtype === "Select" && df.options) {
				const opts = df.options.split("\n").map(o => o.trim());
				if (new_val && !opts.includes(String(new_val))) {
					_reject(row, col_idx, __(`{0}: must be one of: {1}`, [df.label || df.fieldname, opts.slice(0, 5).join(", ")]));
					changes[i] = null;
					continue;
				}
			}

			// Date: basic format check (YYYY-MM-DD)
			if (df.fieldtype === "Date" && new_val) {
				const v = String(new_val);
				if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) {
					_reject(row, col_idx, __(`{0}: use YYYY-MM-DD format`, [df.label || df.fieldname]));
					changes[i] = null;
					continue;
				}
			}

			// Link fields: async existence check (non-blocking — show warning after).
			// Batched by (doctype, value) to avoid N HTTP calls on paste of N rows.
			if (df.fieldtype === "Link" && df.options && new_val) {
				const _row = row, _col = col_idx, _val = String(new_val),
					_label = df.label || df.fieldname, _options = df.options;
				const _cache_key = `${_options}::${_val}`;
				// Use a session-level check cache to avoid re-checking same value twice
				if (!this._link_check_cache) this._link_check_cache = new Map();
				if (this._link_check_cache.has(_cache_key)) {
					if (this._link_check_cache.get(_cache_key) === false) {
						_reject(_row, _col, __(`{0}: "{1}" not found in {2}`, [_label, _val, _options]));
					}
				} else {
					frappe.db.exists(_options, _val).then(exists => {
						this._link_check_cache.set(_cache_key, !!exists);
						if (!exists) {
							_reject(_row, _col, __(`{0}: "{1}" not found in {2}`, [_label, _val, _options]));
						}
					});
				}
			}
		}

		// Remove nulled-out changes
		for (let i = changes.length - 1; i >= 0; i--) {
			if (changes[i] === null) changes.splice(i, 1);
		}
	}

	_on_change(changes, source) {
		// Skip internal HOT sources that aren't user edits
		if (!changes || source === "loadData" || source === "MergeCells" || source === "UndoRedo.undo" && changes.every(([,,,v]) => v === null)) return;

		// Skip our own autofetch writes — they're already in list_view.data, no DB save needed
		if (source === "autofetch") return;
		if (source === "fill_scroll") return;  // formula cells written by _fill_new_rows

		// Coerce Check field booleans → Frappe integers (0/1).
		// HOT's checkbox autofill and our fill_down can produce true/false (boolean);
		// Frappe's set_value expects 0 or 1 for Check fields.
		if (source === "Autofill.fill" || source === "fill_down") {
			changes.forEach((change, i) => {
				if (!change) return;
				const [row, prop, oldVal, newVal] = change;
				if (typeof newVal !== "boolean") return;
				const col_idx = this._get_col_idx(prop);
				if (this.columns[col_idx]?._df?.fieldtype === "Check") {
					changes[i] = [row, prop, oldVal, newVal ? 1 : 0];
				}
			});
		}

		// In array-of-objects mode HOT gives [row, fieldname, oldVal, newVal].
		// formula_bridge needs numeric col indices, so convert.
		const indexed = changes.map(([row, prop, oldVal, newVal]) => {
			const col = this._get_col_idx(prop);
			return [row, col, oldVal, newVal];
		});

		// Push raw values into HyperFormula first (needed before copy/paste adjustment).
		this.formula_bridge.apply_changes(indexed);

		// For autofill: use HF copy+paste so relative references shift correctly.
		// (Without this, =AF1*0.18 copied to row 2 stays =AF1*0.18 instead of =AF2*0.18)
		if (source === "Autofill.fill") {
			this._fix_autofill_formulas(changes, indexed);
		}

		// Persist to Frappe DB — skip rows that are pending bulk creation (not in DB yet)
		const _save_changes = this._bulk_add_start >= 0
			? changes.filter(([row]) => row < this._bulk_add_start)
			: changes;
		if (_save_changes.length) {
			this.data_manager.queue_save(_save_changes);
		}
		if (_save_changes.length !== changes.length) {
			this._update_bulk_bar(); // refresh "X rows ready" count
		}

		// Keep local data array in sync.
		// NOTE: for autofill formula cells, _fix_autofill_formulas already wrote the
		// adjusted formula back, so we skip those (don't overwrite with the unadjusted string).
		const is_autofill_formula = source === "Autofill.fill";
		changes.forEach(([row, prop, , newVal]) => {
			if (!this.list_view.data[row]) return;
			if (is_autofill_formula && this.formula_bridge.is_formula(newVal)) return;
			this.list_view.data[row][prop] = newVal;
		});

		// Auto-fill fetch_from dependent fields when a Link field changes in any new row
		if (this._new_row_idx >= 0 || this._bulk_add_start >= 0) {
			this._autofill_fetch_from(changes);
		}
	}

	/**
	 * Build a map of fetch_from dependencies from the doctype meta.
	 * Handles Link fields (static doctype) and Dynamic Link fields (doctype in another field).
	 *
	 * Returns: { source_fieldname: [{ fieldname, remote_fn, link_dt?, dynamic_link_field? }] }
	 *
	 * e.g. for Sales Order:
	 *   customer → [{ fieldname:"customer_name", remote_fn:"customer_name", link_dt:"Customer" },
	 *                { fieldname:"customer_group", remote_fn:"customer_group", link_dt:"Customer" }, …]
	 *   price_list → [{ fieldname:"price_list_currency", remote_fn:"currency", link_dt:"Price List" }]
	 */
	_build_fetch_from_map(meta) {
		const map = {};
		(meta.fields || []).forEach(f => {
			if (!f.fetch_from) return;
			const dot = f.fetch_from.indexOf(".");
			if (dot < 0) return;
			const src = f.fetch_from.slice(0, dot);
			const remote_fn = f.fetch_from.slice(dot + 1);

			const src_df = (meta.fields || []).find(x => x.fieldname === src);
			if (!src_df) return;

			let entry;
			if (src_df.fieldtype === "Link") {
				// Static link: doctype is known from options
				entry = { fieldname: f.fieldname, remote_fn, link_dt: src_df.options };
			} else if (src_df.fieldtype === "Dynamic Link") {
				// Dynamic link: doctype is stored in the field named by src_df.options
				entry = { fieldname: f.fieldname, remote_fn, dynamic_link_field: src_df.options };
			} else {
				return; // Can't resolve
			}

			(map[src] = map[src] || []).push(entry);
		});
		return map;
	}

	/**
	 * BFS fetch_from chain resolver.
	 *
	 * When any Link/Dynamic-Link field changes in the new row, walks the entire
	 * dependency graph breadth-first. Each resolved field may itself be a source
	 * for deeper fetch_from fields — those are queued and resolved in subsequent passes.
	 *
	 * e.g.  customer → customer_group (hop 1) → price_list (hop 2) → price_list_currency (hop 3)
	 *
	 * Uses "autofetch" as HOT change source so _on_change skips DB save + re-trigger.
	 */
	async _autofill_fetch_from(initial_changes) {
		// Works for both inline insert (_new_row_idx) and bulk add (_bulk_add_start).
		// For bulk rows each changed row is handled independently.
		const is_bulk = this._bulk_add_start >= 0;
		if (this._new_row_idx < 0 && !is_bulk) return;

		const meta = frappe.get_meta(this.doctype);
		if (!meta) return;

		// Build dependency map lazily
		if (!this._fetch_from_map) {
			this._fetch_from_map = this._build_fetch_from_map(meta);
		}

		// Collect distinct new rows touched by these changes
		const changed_rows = is_bulk
			? [...new Set(initial_changes.map(([r]) => r).filter(r => r >= this._bulk_add_start))]
			: (this._new_row_idx >= 0 ? [this._new_row_idx] : []);

		for (const row_idx of changed_rows) {
			const row_data = this.list_view.data[row_idx];
			if (!row_data?._is_new) continue;
			await this._run_fetch_from_row(row_idx, row_data, initial_changes);
		}
	}

	async _run_fetch_from_row(row_idx, row_data, initial_changes) {
		if (!this._fetch_from_map) return;

		// BFS queue: [fieldname, newValue]
		const queue   = [];
		const visited = new Set(); // "fieldname=value" pairs already processed

		for (const [row, prop, , newVal] of initial_changes) {
			if (row === row_idx) queue.push([prop, newVal]);
		}

		while (queue.length) {
			const [field, value] = queue.shift();
			const key = `${field}=${value ?? ""}`;
			if (visited.has(key)) continue;
			visited.add(key);

			const deps = this._fetch_from_map[field];
			if (!deps?.length) continue;

			if (!value) {
				// Propagate clearing — empty source clears all dependents recursively
				const clears = [];
				deps.forEach(d => {
					row_data[d.fieldname] = "";
					const ci = this._get_col_idx(d.fieldname);
					if (ci >= 0) clears.push([row_idx, ci, ""]);
					queue.push([d.fieldname, ""]);
				});
				if (clears.length) this.hot.setDataAtCell(clears, "autofetch");
				continue;
			}

			// Resolve link_dt for Dynamic Link fields from current row_data
			const resolved_deps = deps.map(d => {
				if (d.link_dt) return d;
				// Dynamic Link: read the actual doctype from row_data
				const link_dt = row_data[d.dynamic_link_field] || "";
				return link_dt ? { ...d, link_dt } : null;
			}).filter(Boolean);

			// Batch fetch by link_dt so we issue one DB call per doctype per hop
			const by_dt = {};
			resolved_deps.forEach(d => (by_dt[d.link_dt] = by_dt[d.link_dt] || []).push(d));

			for (const [link_dt, dt_deps] of Object.entries(by_dt)) {
				try {
					const remote_fields = [...new Set(dt_deps.map(d => d.remote_fn))];
					const r = await frappe.db.get_value(link_dt, value, remote_fields);
					if (!r?.message) continue;

					const updates = [];
					dt_deps.forEach(d => {
						const fetched = r.message[d.remote_fn];
						if (fetched != null && fetched !== "") {
							row_data[d.fieldname] = fetched;
							const ci = this._get_col_idx(d.fieldname);
							if (ci >= 0) updates.push([row_idx, ci, fetched]);
							// Queue next hop: this resolved field may itself be a source
							queue.push([d.fieldname, fetched]);
						}
					});
					if (updates.length) this.hot.setDataAtCell(updates, "autofetch");
				} catch (e) {
					console.warn("[ExcelView] fetch chain hop failed:", e);
				}
			}
		}
	}

	/**
	 * After HOT autofill, adjust relative formula references using HyperFormula's
	 * copy+paste API. HF computes the correctly-shifted formula for each target row/col.
	 *
	 * We self-detect the source row by checking which adjacent row already has a
	 * formula in HF (no reliance on beforeAutofill whose signature varies by HOT version).
	 *
	 * Example (fill-down from row 0):
	 *   row 1 → =AF2*0.18
	 *   row 2 → =AF3*0.18
	 */
	_fix_autofill_formulas(changes, indexed) {
		// Only handle single-column fills (standard fill-down / fill-up)
		const cols = new Set(indexed.map(([, c]) => c));
		if (cols.size !== 1) return;
		const col = [...cols][0];
		if (col < 0) return;

		// Filter to formula-only changes
		const formula_changes = indexed.filter(([, , , v]) => this.formula_bridge.is_formula(v));
		if (!formula_changes.length) return;

		const changed_rows = formula_changes.map(([r]) => r);
		const min_row = Math.min(...changed_rows);
		const max_row = Math.max(...changed_rows);

		// Source row is adjacent to the fill range and already holds a formula in HF.
		//   • fill-down: source is min_row - 1
		//   • fill-up:   source is max_row + 1
		let src_row = null;
		if (min_row > 0 && this.formula_bridge.get_formula(min_row - 1, col)) {
			src_row = min_row - 1;
		} else if (this.formula_bridge.get_formula(max_row + 1, col)) {
			src_row = max_row + 1;
		}
		if (src_row === null) return;

		const hf = this.formula_bridge.hf;
		const sheet = this.formula_bridge.sheet_id;

		try {
			// Copy source cell into HF's internal clipboard.
			// HF remembers relative offsets so each paste adjusts references correctly.
			hf.copy({
				start: { sheet, row: src_row, col },
				end:   { sheet, row: src_row, col },
			});

			let needs_render = false;

			formula_changes.forEach(([row, , , newVal]) => {
				// Paste — HF adjusts relative row/col references vs the source position
				hf.paste({ sheet, row, col });

				const adjusted = hf.getCellFormula({ sheet, row, col });
				if (adjusted && adjusted !== newVal) {
					const prop = this.columns[col]?.data;
					if (prop && this.list_view.data[row]) {
						this.list_view.data[row][prop] = adjusted;
					}
					needs_render = true;
				}
			});

			if (needs_render) this.hot.render();
		} catch (e) {
			console.warn("[ExcelView] autofill formula adjustment failed:", e);
		}
	}


	// ── Fill Column ↓ (All Rows) ────────────────────────────────────────
	// Fills a formula from src_row to every row in the loaded dataset.
	// Uses HyperFormula copy+paste so relative references (A1 -> A2 -> A3) are
	// adjusted correctly. Also registers the column in _formula_col_map so
	// future infinite-scroll appends auto-populate new rows.
	_fill_column_all_rows(col, src_row = 0) {
		if (!this.formula_bridge || !this.hot) return;

		const src_formula = this.formula_bridge.get_formula(src_row, col);
		if (!src_formula) {
			frappe.show_alert({ message: __("Selected cell has no formula"), indicator: "orange" });
			return;
		}

		const hf    = this.formula_bridge.hf;
		const sheet = this.formula_bridge.sheet_id;
		const total = this.list_view.data?.length || 0;
		const prop  = this.columns[col]?.data;

		hf.copy({ start: { sheet, row: src_row, col }, end: { sheet, row: src_row, col } });

		for (let row = 0; row < total; row++) {
			if (row === src_row) continue;
			hf.paste({ sheet, row, col });
			const adjusted = hf.getCellFormula({ sheet, row, col });
			if (adjusted && prop && this.list_view.data[row]) {
				this.list_view.data[row][prop] = adjusted;
			}
		}

		// Store formula template (not src_row) so _reapply_formula_cols can reuse it
		this._formula_col_map = this._formula_col_map || new Map();
		this._formula_col_map.set(col, src_formula);
		this._save_formula_col_settings();

		this.hot.render();
		frappe.show_alert({ message: __("Formula filled to {0} rows", [total]), indicator: "green" });
	}

	// Re-applies all tracked formula columns to rows [from_row, to_row].
	// _formula_col_map stores col_idx → template_formula_string.
	// When from_row=0 it does a full re-apply (used after idle refresh).
	// When from_row=prev_len it fills only newly loaded rows (infinite scroll).
	_reapply_formula_cols(from_row, to_row) {
		if (!this.formula_bridge || !this.hot || !this._formula_col_map?.size) return;
		if (to_row < 0 || from_row > to_row) return;

		const hf    = this.formula_bridge.hf;
		const sheet = this.formula_bridge.sheet_id;
		const data  = this.list_view.data;
		const hot_changes = [];

		for (const [col, template] of this._formula_col_map) {
			const prop = this.columns[col]?.data;
			if (!prop || !template) continue;

			// Ensure HF has template in row 0 (source) — needed after a full reload
			hf.setCellContents({ sheet, row: 0, col }, [[template]]);
			if (data[0]) {
				data[0][prop] = template;
				if (from_row === 0) hot_changes.push([0, prop, template]);
			}

			// Copy template from row 0, paste to each target row (HF adjusts refs)
			hf.copy({ start: { sheet, row: 0, col }, end: { sheet, row: 0, col } });
			const loop_start = from_row === 0 ? 1 : from_row;
			for (let row = loop_start; row <= to_row; row++) {
				hf.paste({ sheet, row, col });
				const adjusted = hf.getCellFormula({ sheet, row, col });
				if (adjusted && data[row]) {
					data[row][prop] = adjusted;
					hot_changes.push([row, prop, adjusted]);
				}
			}
		}

		// setDataAtRowProp: hot_changes uses [row, prop_string, value] — property name
		// not numeric col index. afterRenderer sees formula string → async fetch fires.
		// afterChange ignores 'fill_scroll' source.
		if (hot_changes.length) {
			this.hot.setDataAtRowProp(hot_changes, 'fill_scroll');
		}
	}

	// Restores formula columns from a saved templates array [{key, label, formula}].
	// Called from workbook apply_config() and on first refresh from user_settings.
	_restore_formula_col_templates(templates) {
		if (!templates?.length) return;
		let added = false;
		for (const fc of templates) {
			// Skip if column already exists (handles duplicate keys in saved state gracefully)
			if (this.columns.find(c => c.data === fc.key)) continue;
			const new_col = { data: fc.key, title: fc.label, type: 'text', width: 140, _is_formula_col: true };
			this.columns.push(new_col);
			if (this._master_columns)   this._master_columns.push(new_col);
			if (this._original_columns) this._original_columns.push(new_col); // keep in sync (blank cols do this too)
			this._invalidate_col_map();
			added = true;
		}
		if (added) {
			this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
			this.formula_bridge.reload(this.matrix);
			this.hot.updateSettings({ columns: this.columns });
		}
		// Register formula templates in the map.
		// Each unique key gets exactly one entry — last-writer-wins for duplicates,
		// but duplicates should never occur after the _formula_col_count fix below.
		this._formula_col_map = this._formula_col_map || new Map();
		for (const fc of templates) {
			const col_idx = this.columns.findIndex(c => c.data === fc.key);
			if (col_idx >= 0 && fc.formula) this._formula_col_map.set(col_idx, fc.formula);
		}
		// Apply formulas to all currently loaded rows
		const total = (this.list_view.data?.length || 0) - 1;
		if (total >= 0) this._reapply_formula_cols(0, total);

		// ── CRITICAL: advance the key counter past all restored keys ──────────
		// Without this, the next "Add Formula Column" restarts at __fml_1__ and
		// generates a duplicate key, causing columns to vanish or show wrong data.
		let max_idx = this._formula_col_count || 0;
		for (const fc of templates) {
			const m = /^__fml_(\d+)__$/.exec(fc.key || "");
			if (m) max_idx = Math.max(max_idx, parseInt(m[1], 10));
		}
		this._formula_col_count = max_idx;
	}

	// Persists formula column templates to user_settings so they survive page reload.
	_save_formula_col_settings() {
		if (!this._formula_col_map?.size) return;
		const templates = [];
		for (const [col_idx, formula] of this._formula_col_map) {
			const col = this.columns[col_idx];
			if (col) templates.push({ key: col.data, label: col.title, formula });
		}
		frappe.model.user_settings.save(this.doctype, 'excel_formula_col_templates', templates);

		// Also sync formula_columns into the active sheet state so that workbook
		// saves always include the current formula columns without requiring a
		// separate "save workbook" click after adding/editing a formula column.
		const sheet = this.sheet_manager?.get_current();
		if (sheet) {
			sheet.formula_columns = templates.map(t => ({
				key:              t.key,
				label:            t.label,
				formula_template: t.formula,
			}));
		}
	}

	// ── Blank column persistence + lazy-fill ─────────────────────────────────

	_save_blank_col_settings() {
		const configs = [];
		(this._blank_col_configs || new Map()).forEach((cfg, key) => {
			configs.push({ key, label: cfg.label, ff_transform: cfg.ff_transform || null });
		});
		frappe.model.user_settings.save(this.doctype, 'excel_blank_col_configs', configs);
	}

	_restore_blank_cols(configs) {
		if (!configs?.length) return;
		this._blank_col_configs = this._blank_col_configs || new Map();
		let added = false;
		for (const cfg of configs) {
			if (this.columns.find(c => c.data === cfg.key)) continue; // already present
			const new_col = { data: cfg.key, title: cfg.label, type: "text", width: 140, _is_blank_col: true };
			this.columns.push(new_col);
			if (this._master_columns) this._master_columns.push(new_col);
			if (this._original_columns) this._original_columns.push(new_col);
			this._invalidate_col_map();
			added = true;
		}
		// Rebuild HF matrix if any new col added
		if (added) {
			this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
			this.formula_bridge.reload(this.matrix);
			this.hot.updateSettings({ columns: this.columns });
		}
		// Register configs (including ff_transform) and fill all loaded rows
		for (const cfg of configs) {
			this._blank_col_configs.set(cfg.key, cfg);
		}
		const total = (this.list_view.data?.length || 0) - 1;
		if (total >= 0) this._reapply_blank_col_fills(0, total);
		if (added) this.hot.render();
	}

	// Reconstruct a transform function from its saved fn_idx + example_len.
	_ff_make_candidate(fn_idx, example_len) {
		const n = example_len || 0;
		const candidates = [
			v => v.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase()).join(""),
			v => v.split(/\s+/)[0],
			v => v.split(/\s+/).pop(),
			v => v.toUpperCase(),
			v => v.toLowerCase(),
			v => v.slice(0, n),
			v => v.split(/[,;(\-]/)[0].trim(),
			v => v.replace(/\D/g, ""),
			v => v.replace(/[^a-zA-Z]/g, ""),
			v => v.replace(/\s+/g, ""),
		];
		return candidates[fn_idx] || null;
	}

	// Apply stored flash-fill transforms to rows [from_row, to_row] — O(blanks × configs).
	// Called on: initial restore, infinite-scroll append.
	_reapply_blank_col_fills(from_row, to_row) {
		const data = this.list_view.data;
		if (!data?.length || !this._blank_col_configs?.size) return;
		const changes = [];
		this._blank_col_configs.forEach((cfg, col_key) => {
			const ff = cfg.ff_transform;
			if (!ff) return; // blank col with no flash fill yet
			const fn = this._ff_make_candidate(ff.fn_idx, ff.example_len);
			if (!fn) return;
			const col_idx = this.columns.findIndex(c => c.data === col_key);
			if (col_idx < 0) return;
			for (let r = from_row; r <= to_row; r++) {
				if (String(data[r]?.[col_key] ?? "") !== "") continue; // already filled
				const adj_val = String(data[r]?.[ff.adj_col_key] ?? "").trim();
				if (!adj_val) continue;
				try {
					const v = fn(adj_val);
					if (v !== null && v !== "") {
						data[r][col_key] = v;
						changes.push([r, col_idx, v]);
					}
				} catch (_) { /* skip */ }
			}
		});
		if (changes.length) this.hot.setDataAtCell(changes, "flash_fill");
	}


	// ── Column header formatting (afterGetColHeader hook) ─────────────────────
	// Applies border stored at format_store key "h_<col>" to the <th> element.
	_apply_col_header_format(TH, col) {
		if (col < 0) return; // row-number corner cell
		// Highlight mandatory temp columns added during bulk duplicate
		if (this.columns[col]?._is_bulk_temp) {
			const _dark = document.documentElement.getAttribute("data-theme") === "dark";
			TH.style.background = _dark ? "#2c1010" : "#fff0f0";
			TH.style.color      = _dark ? "#f48a8a" : "#c62828";
			return;
		}
		const key = `h_${col}`;
		const fmt = this.format_store[key];
		if (!fmt?.borders) return;
		const b = fmt.borders;
		if (b.top)    TH.style.borderTop    = b.top;
		if (b.right)  TH.style.borderRight  = b.right;
		if (b.bottom) TH.style.borderBottom = b.bottom;
		if (b.left)   TH.style.borderLeft   = b.left;
	}

	_on_selection(row, col, row2, col2) {
		// Format Painter: intercept selection change as paint target
		if (this.toolbar_component?._painting && row >= 0 && col >= 0) {
			this.toolbar_component.apply_paint(row, col);
			// Sync toolbar to reflect new cell's (painted) format
			this.toolbar_component?.sync(row, col);
			this.status_bar?.update(row, col, row2 ?? row, col2 ?? col);
			return;
		}
		this.formula_bar_component.update(row, col);
		this.toolbar_component?.sync(row, col);
		this.status_bar?.update(row, col, row2 ?? row, col2 ?? col);

		// V3.1 — Focus Cell: track active cell for crosshair
		const focus_changed = this._focus_row !== row || this._focus_col !== col;
		this._focus_row = row;
		this._focus_col = col;
		if (this._focus_enabled && focus_changed) this.hot?.render();

		// V3.1 — Formula Precedent highlighting (debounced — skip on rapid arrow-key navigation)
		this._highlight_precedents_debounced(row, col);
	}

	_highlight_precedents_debounced(row, col) {
		clearTimeout(this._precedent_timer);
		this._precedent_timer = setTimeout(() => {
			if (!this._show_precedents) {
				if (this._precedent_cells?.size) { this._precedent_cells = new Set(); this.hot?.render(); }
				return;
			}
			const prev_size = this._precedent_cells?.size || 0;
			this._precedent_cells = new Set();
			const formula = this.formula_bridge?.get_formula?.(row, col);
			if (formula && this.formula_bridge?.hf) {
				try {
					const deps = this.formula_bridge.hf.getCellDependencies(
						{ sheet: this.formula_bridge.sheet_id || 0, row, col }
					);
					deps.forEach(dep => {
						if (dep.row !== undefined && dep.col !== undefined) {
							this._precedent_cells.add(`${dep.row}:${dep.col}`);
						} else if (dep.start) {
							for (let rr = dep.start.row; rr <= dep.end.row; rr++) {
								for (let cc = dep.start.col; cc <= dep.end.col; cc++) {
									this._precedent_cells.add(`${rr}:${cc}`);
								}
							}
						}
					});
					if (deps.length || prev_size) this.hot?.render();
				} catch (_) { /* non-formula cell */ }
			} else if (prev_size) {
				this.hot?.render();
			}
		}, 80);
	}
	_on_col_resize(col_index, new_width) {
		// HOT 6.2.2: widths stored in plugin.manualColumnWidths[] by physical index
		const plugin = this.hot.getPlugin("manualColumnResize");
		const widths = this.columns.map((_, i) => {
			const phys = this.hot.toPhysicalColumn ? this.hot.toPhysicalColumn(i) : i;
			return plugin.manualColumnWidths[phys] || this.columns[i]?.width || 140;
		});
		this.column_manager.save_widths(widths);
		// V3.1 — Record for F4 Repeat Last Action (skip undefined from double-click auto-fit)
		if (new_width != null) this._last_action = { type: "col_resize", size: new_width };
	}

	// V3.3 — Column reorder (manualColumnMove hook)
	_on_col_move() {
		// toPhysicalColumn(v) is ALWAYS relative to _original_columns (the physical
		// order HOT was initialized with). We never call updateSettings({columns})
		// here because that resets manualColumnWidths[] (breaking user-resized widths)
		// and causes visual glitches that force a double-drag.
		const src = this._original_columns || this.columns;
		const n = src.length;
		if (!this.hot?.toPhysicalColumn) return;

		const order = [];
		for (let v = 0; v < n; v++) {
			const phys = this.hot.toPhysicalColumn(v);
			if (phys >= 0 && phys < n) order.push(src[phys].data);
		}
		if (order.length !== n) return; // sanity check

		this.column_manager.save_order(order);
	}

	// Apply persisted column order to this.columns + _master_columns on load
	_apply_saved_col_order() {
		const order = this.column_manager._load_order();
		if (!order || !order.length) return;
		const order_map = new Map(order.map((k, i) => [k, i]));
		const sort_fn = (a, b) => {
			const ai = order_map.has(a.data) ? order_map.get(a.data) : 9999;
			const bi = order_map.has(b.data) ? order_map.get(b.data) : 9999;
			return ai - bi;
		};
		this.columns.sort(sort_fn);
		this._master_columns.sort(sort_fn);
		this._col_index_map = null;
	}

	_on_row_resize(row_index, new_height) {
		// V3.1 — Record for F4 Repeat Last Action
		if (new_height != null) this._last_action = { type: "row_resize", size: new_height };
		// Persist to user_settings so heights survive refresh
		this._schedule_row_heights_save();
	}

	/**
	 * Infinite scroll — triggered by HOT's afterScrollVertically.
	 * Loads the next 100 rows when user scrolls within 20 rows of the bottom.
	 *
	 * Guards:
	 *   - Debounced (150ms) to avoid rapid-fire on momentum scroll
	 *   - `_loading_more` flag prevents concurrent fetches
	 *   - Stops when server returns fewer rows than page_length (no more data)
	 */
	_on_scroll_vertical() {
		// Don't trigger infinite-scroll loads while bulk-add rows are pending —
		// lv.data.length includes blank rows so lv.start would be wrong, and the
		// server response would overwrite / displace the unsaved blank rows.
		if (this._bulk_add_start >= 0) return;
		if (!this.hot) return;

		// DuckDB query sheet — delegate to its own infinite-scroll handler
		const _cur_sheet = this.sheet_manager?.get_current();
		if (_cur_sheet?.query_ast) {
			this._on_scroll_query_sheet(_cur_sheet);
			return;
		}

		// Secondary sheet — delegate to its own infinite-scroll handler
		if (_cur_sheet?.doctype && _cur_sheet.doctype !== this.doctype) {
			this._on_scroll_secondary_sheet(_cur_sheet);
			return;
		}

		if (this._loading_more || this._no_more_data) return;

		const lv           = this.list_view;
		const total_loaded = lv.data?.length || 0;

		// Pixel-based bottom detection — works whether HOT scrolls internally
		// or the page/window scrolls. Check the HOT container's visibility.
		const container = this.$hot_container?.[0];
		if (!container) return;

		// Try HOT inner holder first, fall back to container itself
		const holder     = container.querySelector(".wtHolder") || container;
		const scrollable = holder.scrollHeight > holder.clientHeight ? holder : window;

		let near_bottom;
		if (scrollable === window) {
			// Window scroll: check if HOT container bottom is close to viewport bottom
			const rect     = container.getBoundingClientRect();
			const vh       = window.innerHeight;
			near_bottom    = rect.bottom - vh < 200;   // within 200px of viewport bottom
		} else {
			// HOT internal scroll
			near_bottom = holder.scrollHeight - holder.scrollTop - holder.clientHeight < 200;
		}

		if (!near_bottom) return;

		clearTimeout(this._scroll_load_timer);
		this._scroll_load_timer = setTimeout(() => {
			if (this._loading_more || this._no_more_data) return;

			this._loading_more = true;
			this._show_load_more_indicator(true);

			const prev_len = lv.data?.length || 0;
			lv.start       = prev_len;
			this._prev_append_len = prev_len;   // for auto-fill in refresh()
			lv.last_args   = null;   // bypass no-change throttle

			// Monkey-patch render() for one call to detect empty response
			const orig_render = lv.render.bind(lv);
			lv.render = () => {
				lv.render = orig_render;
				if ((lv.data?.length || 0) <= prev_len) this._no_more_data = true;
				this._loading_more = false;
				this._show_load_more_indicator(false);
				orig_render();
			};

			lv.refresh();
		}, 150);
	}

	/**
	 * Scroll handler for secondary sheets — delegates to _sec_sheet_fetch.
	 * Called from _on_scroll_vertical when active sheet is a non-base DocType.
	 */
	_on_scroll_secondary_sheet(sheet) {
		if (this._sec_sheet_loading || sheet._no_more_data) return;
		const h = this.$hot_container?.[0]?.querySelector(".wtHolder");
		if (h && h.scrollHeight - h.scrollTop - h.clientHeight >= 200) return;
		clearTimeout(this._sec_scroll_timer);
		this._sec_scroll_timer = setTimeout(() => this._sec_sheet_fetch(sheet), 150);
	}

	/**
	 * Fetch next page for a secondary sheet and keep filling until container overflows.
	 * Uses its own _sec_sheet_loading flag so it never conflicts with base-sheet logic.
	 */
	_sec_sheet_fetch(sheet) {
		if (this._sec_sheet_loading || sheet._no_more_data) return;
		// Guard: abort if user switched away
		if (this.sheet_manager?.get_current()?.id !== sheet.id) return;

		this._sec_sheet_loading = true;
		this._show_load_more_indicator(true);

		const prev_len  = sheet.data?.length || 0;
		const page_size = 20; // Fixed for secondary sheets — list_view.page_length belongs to base sheet

		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype:    sheet.doctype,
				fields:     sheet._fetch_fields || ["name"],
				filters:    sheet.filters || [],
				order_by:   sheet.sort_by
					? `${sheet.sort_by.field} ${sheet.sort_by.order}`
					: "modified desc",
				limit:      page_size,
				limit_start: prev_len,
			},
			error: () => {
				this._sec_sheet_loading = false;
				this._show_load_more_indicator(false);
			},
			callback: (r) => {
				this._sec_sheet_loading = false;
				this._show_load_more_indicator(false);

				const new_rows = r.message || [];
				if (new_rows.length < page_size) sheet._no_more_data = true;
				if (!new_rows.length) return;

				sheet.data = [...(sheet.data || []), ...new_rows];
				if (this.sheet_manager?.get_current()?.id !== sheet.id) return;

				this.hot.loadData(sheet.data);
				// Re-apply smart lookups to include the newly appended rows
				this._reapply_smart_lookups?.();

				// After render: keep filling if container still has room, else stop
				if (!sheet._no_more_data) {
					// Short delay so HOT paints before we re-check scrollability
					setTimeout(() => {
						const h = this.$hot_container?.[0]?.querySelector(".wtHolder");
						// Container not yet scrollable → keep filling; scrollable → wait for user scroll
						if (!h || h.scrollHeight - h.clientHeight < 200) {
							this._sec_sheet_fetch(sheet);
						}
					}, 100);
				}
			},
		});
	}

	/**
	 * Scroll handler for DuckDB query sheets — same bottom-proximity guard as secondary sheets.
	 */
	_on_scroll_query_sheet(sheet) {
		if (this._sec_sheet_loading || sheet._no_more_data || sheet._rerun_in_progress) return;
		const h = this.$hot_container?.[0]?.querySelector(".wtHolder");
		if (h && h.scrollHeight - h.scrollTop - h.clientHeight >= 200) return;
		clearTimeout(this._sec_scroll_timer);
		this._sec_scroll_timer = setTimeout(() => this._query_sheet_fetch(sheet), 150);
	}

	/**
	 * Fetch next page for a DuckDB query sheet.
	 * Re-runs the stored AST with offset = current row count, appends results.
	 * Uses the same _sec_sheet_loading flag so it never conflicts with base/secondary sheet loads.
	 */
	async _query_sheet_fetch(sheet) {
		if (this._sec_sheet_loading || sheet._no_more_data || sheet._rerun_in_progress) return;
		if (this.sheet_manager?.get_current()?.id !== sheet.id) return;

		this._sec_sheet_loading = true;
		this._show_load_more_indicator(true);

		try {
			const engine = frappe.views.excel?.duckdb_v2;
			if (!engine) return;

			const { QueryAST } = frappe.views.excel;
			const plain = JSON.parse(sheet.query_ast);
			const ast   = (QueryAST && typeof QueryAST === "function")
				? Object.assign(new QueryAST(), plain)
				: plain;

			const PAGE_SIZE = 100;
			ast.offset = sheet.data?.length || 0;
			ast.limit  = PAGE_SIZE;

			const { headers, rows } = await engine.run_ast(ast);

			if (!rows.length) {
				sheet._no_more_data = true;
				return;
			}

			const new_rows = rows.map(r => {
				const obj = {};
				headers.forEach((h, i) => { obj[h] = r[i] ?? ""; });
				return obj;
			});
			sheet.data = [...(sheet.data || []), ...new_rows];
			if (rows.length < PAGE_SIZE) sheet._no_more_data = true;

			if (this.sheet_manager?.get_current()?.id !== sheet.id) return;
			this.hot?.loadData(sheet.data);

			// Keep filling if the container isn't scrollable yet
			if (!sheet._no_more_data) {
				setTimeout(() => {
					const h = this.$hot_container?.[0]?.querySelector(".wtHolder");
					if (!h || h.scrollHeight - h.clientHeight < 200) this._query_sheet_fetch(sheet);
				}, 100);
			}
		} catch (e) {
			console.error("[ExcelView] _query_sheet_fetch failed:", e);
		} finally {
			this._sec_sheet_loading = false;
			this._show_load_more_indicator(false);
		}
	}

	_show_load_more_indicator(show) {
		if (!this.$hot_container) return;
		if (show) {
			if (!this.$hot_container.find(".ev-load-more-ind").length) {
				$('<div class="ev-load-more-ind">Loading more rows…</div>')
					.appendTo(this.$hot_container);
			}
		} else {
			this.$hot_container.find(".ev-load-more-ind").remove();
		}
	}

	/** Debounced save of manual row heights to user_settings (600ms). */
	_schedule_row_heights_save() {
		clearTimeout(this._rh_save_timer);
		this._rh_save_timer = setTimeout(() => {
			const plugin = this.hot?.getPlugin("manualRowResize");
			if (!plugin) return;
			const heights = [...(plugin.manualRowHeights || [])];
			frappe.model.user_settings.save(this.doctype, "excel_row_heights", heights);
		}, 600);
	}

	// V3.1 — Apply a column width to a set of columns (used by F4 repeat)
	// HOT 6.2.2 stores widths in plugin.manualColumnWidths[] (physical col index)
	_apply_col_resize(cols, size) {
		const plugin = this.hot?.getPlugin("manualColumnResize");
		if (!plugin) return;
		cols.forEach(col => {
			const phys = this.hot.toPhysicalColumn ? this.hot.toPhysicalColumn(col) : col;
			plugin.manualColumnWidths[phys] = size;
		});
		this.hot.render();
		// Persist widths using same physical index read-back
		const widths = this.columns.map((_, i) => {
			const phys = this.hot.toPhysicalColumn ? this.hot.toPhysicalColumn(i) : i;
			return plugin.manualColumnWidths[phys] || this.columns[i]?.width || 140;
		});
		this.column_manager.save_widths(widths);
	}

	// V3.1 — Apply a row height to a set of rows (used by F4 repeat)
	// HOT 6.2.2 stores heights in plugin.manualRowHeights[] (physical row index)
	_apply_row_resize(rows, size) {
		const plugin = this.hot?.getPlugin("manualRowResize");
		if (!plugin) return;
		rows.forEach(row => {
			// Skip hidden rows — keep them at 0
			if (!this._hidden_rows?.has(row)) {
				plugin.manualRowHeights[row] = size;
			}
		});
		this.hot.render();
	}

	_on_render() {
		// Guard: afterRender fires during HOT's own init, before this.hot is assigned
		if (!this.hot) return;
		// V3.1 — Sync left clone (row headers) with master table hidden rows.
		// Perf: only do the O(n) DOM traversal when hidden rows actually changed
		// (_dirty_hidden_rows set true in hide_row/unhide_row), not on every render.
		if (this._dirty_hidden_rows && this._hidden_rows?.size) {
			const masterTRs = this.hot.rootElement?.querySelectorAll(".ht_master tbody tr");
			const leftTRs = this.hot.rootElement?.querySelectorAll(".ht_clone_left tbody tr");
			if (masterTRs && leftTRs) {
				masterTRs.forEach((tr, i) => {
					const ltr = leftTRs[i];
					if (!ltr) return;
					if (tr.style.display === "none") {
						ltr.style.cssText = "display:none!important;height:0!important;";
					} else if (ltr.style.display === "none") {
						ltr.style.cssText = "";
					}
				});
			}
			this._dirty_hidden_rows = false;
		}
		const sel = this.hot.getSelectedLast();
		if (sel) {
			this.formula_bar_component.update(sel[0], sel[1]);
			this.status_bar?.update(sel[0], sel[1], sel[2], sel[3]);
		}
	}

	// ── Keyboard shortcuts ────────────────────────────────────────────────────

	_bind_shortcuts() {
		$(document).on("keydown.ev", (e) => {
			if (!this._is_active()) return;

			const ctrl = e.ctrlKey || e.metaKey;

			// Ctrl+S → force save
			if (ctrl && e.key === "s") {
				e.preventDefault();
				this.data_manager._flush_saves();
				return;
			}

					// Ctrl+F → Find,  Ctrl+H → Find & Replace
			if (ctrl && e.key === "f") {
				e.preventDefault();
				this._show_find_replace("find");
				return;
			}
			if (ctrl && e.key === "h") {
				e.preventDefault();
				this._show_find_replace("replace");
				return;
			}

			// Formatting shortcuts — only when formula bar is NOT focused
			if (document.activeElement?.classList.contains("ev-formula-input")) return;

			if (ctrl && e.key === "b") {
				e.preventDefault();
				this.toolbar_component?.toggle("bold");
			}
			if (ctrl && e.key === "i") {
				e.preventDefault();
				this.toolbar_component?.toggle("italic");
			}
			if (ctrl && e.key === "u") {
				e.preventDefault();
				this.toolbar_component?.toggle("underline");
			}

			// V3.1 — F4: Repeat Last Action
			if (e.key === "F4" && !ctrl && !e.altKey && !e.shiftKey) {
				e.preventDefault();
				this._repeat_last_action();
			}
		});
	}

	_is_active() {
		return this.list_view?.view_name === "Excel" && document.contains(this.$hot_container?.[0]);
	}

	// ── Column visibility ─────────────────────────────────────────────────────

	/**
	 * Hide the given column indices (visible-index space).
	 * Accepts an array so non-contiguous Ctrl+click selections are supported.
	 * @param {number[]} col_indices - array of visible column indices to hide
	 */
	_hide_columns(col_indices) {
		let count = 0;
		col_indices.forEach((c) => {
			const key = this.columns[c]?.data;
			if (key) { this._hidden_col_keys.add(key); count++; }
		});
		if (!count) return;
		this._sync_visible_columns();
		// Persist to current sheet object so Smart Lookup sees per-sheet hidden state
		const _cur = this.sheet_manager?.get_current();
		if (_cur) _cur._hidden_col_keys = new Set(this._hidden_col_keys);
		frappe.model.user_settings.save(this.doctype, "excel_hidden_cols", [...this._hidden_col_keys]);
		frappe.show_alert(
			{
				message: __(
					"{0} column(s) hidden — right-click → Show all columns to restore",
					[count]
				),
				indicator: "blue",
			},
			4
		);
	}

	/**
	 * Restore all hidden columns back to the visible set.
	 */
	_show_all_columns() {
		const count = this._hidden_col_keys.size;
		if (!count) {
			frappe.show_alert({ message: __("No hidden columns"), indicator: "orange" }, 2);
			return;
		}
		this._hidden_col_keys.clear();
		const _cur = this.sheet_manager?.get_current();
		if (_cur) _cur._hidden_col_keys = new Set();
		this._sync_visible_columns();
		frappe.model.user_settings.save(this.doctype, "excel_hidden_cols", []);
		frappe.show_alert(
			{ message: __("{0} column(s) restored", [count]), indicator: "green" },
			2
		);
	}

	/**
	 * Rebuild this.columns as the visible subset of _master_columns,
	 * then push the new column config to HOT and HyperFormula.
	 */
	_sync_visible_columns() {
		this.columns = this._master_columns.filter(
			(c) => !this._hidden_col_keys.has(c.data)
		);
		this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.updateSettings({ columns: this.columns });
		this.hot.render();
	}

	// ── Formula columns ───────────────────────────────────────────────────────

	/**
	 * Add a new "formula column" — a writable column not tied to any Frappe field.
	 * Users can enter formulas (=SUM, =IF, etc.) or plain values.
	 * These are never saved to the DB.
	 */
	_add_formula_column() {
		const idx = (this._formula_col_count = (this._formula_col_count || 0) + 1);
		const key = `__fml_${idx}__`;

		frappe.prompt(
			[
				{
					fieldtype: "Data",
					fieldname: "label",
					label: __("Column Name"),
					default: __("Formula {0}", [idx]),
					reqd: 1,
				},
			],
			({ label }) => {
				const new_col = {
					data: key,
					title: label,
					type: "text",
					width: 140,
					_is_formula_col: true,
				};

				this.columns.push(new_col);
				this._master_columns.push(new_col); // keep master in sync
				this._invalidate_col_map();

				// Seed empty value into every data row so HOT can read/write the key
				(this.list_view.data || []).forEach((row) => {
					row[key] = "";
				});

				// Rebuild HyperFormula matrix with the new column
				this.matrix = this.data_manager.to_matrix(
					this.list_view.data,
					this.columns
				);
				this.formula_bridge.reload(this.matrix);

				// Re-apply column config to HOT
				this.hot.updateSettings({ columns: this.columns });

				// Re-apply existing formula columns so they don't lose their values
				if (this._formula_col_map?.size) {
					const total = (this.list_view.data?.length || 0) - 1;
					if (total >= 0) this._reapply_formula_cols(0, total);
				} else {
					this.hot.render();
				}

				// Focus the first cell of the new column
				const new_col_idx = this.columns.length - 1;
				this.hot.selectCell(0, new_col_idx);

				frappe.show_alert(
					{
						message: __(
							'Formula column "{0}" added — enter values or formulas (=SUM, =IF…)',
							[label]
						),
						indicator: "blue",
					},
					4
				);
			},
			__("Add Formula Column"),
			__("Add")
		);
	}

	_add_blank_column(after_col) {
		const idx = (this._blank_col_count = (this._blank_col_count || 0) + 1);
		const key = `__blk_${idx}__`;

		frappe.prompt(
			[{ fieldtype: "Data", fieldname: "label", label: __("Column Name"),
			   default: __("Column {0}", [idx]), reqd: 1 }],
			({ label }) => {
				const new_col = { data: key, title: label, type: "text", width: 140, _is_blank_col: true };

				const insert_at = after_col + 1;
				this.columns.splice(insert_at, 0, new_col);
				this._master_columns.splice(insert_at, 0, new_col);
				if (this._original_columns) this._original_columns.splice(insert_at, 0, new_col);
				this._invalidate_col_map();

				(this.list_view.data || []).forEach((row) => { row[key] = ""; });

				this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
				this.formula_bridge.reload(this.matrix);
				this.hot.updateSettings({ columns: this.columns });

				if (this._formula_col_map?.size) {
					const total = (this.list_view.data?.length || 0) - 1;
					if (total >= 0) this._reapply_formula_cols(0, total);
				} else {
					this.hot.render();
				}

				// Track in _blank_col_configs for persistence + lazy-fill
				this._blank_col_configs = this._blank_col_configs || new Map();
				this._blank_col_configs.set(key, { key, label });
				this._save_blank_col_settings();

				this.hot.selectCell(0, insert_at);
				frappe.show_alert({ message: __('Blank column "{0}" added — type an example, then Ctrl+E to Flash Fill', [label]), indicator: "blue" }, 4);
			},
			__("Add Blank Column"),
			__("Add")
		);
	}

	_remove_blank_columns(start_col, end_col) {
		const to_remove = [];
		for (let c = start_col; c <= end_col; c++) {
			if (this.columns[c]?._is_blank_col) to_remove.push(c);
		}
		if (!to_remove.length) return;

		// Collect keys BEFORE splicing — indices become invalid after splice
		const removed_keys = to_remove.map(c => this.columns[c].data);

		// Remove in reverse so earlier indices stay valid
		for (let i = to_remove.length - 1; i >= 0; i--) {
			const c = to_remove[i];
			const key = removed_keys[i];
			this.columns.splice(c, 1);
			this._invalidate_col_map();
			const mi = this._master_columns.findIndex(col => col.data === key);
			if (mi !== -1) this._master_columns.splice(mi, 1);
			if (this._original_columns) {
				const oi = this._original_columns.findIndex(col => col.data === key);
				if (oi !== -1) this._original_columns.splice(oi, 1);
			}
		}

		this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.updateSettings({ columns: this.columns });
		this.hot.render();

		// Delete from configs using keys collected before splice, then persist
		removed_keys.forEach(key => this._blank_col_configs?.delete(key));
		this._save_blank_col_settings();
	}

	/**
	 * Remove formula columns that fall within the given col range.
	 * Frappe field columns are silently skipped — DB is never touched.
	 * @param {number} start_col - inclusive
	 * @param {number} end_col   - inclusive
	 */
	_remove_formula_columns(start_col, end_col) {
		const to_remove = [];
		for (let c = start_col; c <= end_col; c++) {
			if (this.columns[c]?._is_formula_col) to_remove.push(c);
		}

		if (!to_remove.length) {
			frappe.show_alert(
				{ message: __("Only formula columns can be removed"), indicator: "orange" },
				3
			);
			return;
		}

		// Remove in reverse order so earlier indices stay valid
		[...to_remove].reverse().forEach((c) => {
			const key = this.columns[c].data;
			// Remove from _formula_col_map before splicing (index still valid here)
			if (this._formula_col_map) this._formula_col_map.delete(c);
			this.columns.splice(c, 1);
			this._invalidate_col_map();
			// Also remove from master list
			this._master_columns = this._master_columns.filter((col) => col.data !== key);
			if (this._original_columns) this._original_columns = this._original_columns.filter((col) => col.data !== key);
			(this.list_view.data || []).forEach((row) => delete row[key]);
		});

		// Rebuild _formula_col_map with updated indices after splice
		if (this._formula_col_map?.size) {
			const rebuilt = new Map();
			for (const [old_idx, formula] of this._formula_col_map) {
				const col = this.columns[old_idx];
				if (col?._is_formula_col) rebuilt.set(old_idx, formula);
			}
			this._formula_col_map = rebuilt;
		}

		// Persist removal — save empty array if no formula cols remain
		if (this._formula_col_map?.size) {
			this._save_formula_col_settings();
		} else {
			frappe.model.user_settings.save(this.doctype, 'excel_formula_col_templates', []);
		}

		// Sync HyperFormula + HOT
		this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.updateSettings({ columns: this.columns });
		this.hot.render();

		frappe.show_alert(
			{
				message: __("{0} formula column(s) removed", [to_remove.length]),
				indicator: "blue",
			},
			2
		);
	}

	// ── Find & Replace ─────────────────────────────────────────────────────────

	/**
	 * Open (or focus) the floating Find & Replace panel.
	 * @param {"find"|"replace"} focus_target  - which input to focus on open
	 */
	_show_find_replace(focus_target = "find") {
		if (!this.$fnr_panel) this._build_fnr_panel();
		this.$fnr_panel.addClass("ev-fnr-visible");
		const $input = focus_target === "replace"
			? this.$fnr_panel.find(".ev-fnr-replace-input")
			: this.$fnr_panel.find(".ev-fnr-find-input");
		$input.focus().select();
	}

	_build_fnr_panel() {
		this._fnr_results = [];
		this._fnr_idx = -1;

		this.$fnr_panel = $(`
			<div class="ev-fnr-panel">
				<div class="ev-fnr-header">
					<span>${__("Find & Replace")}</span>
					<button class="ev-fnr-close" title="${__("Close")}">&#x2715;</button>
				</div>
				<div class="ev-fnr-row">
					<label>${__("Find")}</label>
					<input type="text" class="ev-fnr-find-input" placeholder="${__("Search…")}">
				</div>
				<div class="ev-fnr-row">
					<label>${__("Replace")}</label>
					<input type="text" class="ev-fnr-replace-input" placeholder="${__("Replace with…")}">
				</div>
				<div class="ev-fnr-opts">
					<label><input type="checkbox" data-opt="match_case"> ${__("Match case")}</label>
					<label><input type="checkbox" data-opt="whole_cell"> ${__("Whole cell")}</label>
				</div>
				<div class="ev-fnr-status"></div>
				<div class="ev-fnr-btns">
					<button class="ev-fnr-btn ev-fnr-prev">${__("◄ Prev")}</button>
					<button class="ev-fnr-btn ev-fnr-next">${__("Next ►")}</button>
					<button class="ev-fnr-btn ev-fnr-replace">${__("Replace")}</button>
					<button class="ev-fnr-btn ev-fnr-primary ev-fnr-replace-all">${__("Replace All")}</button>
				</div>
			</div>
		`).appendTo(document.body);

		// ── Events ──────────────────────────────────────────────────────────────

		this.$fnr_panel.find(".ev-fnr-close").on("click", () => this._close_find_replace());

		this.$fnr_panel.find(".ev-fnr-find-input").on("keydown", (e) => {
			if (e.key === "Escape") { this._close_find_replace(); return; }
			if (e.key === "Enter") {
				e.preventDefault();
				e.shiftKey ? this._fnr_navigate(-1) : this._fnr_navigate(1);
			}
		});

		this.$fnr_panel.find(".ev-fnr-replace-input").on("keydown", (e) => {
			if (e.key === "Escape") { this._close_find_replace(); return; }
			if (e.key === "Enter") { e.preventDefault(); this._fnr_replace_one(); }
		});

		// Live re-query as the user types (debounced)
		const requery = frappe.utils.debounce(() => this._fnr_run_query(true), 200);
		this.$fnr_panel.find(".ev-fnr-find-input").on("input", requery);
		this.$fnr_panel.find("[data-opt]").on("change", requery);

		this.$fnr_panel.find(".ev-fnr-prev").on("click", () => this._fnr_navigate(-1));
		this.$fnr_panel.find(".ev-fnr-next").on("click", () => this._fnr_navigate(1));
		this.$fnr_panel.find(".ev-fnr-replace").on("click", () => this._fnr_replace_one());
		this.$fnr_panel.find(".ev-fnr-replace-all").on("click", () => this._fnr_replace_all());

		// ── Drag-to-reposition via header ────────────────────────────────────────
		let _drag_origin = null;
		this.$fnr_panel.find(".ev-fnr-header").on("mousedown", (e) => {
			if ($(e.target).is(".ev-fnr-close")) return;
			const rect = this.$fnr_panel[0].getBoundingClientRect();
			_drag_origin = { mx: e.clientX, my: e.clientY, px: rect.left, py: rect.top };
			e.preventDefault();
		});
		$(document).on("mousemove.fnr_drag", (e) => {
			if (!_drag_origin) return;
			const max_x = window.innerWidth  - this.$fnr_panel[0].offsetWidth;
			const max_y = window.innerHeight - this.$fnr_panel[0].offsetHeight;
			this.$fnr_panel.css({
				left: Math.max(0, Math.min(max_x, _drag_origin.px + e.clientX - _drag_origin.mx)) + "px",
				top:  Math.max(0, Math.min(max_y, _drag_origin.py + e.clientY - _drag_origin.my)) + "px",
				right: "auto",
			});
		});
		$(document).on("mouseup.fnr_drag", () => { _drag_origin = null; });
	}

	_close_find_replace() {
		this.$fnr_panel?.removeClass("ev-fnr-visible");
		// Clear HOT search highlights
		const plugin = this.hot?.getPlugin("search");
		if (plugin) { plugin.query(""); this.hot.render(); }
	}

	/**
	 * Run HOT search plugin with current query + options.
	 * @param {boolean} reset_idx - reset current-match pointer to start
	 */
	_fnr_run_query(reset_idx = false) {
		const query = this.$fnr_panel.find(".ev-fnr-find-input").val();
		const plugin = this.hot.getPlugin("search");
		if (!query) {
			this._fnr_results = [];
			if (reset_idx) this._fnr_idx = -1;
			plugin.query("");
			this.hot.render();
			this._fnr_update_status();
			return;
		}

		const match_case = this.$fnr_panel.find('[data-opt="match_case"]').is(":checked");
		const whole_cell = this.$fnr_panel.find('[data-opt="whole_cell"]').is(":checked");

		const query_method = (q, val) => {
			const s = val?.toString() ?? "";
			const [a, b] = match_case ? [s, q] : [s.toLowerCase(), q.toLowerCase()];
			return whole_cell ? a === b : a.includes(b);
		};

		this._fnr_results = plugin.query(query, null, query_method);
		if (reset_idx) this._fnr_idx = -1;
		this.hot.render();
		this._fnr_update_status();
	}

	/**
	 * Navigate to the next (+1) or previous (-1) search match.
	 * @param {1|-1} direction
	 */
	_fnr_navigate(direction) {
		this._fnr_run_query(false);
		const n = this._fnr_results.length;
		if (!n) { this._fnr_update_status(__("No matches")); return; }
		this._fnr_idx = ((this._fnr_idx + direction) % n + n) % n;
		const { row, col } = this._fnr_results[this._fnr_idx];
		this.hot.selectCell(row, col);
		this._fnr_update_status();
	}

	/** Replace the currently selected match and advance to the next. */
	_fnr_replace_one() {
		if (!this.list_view.can_write) {
			frappe.show_alert({ message: __("No write permission"), indicator: "red" }, 2);
			return;
		}
		const sel = this.hot.getSelected()?.[0];
		if (!sel) { this._fnr_navigate(1); return; }
		const row = sel[0], col = sel[1];
		// Only replace if this cell is actually a search match
		const is_match = this._fnr_results.some((m) => m.row === row && m.col === col);
		if (!is_match) { this._fnr_navigate(1); return; }
		// Use HOT's getCellMeta — covers both _readonly columns AND permission-based readonly
		if (this.hot.getCellMeta(row, col).readOnly) { this._fnr_navigate(1); return; }
		const replace_val = this.$fnr_panel.find(".ev-fnr-replace-input").val();
		this.hot.setDataAtCell(row, col, replace_val);
		this._fnr_run_query(false);
		this._fnr_navigate(1);
	}

	/** Replace every non-readonly match in one batch operation. */
	_fnr_replace_all() {
		if (!this.list_view.can_write) {
			frappe.show_alert({ message: __("No write permission"), indicator: "red" }, 2);
			return;
		}
		this._fnr_run_query(true);
		if (!this._fnr_results.length) {
			frappe.show_alert({ message: __("Nothing to replace"), indicator: "orange" }, 2);
			return;
		}
		const replace_val = this.$fnr_panel.find(".ev-fnr-replace-input").val();
		const changes = this._fnr_results
			.filter(({ row, col }) => !this.hot.getCellMeta(row, col).readOnly)
			.map(({ row, col }) => [row, col, replace_val]);
		if (changes.length) {
			this.hot.setDataAtCell(changes);
			frappe.show_alert(
				{ message: __("{0} cell(s) replaced", [changes.length]), indicator: "green" },
				3
			);
		}
		this._fnr_run_query(true);
	}

	_fnr_update_status(override_msg = null) {
		const $s = this.$fnr_panel.find(".ev-fnr-status");
		if (override_msg) { $s.text(override_msg); return; }
		const n = this._fnr_results.length;
		const q = this.$fnr_panel.find(".ev-fnr-find-input").val();
		if (!q)  { $s.text(""); return; }
		if (!n)  { $s.text(__("No matches")); return; }
		if (this._fnr_idx < 0) { $s.text(__("{0} match(es) found", [n])); return; }
		$s.text(__("{0} of {1}", [this._fnr_idx + 1, n]));
	}

	// ── Column freeze ─────────────────────────────────────────────────────────

	/**
	 * Set or clear the column freeze boundary.
	 * @param {number} n - columns to freeze (0 = unfreeze)
	 */
	_set_freeze(n) {
		this._frozen_cols = n;
		this.hot.updateSettings({ fixedColumnsLeft: n });
		this.column_manager.save_freeze(n);
		// CSS class drives the freeze-boundary green border (border only when frozen)
		this.$hot_container.toggleClass("ev-cols-frozen", n > 0);

		frappe.show_alert(
			n > 0
				? { message: __("{0} column(s) frozen", [n]), indicator: "green" }
				: { message: __("Columns unfrozen"), indicator: "blue" },
			2
		);
	}

	// ── Row height management ─────────────────────────────────────────────────

	/**
	 * Recalculate and apply row heights for the given row range based on
	 * the maximum font size stored in format_store for that row.
	 * Called by the toolbar after font size / bold / wrap changes.
	 *
	 * Formula: max_font_px * 1.6 + 4  (matches Excel's default line height ratio).
	 * Minimum: 23px (HOT default row height).
	 */
	refresh_row_heights(r1 = 0, r2 = null) {
		const total = this.hot?.countRows() ?? 0;
		if (!total) return;
		const end = r2 ?? total - 1;
		const col_count = this.columns.length;
		const plugin = this.hot.getPlugin("manualRowResize");
		if (!plugin) return;

		for (let r = r1; r <= end; r++) {
			let max_size = 0;
			for (let c = 0; c < col_count; c++) {
				const size = this.format_store?.[`${r}:${c}`]?.size;
				if (size && size > max_size) max_size = size;
			}
			const needed = max_size ? Math.ceil(max_size * 1.6) + 4 : 23;
			plugin.setManualSize(r, Math.max(23, needed));
		}
		this.hot.render();
	}

	// ── IntelliFlow — Join Canvas (V2.4) ─────────────────────────────────────

	/**
	 * Open the IntelliFlow visual join canvas overlay.
	 * Replaces any previously open canvas instance.
	 */
	_open_join_canvas() {
		this.join_canvas?.close();
		this.join_canvas = new frappe.views.excel.JoinCanvas({ board: this });
		// If a join config is already active (loaded workbook or previous Apply),
		// pass it so the canvas opens with existing nodes/connections visible.
		this.join_canvas.open(this._last_join_config || null);
	}

	/**
	 * Inject joined rows (from api.get_joined_data) as read-only virtual columns.
	 * Called by JoinCanvas after "Apply" completes, or by _reapply_join_from_config
	 * after a workbook is loaded.
	 *
	 * @param {Object[]} joined_rows  - flat rows: [{name, "DocType__field": value, ...}]
	 * @param {Object}   join_config  - the serialised join_config from the canvas
	 */
	_apply_join_result(joined_rows, join_config) {
		// Persist for workbook save (WorkbookManager.get_config reads this).
		// Stored WITHOUT base_names (those are dynamic per-session).
		this._last_join_config = join_config;

		// Clear skeleton loading flag — shimmer stops, afterRenderer no longer
		// applies ev-cell-join-loading class.
		this.columns.forEach(c => { if (c._is_join_loading) delete c._is_join_loading; });
		this._master_columns.forEach(c => { if (c._is_join_loading) delete c._is_join_loading; });

		// Group joined rows by base record name to detect 1:N fan-out.
		// e.g. User → Task (1:N): user1 may appear 3 times in joined_rows.
		const grouped = {};
		joined_rows.forEach(jr => {
			(grouped[jr.name] = grouped[jr.name] || []).push(jr);
		});

		const max_fan = Math.max(1, ...Object.values(grouped).map(v => v.length));

		if (max_fan > 1) {
			// 1:N join — tree structure: one header row per base doc, children hidden by default.
			this._tree_groups = new Map();
			this._expanded_keys = this._expanded_keys || new Set();
			const result = [];
			this.list_view.data.forEach(doc => {
				const matches = grouped[doc.name];
				if (!matches?.length) { result.push(doc); return; }
				if (matches.length === 1) {
					result.push(Object.assign({ ...doc }, matches[0]));
					return;
				}
				const group = matches.map(jr => ({ ...doc, ...jr }));
				group[0]._tree_is_header = true;
				group[0]._tree_size = matches.length;
				group[0]._tree_group_key = doc.name;
				for (let i = 1; i < group.length; i++) {
					group[i]._tree_is_child = true;
					group[i]._tree_group_key = doc.name;
				}
				this._tree_groups.set(doc.name, group);
				// Start collapsed — only push header row
				if (this._expanded_keys.has(doc.name)) {
					group.forEach(r => result.push(r));
				} else {
					result.push(group[0]);
				}
			});
			this.list_view.data = result;
		} else {
			// 1:1 join — simple merge by name (existing behaviour)
			const by_name = {};
			joined_rows.forEach(jr => { by_name[jr.name] = jr; });
			this.list_view.data.forEach(doc => Object.assign(doc, by_name[doc.name] || {}));
		}

		// If the user selected specific base-node fields in the canvas, filter columns.
		// Always keep: name col, formula cols, existing join cols, hidden-col metadata.
		if (join_config.base_selected_fields?.length) {
			const keep = new Set(join_config.base_selected_fields);
			this.columns = this.columns.filter(c =>
				c._is_join_col || c._is_formula_col || c._is_name_col ||
				c.data === "name" || keep.has(c.data)
			);
			this._master_columns = [...this.columns];
			this._hidden_col_keys.clear();
		}

		// Add/update a read-only virtual column for each selected field on each edge.
		// If skeleton columns were pre-added by _add_join_skeleton_columns, we update
		// their titles (now that meta is loaded) instead of adding duplicates.
		const nodes_by_id = Object.fromEntries(join_config.nodes.map(n => [n.id, n]));
		join_config.edges.forEach(edge => {
			const tgt_node = nodes_by_id[edge.tgt_node_id];
			if (!tgt_node) return;
			edge.selected_fields.forEach(field => {
				const key = `${tgt_node.doctype}__${field}`;
				// Use Frappe meta label (e.g. "Date of Joining") instead of raw fieldname
				const df = frappe.get_meta(tgt_node.doctype)?.fields?.find(f => f.fieldname === field);
				const field_label = df?.label || field;
				const title = `${tgt_node.doctype}: ${field_label}`;

				const existing = this.columns.find(c => c.data === key);
				if (existing) {
					// Update label — skeleton may have used raw fieldname if meta wasn't ready
					existing.title = title;
					const master_existing = this._master_columns.find(c => c.data === key);
					if (master_existing) master_existing.title = title;
					return;
				}
				// Column wasn't pre-added (e.g. direct canvas Apply) — add it now
				const col = {
					data:          key,
					title,
					type:          "text",
					width:         160,
					readOnly:      true,
					_readonly:     true,
					_is_join_col:  true,
				};
				this.columns.push(col);
				this._master_columns.push(col);
				this._invalidate_col_map();
			});
		});

		// Sync HyperFormula matrix + HOT
		this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.updateSettings({ columns: this.columns });
		this.hot.loadData(this.list_view.data);

		frappe.show_alert({ message: __("Join applied"), indicator: "green" }, 2);
	}

	_on_tree_row_click(e, coords) {
		// coords.col === -1 means row header (row number) was clicked
		if (coords.col !== -1) return;
		const row_data = this.list_view.data?.[coords.row];
		if (row_data?._tree_is_header && row_data._tree_size > 1) {
			this._toggle_tree_group(row_data._tree_group_key);
		}
	}

	_toggle_tree_group(key) {
		if (!this._tree_groups?.has(key)) return;
		const group = this._tree_groups.get(key);
		const n_children = group.length - 1;
		if (this._expanded_keys.has(key)) {
			this._expanded_keys.delete(key);
			const idx = this.list_view.data.findIndex(
				r => r._tree_is_header && r._tree_group_key === key
			);
			if (idx >= 0) this._fix_tree_formulas_on_collapse(idx, n_children);
			this.list_view.data = this.list_view.data.filter(
				r => !(r._tree_is_child && r._tree_group_key === key)
			);
		} else {
			this._expanded_keys.add(key);
			const idx = this.list_view.data.findIndex(
				r => r._tree_is_header && r._tree_group_key === key
			);
			if (idx >= 0) {
				this.list_view.data.splice(idx + 1, 0, ...group.slice(1));
				this._fix_tree_formulas_on_expand(idx, n_children);
			}
		}
		this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.loadData(this.list_view.data);
		this.hot.render();
	}

	// Shift all cell row references in a formula string by `shift` (positive or negative).
	// E.g. _shift_all_row_refs("=F5-G5", 3) → "=F8-G8"
	_shift_all_row_refs(formula, shift) {
		if (!shift || !formula) return formula;
		return formula.replace(/([A-Z]+)(\d+)/g, (_m, col, row_str) => {
			const new_row = Math.max(1, parseInt(row_str, 10) + shift);
			return col + new_row;
		});
	}

	// On expand: give children the header's formula (offset per child), then shift
	// all rows that were pushed down by n_children.
	_fix_tree_formulas_on_expand(header_idx, n_children) {
		const formula_cols = this.columns?.filter(c => c._is_formula_col);
		if (!formula_cols?.length) return;
		const header_row = this.list_view.data[header_idx];
		for (const fc of formula_cols) {
			const prop = fc.data;
			const hf = header_row?.[prop];
			const hf_is_formula = hf && this.formula_bridge?.is_formula(hf);
			// 1. Fill children with header formula shifted by i+1
			if (hf_is_formula) {
				for (let i = 0; i < n_children; i++) {
					const child = this.list_view.data[header_idx + 1 + i];
					if (child) child[prop] = this._shift_all_row_refs(hf, i + 1);
				}
			}
			// 2. Shift rows that moved down past the inserted children
			for (let r = header_idx + 1 + n_children; r < this.list_view.data.length; r++) {
				const row = this.list_view.data[r];
				const f = row?.[prop];
				if (!f || !this.formula_bridge?.is_formula(f)) continue;
				row[prop] = this._shift_all_row_refs(f, n_children);
			}
		}
	}

	// On collapse: shift rows that are about to move up by n_children back by -n_children.
	// Must run BEFORE children are filtered out of list_view.data.
	_fix_tree_formulas_on_collapse(header_idx, n_children) {
		const formula_cols = this.columns?.filter(c => c._is_formula_col);
		if (!formula_cols?.length) return;
		for (const fc of formula_cols) {
			const prop = fc.data;
			for (let r = header_idx + 1 + n_children; r < this.list_view.data.length; r++) {
				const row = this.list_view.data[r];
				const f = row?.[prop];
				if (!f || !this.formula_bridge?.is_formula(f)) continue;
				row[prop] = this._shift_all_row_refs(f, -n_children);
			}
		}
	}

	/**
	 * Re-execute a join from a saved config (workbook restore or pending_join_config).
	 * Called from refresh() when _pending_join_config is set after a workbook load.
	 *
	 * @param {Object} cfg - join_config (without base_names — those are rebuilt here)
	 */
	_reapply_join_from_config(cfg) {
		if (this._destroyed) return;
		const loaded_data = this.list_view.data || [];
		if (!loaded_data.length || !cfg.edges?.length) return;

		// Load meta for all target doctypes first (so labels work in _apply_join_result)
		const tgt_doctypes = (cfg.nodes || [])
			.filter(n => n.doctype !== this.doctype)
			.map(n => n.doctype);

		const _do_join = () => {
			if (this._destroyed) return;
			frappe.call({
				method: "excel_view.api.get_joined_data",
				args: {
					base_doctype: this.doctype,
					join_config:  JSON.stringify({
						...cfg,
						base_names: (this.list_view.data || []).map(d => d.name),
					}),
					limit: (this.list_view.data || []).length + 100,
				},
				freeze: false,
				callback: (r) => {
					if (this._destroyed) return;
					this._apply_join_result(r.message || [], cfg);
				},
			});
		};

		if (!tgt_doctypes.length) {
			_do_join();
			return;
		}
		// Ensure all target DocType metas are loaded before applying (for column labels)
		let pending = tgt_doctypes.length;
		tgt_doctypes.forEach(dt => {
			frappe.model.with_doctype(dt, () => {
				if (--pending === 0) _do_join();
			});
		});
	}

	/**
	 * Re-run all saved Smart Lookup joins after a data refresh.
	 * Only operates on the base sheet (list_view.data).
	 */
	_reapply_smart_lookups() {
		if (!this._applied_lookups?.length) return;
		const sm = this.sheet_manager;

		this._applied_lookups.forEach(cfg => {
			const tgt_sheet = [...(sm?._sheets?.values() || [])].find(
				s => s.label === cfg.tgt_sheet_label || s.id === cfg.tgt_sheet_id
			);

			// 1. Live data in the open sheet → fastest path, always fresh.
			//    Skip if data is marked stale (restored from workbook blank_data).
			const live = (tgt_sheet?.data?.length && !tgt_sheet._data_is_stale) ? tgt_sheet.data : null;
			if (live) { this._slk_join(cfg, live, true); return; }

			// 2. Already fetched this session — use cached rows (no repeat API call)
			//    _fresh_rows is set on cfg after any successful async fetch.
			if (cfg._fresh_rows?.length) { this._slk_join(cfg, cfg._fresh_rows, false); return; }

			// 3. Resolve tgt_source — or infer from the restored sheet (old workbook format)
			let src = cfg.tgt_source;
			if (!src && tgt_sheet) {
				if (tgt_sheet.doctype) {
					src = { doctype: tgt_sheet.doctype };
				} else if (tgt_sheet.report_meta?.name) {
					src = {
						report_name:    tgt_sheet.report_meta.name,
						report_filters: tgt_sheet.report_meta.current_filters || {},
						col_keys:       (tgt_sheet.columns_config || []).map(c => c.data),
					};
				}
				if (src) cfg.tgt_source = src;
			}

			// 4. Async fetch — DocType
			if (src?.doctype) {
				const fields = [...new Set([cfg.tgt_field, ...cfg.return_fields.map(f => f.fieldname)])];
				frappe.db.get_list(src.doctype, { fields, limit: 500 })
					.then(rows => {
						if (!rows?.length) { this._slk_join_cache(cfg); return; }
						cfg._fresh_rows = rows;                      // cache on cfg — survives missing tgt_sheet
						if (tgt_sheet) { tgt_sheet.data = rows; tgt_sheet._data_is_stale = false; }
						this._slk_join(cfg, rows, true);             // always join (empty list_view = 0 iters, no harm)
					});
				return;
			}

			// 5. Async fetch — Script / Query Report
			if (src?.report_name) {
				frappe.call({
					method: "frappe.desk.query_report.run",
					args: { report_name: src.report_name, filters: src.report_filters || {}, ignore_prepared_report: 1 },
					callback: r => {
						if (!r.message?.result?.length) { this._slk_join_cache(cfg); return; }
						const api_cols = r.message.columns || [];
						const col_keys = src.col_keys?.length
							? src.col_keys
							: api_cols.map((c, i) => (typeof c === "object" ? c.fieldname || String(i) : String(i)));
						const rows = r.message.result.map(row => {
							if (Array.isArray(row)) {
								return Object.fromEntries(col_keys.map((k, i) => [k, String(row[i] ?? "")]));
							}
							const out = {};
							api_cols.forEach((c, i) => {
								const api_key = typeof c === "object" ? (c.fieldname || String(i)) : String(c);
								out[col_keys[i] ?? api_key] = row[api_key] ?? "";
							});
							return out;
						});
						cfg._fresh_rows = rows;                      // cache on cfg regardless of tgt_sheet state
						if (tgt_sheet) { tgt_sheet.data = rows; tgt_sheet._data_is_stale = false; }
						this._slk_join(cfg, rows, true);             // always join
					},
				});
				return;
			}

			// 6. Last resort — blank/formula sheet with no fetchable source
			this._slk_join_cache(cfg);
		});
	}

	/** Perform the join against live tgt_data rows. */
	_slk_join(cfg, tgt_data, update_cache = false) {
		const tgt_map = new Map();
		tgt_data.forEach(row => {
			const key = String(row[cfg.tgt_field] ?? "").trim().toLowerCase();
			if (key) tgt_map.set(key, row);
		});

		if (update_cache) {
			const nc = {};
			tgt_data.forEach(row => {
				const key = String(row[cfg.tgt_field] ?? "").trim().toLowerCase();
				if (!key) return;
				const e = {};
				cfg.return_fields.forEach(f => { e[f.fieldname] = row[f.fieldname] ?? ""; });
				nc[key] = e;
			});
			cfg._value_cache = nc;
			// Strip runtime-only caches before persisting — rebuilt on restore.
			const _slk_save = this._applied_lookups.map(({ _fresh_rows: _f, _value_cache: _v, ...rest }) => rest);
			// Synchronously patch cache to avoid race condition with concurrent saves (excel_sheets, cf_rules, etc.)
			if (!frappe.model.user_settings[this.doctype]) frappe.model.user_settings[this.doctype] = {};
			frappe.model.user_settings[this.doctype].excel_smart_lookups = _slk_save;
			frappe.model.user_settings.update(this.doctype, frappe.model.user_settings[this.doctype]);
		}

		// Enrich the correct source data array: src_sheet.data for non-base lookups, list_view.data for base.
		const _slk_src_data = this._slk_src_data(cfg);

		const _apply_join = () => {
			_slk_src_data.forEach(row => {
				const key = String(row[cfg.src_field] ?? "").trim().toLowerCase();
				const tr = tgt_map.get(key);
				cfg.return_fields.forEach(f => {
					row[`_slk_${f.fieldname}`] = tr ? (tr[f.fieldname] ?? "") : "";
				});
			});
			this._slk_ensure_cols(cfg);
			this.hot?.render();
		};

		// Join key missing in secondary DocType sheet data — fetch it first
		const src_sheet = cfg.src_sheet_id ? this.sheet_manager?._sheets?.get(cfg.src_sheet_id) : null;
		const join_key_missing = src_sheet?.doctype
			&& _slk_src_data.length > 0
			&& !(cfg.src_field in _slk_src_data[0]);
		if (join_key_missing) {
			frappe.db.get_list(src_sheet.doctype, { fields: ["name", cfg.src_field], limit: 0 })
				.then(rows => {
					const key_map = new Map(rows.map(r => [r.name, r[cfg.src_field] ?? ""]));
					_slk_src_data.forEach(row => { row[cfg.src_field] = key_map.get(row.name) ?? ""; });
					// Also persist to _fetch_fields so future appends include it
					if (src_sheet._fetch_fields && !src_sheet._fetch_fields.includes(cfg.src_field)) {
						src_sheet._fetch_fields.push(cfg.src_field);
					}
					_apply_join();
				});
		} else {
			_apply_join();
		}
	}

	/** Perform the join using the saved _value_cache (offline / blank-sheet fallback). */
	_slk_join_cache(cfg) {
		if (!cfg._value_cache || !Object.keys(cfg._value_cache).length) return;
		this._slk_src_data(cfg).forEach(row => {
			const key = String(row[cfg.src_field] ?? "").trim().toLowerCase();
			const tr = cfg._value_cache[key];
			cfg.return_fields.forEach(f => {
				row[`_slk_${f.fieldname}`] = tr ? (tr[f.fieldname] ?? "") : "";
			});
		});
		this._slk_ensure_cols(cfg);
		this.hot?.render();
	}

	/**
	 * Return the data array to enrich for a given lookup config.
	 * Non-base lookups (cfg.src_sheet_id set) iterate the report/blank sheet's data.
	 * Base lookups fall back to list_view.data.
	 */
	_slk_src_data(cfg) {
		// No src sheet identified → base-sheet lookup, always use list_view.data
		if (!cfg.src_sheet_id && !cfg.src_sheet_label && !cfg.src_sheet_doctype) {
			return this.list_view?.data || [];
		}
		const sm = this.sheet_manager;
		// Fast path: ID still valid (same session)
		let src = sm?._sheets?.get(cfg.src_sheet_id);
		// Fallback: ID is stale (page reload) — find by persistent label/doctype
		if (!src && (cfg.src_sheet_label || cfg.src_sheet_doctype)) {
			const base_id = sm?._get_sheet0_id?.();
			src = [...(sm?._sheets?.values() || [])].find(s =>
				s.id !== base_id && (
					(cfg.src_sheet_label   && s.label   === cfg.src_sheet_label) ||
					(cfg.src_sheet_doctype && s.doctype === cfg.src_sheet_doctype)
				)
			);
			if (src) cfg.src_sheet_id = src.id; // re-sync so next call hits Map directly
		}
		if (src?.data?.length) return src.data;
		return []; // src sheet identified but not loaded yet — join will be deferred
	}

	/** Ensure _slk_* columns exist on the correct sheet (src_sheet.columns_config or _master_columns). */
	_slk_ensure_cols(cfg) {
		const sm = this.sheet_manager;
		// Non-base lookup → add columns to the src sheet's column list (not _master_columns)
		if (cfg.src_sheet_id || cfg.src_sheet_label) {
			let src = sm?._sheets?.get(cfg.src_sheet_id);
			if (!src && cfg.src_sheet_label) {
				const base_id = sm?._get_sheet0_id?.();
				src = [...(sm?._sheets?.values() || [])].find(s =>
					s.id !== base_id && s.label === cfg.src_sheet_label
				);
				if (src) cfg.src_sheet_id = src.id;
			}
			if (!src) return;
			// Secondary DocType sheets use _columns; report/blank sheets use columns_config
			const col_list = src._columns || src.columns_config;
			if (!col_list) return;
			const existing = new Set(col_list.map(c => c.data));
			let changed = false;
			cfg.return_fields.forEach(f => {
				const key = `_slk_${f.fieldname}`;
				if (!existing.has(key)) {
					const new_col = {
						data: key,
						title: `${f.label} [${cfg.tgt_sheet_label}]`,
						readOnly: true,
						_is_lookup_col: true,
					};
					col_list.push(new_col);
					// Mirror onto columns_config for persistence
					if (src._columns && src._columns !== src.columns_config) {
						src.columns_config = [...(src.columns_config || []), new_col];
					}
					existing.add(key);
					changed = true;
				}
			});
			if (changed && sm?.get_current()?.id === src.id) {
				if (src._columns) {
					this.columns = src._columns;
					this.hot?.updateSettings({ columns: this.columns });
					this.hot?.render();
				} else {
					sm._apply_sheet(src);
				}
			}
			return;
		}
		// Base lookup → add to _master_columns
		const existing = new Set(this._master_columns.map(c => c.data));
		let changed = false;
		cfg.return_fields.forEach(f => {
			const key = `_slk_${f.fieldname}`;
			if (!existing.has(key)) {
				this._master_columns.push({ data: key, title: `${f.label} [${cfg.tgt_sheet_label}]`, readOnly: true, _is_lookup_col: true });
				existing.add(key);
				changed = true;
			}
		});
		if (changed) {
			this.columns = this._master_columns.filter(c => !this._hidden_col_keys.has(c.data)); this._col_index_map = null;
			this.hot?.updateSettings({ columns: this.columns });
		}
	}

	// ── Field picker ──────────────────────────────────────────────────────────

	/**
	 * Open the "Choose Columns" dialog.
	 */
	open_field_picker() {
		new frappe.views.excel.FieldPicker({ board: this }).open();
	}

	/**
	 * Apply a new column selection from the field picker.
	 *
	 * @param {string[]} fieldnames - ordered array, always starts with "name"
	 * @param {Object}  [opts]
	 * @param {boolean} [opts.silent=false] - if true, skip the list_view.refresh()
	 *   call.  Used by WorkbookManager.apply_config() which triggers its OWN single
	 *   refresh at the end — suppressing the implicit refresh here avoids the race
	 *   condition where two concurrent board.refresh() calls interleave and wipe the
	 *   joined-row values that were just merged into list_view.data.
	 */
	apply_field_selection(fieldnames, { silent = false } = {}) {
		// Virtual column keys that must never reach the Frappe server
		const VIRTUAL_KEYS = new Set(["_meta", "_is_meta_col", "_social", "_is_social_col", "_is_join_col", "_is_lookup_col", "_is_formula_col"]);
		// Separate CT fields (table__child) from regular Frappe fields; exclude virtual keys
		// Also exclude _slk_* lookup cols and any other underscore-prefixed virtual keys
		const regular = fieldnames.filter(f =>
			f !== "name" &&
			!f.includes("__") &&
			!VIRTUAL_KEYS.has(f) &&
			!f.startsWith("_slk_") &&
			!f.startsWith("_join_")
		);
		this._ct_fieldnames = fieldnames.filter(f => f.includes("__"));

		// ── Preserve virtual column dependencies ──────────────────────────────
		// _inject_meta_column / _inject_social_column need their real field siblings
		// in _master_columns to fire. If the current board has active virtual cols,
		// auto-merge their backing fields into the effective list so rebuilding
		// the columns doesn't silently drop them (e.g. when user adds a new field
		// via the picker without noticing the individual meta/social fields).
		const _META_FIELDS   = ["owner", "creation", "modified_by", "modified"];
		const _SOCIAL_FIELDS = ["_user_tags", "_comments", "_assign", "_liked_by", "docstatus", "idx"];
		const _had_meta   = this._master_columns?.some(c => c.data === "_meta");
		const _had_social = this._master_columns?.some(c => c.data === "_social");

		const effective_regular = [...regular];
		if (_had_meta) {
			_META_FIELDS.forEach(f => { if (!effective_regular.includes(f)) effective_regular.push(f); });
		}

		// column_manager gets ALL fields (regular + CT) for column config
		this.column_manager.fields = [
			...effective_regular.map(f => [f, this.doctype]),
			...this._ct_fieldnames.map(f => [f, this.doctype]),
		];
		if (_had_social) {
			const _cm_keys = new Set(this.column_manager.fields.map(([fn]) => fn));
			_SOCIAL_FIELDS.forEach(f => {
				if (!_cm_keys.has(f)) this.column_manager.fields.push([f, this.doctype]);
			});
		}

		// Recompute columns + master list, then re-apply any persisted hidden cols
		this.columns = this.column_manager.get_columns();
		this._master_columns = [...this.columns];
		// Re-group meta fields into virtual _meta column if present
		this._inject_meta_column();
		this._inject_social_column();
		// Re-inject base-sheet Smart Lookup columns into _master_columns after column rebuild.
		// Non-base lookups (src_sheet_id set) live in their own sheet's columns_config — skip here.
		if (this._applied_lookups?.length) {
			const existing_keys = new Set(this._master_columns.map(c => c.data));
			this._applied_lookups.forEach(cfg => {
				if (cfg.src_sheet_id) return; // belongs to a report/blank sheet, not _master_columns
				cfg.return_fields.forEach(f => {
					const key = `_slk_${f.fieldname}`;
					if (!existing_keys.has(key)) {
						this._master_columns.push({
							data: key,
							title: `${f.label} [${cfg.tgt_sheet_label}]`,
							readOnly: true,
							_is_lookup_col: true,
						});
						existing_keys.add(key);
					}
				});
			});
		}
		// Remove stale hidden keys (columns no longer in the new set)
		const _new_keys = new Set(this.columns.map(c => c.data));
		for (const k of [...this._hidden_col_keys]) {
			if (!_new_keys.has(k)) this._hidden_col_keys.delete(k);
		}
		// V3.3 — Re-apply persisted column order after field picker rebuild
		this._apply_saved_col_order();
		// Reset _original_columns to the new physical order HOT will use after
		// updateSettings(columns) in _sync_visible_columns
		this._original_columns = null; // will be set after HOT re-inits below
		// Apply hidden state — _sync_visible_columns updates this.columns and HOT
		this._sync_visible_columns();
		// Snapshot new physical order for future drag reads
		this._original_columns = [...this.columns];

		// CRITICAL: list_view.fields only gets REGULAR fields — the Frappe server
		// doesn't know about CT composite fieldnames (table__child).
		this.list_view.fields = [
			["name", this.doctype],
			...effective_regular.map(f => [f, this.doctype]),
		];
		if (_had_social) {
			const _lv_keys = new Set(this.list_view.fields.map(([fn]) => fn));
			_SOCIAL_FIELDS.forEach(f => {
				if (!_lv_keys.has(f)) this.list_view.fields.push([f, this.doctype]);
			});
		}

		if (silent) return;

		// Force a fresh data fetch — bypass no_change throttle.
		// render() → board.refresh(data) will reload the matrix + HF + HOT data.
		this.list_view.last_args = null;
		this.list_view.start = 0;
		this.list_view.refresh();
	}

	// ── Child Table Enrichment ────────────────────────────────────────────────

	/**
	 * Fetch child table field values for visible parent rows and merge them into
	 * list_view.data, then re-render HOT so CT columns show populated data.
	 * @param {string[]} parent_names
	 */
	async _enrich_ct_columns(parent_names) {
		if (!this._ct_fieldnames?.length || !parent_names?.length) return;

		// Build requests: {table_fn: [child_fn, ...]}
		const requests = {};
		this._ct_fieldnames.forEach(fn => {
			const sep = fn.indexOf("__");
			const table_fn = fn.slice(0, sep);
			const child_fn = fn.slice(sep + 2);
			(requests[table_fn] = requests[table_fn] || []).push(child_fn);
		});

		try {
			const res = await frappe.call({
				method: "excel_view.api.get_child_data",
				args: {
					doctype: this.doctype,
					requests: JSON.stringify(requests),
					parent_names: JSON.stringify(parent_names),
				},
			});
			const data_map = res?.message || {};

			// Detect whether any parent has multiple child rows (max_children > 1).
			// For each CT key, split the comma-joined string to get per-child arrays.
			let needs_tree = false;
			const parsed_map = {}; // name → { key → string[] }
			for (const [name, ct] of Object.entries(data_map)) {
				let max_c = 1;
				const parsed = {};
				for (const [key, val] of Object.entries(ct)) {
					const parts = val ? String(val).split(", ") : [];
					parsed[key] = parts;
					if (parts.length > max_c) max_c = parts.length;
				}
				parsed_map[name] = { parsed, max_c };
				if (max_c > 1) needs_tree = true;
			}

			if (!needs_tree) {
				// All 1:1 — original behaviour: just assign comma-joined values
				this.list_view.data?.forEach(row => {
					const ct = data_map[row.name];
					if (ct) Object.assign(row, ct);
				});
				this.hot?.render();
				return;
			}

			// 1:N child data — build collapsible tree rows
			this._tree_groups   = this._tree_groups   || new Map();
			this._expanded_keys = this._expanded_keys || new Set();
			this._tree_groups.clear();

			const result = [];
			(this.list_view.data || []).forEach(doc => {
				const ct_raw = data_map[doc.name];
				if (!ct_raw) { result.push(doc); return; }

				const { parsed, max_c } = parsed_map[doc.name];
				if (max_c <= 1) {
					Object.assign(doc, ct_raw);
					result.push(doc);
					return;
				}

				// Header row: shows comma-joined values (summary), tree flag set
				const header = { ...doc, ...ct_raw,
					_tree_is_header: true, _tree_size: max_c, _tree_group_key: doc.name };

				// Child rows: each has individual CT field values
				const children = [];
				for (let i = 0; i < max_c; i++) {
					const child = { ...doc };
					for (const [key, parts] of Object.entries(parsed)) {
						child[key] = parts[i] ?? "";
					}
					child._tree_is_child  = true;
					child._tree_group_key = doc.name;
					children.push(child);
				}

				const group = [header, ...children];
				this._tree_groups.set(doc.name, group);

				if (this._expanded_keys.has(doc.name)) {
					group.forEach(r => result.push(r));
				} else {
					result.push(header);
				}
			});

			this.list_view.data = result;
			this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
			this.hot?.loadData(this.list_view.data);
		} catch (e) {
			console.error("[ExcelView] CT enrichment failed:", e);
		}
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Register the realtime handler for live grid updates.
	 * Called once from the constructor AND by ExcelView.setup_realtime_updates()
	 * after every refresh() — Frappe calls frappe.realtime.off("list_update")
	 * in setup_realtime_updates(), so we must re-register each time.
	 *
	 * Case A: base doctype (e.g. Customer) saved → refresh grid rows.
	 *   NOTE: Frappe's process_document_refreshes() has a route guard that
	 *   returns early for ExcelView (route is /view/excel, not /List/...) and
	 *   then calls disable_realtime_updates().  ExcelView overrides that to
	 *   prevent doctype_unsubscribe, but render_list() is never reached.
	 *   We therefore handle Case A here with list_view.refresh().
	 *
	 * Case B: formula-referenced doctype (e.g. Sales Order) saved → invalidate
	 *   the client-side formula cache + re-evaluate all formula columns.
	 */
	_register_formula_realtime() {
		if (this._destroyed) return;
		// De-dupe: remove any previously registered instance
		if (this._formula_realtime_handler) {
			frappe.realtime.off("list_update", this._formula_realtime_handler);
		}
		this._formula_realtime_handler = (data) => {
			if (this._destroyed) return;
			const updated_doctype = typeof data === "string" ? data : data?.doctype;
			if (!updated_doctype) return;

			// ── Case A: base doctype row changed → refresh grid ───────────────
			if (updated_doctype === this.doctype) {
				clearTimeout(this._base_realtime_timer);
				this._base_realtime_timer = setTimeout(() => {
					if (!this._destroyed) {
						// Reset no_change throttle — we know data changed so force a fresh fetch
						this.list_view.last_args = null;
						this.list_view.refresh();
					}
				}, 800);
			}

			// ── Case B: formula-referenced doctype changed → invalidate cache ─
			if (this._formula_col_map?.size) {
				const fm = frappe.views.excel.formula_manager;
				if (fm) {
					const prefixes = [
						`FRAPPE_SUM:${updated_doctype}:`,
						`FRAPPE_COUNT:${updated_doctype}:`,
						`FRAPPE_AVG:${updated_doctype}:`,
						`FRAPPE_MAX:${updated_doctype}:`,
						`FRAPPE_MIN:${updated_doctype}:`,
						`FRAPPE_GET:${updated_doctype}:`,
						`DYN_SUM:${updated_doctype}:`,
						`DYN_COUNT:${updated_doctype}:`,
						`DYN_AVG:${updated_doctype}:`,
					];
					let had_cached = false;
					for (const pfx of prefixes) {
						for (const key of fm._cache.keys()) {
							if (key.startsWith(pfx)) { fm._cache.delete(key); had_cached = true; }
						}
					}
					if (had_cached) {
						clearTimeout(this._formula_realtime_timer);
						this._formula_realtime_timer = setTimeout(() => {
							if (this._destroyed) return;
							const total = (this.list_view.data?.length || 0) - 1;
							if (total >= 0) this._reapply_formula_cols(0, total);
						}, 600);
					}
				}
			}
		};
		frappe.realtime.on("list_update", this._formula_realtime_handler);
	}

	/**
	 * Reload grid with fresh data from the server.
	 */
	refresh(new_data, { append = false } = {}) {
		// Clear any pending inline insert — server data replaces the grid
		if (this._new_row_idx >= 0) {
			this._new_row_idx = -1;
			this.$inline_insert_bar?.remove();
			this.$inline_insert_bar = null;
		}

		// Blank / Dashboard guard: never push list_view data into HOT when the user
		// is on a blank sheet or a dashboard sheet.  For blank sheets, background
		// refresh keeps charts live.  For dashboard sheets, the HOT container is
		// hidden — let dashboard_manager handle its own data refresh cycle.
		const _guard_sheet = this.sheet_manager?.get_current();
		if (_guard_sheet?.is_blank) {
			setTimeout(() => this.chart_manager?.rerender_all_visible(), 0);
			return;
		}
		if (_guard_sheet?.is_dashboard) return;
		// Secondary sheet active — base list_view data must not overwrite it
		if (_guard_sheet?.doctype && _guard_sheet.doctype !== this.doctype) return;

		// Fresh refresh (filter change, sort etc.) → reset infinite-scroll state
		if (!append) {
			this._no_more_data = false;
			this._loading_more = false;
		}

		// On first refresh, restore formula columns from user_settings if no workbook loaded
		if (!append && this._pending_formula_col_templates?.length && !this._formula_col_map?.size) {
			this._restore_formula_col_templates(this._pending_formula_col_templates);
			this._pending_formula_col_templates = null;
		}

		// Restore blank columns from user_settings on first load
		if (!append && this._pending_blank_col_configs?.length && !this._blank_col_configs?.size) {
			this._restore_blank_cols(this._pending_blank_col_configs);
			this._pending_blank_col_configs = null;
		}

		// On load-more (append), save scroll row so we can restore it after
		// loadData() resets the viewport to the top.
		const saved_row   = append ? (this.hot?.getFirstFullyVisibleRow?.() ?? 0) : 0;
		const prev_data_len = append ? (this._prev_append_len || 0) : 0;

		this.data = new_data;
		this.matrix = this.data_manager.to_matrix(new_data, this.columns);
		this.formula_bridge.reload(this.matrix);
		// V2.3 — clear async formula cache on every data reload so cells
		// don't show stale values after filters change or "Load More" fires.
		frappe.views.excel.formula_manager?.clear();
		// Perf: rebuild lookup maps used by afterRenderer hot path
		this._meta_html_cache?.clear();
		this._social_html_cache?.clear();
		this._tree_parent_map = new Map();
		new_data.forEach((row, i) => { if (row._tree_is_header) this._tree_parent_map.set(row._tree_group_key, i); });
		this.hot.loadData(new_data);
		// Perf: pre-compute CF cell cache after data load (O(rows×rules) once vs per-cell per-render)
		requestAnimationFrame(() => this._rebuild_cf_cache());

		// Restore scroll position after load-more so the viewport doesn't jump to top
		if (append && saved_row > 0) {
			requestAnimationFrame(() => this.hot?.scrollViewportTo?.(saved_row, undefined));
		}

		// Re-apply formula columns: full reload on fresh refresh, new rows only on append
		if (this._formula_col_map?.size) {
			const from = append ? prev_data_len : 0;
			const to   = new_data.length - 1;
			if (to >= from) requestAnimationFrame(() => this._reapply_formula_cols(from, to));
		}

		// Re-apply blank col flash-fill transforms for new/all rows
		if (this._blank_col_configs?.size) {
			const from = append ? prev_data_len : 0;
			const to   = new_data.length - 1;
			if (to >= from) requestAnimationFrame(() => this._reapply_blank_col_fills(from, to));
		}

		// CT columns — re-enrich on every data refresh (idle refresh wipes values)
		if (this._ct_fieldnames?.length && new_data?.length) {
			this._enrich_ct_columns(new_data.map(d => d.name));
		}

		// V2.4 — Re-apply join data whenever the grid refreshes.
		//
		// _pending_join_config: one-shot flag set by WorkbookManager.apply_config().
		//   Shows skeleton columns immediately, then fetches real join data.
		//
		// _last_join_config: persists for the lifetime of the board after the first
		//   Apply (or workbook load).  Frappe's idle auto-refresh calls
		//   frappe.desk.reportview.get which returns only base-doctype rows — join
		//   column values are wiped from every row.  We re-fetch silently here so
		//   the grid never shows empty join cells after an idle refresh.
		if (this._pending_join_config) {
			const cfg = this._pending_join_config;
			this._pending_join_config = null;
			// Pre-add skeleton columns immediately — headers appear right away with
			// a shimmer animation while the async API call runs in the background.
			this._add_join_skeleton_columns(cfg);
			// Defer the full re-apply (meta load + API call) one tick
			setTimeout(() => this._reapply_join_from_config(cfg), 0);
		} else if (this._last_join_config) {
			// Subsequent refresh (idle auto-refresh, filter change, Load More…).
			// Columns already exist — just re-fill row values from the API.
			const cfg = this._last_join_config;
			setTimeout(() => this._reapply_join_from_config(cfg), 0);
		}

		// Smart Lookup — re-join after every data refresh so lookup cols stay populated
		if (this._applied_lookups?.length) {
			setTimeout(() => this._reapply_smart_lookups(), 0);
		}

		// V2.6 — Re-render visible chart overlays with latest data so charts
		// stay in sync after filters change, new records arrive, etc.
		setTimeout(() => this.chart_manager?.rerender_all_visible(), 0);

		// V2.5 — Keep the active non-blank, non-dashboard sheet's data pointer current
		// so switch_to() uses _apply_sheet() (direct swap) rather than _lazy_fetch().
		const _sm_cur = this.sheet_manager?.get_current();
		if (_sm_cur && !_sm_cur.is_blank && !_sm_cur.is_dashboard) _sm_cur.data = new_data;
	}

	/**
	 * Pre-add skeleton join columns synchronously from a saved join_config.
	 * Columns appear instantly with a shimmer; real data fills them once
	 * _reapply_join_from_config → _apply_join_result completes.
	 *
	 * @param {Object} cfg - join_config (nodes + edges with selected_fields)
	 */
	_add_join_skeleton_columns(cfg) {
		if (!cfg?.edges?.length) return;
		const nodes_by_id = Object.fromEntries((cfg.nodes || []).map(n => [n.id, n]));
		let added = 0;

		cfg.edges.filter(e => e.selected_fields?.length).forEach(edge => {
			const tgt_node = nodes_by_id[edge.tgt_node_id];
			if (!tgt_node) return;
			edge.selected_fields.forEach(field => {
				const key = `${tgt_node.doctype}__${field}`;
				if (this.columns.find(c => c.data === key)) return; // already present
				// Use meta label if the DocType is already in the cache, else raw name
				const df = frappe.get_meta(tgt_node.doctype)?.fields?.find(f => f.fieldname === field);
				const col = {
					data:             key,
					title:            `${tgt_node.doctype}: ${df?.label || field}`,
					type:             "text",
					width:            160,
					readOnly:         true,
					_readonly:        true,
					_is_join_col:     true,
					_is_join_loading: true,   // cleared by _apply_join_result
				};
				this.columns.push(col);
				this._master_columns.push(col);
				this._invalidate_col_map();
				// Seed empty value so HOT rows have the key defined
				(this.list_view.data || []).forEach(row => { row[key] = ""; });
				added++;
			});
		});

		if (added) {
			this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
			this.formula_bridge.reload(this.matrix);
			this.hot.updateSettings({ columns: this.columns });
			this.hot.loadData(this.list_view.data);
		}
	}

	// ── Inline Row Insert ─────────────────────────────────────────────────────

	/**
	 * Begin an inline insert session — prepend a blank (or pre-filled) row to
	 * the grid and show the floating Save / Cancel bar.
	 * Called by the toolbar Insert and Duplicate buttons.
	 *
	 * @param {Object}  [prefill={}]        - field values to seed into the new row
	 * @param {boolean} [is_duplicate=false] - true → show "Duplicate" label
	 */
	_start_inline_insert(prefill = {}, is_duplicate = false) {
		if (!this.list_view.can_write) {
			frappe.show_alert({ message: __("No write permission"), indicator: "red" }, 2);
			return;
		}

		// Cancel any existing pending row first (silent — no HOT reload)
		if (this._new_row_idx >= 0) this._cancel_inline_insert(true);

		// Reset fetch chain map so it's rebuilt for the fresh insert
		this._fetch_from_map = null;

		const meta = frappe.get_meta(this.doctype);

		// ── Full default resolution (fresh insert only, not duplicate) ─────────
		//
		// Mirrors what frappe.new_doc does when opening a blank form:
		//
		//   Layer 1 — frappe.model.set_default_values():
		//     Reads df.default from the local meta, which already includes any
		//     Property Setter overrides (loaded by frappe.model.with_doctype at
		//     board init). Covers naming_series, currency, transaction_date, etc.
		//
		//   Layer 2 — frappe.defaults.get_defaults():
		//     Sweeps ALL system/user defaults (company, cost_center, department,
		//     currency…) and applies them to any matching field that exists in
		//     this doctype's meta. Dynamic — no hardcoded field names.
		//
		//   Layer 3 — prefill (caller-supplied pattern hints + duplicate values):
		//     Highest priority, overrides everything above.
		//
		let base_defaults = {};
		if (!is_duplicate) {
			// Layer 1: model / meta / PS defaults
			try {
				const tmp = { doctype: this.doctype };
				frappe.model.set_default_values(tmp);
				Object.entries(tmp).forEach(([k, v]) => {
					if (k !== "doctype" && v != null && v !== "") base_defaults[k] = v;
				});
			} catch (_) {}

			// Layer 2: system / user defaults → matched against this doctype's fields
			try {
				const sys     = frappe.defaults.get_defaults() || {};
				const meta_fns = new Set((meta?.fields || []).map(f => f.fieldname));
				Object.entries(sys).forEach(([k, v]) => {
					if (meta_fns.has(k) && !base_defaults[k] && v != null && v !== "") {
						base_defaults[k] = v;
					}
				});
			} catch (_) {}
		}

		// Layer 3: prefill (pattern hints / duplicate) wins over base defaults
		const full_prefill = { ...base_defaults, ...prefill };

		// Warn about required Table fields with no CT columns visible
		if (!is_duplicate) {
			const req_tables = (meta?.fields || []).filter(f => f.fieldtype === "Table" && f.reqd);
			const missing = req_tables.filter(tf =>
				!this.columns.some(c => c._is_ct_col && c._ct_table === tf.fieldname)
			);
			if (missing.length) {
				frappe.show_alert({
					message: __("Required table(s) '{0}' not visible. Add CT columns or use Open Form.", [missing.map(f => f.label || f.fieldname).join(", ")]),
					indicator: "orange",
				}, 6);
			}
		}

		// Build new row — seed empty strings for every column, then apply full prefill
		const new_row = { _is_new: true };
		this.columns.forEach(col => { new_row[col.data] = ""; });
		Object.assign(new_row, full_prefill);

		// Prepend to list_view.data and reload HOT
		this.list_view.data.unshift(new_row);
		this.data = this.list_view.data;
		this._new_row_idx = 0;

		this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.loadData(this.list_view.data);

		// Show floating bar
		this._show_inline_insert_bar(is_duplicate);

		// Select first writable column in the new row (skip name col at index 0)
		const first_col = this.columns.findIndex((c, i) => i > 0 && !c._readonly && !c._is_join_col && !c._is_formula_col);
		if (first_col >= 0) {
			setTimeout(() => {
				this.hot.scrollViewportTo(0, first_col);
				this.hot.selectCell(0, first_col);
			}, 50);
		}
	}

	/** Build and attach the floating Save / Cancel bar. */
	_show_inline_insert_bar(is_duplicate = false) {
		this.$inline_insert_bar?.remove();
		this.$inline_insert_bar = $(`
			<div class="ev-inline-insert-bar">
				<span class="ev-iib-icon">${is_duplicate ? "📋" : "✨"}</span>
				<span class="ev-iib-info">${is_duplicate
					? __("Duplicate — review values and save")
					: __("New record — fill required fields and save")}</span>
				<button class="ev-iib-open-form btn btn-xs">${__("Open Form")}</button>
				<button class="ev-iib-save btn btn-xs btn-primary">${__("Save Row")}</button>
				<button class="ev-iib-cancel btn btn-xs">${__("✕ Cancel")}</button>
			</div>
		`).appendTo(document.body);

		this.$inline_insert_bar.on("click", ".ev-iib-save",      () => this._finish_inline_insert());
		this.$inline_insert_bar.on("click", ".ev-iib-cancel",    () => this._cancel_inline_insert());
		this.$inline_insert_bar.on("click", ".ev-iib-open-form", () => {
			// Collect values typed so far, pass to new-doc form via route_options
			const row = this.list_view.data[this._new_row_idx] || {};
			const opts = {};
			this.columns.forEach(col => {
				if (!col._is_name_col && !col._is_ct_col && !col._is_join_col && !col._is_formula_col) {
					const v = row[col.data];
					if (v != null && v !== "") opts[col.data] = v;
				}
			});
			this._cancel_inline_insert(true);
			frappe.route_options = opts;
			frappe.new_doc(this.doctype);
		});
	}

	/**
	 * Validate the pending new row and save it to Frappe DB via frappe.client.insert.
	 */
	async _finish_inline_insert() {
		if (this._new_row_idx < 0) return;
		const row_data = this.list_view.data[this._new_row_idx];
		if (!row_data?._is_new) return;

		const dt   = this.doctype;
		const meta = frappe.get_meta(dt);

		// ── Validate visible required fields only ───────────────────────────
		// Non-visible required fields (Company, Currency, Price List…) are NOT blocked
		// here — Frappe fills many of them from user/system defaults at the server level.
		// We only highlight required fields that ARE visible and empty so the user can fix them.
		const visible_fns  = new Set(this.columns.map(c => c.data));
		const req_fields   = (meta?.fields || []).filter(f =>
			f.reqd && f.fieldtype !== "Table" && !f.read_only
		);
		const missing_visible = req_fields.filter(f =>
			visible_fns.has(f.fieldname) &&
			(row_data[f.fieldname] == null || row_data[f.fieldname] === "")
		);
		if (missing_visible.length) {
			const names = missing_visible.map(f => f.label || f.fieldname).join(", ");
			frappe.show_alert({ message: __("Fill required: {0}", [names]), indicator: "red" }, 3);
			const first_col = this.columns.findIndex(c => c.data === missing_visible[0].fieldname);
			if (first_col >= 0) this.hot.selectCell(0, first_col);
			return;
		}

		// ── Build doc ───────────────────────────────────────────────────────
		const doc = { doctype: dt };

		// Keys to exclude from the scalar field sweep
		const ct_keys      = new Set(this.columns.filter(c => c._is_ct_col).map(c => c.data));
		const virtual_keys = new Set([
			"name", "_is_new",
			...this.columns.filter(c => c._is_join_col || c._is_formula_col || c._is_name_col).map(c => c.data),
		]);

		// Include ALL non-virtual, non-CT values from row_data.
		// This covers both visible column values AND non-visible prefill values
		// (company, currency, price_list, etc. from pattern detection / Property Setters).
		const NUMERIC_TYPES = new Set(["Int","Float","Currency","Percent","Duration"]);
		const CHECK_TYPES   = new Set(["Check"]);
		Object.entries(row_data).forEach(([k, v]) => {
			if (!k.startsWith("_") && !virtual_keys.has(k) && !ct_keys.has(k) && v != null && v !== "") {
				const df = meta?.fields?.find(f => f.fieldname === k);
				if (df && NUMERIC_TYPES.has(df.fieldtype)) {
					const n = parseFloat(v);
					doc[k] = isNaN(n) ? 0 : n;
				} else if (df && CHECK_TYPES.has(df.fieldtype)) {
					doc[k] = v ? 1 : 0;
				} else {
					doc[k] = v;
				}
			}
		});

		// CT columns → group into child table arrays (one child row per group)
		const ct_groups = {};
		this.columns.filter(c => c._is_ct_col).forEach(col => {
			const table_fn = col._ct_table;
			if (!ct_groups[table_fn]) {
				const table_df = meta?.fields?.find(f => f.fieldname === table_fn);
				ct_groups[table_fn] = [table_df ? { doctype: table_df.options } : {}];
			}
			const child_fn = col.data.slice(table_fn.length + 2);
			const v = row_data[col.data];
			if (v != null && v !== "") {
				const ct_dt   = ct_groups[table_fn][0].doctype;
				const ct_meta = ct_dt ? frappe.get_meta(ct_dt) : null;
				const ct_df   = ct_meta?.fields?.find(f => f.fieldname === child_fn);
				if (ct_df && NUMERIC_TYPES.has(ct_df.fieldtype)) {
					const n = parseFloat(v);
					ct_groups[table_fn][0][child_fn] = isNaN(n) ? 0 : n;
				} else if (ct_df && CHECK_TYPES.has(ct_df.fieldtype)) {
					ct_groups[table_fn][0][child_fn] = v ? 1 : 0;
				} else {
					ct_groups[table_fn][0][child_fn] = v;
				}
			}
		});
		Object.entries(ct_groups).forEach(([fn, rows]) => { doc[fn] = rows; });

		// ── Submit ──────────────────────────────────────────────────────────
		const $save_btn = this.$inline_insert_bar?.find(".ev-iib-save");
		$save_btn?.prop("disabled", true).text(__("Saving…"));

		try {
			const r = await frappe.call({
				method: "frappe.client.insert",
				args: { doc },
				freeze: false,
			});
			if (r.message) {
				frappe.show_alert({ message: __("{0} created", [r.message.name]), indicator: "green" }, 3);
				// Clear the inline state without splicing (refresh will fetch clean data)
				this._new_row_idx = -1;
				this.$inline_insert_bar?.remove();
				this.$inline_insert_bar = null;
				this.list_view.last_args = null;
				this.list_view.refresh();
			}
		} catch (_) {
			// frappe.call already shows the server-side validation error
			$save_btn?.prop("disabled", false).text(__("Save Row"));
		}
	}

	/**
	 * Discard the pending inline insert row and restore the grid.
	 * @param {boolean} [silent=false] - if true, skip HOT reload (caller will reload)
	 */
	_cancel_inline_insert(silent = false) {
		if (this._new_row_idx < 0) return;
		this.list_view.data.splice(this._new_row_idx, 1);
		this.data = this.list_view.data;
		this._new_row_idx = -1;
		this.$inline_insert_bar?.remove();
		this.$inline_insert_bar = null;
		if (!silent) {
			this.matrix = this.data_manager.to_matrix(this.list_view.data, this.columns);
			this.formula_bridge.reload(this.matrix);
			this.hot.loadData(this.list_view.data);
		}
	}

	/**
	 * Force HOT to re-render (e.g. after sidebar toggle resizes the container).
	 */
	resize() {
		this.hot?.render();
	}

	// ── V2.5 Sheet context switching ──────────────────────────────────────────

	/**
	 * Rebuild columns + data context for a different doctype sheet.
	 * Called by SheetManager._apply_sheet() and ._lazy_fetch().
	 * @param {Object} sheet - SheetState from SheetManager
	 */
	_switch_sheet_context(sheet) {
		if (!sheet) return;

		// Restore incoming sheet's hidden col state
		this._hidden_col_keys = sheet._hidden_col_keys
			? new Set(sheet._hidden_col_keys)
			: new Set();

		// Blank sheet — use its pre-built A–Z columns directly
		if (sheet.is_blank) {
			this.columns = sheet.columns_config || [];
			return;
		}

		// Cache current base-sheet join config before switching
		if (sheet.doctype === this.doctype) {
			// Switching back to base — restore original columns, applying hidden filter
			this.columns = this._master_columns.filter(c => !this._hidden_col_keys.has(c.data)); this._col_index_map = null;
		} else if (sheet._columns) {
			// Already built columns for this sheet — reuse
			this.columns = sheet._columns;
		} else {
			// Build minimal columns from doctype meta (lazy)
			frappe.model.with_doctype(sheet.doctype, () => {
				const meta = frappe.get_meta(sheet.doctype);
				const _NON_DATA = new Set(["Section Break", "Column Break", "HTML", "Table", "Tab Break", "Fold", "Heading"]);
				// Mirror Frappe's Report/List view: show only in_list_view fields; fall back to first 5
				let show_fields = meta.fields.filter(f => f.in_list_view && !_NON_DATA.has(f.fieldtype));
				if (!show_fields.length) show_fields = meta.fields.filter(f => !_NON_DATA.has(f.fieldtype)).slice(0, 5);

				const cols = [
					{
						data: "name",
						title: "ID",
						type: "text",
						width: 160,
						readOnly: true,
						_readonly: true,
					},
					...show_fields.map((f) => ({
						data: f.fieldname,
						title: f.label || f.fieldname,
						type: "text",
						width: 140,
						readOnly: f.read_only ? true : !this.list_view.can_write,
						_readonly: !!f.read_only,
					})),
				];

				sheet._columns = cols;
				this.columns = cols;

				if (this.hot) {
					this.hot.updateSettings({ columns: this.columns });
					if (sheet.data) this.hot.loadData(sheet.data);
				}
			});

			// Placeholder columns while meta loads
			this.columns = [{ data: "name", title: "ID", type: "text", width: 160, readOnly: true }];
		}
	}

	/**
	 * Inject lookup columns into the grid (from IntelliLookup).
	 * Same pattern as _apply_join_result but for client-side lookup cols.
	 * @param {Array} lookup_cols - HOT column definitions with _is_lookup_col:true
	 * @param {Array} data        - base data array (already mutated with lookup values)
	 */
	_inject_lookup_columns(lookup_cols, data) {
		// Remove stale lookup cols of the same types (by data key prefix)
		const new_keys = new Set(lookup_cols.map((c) => c.data));
		this.columns = this.columns.filter((c) => !c._is_lookup_col || new_keys.has(c.data));
		this._master_columns = this._master_columns.filter((c) => !c._is_lookup_col || new_keys.has(c.data));

		// Seed empty values so HOT rows have the key defined
		(data || []).forEach((row) => {
			lookup_cols.forEach((col) => {
				if (!(col.data in row)) row[col.data] = "";
			});
		});

		// Append new lookup columns
		lookup_cols.forEach((col) => {
			if (!this.columns.find((c) => c.data === col.data)) {
				this.columns.push(col);
				this._invalidate_col_map();
				this._master_columns.push(col);
			}
		});

		// Reload HOT
		this.matrix = this.data_manager.to_matrix(data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.updateSettings({ columns: this.columns });
		this.hot.loadData(data);
	}

	// ── Bulk Add ──────────────────────────────────────────────────────────────
	// Lets users fill N blank rows directly in the grid and create all of them
	// as Frappe documents in one shot — replaces the export → edit → import flow.

	/**
	 * Enter bulk-add mode: append N blank rows to the grid.
	 * HOT's native Ctrl+V paste works immediately — users can paste from Excel.
	 * @param {number} n  Number of blank rows to add (default 10).
	 */
	_enter_bulk_add_mode(n = 10) {
		if (this._bulk_add_start >= 0) return; // already active

		// Build a blank row object matching the current column schema
		const _blank_row = () => {
			const row = {};
			this.columns.forEach((col) => { if (col.data) row[col.data] = ""; });
			return row;
		};

		this._bulk_add_start = this.list_view.data.length;
		for (let i = 0; i < n; i++) this.list_view.data.push(_blank_row());

		// HOT afterRenderer hook: tint bulk rows green
		const is_dark = () => document.documentElement.getAttribute("data-theme") === "dark";
		this._bulk_renderer_hook = (td, row) => {
			if (row < this._bulk_add_start) return;
			td.style.backgroundColor = is_dark() ? "#0c2010" : "#f0faf0";
		};
		this.hot.addHook("afterRenderer", this._bulk_renderer_hook);

		this.hot.loadData(this.list_view.data);
		this._show_bulk_bar(n);

		// Scroll to first bulk row so user sees it immediately
		this.hot.scrollViewportTo(this._bulk_add_start, 0);
		frappe.show_alert({
			message: __(
				"{0} blank rows added — fill them in or paste from Excel/Sheets (Ctrl+V)",
				[n]
			),
			indicator: "green",
		}, 4);
	}

	/**
	 * Bulk-duplicate selected rows: fetches the full document for each source row
	 * (so ALL saved fields — including mandatory ones not visible in the grid — are
	 * captured), then enters bulk-add mode.
	 *
	 * Visible columns are pre-filled and remain editable.
	 * Non-visible fields (mandatory fields, fetch_from values, etc.) are stored in
	 * `row._hidden_fields` and silently merged back at `_collect_bulk_rows` time.
	 * This covers both meta-defined `fetch_from` AND JS-defined `frappe.set_query`
	 * relationships, because their resolved values are already persisted in the doc.
	 *
	 * @param {number[]} row_indices  Sorted array of data row indices to clone.
	 */
	async _bulk_duplicate(row_indices) {
		if (this._bulk_add_start >= 0) {
			frappe.show_alert({ message: __("Exit current bulk mode first (Cancel)"), indicator: "orange" }, 3);
			return;
		}

		const SYSTEM = new Set(["name","creation","modified","modified_by","owner",
			"docstatus","idx","_user_tags","_comments","_assign","_liked_by","_seen",
			"amended_from","naming_series"]);

		const data = this.list_view.data;
		const valid_srcs = row_indices
			.map(idx => data[idx])
			.filter(r => r && !r._is_new && r.name);

		if (!valid_srcs.length) {
			frappe.show_alert({ message: __("No valid rows to duplicate"), indicator: "orange" }, 3);
			return;
		}

		// Fetch each full document (parallel) so mandatory + fetch_from + JS-resolved
		// fields are available even when those fields are not visible columns.
		const full_map = new Map();
		await Promise.all(
			valid_srcs.map(src =>
				frappe.call({ method: "frappe.client.get", args: { doctype: this.doctype, name: src.name } })
					.then(r => { if (r.message?.name) full_map.set(r.message.name, r.message); })
					.catch(() => {})
			)
		);
		valid_srcs.forEach(src => { if (!full_map.has(src.name)) full_map.set(src.name, src); });

		// ── Mandatory-field temp columns ──────────────────────────────────────
		// If a doctype has mandatory scalar fields not currently visible in the grid,
		// add them as temporary editable columns so the user can see and fill them
		// before clicking Create. These columns are removed on Cancel/Create.
		const meta = frappe.get_meta(this.doctype);
		const SKIP_TYPES = new Set(["Section Break","Column Break","Tab Break","HTML",
			"Heading","Button","Fold","Table","Table MultiSelect"]);
		const visible_keys_before = new Set(this.columns.map(c => c.data).filter(Boolean));

		const mandatory_extra = (meta?.fields || []).filter(f =>
			f.reqd && f.fieldname && !f.hidden && !f.read_only &&
			!SKIP_TYPES.has(f.fieldtype) && !visible_keys_before.has(f.fieldname)
		);

		if (mandatory_extra.length) {
			this._bulk_dup_orig_columns = this.columns;

			// ── Snapshot current column widths before updateSettings wipes them ──
			// HOT 6.2.2 stores widths in plugin.manualColumnWidths[] (index-based).
			// updateSettings({ columns: [...] }) resets this array, collapsing every
			// column to auto-width and killing the horizontal scrollbar.
			// We snapshot here and restore shifted by extra_count after the call.
			const _rp = this.hot.getPlugin('manualColumnResize');
			this._bulk_dup_orig_widths = _rp?.manualColumnWidths
				? [..._rp.manualColumnWidths]
				: null;

			// Use proper column config per fieldtype so pickers/dropdowns work in temp cols.
			const extra_cols = mandatory_extra.map(df => {
				const col = frappe.views.excel.get_column_config(df, true);
				return {
					...col,
					title:    `* ${__(df.label || df.fieldname)}`,
					width:    Math.max(100, Math.min(180, ((df.label || df.fieldname).length * 9) + 20)),
					readOnly:  false,
					_readonly: false,
					className: "",
					_is_bulk_temp: true,
				};
			});
			// Prepend so mandatory fields appear first — user sees them immediately
			this.columns = [...extra_cols, ...this.columns];
			// Backfill empty slots in ALL existing rows so HOT doesn't get confused
			data.forEach(row => {
				extra_cols.forEach(col => { if (!(col.data in row)) row[col.data] = ""; });
			});
		}

		// ── Set up bulk-add mode ──────────────────────────────────────────────
		const start = data.length;
		this._bulk_add_start = start;

		const is_dark = () => document.documentElement.getAttribute("data-theme") === "dark";
		this._bulk_renderer_hook = (td, row) => {
			if (row < start) return;
			td.style.backgroundColor = is_dark() ? "#0c2010" : "#f0faf0";
		};
		this.hot.addHook("afterRenderer", this._bulk_renderer_hook);

		// Recalculate visible keys after potential column expansion
		const visible_keys = new Set(this.columns.map(c => c.data).filter(Boolean));

		let added = 0;
		for (const src of valid_srcs) {
			const full = full_map.get(src.name) || src;
			const row  = { _is_new: true };
			this.columns.forEach(col => { if (col.data) row[col.data] = ""; });

			const hidden = {};
			for (const [k, v] of Object.entries(full)) {
				if (SYSTEM.has(k) || k.startsWith("_")) continue;
				// Skip null, empty, and complex types (arrays = child tables, objects = JSON fields)
				if (v == null || v === "" || (typeof v === "object")) continue;
				if (visible_keys.has(k)) {
					row[k] = v;       // editable in the grid (including mandatory temp cols)
				} else {
					hidden[k] = v;    // non-visible non-mandatory: silently included at create
				}
			}
			if (Object.keys(hidden).length) row._hidden_fields = hidden;
			data.push(row);
			added++;
		}

		this.hot.loadData(data);

		// scrollViewportTo with snapToBottom=true forces scroll even when the target
		// is already partially visible — ensures the last duplicate row is fully in view.
		const _dup_last = start + added - 1;
		const _scroll_once = () => {
			this.hot.scrollViewportTo(_dup_last, 0, true);
			this.hot.removeHook('afterRender', _scroll_once);
		};
		this.hot.addHook('afterRender', _scroll_once);

		if (this._bulk_dup_orig_columns) {
			// Build widths: prepended extra cols first, then original widths.
			// Pass via manualColumnResize setting in the SAME updateSettings call —
			// updateSettings({ columns }) resets the plugin's internal array, so
			// supplying widths via a separate assignment (or a later render) is ignored.
			// Including them in the same call forces the plugin to re-init with the
			// correct values, which restores the horizontal scrollbar.
			const extra_n      = this.columns.length - this._bulk_dup_orig_columns.length;
			const extra_widths = this.columns.slice(0, extra_n).map(c => c.width || 120);
			const combined_w   = this._bulk_dup_orig_widths
				? [...extra_widths, ...this._bulk_dup_orig_widths]
				: extra_widths;

			// Hook registered above fires on the render HOT triggers internally here.
			this.hot.updateSettings({ columns: this.columns, manualColumnResize: combined_w });
		} else {
			this.hot.render(); // trigger the scroll hook
		}

		this._show_bulk_bar(added);

		frappe.show_alert({
			message: __("{0} rows duplicated — edit inline then click Create", [added]),
			indicator: "green",
		}, 4);
	}

	/**
	 * Enter bulk-add mode pre-populated with imported rows.
	 * Each row in `rows` is a field→value dict already mapped to this doctype's fields.
	 * @param {Object[]} rows
	 */
	_enter_bulk_add_mode_with_data(rows) {
		if (this._bulk_add_start >= 0) {
			frappe.confirm(__("Bulk mode is already active. Replace it with the imported data?"), () => {
				this._exit_bulk_add_mode();
				this._enter_bulk_add_mode_with_data(rows);
			});
			return;
		}

		const _blank_row = () => {
			const row = {};
			this.columns.forEach(col => { if (col.data) row[col.data] = ""; });
			return row;
		};

		this._bulk_add_start = this.list_view.data.length;

		const is_dark = () => document.documentElement.getAttribute("data-theme") === "dark";
		this._bulk_renderer_hook = (td, row) => {
			if (row < this._bulk_add_start) return;
			td.style.backgroundColor = is_dark() ? "#0c2010" : "#f0faf0";
		};
		this.hot.addHook("afterRenderer", this._bulk_renderer_hook);

		for (const src_row of rows) {
			const row = _blank_row();
			row._is_new = true;
			for (const [k, v] of Object.entries(src_row)) {
				if (k in row) row[k] = v;
			}
			this.list_view.data.push(row);
		}

		this.hot.loadData(this.list_view.data);
		this._show_bulk_bar(rows.length);
		this._update_bulk_bar();
		this.hot.scrollViewportTo(this._bulk_add_start, 0);
		frappe.show_alert({
			message: __("{0} rows imported — review and click Create", [rows.length]),
			indicator: "green",
		}, 4);
	}

	/** Exit bulk-add mode without creating: remove pending rows and clean up. */
	_exit_bulk_add_mode() {
		if (this._bulk_add_start < 0) return;
		this.list_view.data.splice(this._bulk_add_start);
		this._bulk_add_start = -1;

		if (this._bulk_renderer_hook) {
			this.hot.removeHook("afterRenderer", this._bulk_renderer_hook);
			this._bulk_renderer_hook = null;
		}

		// Restore original columns if temporary mandatory columns were added for duplicate
		if (this._bulk_dup_orig_columns) {
			this.columns = this._bulk_dup_orig_columns;
			this._bulk_dup_orig_columns = null;
			const orig_w = this._bulk_dup_orig_widths;
			this._bulk_dup_orig_widths = null;
			// Same pattern as _bulk_duplicate: pass widths via manualColumnResize in
			// the same updateSettings call so the plugin re-inits with correct values.
			this.hot.updateSettings({ columns: this.columns, manualColumnResize: orig_w || true });
		}

		this.hot.loadData(this.list_view.data);
		this.$bulk_bar?.remove();
		this.$bulk_bar = null;
	}

	/** Render the floating action bar shown while bulk-add is active. */
	_show_bulk_bar(n) {
		this.$bulk_bar?.remove();
		this.$bulk_bar = $(`
			<div class="ev-bulk-bar">
				<span class="ev-bulk-bar__icon">✨</span>
				<span class="ev-bulk-bar__info">${__("{0} rows added — 0 ready", [n])}</span>
				<span class="ev-bulk-bar__hint">${__("Ctrl+V pastes from Excel/Sheets")}</span>
				<button class="ev-bulk-bar__create btn btn-primary btn-sm" disabled>
					${__("Create 0 Records")}
				</button>
				<button class="ev-bulk-bar__cancel btn btn-sm">✕ ${__("Cancel")}</button>
			</div>
		`).appendTo(document.body);

		this.$bulk_bar.on("click", ".ev-bulk-bar__create:not([disabled])", () => this._do_bulk_create());
		this.$bulk_bar.on("click", ".ev-bulk-bar__cancel", () => this._exit_bulk_add_mode());
	}

	/** Recount filled rows and update the action bar label + button state. */
	_update_bulk_bar() {
		if (!this.$bulk_bar || this._bulk_add_start < 0) return;
		const pending = this.list_view.data.slice(this._bulk_add_start);
		// A row is "ready" if it has at least one non-virtual, non-hidden visible value
		// OR has hidden_fields (from duplicate — always considered filled)
		const filled  = pending.filter((row) =>
			row._hidden_fields ||
			Object.entries(row).some(([k, v]) => k !== "name" && !k.startsWith("_") && v != null && v !== "")
		).length;

		this.$bulk_bar.find(".ev-bulk-bar__info").text(
			__("{0} rows — {1} ready", [pending.length, filled])
		);
		const $btn = this.$bulk_bar.find(".ev-bulk-bar__create");
		$btn.text(__("Create {0} Record(s)", [filled]));
		filled > 0 ? $btn.prop("disabled", false) : $btn.prop("disabled", true);
	}

	/**
	 * Collect filled bulk rows as plain field-value dicts, stripping virtual cols
	 * and skipping fully empty rows.
	 *
	 * For duplicate rows, `_hidden_fields` carries non-visible fields (mandatory
	 * fields, fetch_from values resolved from saved docs). These are merged in at
	 * the lowest priority so any user edits in visible columns take precedence.
	 *
	 * @returns {Array<Object>}
	 */
	_collect_bulk_rows() {
		const _virtual = new Set(["_meta", "_social", "_is_new", "name"]);
		return this.list_view.data
			.slice(this._bulk_add_start)
			.filter((row) =>
				row._hidden_fields ||
				Object.entries(row).some(([k, v]) => !_virtual.has(k) && !k.startsWith("_") && v != null && v !== "")
			)
			.map((row) => {
				const clean = {};
				// Hidden fields first (lowest priority — from the original saved doc)
				if (row._hidden_fields) {
					Object.entries(row._hidden_fields).forEach(([k, v]) => {
						if (v != null && v !== "") clean[k] = v;
					});
				}
				// Visible fields override hidden (user may have edited them)
				Object.entries(row).forEach(([k, v]) => {
					if (!_virtual.has(k) && !k.startsWith("_") && v != null && v !== "") {
						clean[k] = v;
					}
				});
				return clean;
			});
	}

	/**
	 * Create all filled bulk rows as Frappe documents.
	 * Shows a progress dialog, then refreshes the list on completion.
	 */
	async _do_bulk_create() {
		const rows = this._collect_bulk_rows();
		if (!rows.length) return;

		const $btn = this.$bulk_bar?.find(".ev-bulk-bar__create");
		$btn?.prop("disabled", true).text(__("Creating…"));

		try {
			const r = await frappe.call({
				method: "excel_view.api.bulk_create_records",
				args:   { doctype: this.doctype, rows: JSON.stringify(rows) },
			});

			const { created = [], errors = [] } = r.message || {};

			// Highlight error rows red in the grid
			if (errors.length) {
				errors.forEach(({ idx }) => {
					const grid_row = this._bulk_add_start + idx;
					// Mark row cells with a red tint via a one-shot afterRenderer
					const _err_hook = (td, row) => {
						if (row === grid_row) td.style.backgroundColor = "#fdecea";
					};
					this.hot.addHook("afterRenderer", _err_hook);
				});
				this.hot.render();
			}

			// Show result summary
			if (created.length && !errors.length) {
				frappe.show_alert({
					message: __("{0} record(s) created successfully", [created.length]),
					indicator: "green",
				}, 4);
				this._exit_bulk_add_mode();
				this.list_view.refresh();
			} else if (created.length && errors.length) {
				frappe.msgprint({
					title:   __("Partial Success"),
					message: __(
						"{0} record(s) created. {1} row(s) failed — they are highlighted red. Fix errors and try again.",
						[created.length, errors.length]
					),
					indicator: "orange",
				});
				// Remove successfully created rows from bulk area, keep failed ones
				const failed_idxs = new Set(errors.map((e) => e.idx));
				const failed_rows = rows.filter((_, i) => failed_idxs.has(i));
				this.list_view.data.splice(this._bulk_add_start);
				failed_rows.forEach((row) => this.list_view.data.push(row));
				this.hot.loadData(this.list_view.data);
				this._update_bulk_bar();
				this.list_view.refresh();
			} else {
				frappe.msgprint({
					title:   __("All rows failed"),
					message: errors.map((e) => `Row ${e.idx + 1}: ${e.message}`).join("<br>"),
					indicator: "red",
				});
				$btn?.prop("disabled", false).text(__("Retry"));
			}
		} catch (e) {
			frappe.show_alert({ message: __("Bulk create failed — see console"), indicator: "red" }, 4);
			$btn?.prop("disabled", false).text(__("Retry"));
		}
	}

	/**
	 * Destroy HOT instance and unbind all events.
	 * Called when navigating away from Excel View.
	 */
	destroy() {
		this._destroyed = true;
		this._last_join_config    = null;
		this._pending_join_config = null;
		$(document).off("keydown.ev");
		this._resize_observer?.disconnect();
		// Remove formula-cache realtime listener
		if (this._formula_realtime_handler) {
			frappe.realtime.off("list_update", this._formula_realtime_handler);
			this._formula_realtime_handler = null;
		}
		clearTimeout(this._formula_realtime_timer);
		clearTimeout(this._base_realtime_timer);
		// Remove infinite-scroll listener
		if (this._scroll_listener) {
			this._scroll_listener.target.removeEventListener("scroll", this._scroll_listener.fn);
			this._scroll_listener = null;
		}
		this.toolbar_component?.destroy();
		this.formula_bar_component?.destroy();
		this.status_bar?.destroy();
		this.workbook_manager?.destroy();
		this.sheet_manager?.destroy();
		this.dashboard_manager?.destroy();
		// Exit bulk-add mode cleanly (removes pending rows + hooks)
		if (this._bulk_add_start >= 0) this._exit_bulk_add_mode();
		this.hot?.destroy();
		this.hot = null;
		this.$wrapper?.empty();
	}
};
