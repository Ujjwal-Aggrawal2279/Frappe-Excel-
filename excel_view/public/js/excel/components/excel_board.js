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
		// V3.1 — Repeat Last Action (F4)
		this._last_action = null;
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
		this.cf_manager     = new frappe.views.excel.CFManager({ board: this });
		this.chart_manager  = new frappe.views.excel.ChartManager({ board: this });
		this.pivot_builder  = new frappe.views.excel.PivotBuilder({ board: this });

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
		frappe.views.excel.formula_manager?.set_rerender(() => this.hot?.render());

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
			afterChange: (changes, source) => this._on_change(changes, source),
			afterSelection: (r, c, r2, c2) => this._on_selection(r, c, r2, c2),
			afterColumnResize: (col, size) => this._on_col_resize(col, size),
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
			// V3.1 — intercept F4 before HOT swallows it (HOT uses F4 for formula cycling)
			beforeKeyDown: (e) => {
				if (e.key === "F4" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
					e.stopImmediatePropagation();
					e.preventDefault();
					setTimeout(() => this._repeat_last_action(), 0);
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
			this._render_meta_cell(TD, this.list_view?.data?.[row]);
			TD.style.padding = "0";
			TD.style.verticalAlign = "middle";
			return;
		}

		// Social column: render Tags/Comments/Assign/Liked/Status/Idx
		if (this.columns[col]?._is_social_col) {
			this._render_social_cell(TD, this.list_view?.data?.[row]);
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
			const raw_val = this.list_view?.data?.[row]?.[this.columns[col]?.data];
			const row_data = this.list_view?.data?.[row];
			// Perf: track which properties have been set so we can stop early
			let _cf_bg_set = false, _cf_color_set = false;
			for (const rule of this.cond_fmt_rules) {
				// Early exit: all possible CF properties already applied
				if (_cf_bg_set && _cf_color_set) break;
				const rng = rule.range || {};
				const minC = Math.min(rng.c1, rng.c2), maxC = Math.max(rng.c1, rng.c2);
				if (col < minC || col > maxC) continue;
				// Skip bg-only rules if bg already set
				if (_cf_bg_set && rule.fmt?.bg && !rule.fmt?.color) continue;
				// Skip color-only rules if color already set
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
		const alpha = (on_row && on_col) ? 0.38 : 0.18; // brighter: 18% row/col, 38% intersection
		TD.style.setProperty("background-color", `rgba(${r},${g},${b},${alpha})`, "important");
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
		this.columns = this._master_columns.filter(c => !this._hidden_col_keys.has(c.data));
	}

	/**
	 * Render the combined meta cell HTML.
	 * Shows Created By (avatar + name + date) and Updated By rows.
	 */
	_render_meta_cell(TD, row_data) {
		if (!row_data) { TD.textContent = ""; return; }
		// Cache keyed by name+modified — same values → reuse cached innerHTML (avoids date parse + escape per render)
		const _cache_key = `${row_data.name || ""}:${row_data.modified || ""}`;
		const _cached = this._meta_html_cache?.get(_cache_key);
		if (_cached) { TD.innerHTML = _cached; return; }

		const _avatar = (user, fullname) => {
			const info = frappe.boot?.user_info?.[user];
			const img = info?.image;
			const initials = (fullname || user || "?").substring(0, 1).toUpperCase();
			if (img) {
				return `<img src="${frappe.utils.escape_html(img)}" class="ev-meta-avatar ev-meta-avatar--img" title="${frappe.utils.escape_html(fullname || user)}">`;
			}
			// Color-coded letter avatar — guard against empty user (charCodeAt → NaN)
			const colors = ["#e53935","#8e24aa","#1565c0","#00838f","#2e7d32","#ef6c00","#6d4c41","#546e7a"];
			const code = (user || " ").charCodeAt(0) || 0;
			const bg = colors[code % colors.length];
			return `<span class="ev-meta-avatar" style="background:${bg}" title="${frappe.utils.escape_html(fullname || user)}">${frappe.utils.escape_html(initials)}</span>`;
		};

		const _fmt_dt = (val) => {
			if (!val) return "";
			try {
				const d = frappe.datetime.str_to_user(val) || val;
				return String(d).replace(" ", "\u00a0"); // non-breaking space keeps date+time together
			} catch (_) { return String(val).substring(0, 16); }
		};

		const owner = row_data.owner || "";
		const owner_info = frappe.boot?.user_info?.[owner];
		const owner_name = owner_info?.fullname || owner;

		const modified_by = row_data.modified_by || "";
		const mod_info = frappe.boot?.user_info?.[modified_by];
		const mod_name = mod_info?.fullname || modified_by;

		const _html = `
			<div class="ev-meta-cell">
				<div class="ev-meta-row" title="${frappe.utils.escape_html(owner_name)}">
					${_avatar(owner, owner_name)}
					<span class="ev-meta-date"><span class="ev-meta-badge ev-meta-badge--cr">CR</span>${_fmt_dt(row_data.creation)}</span>
				</div>
				<div class="ev-meta-row ev-meta-row--updated" title="${frappe.utils.escape_html(mod_name)}">
					${_avatar(modified_by, mod_name)}
					<span class="ev-meta-date"><span class="ev-meta-badge ev-meta-badge--md">MD</span>${_fmt_dt(row_data.modified)}</span>
				</div>
			</div>
		`;
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
		this.columns = this._master_columns.filter(c => !this._hidden_col_keys.has(c.data));
	}

	/**
	 * Render the combined social cell.
	 * Row 1: docstatus badge + assigned avatars + idx
	 * Row 2: tags pill + like count + comment count
	 * Clicking ♥ toggles like inline; clicking avatars/tags opens frappe dialogs.
	 */
	_render_social_cell(TD, row_data) {
		if (!row_data) { TD.textContent = ""; return; }

		// Cache key covers all 6 fields — any change invalidates
		const _ck = `${row_data.name}|${row_data.docstatus}|${row_data.idx}|${row_data._user_tags || ""}|${(row_data._assign || "").substring(0, 60)}|${(row_data._liked_by || "").substring(0, 60)}|${(row_data._comments || "").substring(0, 20)}`;
		const _cached = this._social_html_cache?.get(_ck);
		if (_cached) { TD.innerHTML = _cached; return; }

		const _esc = s => frappe.utils.escape_html(String(s ?? ""));

		// ── Reusable avatar builder (same colors as meta col) ─────────────
		const _colors = ["#e53935","#8e24aa","#1565c0","#00838f","#2e7d32","#ef6c00","#6d4c41","#546e7a"];
		const _avatar = (u) => {
			const info = frappe.boot?.user_info?.[u];
			const name = info?.fullname || u;
			const code = (u || " ").charCodeAt(0) || 0;
			if (info?.image) return `<img src="${_esc(info.image)}" class="ev-sc-av ev-sc-av--img" title="${_esc(name)}">`;
			return `<span class="ev-sc-av" style="background:${_colors[code % _colors.length]}" title="${_esc(name)}">${_esc(name.substring(0, 1).toUpperCase())}</span>`;
		};

		// ── docstatus ────────────────────────────────────────────────────
		const ds = row_data.docstatus ?? 0;
		const DS_MAP = ["Draft", "Submitted", "Cancelled"];
		const ds_cls = ["ev-sc-ds--draft", "ev-sc-ds--submitted", "ev-sc-ds--cancelled"];

		// ── Assigned To: ["Administrator"] ───────────────────────────────
		let assigned = [];
		try { assigned = JSON.parse(row_data._assign || "[]"); } catch(_) {}
		const av_html = assigned.slice(0, 3).map(_avatar).join("")
			+ (assigned.length > 3 ? `<span class="ev-sc-av ev-sc-av--more">+${assigned.length - 3}</span>` : "");

		// ── Tags: ",Just" → ["Just"] ─────────────────────────────────────
		let tags = [];
		try { tags = (row_data._user_tags || "").split(",").map(t => t.trim()).filter(Boolean); } catch(_) {}
		const tags_html = tags.length
			? `<span class="ev-sc-tag" data-sc="tags" data-name="${_esc(row_data.name)}" title="${_esc(tags.join(", "))}">${_esc(tags[0])}${tags.length > 1 ? `<span class="ev-sc-tag-more">+${tags.length - 1}</span>` : ""}</span>`
			: `<span class="ev-sc-tag-empty" data-sc="tags" data-name="${_esc(row_data.name)}" title="Add tag">🏷</span>`;

		// ── Liked By: ["user1@gmail.com"] ─────────────────────────────────
		let liked = [];
		try { liked = JSON.parse(row_data._liked_by || "[]"); } catch(_) {}
		const me_liked = liked.includes(frappe.session?.user);
		const like_html = `<span class="ev-sc-like${me_liked ? " ev-sc-like--on" : ""}" data-sc="like" data-name="${_esc(row_data.name)}" data-doctype="${_esc(this.doctype)}" data-liked="${me_liked ? "1" : "0"}" title="${me_liked ? "Unlike" : "Like"}">♥ ${liked.length}</span>`;

		// ── Comments: JSON array count ────────────────────────────────────
		let cc = 0;
		try { const c = JSON.parse(row_data._comments || "[]"); cc = Array.isArray(c) ? c.length : 0; } catch(_) {}
		const comment_html = `<span class="ev-sc-comment" data-sc="comment" data-name="${_esc(row_data.name)}" title="${cc} comment(s)">💬${cc > 0 ? " " + cc : ""}</span>`;

		// ── idx ───────────────────────────────────────────────────────────
		const idx_html = row_data.idx != null ? `<span class="ev-sc-idx">#${row_data.idx}</span>` : "";

		const _html = `<div class="ev-social-cell" data-name="${_esc(row_data.name)}">
			<div class="ev-sc-row ev-sc-row--top">
				<span class="ev-sc-ds ${ds_cls[ds] || ds_cls[0]}">${DS_MAP[ds] || "Draft"}</span>
				${av_html ? `<span class="ev-sc-avatars" data-sc="assign" data-name="${_esc(row_data.name)}" title="Click to manage assignments">${av_html}</span>` : `<span class="ev-sc-assign-empty" data-sc="assign" data-name="${_esc(row_data.name)}" title="Assign to someone">👤</span>`}
				${idx_html}
			</div>
			<div class="ev-sc-row ev-sc-row--bottom">
				${tags_html}
				${like_html}
				${comment_html}
			</div>
		</div>`;

		this._social_html_cache?.set(_ck, _html);
		TD.innerHTML = _html;
	}

	/** Handle CRUD actions for social column cells (like toggle, assign, tags). */
	_bind_social_clicks() {
		this.$hot_container.on("click.social", "[data-sc]", (e) => {
			const $el = $(e.target).closest("[data-sc]");
			const action = $el.data("sc");
			const name   = $el.data("name");
			if (!name) return;
			e.stopPropagation();

			if (action === "like") {
				const add = $el.data("liked") === "1" ? "No" : "Yes";
				frappe.call({
					method: "frappe.desk.like.toggle_like",
					args: { doctype: this.doctype, name, add },
					callback: (r) => {
						// Update row_data in-place and clear cache
						const row = this.list_view.data?.find(d => d.name === name);
						if (row) {
							row._liked_by = r.message;
							const _ck_prefix = `${name}|`;
							[...this._social_html_cache.keys()]
								.filter(k => k.startsWith(_ck_prefix))
								.forEach(k => this._social_html_cache.delete(k));
							this.hot?.render();
						}
					},
				});

			} else if (action === "assign") {
				frappe.call({
					method: "frappe.desk.form.assign_to.get",
					args: { doctype: this.doctype, name },
					callback: (r) => {
						const assigned = r.message || [];
						const d = new frappe.ui.Dialog({
							title: __("Assigned To"),
							fields: [{ label: __("Assign To"), fieldname: "user", fieldtype: "Link", options: "User" }],
							primary_action_label: __("Assign"),
							primary_action: (vals) => {
								if (!vals.user) return;
								frappe.call({
									method: "frappe.desk.form.assign_to.add",
									args: { doctype: this.doctype, name, assign_to: [vals.user], bulk_assign: false },
									callback: () => { d.hide(); this.list_view.refresh(); },
								});
							},
						});
						d.show();
					},
				});

			} else if (action === "tags") {
				frappe.prompt(
					{ fieldtype: "Data", fieldname: "tag", label: __("Tag"), description: __("Add a tag to this record") },
					(vals) => {
						if (!vals.tag) return;
						frappe.call({
							method: "frappe.desk.tags.add_tag",
							args: { dt: this.doctype, dn: name, tag: vals.tag.trim() },
							callback: () => this.list_view.refresh(),
						});
					},
					__("Add Tag"), __("Add")
				);

			} else if (action === "comment") {
				frappe.set_route("Form", this.doctype, name);
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

	_on_change(changes, source) {
		// Skip internal HOT sources that aren't user edits
		if (!changes || source === "loadData" || source === "MergeCells" || source === "UndoRedo.undo" && changes.every(([,,,v]) => v === null)) return;

		// Skip our own autofetch writes — they're already in list_view.data, no DB save needed
		if (source === "autofetch") return;

		// In array-of-objects mode HOT gives [row, fieldname, oldVal, newVal].
		// formula_bridge needs numeric col indices, so convert.
		const indexed = changes.map(([row, prop, oldVal, newVal]) => {
			const col = this.columns.findIndex((c) => c.data === prop);
			return [row, col, oldVal, newVal];
		});

		// Push raw values into HyperFormula first (needed before copy/paste adjustment).
		this.formula_bridge.apply_changes(indexed);

		// For autofill: use HF copy+paste so relative references shift correctly.
		// (Without this, =AF1*0.18 copied to row 2 stays =AF1*0.18 instead of =AF2*0.18)
		if (source === "Autofill.fill") {
			this._fix_autofill_formulas(changes, indexed);
		}

		// Persist to Frappe DB
		this.data_manager.queue_save(changes);

		// Keep local data array in sync.
		// NOTE: for autofill formula cells, _fix_autofill_formulas already wrote the
		// adjusted formula back, so we skip those (don't overwrite with the unadjusted string).
		const is_autofill_formula = source === "Autofill.fill";
		changes.forEach(([row, prop, , newVal]) => {
			if (!this.list_view.data[row]) return;
			if (is_autofill_formula && this.formula_bridge.is_formula(newVal)) return;
			this.list_view.data[row][prop] = newVal;
		});

		// Inline insert: auto-fill fetch_from dependent fields when a Link field changes
		if (this._new_row_idx >= 0) {
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
		if (this._new_row_idx < 0) return;

		const meta = frappe.get_meta(this.doctype);
		if (!meta) return;

		// Build dependency map lazily (once per inline insert session)
		if (!this._fetch_from_map) {
			this._fetch_from_map = this._build_fetch_from_map(meta);
		}

		const row_idx  = this._new_row_idx;
		const row_data = this.list_view.data[row_idx];
		if (!row_data?._is_new) return;

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
					const ci = this.columns.findIndex(c => c.data === d.fieldname);
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
							const ci = this.columns.findIndex(c => c.data === d.fieldname);
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

	// ── Column header formatting (afterGetColHeader hook) ─────────────────────
	// Applies border stored at format_store key "h_<col>" to the <th> element.
	_apply_col_header_format(TH, col) {
		if (col < 0) return; // row-number corner cell
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

		// V3.1 — Formula Precedent highlighting
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
			this.hot?.render(); // clear old outlines
		}
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

	_on_row_resize(row_index, new_height) {
		// V3.1 — Record for F4 Repeat Last Action
		if (new_height != null) this._last_action = { type: "row_resize", size: new_height };
		// Persist to user_settings so heights survive refresh
		this._schedule_row_heights_save();
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
		// afterGetRowHeader is not always called by updateSettings; this ensures
		// the row header TRs are always in sync with the data TRs after every render.
		if (this._hidden_rows?.size) {
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
				this.hot.render();

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
			this.columns.splice(c, 1);
			// Also remove from master list
			this._master_columns = this._master_columns.filter((col) => col.data !== key);
			(this.list_view.data || []).forEach((row) => delete row[key]);
		});

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
			frappe.model.user_settings.save(this.doctype, "excel_smart_lookups", this._applied_lookups);
		}

		(this.list_view?.data || []).forEach(row => {
			const key = String(row[cfg.src_field] ?? "").trim().toLowerCase();
			const tr = tgt_map.get(key);
			cfg.return_fields.forEach(f => {
				row[`_slk_${f.fieldname}`] = tr ? (tr[f.fieldname] ?? "") : "";
			});
		});
		this._slk_ensure_cols(cfg);
		this.hot?.render();
	}

	/** Perform the join using the saved _value_cache (offline / blank-sheet fallback). */
	_slk_join_cache(cfg) {
		if (!cfg._value_cache || !Object.keys(cfg._value_cache).length) return;
		(this.list_view?.data || []).forEach(row => {
			const key = String(row[cfg.src_field] ?? "").trim().toLowerCase();
			const tr = cfg._value_cache[key];
			cfg.return_fields.forEach(f => {
				row[`_slk_${f.fieldname}`] = tr ? (tr[f.fieldname] ?? "") : "";
			});
		});
		this._slk_ensure_cols(cfg);
		this.hot?.render();
	}

	/** Ensure _slk_* columns exist in _master_columns / columns. */
	_slk_ensure_cols(cfg) {
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
			this.columns = this._master_columns.filter(c => !this._hidden_col_keys.has(c.data));
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

		// column_manager gets ALL fields (regular + CT) for column config
		this.column_manager.fields = [
			...regular.map(f => [f, this.doctype]),
			...this._ct_fieldnames.map(f => [f, this.doctype]),
		];

		// Recompute columns + master list, then re-apply any persisted hidden cols
		this.columns = this.column_manager.get_columns();
		this._master_columns = [...this.columns];
		// Re-group meta fields into virtual _meta column if present
		this._inject_meta_column();
		this._inject_social_column();
		// Re-inject Smart Lookup columns into _master_columns after column rebuild
		if (this._applied_lookups?.length) {
			const existing_keys = new Set(this._master_columns.map(c => c.data));
			this._applied_lookups.forEach(cfg => {
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
		// Apply hidden state — _sync_visible_columns updates this.columns and HOT
		this._sync_visible_columns();

		// CRITICAL: list_view.fields only gets REGULAR fields — the Frappe server
		// doesn't know about CT composite fieldnames (table__child).
		this.list_view.fields = [
			["name", this.doctype],
			...regular.map(f => [f, this.doctype]),
		];

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
	 * Reload grid with fresh data from the server.
	 */
	refresh(new_data) {
		// Clear any pending inline insert — server data replaces the grid
		if (this._new_row_idx >= 0) {
			this._new_row_idx = -1;
			this.$inline_insert_bar?.remove();
			this.$inline_insert_bar = null;
		}

		// Blank-sheet guard: when the user is on a blank sheet (A-Z columns, no
		// Frappe data), a background list_view.refresh() may be triggered to keep
		// charts live (sheet_manager._apply_sheet).  We must NOT push the fetched
		// Sales Order rows into the HOT instance — that would clobber the blank
		// grid.  Just rerender visible charts and bail out.
		if (this.sheet_manager?.get_current()?.is_blank) {
			setTimeout(() => this.chart_manager?.rerender_all_visible(), 0);
			return;
		}

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

		// V2.5 — Keep the active non-blank sheet's data pointer current so that
		// switch_to() uses _apply_sheet() (direct swap) rather than _lazy_fetch()
		// (re-fetch) when the user returns to this tab later.
		const _sm_cur = this.sheet_manager?.get_current();
		if (_sm_cur && !_sm_cur.is_blank) _sm_cur.data = new_data;
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
		`).prependTo(this.$grid_main);

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
			this.columns = this._master_columns.filter(c => !this._hidden_col_keys.has(c.data));
		} else if (sheet._columns) {
			// Already built columns for this sheet — reuse
			this.columns = sheet._columns;
		} else {
			// Build minimal columns from doctype meta (lazy)
			frappe.model.with_doctype(sheet.doctype, () => {
				const meta = frappe.get_meta(sheet.doctype);
				const show_fields = meta.fields
					.filter((f) => !["Section Break", "Column Break", "HTML", "Table", "Tab Break"].includes(f.fieldtype))
					.slice(0, 12);

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
				this._master_columns.push(col);
			}
		});

		// Reload HOT
		this.matrix = this.data_manager.to_matrix(data, this.columns);
		this.formula_bridge.reload(this.matrix);
		this.hot.updateSettings({ columns: this.columns });
		this.hot.loadData(data);
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
		this.toolbar_component?.destroy();
		this.formula_bar_component?.destroy();
		this.status_bar?.destroy();
		this.workbook_manager?.destroy();
		this.sheet_manager?.destroy();
		this.hot?.destroy();
		this.hot = null;
		this.$wrapper?.empty();
	}
};
