/**
 * excel_view/components/child_table_manager.js  —  V3.5
 *
 * Inline child-table panel for the Excel View grid.
 * All writes go through parent_doc.save() ORM path via save_child_table_bulk.
 * Deletes are queued alongside edits — one transaction, validation passes.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.ChildTableManager = class ChildTableManager {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.board - ExcelBoard instance
	 */
	constructor(opts) {
		this.board = opts.board;
		this._state = null;    // null when collapsed
		this._$panel = null;

		// Edit queue: { child_name_or_temp: { fieldname: val } }
		this._save_queue = {};
		// Delete queue: Set of child_name strings pending removal
		this._delete_queue = new Set();
		this._dirty = false;

		this._meta_cache = {};
		this._badge_cache = {};
		// col visibility prefs: fieldname → Set<fieldname>
		this._col_prefs = {};
		this._chooser_close_handler = null;

		this._tabs = this._resolve_tabs();
		this._after_render_bound = this._on_after_render.bind(this);
		this.board.hot?.addHook("afterRender", this._after_render_bound);
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/** Returns true if the board's doctype has at least one child table. */
	has_child_tables() { return this._tabs.length > 0; }

	/**
	 * Toggle expand / collapse for the given parent HOT row index.
	 * Collapses any currently-open panel first (single-expansion guarantee).
	 * @param {number} row_idx
	 */
	async toggle(row_idx) {
		if (this._state?.parent_row_idx === row_idx) {
			this.collapse();
		} else {
			this.collapse();
			await this._expand(row_idx);
		}
	}

	/**
	 * Collapse the currently expanded panel (no-op if nothing is expanded).
	 * Safe to call multiple times.
	 */
	collapse() {
		if (!this._state) return;
		if (this._dirty) this._save_all();
		this._remove_spacer();
		this._destroy_panel();
		this._state = null;
		this.board.hot?.render();
	}

	/**
	 * Called by ExcelBoard.refresh() before new data is loaded.
	 * Collapse without flushing saves (data will be stale anyway).
	 */
	collapse_silent() {
		if (!this._state) return;
		this._remove_spacer();
		this._destroy_panel();
		this._state = null;
	}

	/**
	 * Reposition the panel after HOT re-renders.
	 * Hooked into afterRender — called on every scroll / filter / refresh.
	 */
	_on_after_render() {
		if (!this._state || !this._$panel) return;
		this._reposition_panel();
	}

	/**
	 * Returns the spacer height for a given HOT row index.
	 * Integrated into ExcelBoard's rowHeights callback.
	 * @param {number} row_idx
	 * @returns {number|undefined}
	 */
	spacer_height_for_row(row_idx) {
		const d = this.board.list_view?.data?.[row_idx];
		if (d?._is_ct_spacer) return d._ct_spacer_h || 0;
		return undefined;
	}

	/** Cleanup: remove panel, spacer, listeners, queued timers. */
	destroy() {
		this._save_queue = {};
		this._delete_queue.clear();
		this.collapse_silent();
		if (this._after_render_bound && this.board.hot) {
			this.board.hot.removeHook("afterRender", this._after_render_bound);
		}
		this._$panel?.remove();
		this._$panel = null;
	}

	// ── Expand / Collapse internals ───────────────────────────────────────────

	async _expand(row_idx) {
		const data = this.board.list_view.data;
		const doc = data[row_idx];
		if (!doc || doc._is_ct_spacer || doc._is_new || !doc.name) return;
		if (!this._tabs.length) return;

		this._state = {
			parent_row_idx: row_idx,
			parent_name:    doc.name,
			tabs:           this._tabs,
			active_tab:     this._tabs[0].fieldname,
			rows_by_tab:    new Map(),
			loading_tabs:   new Set(),
		};
		this._insert_spacer(row_idx, _PANEL_MIN_HEIGHT);
		this._create_panel();
		this._render_panel_skeleton();
		this._reposition_panel();
		await this._load_tab(this._tabs[0].fieldname);
	}

	// ── Tab loading ───────────────────────────────────────────────────────────

	async _load_tab(fieldname) {
		if (!this._state) return;
		const state = this._state;
		state.active_tab = fieldname;

		// Already cached — just re-render
		if (state.rows_by_tab.has(fieldname)) {
			this._render_panel_content();
			return;
		}

		state.loading_tabs.add(fieldname);
		this._render_panel_skeleton();

		try {
			const payload = await this._ev_call(
				"excel_view.api.get_child_rows",
				{
					doctype:         this.board.doctype,
					parent_name:     state.parent_name,
					child_fieldname: fieldname,
				},
				__("Loading {0}", [this._tab_label(fieldname)])
			);

			if (!this._state || this._state.parent_name !== state.parent_name) return;

			state.rows_by_tab.set(fieldname, {
				child_doctype:         payload.child_doctype,
				fields:                payload.fields,
				rows:                  payload.rows,
				parent_docstatus:      payload.parent_docstatus     ?? 0,
				table_allow_on_submit: payload.table_allow_on_submit ?? false,
			});
			this._badge_cache[fieldname] = payload.rows.length;
		} catch (err) {
			if (!this._state) return;
			state.loading_tabs.delete(fieldname);
			return;
		}

		state.loading_tabs.delete(fieldname);
		this._update_spacer_height();
		this._render_panel_content();
		this._reposition_panel();
	}

	_switch_tab(fieldname) {
		if (!this._state || this._state.active_tab === fieldname) return;
		this._close_col_chooser();
		if (this._dirty) this._save_all();
		this._load_tab(fieldname);
	}

	// ── Panel DOM ─────────────────────────────────────────────────────────────

	_create_panel() {
		this._destroy_panel();
		this._$panel = $(`<div class="ev-ct-panel" role="region" aria-label="${frappe.utils.escape_html(__("Child table panel"))}"></div>`);
		this._$panel.css({ position: "absolute", left: 0, right: 0, "z-index": 20 });
		this.board.$hot_container.append(this._$panel);

		this._$panel
			.on("click.ev-ct", ".ev-ct-tab", (e) => {
				const fn = $(e.currentTarget).data("fieldname");
				if (fn) this._switch_tab(fn);
			})
			.on("click.ev-ct", ".ev-ct-add-btn", () => this._add_row())
			.on("click.ev-ct", ".ev-ct-save-all-btn", () => this._save_all())
			.on("click.ev-ct", ".ev-ct-delete-btn", (e) => {
				const name = $(e.currentTarget).closest("tr").data("child-name");
				if (name) this._queue_delete(name);
			})
			.on("click.ev-ct", ".ev-ct-undo-delete-btn", (e) => {
				const name = $(e.currentTarget).closest("tr").data("child-name");
				if (name) this._unqueue_delete(name);
			})
			.on("click.ev-ct", ".ev-ct-discard-btn", (e) => {
				const name = $(e.currentTarget).closest("tr").data("child-name");
				if (name) this._discard_new_row(name);
			})
			.on("click.ev-ct", ".ev-ct-col-chooser-btn", (e) => {
				this._open_col_chooser(e.currentTarget);
			})
			.on("click.ev-ct", ".ev-ct-collapse-btn", () => this.collapse())
			.on("mousedown.ev-ct", ".ev-ct-resize-handle", (e) => this._start_resize(e))
			// V3.5 — Rich-text / HTML field: open editor modal
			.on("click.ev-ct", ".ev-ct-rich-edit-btn", (e) => {
				const $td        = $(e.currentTarget).closest("td.ev-ct-td--rich");
				const $tr        = $td.closest("tr.ev-ct-tr");
				const child_name = $tr.data("child-name");
				const fieldname  = e.currentTarget.dataset.fieldname;
				const fieldtype  = e.currentTarget.dataset.fieldtype;
				const label      = e.currentTarget.dataset.label;
				const current    = $td.find(".ev-ct-rich-preview").html() || "";
				this._open_rich_editor(child_name, fieldname, fieldtype, label, current);
			});

		// V3.5 — Stop scroll from bubbling to HOT grid when panel table can still scroll
		this._$panel[0].addEventListener("wheel", (e) => {
			const wrap = this._$panel[0].querySelector(".ev-ct-table-wrap");
			if (!wrap) return;
			const down = e.deltaY > 0;
			const can  = down
				? wrap.scrollTop + wrap.clientHeight < wrap.scrollHeight
				: wrap.scrollTop > 0;
			if (can) e.stopPropagation();
		}, { passive: true });
	}

	// ── Resize handle drag ────────────────────────────────────────────────────

	_start_resize(e) {
		e.preventDefault();
		const start_y      = e.clientY;
		const start_height = this._$panel?.[0]?.offsetHeight ?? _PANEL_MIN_HEIGHT;

		const on_move = (mv) => {
			if (!this._$panel) return;
			const new_h = Math.min(Math.max(start_height + (mv.clientY - start_y), _PANEL_MIN_HEIGHT), _PANEL_MAX_HEIGHT);
			this._$panel.css("height", new_h + "px");

			// Keep spacer row in sync so HOT reserves the right space
			const data   = this.board.list_view.data;
			const spacer = data.find(d => d._is_ct_spacer);
			if (spacer) {
				spacer._ct_spacer_h = new_h;
				this.board.hot?.render();
			}
		};

		const on_up = () => {
			$(document).off("mousemove.ev-ct-resize mouseup.ev-ct-resize");
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
		};

		document.body.style.cursor    = "ns-resize";
		document.body.style.userSelect = "none";
		$(document)
			.on("mousemove.ev-ct-resize", on_move)
			.on("mouseup.ev-ct-resize", on_up);
	}

	_destroy_panel() {
		if (!this._$panel) return;
		$(document).off("mousemove.ev-ct-resize mouseup.ev-ct-resize");
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
		this._$panel.off(".ev-ct").remove();
		this._$panel = null;
	}

	_render_panel_skeleton() {
		if (!this._$panel || !this._state) return;
		const { tabs, active_tab } = this._state;

		this._$panel.html(`
			<div class="ev-ct-header">
				<div class="ev-ct-header-strip">
					${this._build_tab_strip_html(tabs, active_tab)}
					<button class="ev-ct-col-chooser-btn" title="${frappe.utils.escape_html(__("Choose columns"))}">
						<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
							<path d="M0 2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 12.5V5a1 1 0 0 1-1-1V2zm2 3v7.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V5H2zm13-3H1v2h14V2z"/>
						</svg>
					</button>
					<button class="ev-ct-collapse-btn" title="${frappe.utils.escape_html(__("Collapse"))}">
						<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
							<path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
						</svg>
					</button>
				</div>
			</div>
			<div class="ev-ct-body ev-ct-body--loading">
				<div class="ev-ct-skeleton">
					<div class="ev-ct-sk-row ev-ct-sk-row--header"></div>
					<div class="ev-ct-sk-row"></div>
					<div class="ev-ct-sk-row"></div>
					<div class="ev-ct-sk-row ev-ct-sk-row--faded"></div>
				</div>
			</div>
			<div class="ev-ct-resize-handle" title="${frappe.utils.escape_html(__("Drag to resize"))}"></div>
		`);
	}

	_render_panel_content() {
		if (!this._$panel || !this._state) return;
		const { tabs, active_tab, rows_by_tab } = this._state;
		const tab_data = rows_by_tab.get(active_tab);
		if (!tab_data) { this._render_panel_skeleton(); return; }

		const can_write    = this.board.list_view.can_write;
		const { can_add_delete, is_submitted, is_cancelled } = this._get_submit_flags(tab_data);
		const visible_fields = this._get_visible_fields(tab_data.fields, active_tab);

		this._$panel.html(`
			<div class="ev-ct-header">
				<div class="ev-ct-header-strip">
					${this._build_tab_strip_html(tabs, active_tab)}
					<button class="ev-ct-col-chooser-btn" title="${frappe.utils.escape_html(__("Choose columns"))}">
						<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
							<path d="M0 2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1v7.5a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 1 12.5V5a1 1 0 0 1-1-1V2zm2 3v7.5A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V5H2zm13-3H1v2h14V2z"/>
						</svg>
					</button>
					<button class="ev-ct-collapse-btn" title="${frappe.utils.escape_html(__("Collapse"))}">
						<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
							<path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
						</svg>
					</button>
				</div>
			</div>
			<div class="ev-ct-body">
				<div class="ev-ct-table-wrap">
					<table class="ev-ct-table" cellspacing="0" cellpadding="0">
						<thead>
							<tr class="ev-ct-thead-row">
								<th class="ev-ct-th ev-ct-th--action"></th>
								${visible_fields.map(f =>
									`<th class="ev-ct-th" title="${frappe.utils.escape_html(f.label)}">
										${frappe.utils.escape_html(__(f.label))}
										${f.reqd ? '<span class="ev-ct-reqd">*</span>' : ""}
									</th>`
								).join("")}
							</tr>
						</thead>
						<tbody class="ev-ct-tbody">
							${tab_data.rows.map((row, idx) =>
								this._build_row_html(row, idx, visible_fields, can_write, is_submitted, is_cancelled, can_add_delete)
							).join("")}
						</tbody>
					</table>
				</div>
				<div class="ev-ct-footer">
					${can_add_delete ? `
					<button class="ev-ct-add-btn">
						<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
							<path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/>
						</svg>
						${frappe.utils.escape_html(__("Add {0}", [this._child_label(active_tab)]))}
					</button>` : ""}
					<button class="ev-ct-save-all-btn ev-ct-save-all-btn--hidden" disabled>
						<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
							<path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4.414A2 2 0 0 0 14.414 3L13 1.586A2 2 0 0 0 11.586 1H2zm10 11v-3a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v3H2V2h1v3a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V2h.586L14 3.414V13h-2zM6 14v-3h4v3H6z"/>
						</svg>
						<span class="ev-ct-save-label">${__("Save")}</span>
						<span class="ev-ct-save-badge" style="display:none"></span>
					</button>
				</div>
			</div>
			<div class="ev-ct-resize-handle" title="${frappe.utils.escape_html(__("Drag to resize"))}"></div>
		`);

		this._bind_cell_edit_listeners(visible_fields, tab_data.child_doctype);
		this._update_save_btn();
	}

	// ── Submit/cancel flags ───────────────────────────────────────────────────

	_get_submit_flags(tab_data) {
		const ds = tab_data.parent_docstatus ?? 0;
		const is_submitted  = ds === 1;
		const is_cancelled  = ds === 2;
		const can_add_delete = (!is_submitted && !is_cancelled) ||
		                       (is_submitted && !!tab_data.table_allow_on_submit);
		return { is_submitted, is_cancelled, can_add_delete };
	}

	// ── Column visibility ─────────────────────────────────────────────────────

	_get_visible_fields(fields, fieldname) {
		const prefs = this._col_prefs[fieldname];
		if (prefs?.size) return fields.filter(f => prefs.has(f.fieldname) && !f.hidden);
		let vis = fields.filter(f => f.in_list_view && !f.hidden);
		if (!vis.length) vis = fields.filter(f => !f.hidden).slice(0, 8);
		return vis;
	}

	// ── Tab strip ─────────────────────────────────────────────────────────────

	_build_tab_strip_html(tabs, active_tab) {
		return `
			<div class="ev-ct-tabs" role="tablist">
				${tabs.map(tab => {
					const count = this._badge_cache[tab.fieldname];
					const badge = count != null
						? `<span class="ev-ct-tab-badge">${count}</span>`
						: "";
					const is_active = tab.fieldname === active_tab;
					return `
						<button
							class="ev-ct-tab${is_active ? " ev-ct-tab--active" : ""}"
							data-fieldname="${frappe.utils.escape_html(tab.fieldname)}"
							role="tab"
							aria-selected="${is_active}"
							title="${frappe.utils.escape_html(__(tab.label || tab.fieldname))}"
						>
							${frappe.utils.escape_html(__(tab.label || tab.fieldname))}
							${badge}
						</button>
					`;
				}).join("")}
			</div>
		`;
	}

	// ── Row HTML builder ──────────────────────────────────────────────────────

	_build_row_html(row, idx, visible_fields, can_write, is_submitted=false, is_cancelled=false, can_add_delete=true) {
		const child_name     = frappe.utils.escape_html(row.name || "");
		const is_new_row     = !!row._is_new_ct_row;
		const is_pending_del = !is_new_row && this._delete_queue.has(row.name);

		// Action button
		let action_btn;
		if (is_new_row) {
			action_btn = `<button class="ev-ct-discard-btn" title="${frappe.utils.escape_html(__("Discard"))}">
				<svg width="8" height="8" viewBox="0 0 12 12" fill="none">
					<path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
				</svg>
			</button>`;
		} else if (is_pending_del) {
			action_btn = `<button class="ev-ct-undo-delete-btn" title="${frappe.utils.escape_html(__("Undo delete"))}">
				<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
					<path d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z"/>
					<path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z"/>
				</svg>
			</button>`;
		} else if (can_add_delete) {
			action_btn = `<button class="ev-ct-delete-btn" title="${frappe.utils.escape_html(__("Delete row"))}">
				<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
					<path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
					<path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
				</svg>
			</button>`;
		} else {
			action_btn = "";
		}

		return `
			<tr class="ev-ct-tr${is_new_row ? " ev-ct-tr--new" : ""}${is_pending_del ? " ev-ct-tr--pending-del" : ""}"
			    data-child-name="${child_name}" data-idx="${idx}">
				<td class="ev-ct-td ev-ct-td--action">
					<span class="ev-ct-row-num">${is_new_row ? "+" : (row.idx || idx + 1)}</span>
					${action_btn}
				</td>
				${visible_fields.map(f => {
					const raw_val = row[f.fieldname];
					const display = this._format_cell_value(raw_val, f);

					// submitted doc field-level guard (new rows always editable)
					const submitted_lock = !is_new_row && is_submitted && !f.allow_on_submit;
					const is_readonly    = !can_write || !!f.read_only || is_cancelled || submitted_lock || is_pending_del;
					const data_attr      = `data-fieldname="${frappe.utils.escape_html(f.fieldname)}" data-fieldtype="${frappe.utils.escape_html(f.fieldtype)}"`;

					if (is_readonly) {
						return `<td class="ev-ct-td ev-ct-td--readonly" ${data_attr}>
							<span class="ev-ct-cell-value">${frappe.utils.escape_html(display)}</span>
						</td>`;
					}

					let input_html;
					if (f.fieldtype === "Select" && f.options) {
						const opts = f.options.split("\n").map(o =>
							`<option value="${frappe.utils.escape_html(o)}"${o === display ? " selected" : ""}>${frappe.utils.escape_html(o)}</option>`
						).join("");
						input_html = `<select class="ev-ct-cell-select" ${data_attr} data-original="${frappe.utils.escape_html(display)}">${opts}</select>`;
					} else if (f.fieldtype === "Check") {
						input_html = `<input type="checkbox" class="ev-ct-cell-input ev-ct-cell-check" ${data_attr}
							data-original="${raw_val ? "1" : "0"}" ${raw_val ? "checked" : ""}>`;
					} else if (f.fieldtype === "Link") {
						input_html = `<input type="text" class="ev-ct-cell-input ev-ct-cell-link" ${data_attr}
							data-link-doctype="${frappe.utils.escape_html(f.options || "")}"
							data-original="${frappe.utils.escape_html(display)}"
							value="${frappe.utils.escape_html(display)}" autocomplete="off">`;
					} else if (["Int", "Float", "Currency", "Percent"].includes(f.fieldtype)) {
						// type="number" requires a plain numeric string — never pass a locale-formatted value
						// (e.g. "1,20,000.00") or the browser will silently reject it and show blank.
						const num_val = (raw_val == null || raw_val === "") ? "" : String(raw_val);
						input_html = `<input type="number" class="ev-ct-cell-input ev-ct-cell-number" ${data_attr}
							data-original="${frappe.utils.escape_html(num_val)}"
							value="${frappe.utils.escape_html(num_val)}"
							step="any">`;
					} else if (f.fieldtype === "Date") {
						input_html = `<input type="date" class="ev-ct-cell-input" ${data_attr}
							data-original="${frappe.utils.escape_html(display)}"
							value="${frappe.utils.escape_html(display)}">`;
					} else if (["Text Editor", "Long Text"].includes(f.fieldtype)) {
						// Render HTML content as live preview + edit button
						const html_content = (raw_val != null && raw_val !== "") ? String(raw_val) : "";
						return `<td class="ev-ct-td ev-ct-td--rich" ${data_attr}
							data-fieldname="${frappe.utils.escape_html(f.fieldname)}"
							data-fieldtype="${frappe.utils.escape_html(f.fieldtype)}">
							<div class="ev-ct-rich-preview">${html_content}</div>
							<button class="ev-ct-rich-edit-btn"
								data-fieldname="${frappe.utils.escape_html(f.fieldname)}"
								data-fieldtype="${frappe.utils.escape_html(f.fieldtype)}"
								data-label="${frappe.utils.escape_html(__(f.label || f.fieldname))}"
								title="${frappe.utils.escape_html(__("Edit {0}", [f.label || f.fieldname]))}">
								<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
									<path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
								</svg>
							</button>
						</td>`;
					} else {
						input_html = `<input type="text" class="ev-ct-cell-input" ${data_attr}
							data-original="${frappe.utils.escape_html(display)}"
							value="${frappe.utils.escape_html(display)}">`;
					}

					return `<td class="ev-ct-td" ${data_attr}>${input_html}</td>`;
				}).join("")}
			</tr>
		`;
	}

	// ── Cell edit listeners ───────────────────────────────────────────────────

	_bind_cell_edit_listeners(visible_fields, child_doctype) {
		if (!this._$panel) return;

		this._$panel
			.off("change.ev-ct-edit keydown.ev-ct-edit")
			.on("change.ev-ct-edit", ".ev-ct-cell-select, .ev-ct-cell-check", (e) => {
				this._on_input_commit(e.currentTarget, child_doctype);
			})
			.on("keydown.ev-ct-edit", ".ev-ct-cell-input", (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					e.currentTarget.blur();
					// Move to same field in next row
					const $tr = $(e.currentTarget).closest("tr");
					const fn  = e.currentTarget.dataset.fieldname;
					$tr.next("tr.ev-ct-tr").find(`[data-fieldname="${fn}"].ev-ct-cell-input`).focus();
				}
				if (e.key === "Escape") {
					e.currentTarget.value = e.currentTarget.dataset.original || "";
					e.currentTarget.blur();
				}
			})
			.on("blur.ev-ct-edit", ".ev-ct-cell-input", (e) => {
				this._on_input_commit(e.currentTarget, child_doctype);
			});

		// Wheel prevention on number inputs (passive:false required)
		this._$panel.find("input[type='number']").each((_, el) => {
			if (!el._ev_no_wheel) {
				el._ev_no_wheel = true;
				el.addEventListener("wheel", (ev) => { ev.preventDefault(); }, { passive: false });
			}
		});

		// Awesomplete for link fields
		this._$panel.find(".ev-ct-cell-link").each((_, el) => {
			if (!el._ev_aw_init) {
				el._ev_aw_init = true;
				const link_doctype = el.dataset.linkDoctype;
				if (link_doctype) this._setup_link_autocomplete(el, link_doctype);
			}
		});
	}

	// ── Input commit ─────────────────────────────────────────────────────────

	_on_input_commit(el, child_doctype) {
		const $tr = $(el).closest("tr.ev-ct-tr");
		const child_name = $tr.data("child-name");
		if (!child_name) return;

		const fieldname  = el.dataset.fieldname;
		let   new_val    = el.type === "checkbox" ? (el.checked ? 1 : 0) : el.value;
		const orig_val   = el.dataset.original ?? "";

		if (String(new_val) === String(orig_val)) return;

		el.dataset.original = String(new_val);

		// Update in-memory cache
		this._update_cached_row(child_name, fieldname, new_val);

		if (!this._save_queue[child_name]) this._save_queue[child_name] = {};
		this._save_queue[child_name][fieldname] = new_val;
		this._dirty = true;
		this._show_dirty();
		this._update_save_btn();
	}

	// ── Cached row update ─────────────────────────────────────────────────────

	_update_cached_row(child_name, fieldname, value) {
		if (!this._state) return;
		const tab_data = this._state.rows_by_tab.get(this._state.active_tab);
		if (!tab_data) return;
		const row = tab_data.rows.find(r => r.name === child_name);
		if (row) row[fieldname] = value;
	}

	// ── Link autocomplete ─────────────────────────────────────────────────────

	_setup_link_autocomplete(el, link_doctype) {
		const aw = new Awesomplete(el, { minChars: 0, maxItems: 10, autoFirst: true });

		el.addEventListener("input", frappe.utils.debounce(async () => {
			const txt = el.value.trim();
			try {
				const r = await frappe.call({
					method: "frappe.desk.search.search_link",
					args: { doctype: link_doctype, txt, page_length: 10 },
					freeze: false, error: () => {},
				});
				const results = r?.message || [];
				aw.list = results.map(x => (typeof x === "object" ? x.value : x));
				aw.evaluate();
			} catch (_) { /* ignore */ }
		}, 250));

		el.addEventListener("awesomplete-open", () => {
			const ul  = aw.ul;
			const rect = el.getBoundingClientRect();
			ul.classList.add("ev-ct-aw-dropdown");
			document.body.appendChild(ul);
			const is_dark = document.documentElement.getAttribute("data-theme") === "dark";
			Object.assign(ul.style, {
				position: "fixed",
				top:      (rect.bottom + 2) + "px",
				left:     rect.left + "px",
				width:    Math.max(rect.width, 200) + "px",
				zIndex:   "9999",
				background: is_dark ? "#1e1e1e" : "#ffffff",
				border:     is_dark ? "1px solid #2a4a38" : "1px solid #b8d9c8",
				borderRadius: "4px",
				boxShadow:    "0 4px 12px rgba(0,0,0,0.18)",
				fontSize:     "12px",
				listStyle:    "none",
				padding:      "2px 0",
			});
		});
		el.addEventListener("awesomplete-close", () => {
			if (aw.ul && aw.ul.parentNode !== aw.container) aw.container.appendChild(aw.ul);
		});
		el.addEventListener("awesomplete-selectcomplete", () => {
			el.dispatchEvent(new Event("change", { bubbles: true }));
		});
	}

	// ── Bulk save ─────────────────────────────────────────────────────────────

	async _save_all() {
		if (!Object.keys(this._save_queue).length && !this._delete_queue.size) return;
		if (!this._state) return;

		// Flush any focused input
		this._$panel?.find(".ev-ct-cell-input:focus, .ev-ct-cell-select:focus")
			.each((_, el) => this._on_input_commit(el, null));

		const queue = { ...this._save_queue };
		const deletes = [...this._delete_queue];
		const { parent_name, active_tab } = this._state;

		const updates = [];
		const inserts = [];

		for (const [name, fields] of Object.entries(queue)) {
			if (!Object.keys(fields).length) continue;
			if (name.startsWith("_new_ct_")) inserts.push({ temp_name: name, fields });
			else updates.push({ name, fields });
		}

		// Remove empty new rows (added but nothing typed)
		for (const [name] of Object.entries(queue)) {
			if (name.startsWith("_new_ct_") && !inserts.find(i => i.temp_name === name)) {
				this._discard_new_row(name);
			}
		}

		if (!updates.length && !inserts.length && !deletes.length) {
			this._save_queue = {};
			this._delete_queue.clear();
			this._dirty = false;
			this._update_save_btn();
			return;
		}

		const $btn = this._$panel?.find(".ev-ct-save-all-btn");
		$btn?.prop("disabled", true).find(".ev-ct-save-label").text(__("Saving..."));

		try {
			await this._ev_call(
				"excel_view.api.save_child_table_bulk",
				{
					doctype:         this.board.doctype,
					parent_name,
					child_fieldname: active_tab,
					changes:         JSON.stringify({ updates, inserts, deletes }),
				},
				__("Saving {0}", [this._tab_label(active_tab)])
			);

			this._save_queue = {};
			this._delete_queue.clear();
			this._dirty = false;
			this._clear_dirty();
			this._update_save_btn();

			frappe.views.excel.toast(__("Saved"), "success", 1800);

			// Bust cache → re-fetch from server (ORM-computed fields may have changed)
			if (this._state) this._state.rows_by_tab.delete(active_tab);
			this._load_tab(active_tab);

		} catch (_err) {
			// Restore queues so user can retry
			Object.assign(this._save_queue, queue);
			for (const n of deletes) this._delete_queue.add(n);
			this._dirty = true;
			this._update_save_btn();
		}
	}

	// ── Save button state ─────────────────────────────────────────────────────

	_update_save_btn() {
		const $btn = this._$panel?.find(".ev-ct-save-all-btn");
		if (!$btn?.length) return;
		const count = Object.keys(this._save_queue).length + this._delete_queue.size;
		if (count > 0) {
			$btn.removeClass("ev-ct-save-all-btn--hidden").prop("disabled", false);
			$btn.find(".ev-ct-save-label").text(__("Save"));
			$btn.find(".ev-ct-save-badge").text(count).css("display", "inline-flex");
		} else {
			$btn.addClass("ev-ct-save-all-btn--hidden");
		}
	}

	// ── Add row (optimistic) ──────────────────────────────────────────────────

	_add_row() {
		if (!this._state) return;
		const { active_tab, rows_by_tab } = this._state;
		const tab_data = rows_by_tab.get(active_tab);
		if (!tab_data) return;

		const can_write = this.board.list_view.can_write;
		const { can_add_delete, is_submitted, is_cancelled } = this._get_submit_flags(tab_data);

		const temp_name = `_new_ct_${Date.now()}`;
		const pending   = { name: temp_name, idx: tab_data.rows.length + 1, _is_new_ct_row: true };
		tab_data.fields.forEach(f => {
			if (f.default != null && f.default !== "") pending[f.fieldname] = f.default;
		});
		tab_data.rows.push(pending);
		this._badge_cache[active_tab] = tab_data.rows.length;

		const visible_fields = this._get_visible_fields(tab_data.fields, active_tab);
		this._$panel?.find(".ev-ct-tbody").html(
			tab_data.rows.map((row, idx) =>
				this._build_row_html(row, idx, visible_fields, can_write, is_submitted, is_cancelled, can_add_delete)
			).join("")
		);
		this._bind_cell_edit_listeners(visible_fields, tab_data.child_doctype);

		// Queue the new row (so Save button appears even before user types)
		if (!this._save_queue[temp_name]) this._save_queue[temp_name] = {};
		this._dirty = true;
		this._show_dirty();
		this._update_save_btn();
		this._update_spacer_height();

		// Focus first editable cell
		setTimeout(() => {
			this._$panel?.find(`tr[data-child-name="${temp_name}"] .ev-ct-cell-input`).first().focus();
		}, 50);
	}

	// ── Discard new row ───────────────────────────────────────────────────────

	_discard_new_row(temp_name) {
		if (!this._state) return;
		const { active_tab, rows_by_tab } = this._state;
		const tab_data = rows_by_tab.get(active_tab);
		if (!tab_data) return;

		tab_data.rows = tab_data.rows.filter(r => r.name !== temp_name);
		delete this._save_queue[temp_name];
		this._badge_cache[active_tab] = tab_data.rows.length;

		const can_write = this.board.list_view.can_write;
		const { can_add_delete, is_submitted, is_cancelled } = this._get_submit_flags(tab_data);
		const visible_fields = this._get_visible_fields(tab_data.fields, active_tab);

		this._$panel?.find(".ev-ct-tbody").html(
			tab_data.rows.map((row, idx) =>
				this._build_row_html(row, idx, visible_fields, can_write, is_submitted, is_cancelled, can_add_delete)
			).join("")
		);
		this._bind_cell_edit_listeners(visible_fields, tab_data.child_doctype);
		this._dirty = Object.keys(this._save_queue).length > 0 || this._delete_queue.size > 0;
		if (!this._dirty) this._clear_dirty();
		this._update_save_btn();
		this._update_spacer_height();
	}

	// ── Delete queue ──────────────────────────────────────────────────────────

	_queue_delete(child_name) {
		if (!this._state) return;
		this._delete_queue.add(child_name);
		this._dirty = true;
		this._show_dirty();
		this._update_save_btn();
		this._rerender_tbody();
	}

	_unqueue_delete(child_name) {
		this._delete_queue.delete(child_name);
		this._dirty = Object.keys(this._save_queue).length > 0 || this._delete_queue.size > 0;
		if (!this._dirty) this._clear_dirty();
		this._update_save_btn();
		this._rerender_tbody();
	}

	// ── tbody fast re-render ──────────────────────────────────────────────────

	_rerender_tbody() {
		if (!this._state) return;
		const { active_tab, rows_by_tab } = this._state;
		const tab_data = rows_by_tab.get(active_tab);
		if (!tab_data) return;
		const can_write = this.board.list_view.can_write;
		const { can_add_delete, is_submitted, is_cancelled } = this._get_submit_flags(tab_data);
		const visible_fields = this._get_visible_fields(tab_data.fields, active_tab);
		this._$panel?.find(".ev-ct-tbody").html(
			tab_data.rows.map((row, idx) =>
				this._build_row_html(row, idx, visible_fields, can_write, is_submitted, is_cancelled, can_add_delete)
			).join("")
		);
		this._bind_cell_edit_listeners(visible_fields, tab_data.child_doctype);
	}

	// ── Rich-text / HTML field editor modal ──────────────────────────────────

	_open_rich_editor(child_name, fieldname, fieldtype, label, current_html) {
		if (!this._state) return;
		const can_write     = this.board.list_view.can_write;
		const { active_tab, rows_by_tab } = this._state;
		const tab_data      = rows_by_tab.get(active_tab);
		const { is_submitted, is_cancelled } = tab_data
			? this._get_submit_flags(tab_data)
			: { is_submitted: false, is_cancelled: false };

		const is_readonly    = !child_name || !can_write || is_cancelled;
		const submitted_lock = is_submitted && tab_data
			? !tab_data.fields.find(f => f.fieldname === fieldname)?.allow_on_submit
			: false;
		const can_edit       = !is_readonly && !submitted_lock;
		const editor_ft      = fieldtype === "Long Text" ? "Long Text" : "Text Editor";
		const escaped_label  = frappe.utils.escape_html(__(label));

		// ── EV Rich Text Editor modal (same design system as main grid) ───────────
		const $overlay = $(`
			<div class="ev-rte-overlay" role="dialog" aria-modal="true"
				aria-label="${escaped_label}">
				<div class="ev-rte-modal">
					<div class="ev-rte-header">
						<div class="ev-rte-header-left">
							<svg class="ev-rte-icon" width="14" height="14" viewBox="0 0 16 16"
								fill="currentColor" aria-hidden="true">
								<path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10
								10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1
								.11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5
								12.5 1.207zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1
								.5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293zm-9.761 5.175-.106.106-1.528
								3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0
								1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
							</svg>
							<span class="ev-rte-title">${escaped_label}</span>
							<span class="ev-rte-ft-tag">${frappe.utils.escape_html(editor_ft)}</span>
						</div>
						<div class="ev-rte-header-right">
							${can_edit
								? `<span class="ev-rte-status ev-rte-status--edit">
									<span class="ev-rte-status-dot"></span>${__("Editing")}
								   </span>`
								: `<span class="ev-rte-status ev-rte-status--view">${__("View Only")}</span>`}
							<button class="ev-rte-close-btn" aria-label="${__("Close")}">
								<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
									<path d="M1 1l10 10M11 1L1 11" stroke="currentColor"
										stroke-width="1.8" stroke-linecap="round"/>
								</svg>
							</button>
						</div>
					</div>
					<div class="ev-rte-editor-area"></div>
					<div class="ev-rte-footer">
						<span class="ev-rte-shortcut-hint">
							${can_edit ? `<kbd>Ctrl</kbd><span>+</span><kbd>S</kbd> ${__("to save")}` : ""}
						</span>
						<div class="ev-rte-footer-actions">
							<button class="ev-rte-cancel-btn">${__("Cancel")}</button>
							${can_edit
								? `<button class="ev-rte-save-btn">
									<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
										<path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0
										1-1V4.5a.5.5 0 0 0-.146-.354l-3-3A.5.5 0 0 0 11.5
										1H2zm0 1h9.293L14 4.707V14H2V2zm2 2h5a1 1 0 0 1 1 1v1a1
										1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm0 5h8v1H4v-1zm0
										2h8v1H4v-1z"/>
									</svg>
									${__("Save Changes")}
								   </button>`
								: ""}
						</div>
					</div>
				</div>
			</div>
		`).appendTo(document.body);

		const $area  = $overlay.find(".ev-rte-editor-area");
		let _control = null;
		try {
			_control = frappe.ui.form.make_control({
				df: { fieldtype: editor_ft, fieldname: "ev_rte_ct_content", label: "", read_only: can_edit ? 0 : 1 },
				parent:       $area[0],
				render_input: true,
			});
			setTimeout(() => { try { _control.set_value(current_html); } catch (_) {} }, 60);
		} catch (_e) {
			$area.html(`<textarea class="ev-rte-fallback-ta"
				${can_edit ? "" : "readonly"}
				placeholder="${frappe.utils.escape_html(__("No content"))}"
			>${frappe.utils.escape_html(current_html)}</textarea>`);
		}

		const _get_value = () => {
			if (_control) { try { return _control.get_value() ?? ""; } catch (_) {} }
			return $area.find(".ev-rte-fallback-ta").val() || "";
		};

		const close = () => {
			$(document).off("keydown.ev-rte-ct");
			$overlay[0].classList.remove("ev-rte-overlay--in");
			setTimeout(() => $overlay.remove(), 180);
		};

		const save = async () => {
			const new_val = _get_value();
			if (new_val === current_html) { close(); return; }
			try {
				await this._ev_call("excel_view.api.save_child_row", {
					doctype:         this.board.doctype,
					parent_name:     this._state.parent_name,
					child_fieldname: active_tab,
					child_name,
					fields: JSON.stringify({ [fieldname]: new_val }),
				});
				this._update_cached_row(child_name, fieldname, new_val);
				this._$panel?.find(
					`tr[data-child-name="${child_name}"] td[data-fieldname="${fieldname}"] .ev-ct-rich-preview`
				).html(new_val);
				frappe.views.excel.toast(__("Saved"), "success", 2500);
				close();
			} catch (_) { /* error shown by _ev_call */ }
		};

		$overlay
			.on("click", ".ev-rte-close-btn, .ev-rte-cancel-btn", close)
			.on("click", (e) => { if ($(e.target).is(".ev-rte-overlay")) close(); })
			.on("click", ".ev-rte-save-btn", save);

		$(document).on("keydown.ev-rte-ct", (e) => {
			if (e.key === "Escape") { close(); return; }
			if ((e.ctrlKey || e.metaKey) && e.key === "s" && can_edit) {
				e.preventDefault(); save();
			}
		});

		requestAnimationFrame(() => requestAnimationFrame(() => {
			$overlay[0].classList.add("ev-rte-overlay--in");
		}));
	}

	// ── Column chooser ────────────────────────────────────────────────────────

	_open_col_chooser(btn_el) {
		if (!this._state) return;
		this._close_col_chooser();

		const { active_tab, rows_by_tab } = this._state;
		const tab_data = rows_by_tab.get(active_tab);
		if (!tab_data) return;

		const all_fields = tab_data.fields.filter(f => !f.hidden);
		const prefs = this._col_prefs[active_tab] || new Set(
			this._get_visible_fields(tab_data.fields, active_tab).map(f => f.fieldname)
		);

		const $dropdown = $(`<div class="ev-ct-col-chooser"></div>`);
		$dropdown.css({
			position:     "fixed",
			zIndex:       9998,
			background:   "var(--card-bg, #fff)",
			border:       "1px solid var(--border-color, #d1d8dd)",
			borderRadius: "6px",
			boxShadow:    "0 4px 16px rgba(0,0,0,0.14)",
			padding:      "8px 0",
			minWidth:     "200px",
			maxHeight:    "280px",
			overflowY:    "auto",
			fontSize:     "12px",
		});

		all_fields.forEach(f => {
			const checked = prefs.has(f.fieldname);
			const $item = $(`
				<label class="ev-ct-cc-item" style="display:flex;align-items:center;gap:8px;padding:5px 14px;cursor:pointer;">
					<input type="checkbox" value="${frappe.utils.escape_html(f.fieldname)}" ${checked ? "checked" : ""}>
					<span>${frappe.utils.escape_html(__(f.label || f.fieldname))}</span>
				</label>
			`);
			$item.on("change", "input", (e) => {
				if (!this._col_prefs[active_tab]) this._col_prefs[active_tab] = new Set(prefs);
				if (e.currentTarget.checked) this._col_prefs[active_tab].add(f.fieldname);
				else this._col_prefs[active_tab].delete(f.fieldname);
				this._render_panel_content();
			});
			$dropdown.append($item);
		});

		document.body.appendChild($dropdown[0]);

		const rect = btn_el.getBoundingClientRect();
		$dropdown.css({
			top:  (rect.bottom + 4) + "px",
			left: Math.min(rect.left, window.innerWidth - 220) + "px",
		});

		this._chooser_close_handler = (e) => {
			if (!$dropdown[0].contains(e.target) && e.target !== btn_el) {
				this._close_col_chooser();
			}
		};
		setTimeout(() => {
			document.addEventListener("mousedown", this._chooser_close_handler, { once: false });
		}, 0);

		this._$chooser = $dropdown;
	}

	_close_col_chooser() {
		if (this._$chooser) {
			this._$chooser.remove();
			this._$chooser = null;
		}
		if (this._chooser_close_handler) {
			document.removeEventListener("mousedown", this._chooser_close_handler);
			this._chooser_close_handler = null;
		}
	}

	// ── API call wrapper ──────────────────────────────────────────────────────

	_ev_call(method, args) {
		// Wrap frappe.call in a real Promise so ALL server errors reject and surface.
		//
		// Frappe error response shapes:
		//   A) HTTP 200 with exc_type + _server_messages  (frappe.throw / ValidationError)
		//   B) HTTP 4xx/5xx — handled by `error` XHR callback
		//   C) r.message.error = true — our own API convention
		return new Promise((resolve, reject) => {
			frappe.call({
				method,
				args,
				freeze: false,
				callback: (r) => {
					// Shape A — server exception embedded in a 200 response
					if (r?.exc_type || r?.exc) {
						frappe.views.excel.show_error(r, method);
						reject(new Error(this._extract_frappe_msg(r)));
						return;
					}
					// Shape C — our own API error envelope (_ev_error: true)
					const payload = r?.message;
					if (payload?._ev_error) {
						frappe.views.excel.show_error(payload, payload.message);
						reject(new Error(payload.message));
					} else {
						resolve(payload);
					}
				},
				error: (xhr) => {
					// Shape B — HTTP-level error
					let src = {};
					try { src = typeof xhr.responseJSON === "object" ? xhr.responseJSON : JSON.parse(xhr.responseText || "{}"); } catch (_) {}
					frappe.views.excel.show_error(src, method);
					reject(new Error(this._extract_frappe_msg(src)));
				},
			});
		});
	}

	// Extract a plain-text message from a Frappe error response (for Error objects only).
	_extract_frappe_msg(r) {
		try {
			if (r?._server_messages) {
				const msgs = JSON.parse(r._server_messages);
				const first = typeof msgs[0] === "string" ? JSON.parse(msgs[0]) : msgs[0];
				const txt = (first?.message || String(first)).replace(/<[^>]*>/g, "").trim();
				if (txt) return txt;
			}
		} catch (_) {}
		const exc = r?.exc || r?.exception || "";
		if (exc) {
			const lines = String(exc).trim().split("\n").filter(l => l.trim());
			const last  = lines[lines.length - 1] || "";
			const msg   = last.replace(/^[\w.]+(?:Error|Exception):\s*/i, "").trim();
			if (msg) return msg;
		}
		return __("An unexpected error occurred.");
	}

	// ── Spacer management ─────────────────────────────────────────────────────

	_insert_spacer(row_idx, height) {
		this._remove_spacer();
		const spacer = {
			_is_ct_spacer:  true,
			_ct_spacer_h:   height,
			_ct_parent_idx: row_idx,
		};
		this.board.list_view.data.splice(row_idx + 1, 0, spacer);
		const data = this.board.list_view.data;
		this.board.matrix = this.board.data_manager.to_matrix(data, this.board.columns);
		this.board.formula_bridge.reload(this.board.matrix);
		this.board.hot?.loadData(data);
	}

	_remove_spacer() {
		const data = this.board.list_view.data;
		const idx = data.findIndex(d => d._is_ct_spacer);
		if (idx < 0) return;
		data.splice(idx, 1);
		const m = this.board.data_manager.to_matrix(data, this.board.columns);
		this.board.matrix = m;
		this.board.formula_bridge.reload(m);
		this.board.hot?.loadData(data);
	}

	_update_spacer_height() {
		const data = this.board.list_view.data;
		const spacer = data.find(d => d._is_ct_spacer);
		if (!spacer) return;
		spacer._ct_spacer_h = this._compute_panel_height();
		this.board.hot?.render();
	}

	_compute_panel_height() {
		if (!this._state) return _PANEL_MIN_HEIGHT;
		const tab_data = this._state.rows_by_tab.get(this._state.active_tab);
		if (!tab_data) return _PANEL_MIN_HEIGHT;
		const row_count = tab_data.rows.length;
		const natural = _PANEL_HEADER_H + _COL_HEADER_H + (row_count * _ROW_H) + _ADD_BTN_H + 8;
		return Math.min(Math.max(natural, _PANEL_MIN_HEIGHT), _PANEL_MAX_HEIGHT);
	}

	// ── Panel positioning ─────────────────────────────────────────────────────

	_reposition_panel() {
		if (!this._$panel || !this._state) return;

		const spacer_idx = this._state.parent_row_idx + 1;
		const hot = this.board.hot;
		if (!hot) return;

		const td = hot.getCell(spacer_idx, 0);
		if (!td) {
			this._$panel.css("visibility", "hidden");
			return;
		}

		this._$panel.css("visibility", "visible");

		const hot_el  = this.board.$hot_container[0];
		const td_rect = td.getBoundingClientRect();
		const hot_rect = hot_el.getBoundingClientRect();

		const row_header_el = hot_el.querySelector(".ht_clone_left");
		const row_header_w  = row_header_el ? row_header_el.offsetWidth : 0;

		this._$panel.css({
			top:    (td_rect.top - hot_rect.top) + "px",
			left:   row_header_w + "px",
			right:  0,
			height: this._compute_panel_height() + "px",
		});
	}

	// ── Dirty indicator ───────────────────────────────────────────────────────

	_show_dirty() { this.board.list_view?.page?.set_indicator(__("Unsaved child edits"), "orange"); }
	_clear_dirty() { this.board.list_view?.page?.clear_indicator(); }

	// ── Helpers ───────────────────────────────────────────────────────────────

	_resolve_tabs() {
		const meta = frappe.get_meta(this.board.doctype);
		return (meta?.fields || []).filter(
			f => f.fieldtype === "Table" && f.options && !f.hidden
		);
	}

	_tab_label(fieldname) {
		const tab = this._tabs.find(t => t.fieldname === fieldname);
		return __(tab?.label || fieldname);
	}

	_child_label(fieldname) {
		const tab = this._tabs.find(t => t.fieldname === fieldname);
		const label = tab?.label || fieldname;
		// Naive singularise: "Items" → "Item", "Taxes" → "Tax"
		return __(label.replace(/ies$/, "y").replace(/s$/, ""));
	}

	_format_cell_value(val, field) {
		if (val === null || val === undefined) return "";
		if (typeof val === "number") {
			if (field.fieldtype === "Currency" || field.fieldtype === "Float") {
				return frappe.format(val, { fieldtype: field.fieldtype }, { only_value: true }) ?? String(val);
			}
			return String(val);
		}
		if (typeof val === "boolean") return val ? __("Yes") : __("No");
		return String(val);
	}
};

// ── Module-level constants ────────────────────────────────────────────────────

const _PANEL_MIN_HEIGHT = 200;
const _PANEL_MAX_HEIGHT = 400;
const _PANEL_HEADER_H   = 36;
const _COL_HEADER_H     = 30;
const _ROW_H            = 30;
const _ADD_BTN_H        = 40;
