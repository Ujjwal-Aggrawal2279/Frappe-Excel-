/**
 * excel_view/components/workbook_manager.js
 *
 * Saved Workbooks — V2.1
 *
 * Responsibilities:
 *   1. Serialize the current grid state into a plain config object.
 *   2. Restore a previously saved config (columns, formula cols, filters, sort).
 *   3. Persist configs to / from the `Excel Workbook` Frappe DocType via
 *      the excel_view.api whitelist endpoints.
 *   4. Bind the Save / Views toolbar buttons that toolbar.js renders.
 *
 * State saved per workbook:
 *   columns_config  — ordered [{fieldname, width} | {key, label, is_formula_col, width}]
 *   formula_columns — [{key, label, values: {doc_name: formula_or_value}}]
 *   filters         — [[doctype, fieldname, op, value], ...]  (frappe filter_area.get() format)
 *   sort_by         — {field, order}
 *
 * NOT saved (V2.1): format_store (cell styling) — row-index-based, meaningless
 * after data reload.  Will move to doc+fieldname indexing in V3.
 *
 * Usage (instantiated by ExcelBoard):
 *   this.workbook_manager = new frappe.views.excel.WorkbookManager({ board: this });
 *   this.workbook_manager.setup();          // after toolbar.setup()
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.WorkbookManager = class WorkbookManager {
	// ── Constructor ───────────────────────────────────────────────────────────

	/**
	 * @param {Object}  opts
	 * @param {Object}  opts.board - ExcelBoard instance
	 */
	constructor({ board }) {
		this.board    = board;
		// Tracks the currently loaded/saved workbook.  null = unsaved new view.
		this._current = null; // { name, title }
		this._dropdown_open = false;
	}

	// ── Setup ─────────────────────────────────────────────────────────────────

	setup() {
		this._bind_toolbar_events();
		this._auto_restore();
	}

	// ── Auto-restore last workbook on page load ────────────────────────────────

	/**
	 * If the user had a workbook loaded (or the join canvas open) before the last
	 * page refresh, silently re-apply them so the session is consistent.
	 *
	 * We defer by one tick so ExcelBoard finishes its own setup first.
	 */
	_auto_restore() {
		const settings = frappe.get_user_settings(this.board.doctype) || {};

		// Re-apply the last active workbook after the current JS call stack clears
		if (settings.excel_current_workbook?.name) {
			setTimeout(() => {
				this._load_workbook(settings.excel_current_workbook.name, /* silent */ true);
			}, 0);
		}

		// Re-open the join canvas if it was open when the page was refreshed.
		// Deferred by a slightly longer tick so the board + workbook restore settle first.
		if (settings.excel_join_canvas_open) {
			setTimeout(() => {
				this.board._open_join_canvas();
			}, 50);
		}
	}

	// ── Toolbar event binding ─────────────────────────────────────────────────

	_bind_toolbar_events() {
		const $tb = $(this.board.toolbar);

		// All toolbar events use the ".ev-wb" namespace so WorkbookManager.destroy()
		// can reliably remove them via $tb.off(".ev-wb") even when the toolbar
		// wrapper DOM element is reused across board destroy/recreate cycles.

		// Save button (left part) — quick save
		$tb.on("click.ev-wb", ".ev-wb-save-btn", (e) => {
			e.stopPropagation();
			this._close_dropdown();
			this.save();
		});

		// Dropdown arrow — "Save As..." option
		$tb.on("click.ev-wb", ".ev-wb-dropdown-arrow", (e) => {
			e.stopPropagation();
			this._toggle_dropdown();
		});

		// Dropdown items
		$tb.on("click.ev-wb", ".ev-wb-dd-item", (e) => {
			const action = $(e.currentTarget).data("action");
			this._close_dropdown();
			if (action === "save_as") this.save_as();
		});

		// Deselect button — clear active workbook
		$tb.on("click.ev-wb", ".ev-wb-deselect-btn", (e) => {
			e.stopPropagation();
			this._deselect();
		});

		// Views button — open load dialog
		$tb.on("click.ev-wb", ".ev-wb-views-btn", (e) => {
			e.stopPropagation();
			this._close_dropdown();
			this.open_views_dialog();
		});

		// Close dropdown on outside click
		$(document).on("click.ev-wb", () => this._close_dropdown());
	}

	_toggle_dropdown() {
		const $dd = $(this.board.toolbar).find(".ev-wb-dropdown");
		this._dropdown_open = !this._dropdown_open;
		$dd.toggleClass("hide", !this._dropdown_open);
	}

	_close_dropdown() {
		$(this.board.toolbar).find(".ev-wb-dropdown").addClass("hide");
		this._dropdown_open = false;
	}

	// ── Save flow ─────────────────────────────────────────────────────────────

	/**
	 * Quick-save: auto-saves if a workbook is already loaded, otherwise prompts.
	 */
	save() {
		if (this._current) {
			this._persist(this._current.name, this._current.title);
		} else {
			this._prompt_title((title, is_public) => {
				this._persist(null, title, is_public);
			});
		}
	}

	/**
	 * Always prompts for a new title — "Save As..." behaviour.
	 */
	save_as() {
		this._prompt_title((title, is_public) => {
			this._persist(null, title, is_public);
		}, this._current?.title);
	}

	/**
	 * Save the current grid state (including any active join config) under a
	 * given title, without prompting.  Called by JoinCanvas after Apply.
	 *
	 * @param {string}  title     - name shown in the Views list
	 * @param {number}  is_public - 1 = shared with everyone, 0 = private
	 */
	save_titled(title, is_public = 0) {
		this._persist(null, title, is_public ? 1 : 0);
	}

	_prompt_title(on_confirm, default_title = "") {
		frappe.prompt(
			[
				{
					fieldtype: "Data",
					fieldname: "title",
					label: __("View Name"),
					reqd: 1,
					default: default_title,
				},
				{
					fieldtype: "Check",
					fieldname: "is_public",
					label: __("Share with everyone"),
					default: 0,
				},
			],
			({ title, is_public }) => on_confirm(title, is_public),
			__("Save View"),
			__("Save"),
		);
	}

	/** Serialise current state and send to server. */
	_persist(workbook_name, title, is_public = 0) {
		const config = this.get_config();

		frappe.call({
			method: "excel_view.api.save_workbook",
			args: {
				title,
				doctype_name:    this.board.doctype,
				columns_config:  JSON.stringify(config.columns_config),
				formula_columns: JSON.stringify(config.formula_columns),
				filters:         JSON.stringify(config.filters),
				sort_by:         JSON.stringify(config.sort_by),
				join_config:     JSON.stringify(config.join_config),
				sheets:          JSON.stringify(config.sheets),
				chart_overlays:  JSON.stringify(config.chart_overlays),
				format_store:    JSON.stringify(config.format_store),
				cond_fmt_rules:  JSON.stringify(config.cond_fmt_rules),
				view_state:      JSON.stringify({ freeze_cols: config.freeze_cols, freeze_rows: config.freeze_rows, hide_gridlines: config.hide_gridlines }),
				is_public:       is_public ? 1 : 0,
				workbook_name:   workbook_name || null,
			},
			freeze: false,
			callback: (r) => {
				const saved = r.message;
				this._current = { name: saved.name, title: saved.title };
				this._update_save_label(saved.title);
				this._save_current_to_user_settings(saved.name, saved.title);
				this.board._mark_saved?.();
				frappe.show_alert(
					{ message: __('View "{0}" saved', [saved.title]), indicator: "green" },
					3,
				);
			},
			error: () => {
				frappe.show_alert(
					{ message: __("Failed to save view"), indicator: "red" },
					3,
				);
			},
		});
	}

	// ── Load flow ─────────────────────────────────────────────────────────────

	/**
	 * Open the "Open View" dialog listing all workbooks for the current DocType.
	 */
	open_views_dialog() {
		frappe.call({
			method: "excel_view.api.get_workbooks",
			args: { doctype_name: this.board.doctype },
			callback: (r) => this._show_views_dialog(r.message || []),
		});
	}

	_show_views_dialog(workbooks) {
		const me   = this;
		const user = frappe.session.user;

		const mine   = workbooks.filter(w => w.owner === user);
		const shared = workbooks.filter(w => w.owner !== user && w.is_public);

		// Mark the currently loaded workbook with a checkmark
		const row_html = (w) => {
			const is_current = me._current?.name === w.name;
			return `
			<div class="ev-wb-row${is_current ? " ev-wb-row--active" : ""}"
				data-name="${frappe.utils.escape_html(w.name)}">
				${is_current
					? `<span class="ev-wb-active-check" title="${__("Currently loaded")}">✓</span>`
					: `<svg class="ev-wb-row-icon" width="13" height="13" viewBox="0 0 16 16"
							fill="currentColor" aria-hidden="true">
							<rect x="1" y="1" width="4" height="14" rx="1"/>
							<rect x="6" y="1" width="4" height="14" rx="1"/>
							<rect x="11" y="1" width="4" height="14" rx="1"/>
						</svg>`}
				<span class="ev-wb-row-title">${frappe.utils.escape_html(w.title)}</span>
				<span class="ev-wb-row-date">${frappe.datetime.prettyDate(w.modified)}</span>
				${w.owner === user
					? `<button class="ev-wb-row-del btn btn-xs"
							data-name="${frappe.utils.escape_html(w.name)}"
							title="${__("Delete")}">✕</button>`
					: `<span class="ev-wb-row-shared">${__("shared")}</span>`}
			</div>`;
		};

		let body_html = "";
		if (mine.length) {
			body_html += `<div class="ev-wb-section-label">${__("My Views")}</div>
				<div class="ev-wb-list">${mine.map(row_html).join("")}</div>`;
		}
		if (shared.length) {
			body_html += `<div class="ev-wb-section-label">${__("Shared Views")}</div>
				<div class="ev-wb-list">${shared.map(row_html).join("")}</div>`;
		}
		if (!body_html) {
			body_html = `<div class="ev-wb-empty">
				${__("No saved views yet for {0}.", [this.board.doctype])}
				<br><small>${__('Click "Save View" in the toolbar to create one.')}</small>
			</div>`;
		}

		const d = new frappe.ui.Dialog({
			title:               __("Open View — {0}", [this.board.doctype]),
			fields:              [{ fieldtype: "HTML", fieldname: "wb_list", options: body_html }],
			primary_action_label: __("Close"),
			primary_action()     { d.hide(); },
		});

		// Use d.$body — the correct Frappe Dialog property for the modal body element.
		// d.$wrapper.find(".frappe-dialog-body") can be empty before show(); d.$body is reliable.
		const $body = d.$body;

		// Load on row click (but not on delete button or its children)
		$body.on("click", ".ev-wb-row", function (e) {
			if ($(e.target).closest(".ev-wb-row-del").length) return;
			const name = $(this).data("name");
			d.hide();
			me._load_workbook(name);
		});

		// Delete
		$body.on("click", ".ev-wb-row-del", function (e) {
			e.stopPropagation();
			const name  = $(this).data("name");
			const title = $(this).closest(".ev-wb-row").find(".ev-wb-row-title").text();
			frappe.confirm(
				__('Delete view "{0}"?', [title]),
				() => {
					frappe.call({
						method:   "excel_view.api.delete_workbook",
						args:     { name },
						callback: () => {
							$(this).closest(".ev-wb-row").remove();
							frappe.show_alert(
								{ message: __("View deleted"), indicator: "green" }, 2,
							);
							if (me._current?.name === name) {
								me._current = null;
								me._update_save_label(null);
								me._save_current_to_user_settings(null, null);
							}
						},
					});
				},
			);
		});

		d.show();
	}

	/** Fetch full workbook doc then apply its config.
	 *  @param {string}  name   - Excel Workbook doc name
	 *  @param {boolean} silent - if true, suppress the "loaded" alert (used on auto-restore)
	 */
	_load_workbook(name, silent = false) {
		frappe.call({
			method:   "excel_view.api.load_workbook",
			args:     { name },
			callback: (r) => {
				const wb = r.message;

				// Workbook was deleted externally — clear stale reference and bail out
				if (wb?.not_found) {
					if (this._current?.name === name) {
						this._current = null;
						this._update_save_label(null);
					}
					this._save_current_to_user_settings(null, null);
					if (!silent) {
						frappe.show_alert(
							{ message: __("This view no longer exists"), indicator: "orange" },
							4,
						);
					}
					return;
				}

				const _vs = this._parse_json(wb.view_state, {});
				const config = {
					columns_config:  this._parse_json(wb.columns_config,  []),
					formula_columns: this._parse_json(wb.formula_columns, []),
					filters:         this._parse_json(wb.filters,         []),
					sort_by:         this._parse_json(wb.sort_by,         {}),
					join_config:     this._parse_json(wb.join_config,     null),
					sheets:          this._parse_json(wb.sheets,          null),
					chart_overlays:  this._parse_json(wb.chart_overlays,  []),
					format_store:    this._parse_json(wb.format_store,    {}),
					cond_fmt_rules:  this._parse_json(wb.cond_fmt_rules,  []),
					freeze_cols:     _vs.freeze_cols  || 0,
					freeze_rows:     _vs.freeze_rows  || 0,
					hide_gridlines:  _vs.hide_gridlines || false,
				};

				this._current = { name: wb.name, title: wb.title };
				this._update_save_label(wb.title);

				// Persist so the workbook survives a page refresh
				this._save_current_to_user_settings(wb.name, wb.title);

				// apply_config is async — await so filter+sort settle before refresh
				this.apply_config(config).then(() => {
					if (!silent) {
						frappe.show_alert(
							{ message: __('View "{0}" loaded', [wb.title]), indicator: "green" },
							3,
						);
					}
				});
			},
		});
	}

	/** Persist current workbook ref to user_settings (survives page refresh). */
	_save_current_to_user_settings(name, title) {
		frappe.model.user_settings.save(
			this.board.doctype,
			"excel_current_workbook",
			name ? { name, title } : null,
		);
	}

	// ── Serialise current state ───────────────────────────────────────────────

	/**
	 * Capture the complete grid state as a plain JSON-serialisable object.
	 *
	 * columns_config: ordered array of column descriptors.
	 *   Regular field: { fieldname, width }
	 *   Formula col:   { key, label, is_formula_col: true, width }
	 *
	 * formula_columns: per-doc values for formula columns (keyed by doc.name
	 *   so they survive row reordering / re-pagination on restore).
	 *   [{ key, label, values: { "DOC-001": "=B1*0.18", ... } }]
	 *
	 * filters: filter_area.get() format — [[doctype, fieldname, op, value], ...]
	 *
	 * sort_by: { field, order } from list_view.sort_by / sort_order.
	 */
	get_config() {
		const board  = this.board;
		const plugin = board.hot?.getPlugin("manualColumnResize");

		// ── columns_config ─────────────────────────────────────────────────
		// Join columns (_is_join_col) are intentionally excluded: they are not
		// Frappe fieldnames and cannot be passed to apply_field_selection().
		// They are re-added automatically after refresh via _reapply_join_from_config().
		const columns_config = board.columns.map((col, i) => {
			// HOT 6.2.2: widths stored in plugin.manualColumnWidths[] by physical index
			const phys_i = board.hot?.toPhysicalColumn ? board.hot.toPhysicalColumn(i) : i;
			const width = plugin?.manualColumnWidths?.[phys_i] ?? col.width ?? 140;
			if (col._is_formula_col) {
				return { key: col.data, label: col.title, is_formula_col: true, width };
			}
			if (col._is_join_col) return null; // excluded — restored via join_config
			// Meta column: save as special marker with its actual width.
			// apply_config will expand it to the 4 underlying fields for the server
			// query, then call _inject_meta_column() to re-group them.
			if (col._is_meta_col) {
				return { fieldname: "_meta", width, is_meta_col: true };
			}
			return { fieldname: col.data, width };
		}).filter(Boolean);

		// ── formula_columns ────────────────────────────────────────────────
		// Save per-row values keyed by doc name so they survive data reload.
		const formula_columns = board.columns
			.filter(col => col._is_formula_col)
			.map(col => {
				const values = {};
				(board.list_view.data || []).forEach(row => {
					const v = row[col.data];
					if (v != null && v !== "") values[row.name] = v;
				});
				return { key: col.data, label: col.title, values };
			});

		// ── filters ────────────────────────────────────────────────────────
		// filter_area.get() returns filter objects; normalise to [dt, field, op, value] arrays.
		let filters = [];
		try {
			filters = (board.list_view.filter_area?.get() ?? [])
				.map(f => Array.isArray(f) ? f.slice(0, 4) : f);
		} catch (_) { /* filter_area may not exist in all contexts */ }

		// ── sort_by ────────────────────────────────────────────────────────
		const sort_by = {
			field: board.list_view.sort_by    || "modified",
			order: board.list_view.sort_order || "desc",
		};

		// ── join_config ────────────────────────────────────────────────
		// Include the last applied IntelliFlow join config if one exists.
		// board._last_join_config is set by _apply_join_result() and persists
		// until the board is destroyed or a new workbook deselected.
		const join_config = this.board._last_join_config || null;

		// ── sheets (V2.5) ──────────────────────────────────────────────
		// Save current base-sheet columns into sheet_manager before serializing
		const sm = this.board.sheet_manager;
		const current_sheet = sm?.get_current();
		const is_blank_sheet = current_sheet?.is_blank === true;
		// Skip save for blank sheets — their A-Z columns must not overwrite the
		// base sheet's real Frappe fieldname config in sheet_manager.
		if (sm && !is_blank_sheet) {
			sm.save_current_columns(columns_config, formula_columns, filters, sort_by);
		}
		const sheets = sm ? sm.serialize() : null;
		// When on a blank sheet, board.columns are A-Z dummies. Use the base
		// sheet's real fieldname config for the root-level columns_config so
		// apply_config → apply_field_selection gets proper Frappe fieldnames.
		let root_columns_config = columns_config;
		if (is_blank_sheet) {
			const base_sheet = sm?.get_all()?.[0];
			if (base_sheet?.columns_config?.length) {
				root_columns_config = base_sheet.columns_config;
			}
		}

		// ── chart_overlays (V2.6) ──────────────────────────────────────────
		const chart_overlays = (this.board.chart_overlays || []).map((c) => ({ ...c }));

		// ── cell formatting + conditional formatting (V2.6) ────────────────
		const format_store   = { ...this.board.format_store };
		const cond_fmt_rules = [...(this.board.cond_fmt_rules || [])];
		// V3.1 — Encode hidden_rows + manual row_heights inside format_store
		// (no DocType schema change needed; __ prefix avoids collision with cell keys)
		const plugin_rh = board.hot?.getPlugin("manualRowResize");
		if (board._hidden_rows?.length) format_store.__hidden_rows = [...board._hidden_rows];
		const _rh_arr = plugin_rh?.manualRowHeights ? [...plugin_rh.manualRowHeights] : [];
		if (_rh_arr.some(h => h != null)) format_store.__row_heights = _rh_arr;

		// ── View tab state (V2.6) ───────────────────────────────────────────
		const freeze_cols    = this.board._frozen_cols || 0;
		const freeze_rows    = this.board._frozen_rows || 0;
		const hide_gridlines = this.board.$hot_container?.hasClass("ev-hide-gridlines") || false;

		return { columns_config: root_columns_config, formula_columns, filters, sort_by, join_config, sheets, chart_overlays, format_store, cond_fmt_rules, freeze_cols, freeze_rows, hide_gridlines };
	}

	// ── Restore state from config ─────────────────────────────────────────────

	/**
	 * Apply a workbook config to the live board.
	 *
	 * Returns a Promise so callers can await full completion.
	 *
	 * Sequence:
	 *   1. Rebuild HOT columns from saved field list.
	 *   2. Re-add formula columns + inject saved per-row values.
	 *   3. Apply column widths.
	 *   4. Await filter restoration (async — must complete before refresh).
	 *   5. Set sort config.
	 *   6. Force-refresh: bypass no_change throttle + fetch with new filters/sort.
	 */
	async apply_config(config) {
		const board = this.board;

		// ── 1. Regular field columns ───────────────────────────────────────
		// Use silent:true to suppress the implicit list_view.refresh() inside
		// apply_field_selection.  apply_config's own step-6 refresh is the
		// single authoritative fetch; two concurrent refreshes create a race
		// condition where the second board.refresh() wipes joined-row values.
		const META_AUDIT_FIELDS = ["owner", "creation", "modified_by", "modified"];
		const has_meta_col = (config.columns_config || []).some(c => c.is_meta_col);
		const regular_fieldnames = (config.columns_config || [])
			.filter(c => !c.is_formula_col)
			.flatMap(c => c.is_meta_col ? META_AUDIT_FIELDS : [c.fieldname])
			.filter(Boolean);

		if (regular_fieldnames.length) {
			board.apply_field_selection(regular_fieldnames, { silent: true });
		}

		// Re-inject meta column if the saved config had one
		if (has_meta_col) {
			board._inject_meta_column();
			board.hot.updateSettings({ columns: board.columns });
		}

		// ── 2. Re-add formula columns ──────────────────────────────────────
		(config.formula_columns || []).forEach(fc => {
			(board.list_view.data || []).forEach(row => {
				row[fc.key] = fc.values?.[row.name] ?? "";
			});
			const new_col = {
				data:            fc.key,
				title:           fc.label,
				type:            "text",
				width:           140,
				_is_formula_col: true,
			};
			board.columns.push(new_col);
			board._master_columns.push(new_col);
		});

		if ((config.formula_columns || []).length) {
			board.matrix = board.data_manager.to_matrix(board.list_view.data, board.columns);
			board.formula_bridge.reload(board.matrix);
			board.hot.updateSettings({ columns: board.columns });
		}

		// ── 3. Column widths ───────────────────────────────────────────────
		// Build key→width map from saved config, then apply by matching actual
		// board.columns (so meta col and any reordering are handled correctly).
		const plugin = board.hot?.getPlugin("manualColumnResize");
		if (plugin) {
			const width_map = {};
			(config.columns_config || []).forEach(cfg => {
				if (cfg.width && cfg.fieldname) width_map[cfg.fieldname] = cfg.width;
				if (cfg.width && cfg.key) width_map[cfg.key] = cfg.width;
			});
			board.columns.forEach((col, vis_i) => {
				const w = width_map[col.data];
				if (w) plugin.setManualSize(vis_i, w);
			});
		}

		// ── 4. Filters — MUST complete before calling refresh ──────────────
		// Strategy: clear → set → then force-refresh.
		// We null out last_args so no_change() never throttles a workbook load
		// (e.g. if the user just cleared filters and the args are identical).
		const fa = board.list_view.filter_area;
		if (fa) {
			try {
				await fa.clear(false);
				fa.filter_list?.update_filter_button?.();
			} catch (err) {
				console.error("[WorkbookManager] filter_area.clear failed:", err);
			}

			if ((config.filters || []).length) {
				try {
					await fa.set(config.filters);
				} catch (err) {
					// filter_area.set failed — fall back to direct filter_list insertion
					console.error("[WorkbookManager] filter_area.set failed, using fallback:", err);
					try {
						const non_std = config.filters.filter(f => {
							const condition = f[2];
							return !(condition === "=" || condition === "like");
						});
						if (non_std.length) {
							await fa.filter_list.add_filters(non_std);
						}
						const std = config.filters.filter(f => {
							const condition = f[2];
							const fieldname = f[1];
							return (condition === "=" || condition === "like")
								&& board.list_view.page.fields_dict[fieldname];
						});
						for (const f of std) {
							const ctrl = board.list_view.page.fields_dict[f[1]];
							if (ctrl) await ctrl.set_value(f[3]);
						}
					} catch (fb_err) {
						console.error("[WorkbookManager] filter fallback also failed:", fb_err);
					}
				}
			}
		}

		// ── 5. Sort ────────────────────────────────────────────────────────
		if (config.sort_by?.field) {
			board.list_view.sort_by    = config.sort_by.field;
			board.list_view.sort_order = config.sort_by.order || "desc";
		}

		// ── 6. Force-refresh — bypass the 3-second no_change throttle ──────
		// BaseList.no_change() compares JSON-stringified args to last_args.
		// If the user just cleared filters (identical args), the refresh is
		// silently skipped.  Nulling last_args forces a fresh fetch every time
		// a workbook is loaded.

		// If this workbook has a join config, schedule re-apply after the next
		// board.refresh() call (which fires when the server returns data).
		// _pending_join_config is consumed by ExcelBoard.refresh() exactly once.
		if (config.join_config?.edges?.length) {
			board._pending_join_config = config.join_config;
		}

		board.list_view.last_args = null;
		board.list_view.start = 0;
		board.list_view.refresh();

		// ── 7. Restore sheet tabs (V2.5) ─────────────────────────────────────────
		// Deferred so list_view.refresh() gets its async fetch in flight first.
		if (config.sheets?.length) {
			setTimeout(() => board.sheet_manager?.restore(config.sheets), 50);
		}

		// ── 8. Restore chart overlays (V2.6) ──────────────────────────────────────
		if (config.chart_overlays?.length) {
			setTimeout(() => board._restore_chart_overlays(config.chart_overlays), 100);
		}

		// ── 9. Restore cell formatting + CF rules (V2.6) ───────────────────────────
		if (config.format_store && typeof config.format_store === "object") {
			// V3.1 — Extract __meta keys (hidden_rows + row_heights) from format_store
			const { __hidden_rows, __row_heights, ...cell_formats } = config.format_store;
			board.format_store = cell_formats;
			frappe.model.user_settings.save(board.doctype, "excel_format_store", board.format_store);
			// Restore hidden rows
			if (Array.isArray(__hidden_rows) && __hidden_rows.length) {
				board._hidden_rows = [...__hidden_rows];
				frappe.model.user_settings.save(board.doctype, "excel_hidden_rows", board._hidden_rows);
			}
			// Restore manual row heights
			if (Array.isArray(__row_heights) && __row_heights.some(h => h != null)) {
				setTimeout(() => {
					const rh_plugin = board.hot?.getPlugin("manualRowResize");
					if (rh_plugin) {
						rh_plugin.manualRowHeights = [...__row_heights];
						board.hot.render();
						frappe.model.user_settings.save(board.doctype, "excel_row_heights", __row_heights);
					}
				}, 0);
			}
		}
		if (Array.isArray(config.cond_fmt_rules) && config.cond_fmt_rules.length) {
			board.cond_fmt_rules = config.cond_fmt_rules;
			board._clear_cf_cache?.();
			frappe.model.user_settings.save(board.doctype, "excel_cf_rules", board.cond_fmt_rules);
		}
		if (config.format_store || config.cond_fmt_rules?.length) {
			setTimeout(() => board.hot?.render(), 150);
		}

		// ── 10. Restore View tab state (V2.6) ──────────────────────────────────────
		if (config.freeze_cols > 0) {
			setTimeout(() => board._set_freeze?.(config.freeze_cols), 50);
		}
		if (config.freeze_rows > 0) {
			board._frozen_rows = config.freeze_rows;
			frappe.model.user_settings.save(board.doctype, "excel_view_freeze_rows", config.freeze_rows);
			setTimeout(() => { board.hot?.updateSettings({ fixedRowsTop: config.freeze_rows }); board.hot?.render(); }, 80);
		}
		if (config.hide_gridlines) {
			board.$hot_container?.addClass("ev-hide-gridlines");
			frappe.model.user_settings.save(board.doctype, "excel_hide_gridlines", true);
		}
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	/** Update the Save button label + show/hide the deselect × button. */
	_update_save_label(title) {
		const $tb = $(this.board.toolbar);
		$tb.find(".ev-wb-save-label").text(
			title
				? (title.length > 22 ? title.slice(0, 20) + "…" : title)
				: __("Save View"),
		);
		// Show × only when a workbook is active
		$tb.find(".ev-wb-deselect-btn").toggleClass("hide", !title);
	}

	/**
	 * Deselect the active workbook and reset grid to its default state:
	 *   - Label → "Save View"
	 *   - Columns → all doctype fields (list_view.fields = _get_all_meta_fields)
	 *   - Filters → cleared
	 *   - Refresh → fresh fetch with no filters
	 *
	 * Strategy: destroy the current board entirely so that the next render()
	 * call creates a fresh ExcelBoard from list_view.fields.  This avoids
	 * fighting HOT 6.x's internal column-count tracking (updateSettings alone
	 * does not reliably resize the <colgroup> after loadData).
	 *
	 * The toolbar / formula-bar DOM wrappers are owned by ExcelView (setup_view)
	 * and survive the board destroy; the new board re-renders into them.
	 */
	async _deselect() {
		const board     = this.board;
		const list_view = board.list_view; // save ref — board is about to be destroyed

		// 1. Clear user-settings LOCAL CACHE synchronously so the new board's
		//    _auto_restore() reads null immediately.
		//
		//    IMPORTANT: frappe.model.user_settings.save() compares old vs new JSON
		//    and skips the server call when they are identical.  If we update the
		//    in-memory cache first and THEN call save(), save() sees no diff and
		//    never reaches the server — so the workbook name survives a page refresh.
		//
		//    Fix: build the cleared object, write it to the in-memory cache, then
		//    call frappe.model.user_settings.update() DIRECTLY (bypasses the no-change
		//    guard) to force a single server POST with all cleared keys at once.
		this._current = null;
		const dt = board.doctype;
		const cleared = Object.assign({}, frappe.model.user_settings[dt] || {}, {
			excel_current_workbook: null,
			excel_format_store:     null,
			excel_cf_rules:         null,
			excel_view_freeze:      0,
			excel_view_freeze_rows: 0,
			excel_hide_gridlines:   false,
			excel_chart_overlays:   [],
			// V3.1 — clear hidden rows, row heights, and column widths on deselect
			excel_hidden_rows:      [],
			excel_row_heights:      [],
			excel_columns:          null,
		});
		frappe.model.user_settings[dt] = cleared; // commit synchronous clear

		// Single server POST — bypasses the save() no-change guard
		frappe.model.user_settings.update(dt, cleared);

		// 2. Clear filters
		const fa = list_view.filter_area;
		if (fa) {
			try {
				await fa.clear(false);
				fa.filter_list?.update_filter_button?.();
			} catch (err) {
				console.error("[WorkbookManager] deselect clear failed:", err);
			}
		}

		// 3. Restore the default list_view.fields.
		//    apply_field_selection() (called from apply_config) overwrites
		//    list_view.fields with only the workbook's columns.  Without this
		//    restore the freshly-created board would show only those columns.
		if (board._default_list_view_fields?.length) {
			list_view.fields = [...board._default_list_view_fields];
		}

		// 4. Destroy the board so render() recreates it with default columns.
		//    Set excel_board = null first — render() checks this to decide
		//    whether to create a new board or call board.refresh().
		list_view.excel_board = null;
		board.destroy(); // clears HOT, toolbar inner HTML, formula bar, event handlers

		// 5. Force-refresh — bypass no_change throttle
		list_view.last_args = null;
		list_view.start = 0;
		list_view.refresh();
	}

	_parse_json(str, fallback) {
		try {
			return str ? JSON.parse(str) : fallback;
		} catch (_) {
			return fallback;
		}
	}

	destroy() {
		$(document).off("click.ev-wb");
		$(this.board.toolbar).off(".ev-wb");
	}
};
