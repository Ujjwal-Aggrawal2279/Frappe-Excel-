/**
 * excel_view/components/field_picker.js
 *
 * "Choose Columns" dialog for Excel View.
 *
 * Features:
 *  - RBAC: filters fields by the logged-in user's readable permlevels
 *  - Handles large field lists (100+ custom fields) efficiently
 *  - Live search (label + fieldname)
 *  - HTML5 native drag-to-reorder (one set of listeners on the list parent)
 *  - Select All / Deselect All (visible items only)
 *  - "name" (ID) column is always locked first
 *  - Saves selection to frappe.model.user_settings (server-side, per-user per-doctype)
 *
 * Usage:
 *   new frappe.views.excel.FieldPicker({ board }).open();
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.FieldPicker = class FieldPicker {
	// Fieldtypes that have no tabular value — never show in the grid
	static SKIP_TYPES = new Set([
		"Column Break", "Section Break", "Tab Break", "Fold",
		"Heading", "HTML", "Custom HTML",
		"Table", "Table MultiSelect",
		"Password",
	]);

	// CT child fields to skip (system-level, meaningless in flat grid)
	static CT_SKIP = new Set(["parent", "parenttype", "parentfield", "idx", "docstatus", "name"]);

	// Human-readable type → badge CSS class (for visual hint in the list)
	static TYPE_CLASS = {
		Currency: "ev-ft-num", Float: "ev-ft-num", Int: "ev-ft-num", Percent: "ev-ft-num",
		Date: "ev-ft-date", Datetime: "ev-ft-date", Time: "ev-ft-date",
		Link: "ev-ft-link", "Dynamic Link": "ev-ft-link",
		Select: "ev-ft-select",
		Check: "ev-ft-check",
		Data: "ev-ft-data", Text: "ev-ft-data", "Small Text": "ev-ft-data",
		"Long Text": "ev-ft-data",
	};

	constructor({ board }) {
		this.board    = board;
		this.doctype  = board.doctype;
		this.meta     = board.meta;
		this._fields  = []; // [{ fieldname, label, fieldtype, checked, locked, is_custom }]
		this._dialog  = null;
		this.$list    = null;
	}

	// ── Public ────────────────────────────────────────────────────────────────

	async open() {
		// Pre-load child doctype metas so CT fields can be shown in picker
		const table_dfs = (this.meta.fields || []).filter(df => df.fieldtype === "Table");
		await Promise.all(
			table_dfs.map(df => new Promise(resolve => frappe.model.with_doctype(df.options, resolve)))
		);
		this._build_fields();
		this._create_dialog();
	}

	// ── Field list construction ───────────────────────────────────────────────

	_build_fields() {
		// ── RBAC: determine which permlevels the current user can READ ──────
		const perms = frappe.perm.get_perm(this.doctype) || [];
		const readable_permlevels = new Set(
			perms.filter(p => p.read).map(p => p.permlevel || 0)
		);
		const can_read = (df) => readable_permlevels.has(df.permlevel || 0);

		// ── Currently visible column keys (to pre-check them) ───────────────
		const visible_keys = new Set(
			this.board.columns
				.filter(c => !c._is_formula_col && !c._is_name_col)
				.map(c => c.data)
		);

		// ── "name" / ID — always first, always checked, not draggable ───────
		this._fields = [{
			fieldname: "name",
			label: "ID",
			fieldtype: "Data",
			checked: true,
			locked: true,
			is_custom: false,
		}];

		// ── All DocType fields (base + custom fields in meta.fields) ─────────
		(this.meta.fields || []).forEach(df => {
			if (FieldPicker.SKIP_TYPES.has(df.fieldtype)) return;
			if (df.fieldname === "name") return;
			if (df.fieldname === "idx") return;      // internal sort index
			if (df.fieldname === "docstatus") return; // status field is the human-readable equivalent
			if (df.is_virtual) return;
			if (!can_read(df)) return; // RBAC permlevel gate

			this._fields.push({
				fieldname:  df.fieldname,
				label:      df.label || df.fieldname,
				fieldtype:  df.fieldtype,
				checked:    visible_keys.has(df.fieldname),
				locked:     false,
				is_custom:  !!(df.is_custom_field || df.custom),
			});
		});

		// ── Sort: all non-locked, non-CT fields alphabetically by label ─────────
		const locked  = this._fields.filter(f => f.locked);
		const rest    = this._fields.filter(f => !f.locked);
		rest.sort((a, b) => a.label.localeCompare(b.label));
		this._fields = [...locked, ...rest];

		// ── Child table fields (grouped by parent Table field) ───────────────
		const saved_ct = frappe.get_user_settings(this.doctype)?.excel_ct_columns || [];
		const visible_ct = new Set(saved_ct);

		(this.meta.fields || []).forEach(df => {
			if (df.fieldtype !== "Table") return;
			// No client-side perm check for child tables — istable=1 DocTypes don't have
			// their own permission rows; they inherit from the parent. Server enforces it.
			const child_meta = frappe.get_meta(df.options);
			if (!child_meta) return;

			const child_dfs = (child_meta.fields || []).filter(cf =>
				!FieldPicker.SKIP_TYPES.has(cf.fieldtype) &&
				!FieldPicker.CT_SKIP.has(cf.fieldname) &&
				!cf.is_virtual
			);
			if (!child_dfs.length) return;

			// Section divider
			this._fields.push({
				fieldname: `__ct_section_${df.fieldname}`,
				label: df.label || df.fieldname,
				fieldtype: "Table",
				is_section: true,
				locked: false,
				checked: false,
			});

			child_dfs.forEach(cf => {
				const composite = `${df.fieldname}__${cf.fieldname}`;
				this._fields.push({
					fieldname: composite,
					label: cf.label || cf.fieldname,
					fieldtype: cf.fieldtype,
					checked: visible_ct.has(composite),
					locked: false,
					is_ct: true,
					ct_table_label: df.label || df.fieldname,
				});
			});
		});
	}

	// ── Modal creation ────────────────────────────────────────────────────────

	_create_dialog() {
		const $overlay = $(`
			<div class="ev-fp-overlay" role="dialog" aria-modal="true" aria-label="${__("Choose Columns")}">
				<div class="ev-fp-modal">
					<div class="ev-fp-modal-header">
						<span class="ev-fp-modal-title">${__("Choose Columns")}</span>
						<button class="ev-fp-modal-close" aria-label="${__("Close")}">
							<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
								<path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
							</svg>
						</button>
					</div>
					<div class="ev-fp-modal-body ev-fp-body"></div>
					<div class="ev-fp-modal-footer">
						<button class="ev-fp-cancel-btn btn btn-default btn-sm">${__("Cancel")}</button>
						<button class="ev-fp-submit-btn btn btn-primary btn-sm">${__("Apply")}</button>
					</div>
				</div>
			</div>
		`).appendTo(document.body);

		this._$overlay = $overlay;
		const $body = $overlay.find(".ev-fp-modal-body");
		this._render($body);

		const close = () => {
			$(document).off("keydown.ev-fp");
			$overlay.remove();
		};
		this._close_modal = close;

		$overlay.on("click", ".ev-fp-modal-close, .ev-fp-cancel-btn", close);
		$overlay.on("click", (e) => { if ($(e.target).is(".ev-fp-overlay")) close(); });
		$overlay.on("click", ".ev-fp-submit-btn", () => this._on_apply());
		$(document).on("keydown.ev-fp", (e) => { if (e.key === "Escape") close(); });

		// Focus search on open
		setTimeout(() => $overlay.find(".ev-fp-search")[0]?.focus(), 60);
	}

	_render($body) {
		const total = this._fields.length;

		$body.html(`
			<div class="ev-fp-toolbar">
				<input class="ev-fp-search form-control form-control-sm"
					placeholder="${__("Search by label or fieldname…")}" autocomplete="off">
				<span class="ev-fp-count"></span>
			</div>
			<div class="ev-fp-actions">
				<a class="ev-fp-select-all">${__("Select All")}</a>
				&nbsp;·&nbsp;
				<a class="ev-fp-deselect-all">${__("Deselect All")}</a>
				<span class="ev-fp-hint">${__("Drag rows to reorder")}</span>
			</div>
			<ul class="ev-fp-list" role="listbox" aria-label="${__("Available columns")}">
				${this._fields.map(f => this._item_html(f)).join("")}
			</ul>
		`);

		this.$list = $body.find(".ev-fp-list");
		this._update_count();
		this._bind_events($body);
		this._init_drag();
	}

	_item_html(f) {
		// Section divider for child table groups
		if (f.is_section) {
			return `<li class="ev-fp-ct-section" data-fieldname="${frappe.utils.escape_html(f.fieldname)}">
				<span class="ev-fp-ct-section-icon">📋</span>
				${frappe.utils.escape_html(__(f.label))}
				<span class="ev-fp-badge ev-fp-ct-badge">CT</span>
			</li>`;
		}

		const type_cls = FieldPicker.TYPE_CLASS[f.fieldtype] || "ev-ft-other";
		const drag_cls = f.locked ? "ev-fp-drag-disabled" : "ev-fp-drag";
		const indent_cls = f.is_ct ? " ev-fp-item--ct" : "";
		return `
			<li class="ev-fp-item${f.locked ? " ev-fp-locked" : ""}${indent_cls}"
				data-fieldname="${frappe.utils.escape_html(f.fieldname)}"
				draggable="false"
				role="option">
				<span class="${drag_cls}" aria-hidden="true">${f.is_ct ? "" : "⠿"}</span>
				<label class="ev-fp-label-wrap">
					<input type="checkbox" class="ev-fp-check"
						${f.checked ? "checked" : ""}
						${f.locked ? "disabled" : ""}>
					<span class="ev-fp-label">${frappe.utils.escape_html(__(f.label))}</span>
					${f.is_custom
						? `<span class="ev-fp-badge ev-fp-custom">${__("Custom")}</span>`
						: ""}
					${f.is_ct
						? `<span class="ev-fp-badge ev-fp-ct-badge">${__("CT")}</span>`
						: `<span class="ev-fp-badge ${type_cls}">${frappe.utils.escape_html(f.fieldtype)}</span>`}
				</label>
			</li>
		`;
	}

	// ── Events (event delegation — one handler for entire list) ──────────────

	_bind_events($body) {
		// Live search: match against translated label and raw fieldname
		$body.on("input", ".ev-fp-search", (e) => {
			const q = e.target.value.trim().toLowerCase();
			// Track whether a CT section has any visible children
			let last_section = null;
			let section_has_visible = false;

			const finalize_section = () => {
				if (last_section) last_section.hidden = !section_has_visible;
			};

			this.$list[0].querySelectorAll(".ev-fp-item, .ev-fp-ct-section").forEach(el => {
				if (el.classList.contains("ev-fp-ct-section")) {
					finalize_section();
					last_section = el;
					section_has_visible = false;
					return;
				}
				if (el.classList.contains("ev-fp-locked")) return; // ID always visible
				const label = el.querySelector(".ev-fp-label").textContent.toLowerCase();
				const fn    = el.dataset.fieldname.toLowerCase();
				const hidden = !!(q && !label.includes(q) && !fn.includes(q));
				el.hidden = hidden;
				if (!hidden) section_has_visible = true;
			});
			finalize_section();
			this._update_count();
		});

		// Select All — only visible, non-locked rows
		$body.on("click", ".ev-fp-select-all", () => {
			this.$list[0].querySelectorAll(
				".ev-fp-item:not(.ev-fp-locked):not([hidden]) .ev-fp-check"
			).forEach(cb => { cb.checked = true; });
			this._update_count();
		});

		// Deselect All — only visible, non-locked rows
		$body.on("click", ".ev-fp-deselect-all", () => {
			this.$list[0].querySelectorAll(
				".ev-fp-item:not(.ev-fp-locked):not([hidden]) .ev-fp-check"
			).forEach(cb => { cb.checked = false; });
			this._update_count();
		});

		// Count update on any checkbox change
		$body.on("change", ".ev-fp-check", () => this._update_count());
	}

	_update_count() {
		const total   = this._fields.filter(f => !f.is_section).length;
		const checked = this.$list[0].querySelectorAll(".ev-fp-check:checked").length;
		this.$list.closest(".ev-fp-body")
			.find(".ev-fp-count")
			.text(`${checked} / ${total} ${__("selected")}`);
	}

	// ── HTML5 drag-to-reorder (single set of listeners on parent ul) ──────────

	_init_drag() {
		const list = this.$list[0];
		let drag_src = null;

		list.addEventListener("dragstart", (e) => {
			const item = e.target.closest(".ev-fp-item:not(.ev-fp-locked)");
			if (!item) { e.preventDefault(); return; }
			drag_src = item;
			item.classList.add("ev-fp-dragging");
			e.dataTransfer.effectAllowed = "move";
			// Required for Firefox
			e.dataTransfer.setData("text/plain", item.dataset.fieldname);
		});

		list.addEventListener("dragend", () => {
			if (drag_src) drag_src.classList.remove("ev-fp-dragging");
			list.querySelectorAll(".ev-fp-drag-over")
				.forEach(el => el.classList.remove("ev-fp-drag-over"));
			drag_src = null;
		});

		list.addEventListener("dragover", (e) => {
			if (!drag_src) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "move";
			const target = e.target.closest(".ev-fp-item");
			if (!target || target === drag_src) return;
			list.querySelectorAll(".ev-fp-drag-over")
				.forEach(el => el.classList.remove("ev-fp-drag-over"));
			target.classList.add("ev-fp-drag-over");
		});

		list.addEventListener("dragleave", (e) => {
			// Only remove highlight when leaving the item itself (not its children)
			const item = e.target.closest(".ev-fp-item");
			if (item && !item.contains(e.relatedTarget)) {
				item.classList.remove("ev-fp-drag-over");
			}
		});

		list.addEventListener("drop", (e) => {
			e.preventDefault();
			const target = e.target.closest(".ev-fp-item");
			if (!target || !drag_src || target === drag_src) return;
			// Insert drag_src BEFORE the drop target
			list.insertBefore(drag_src, target);
			target.classList.remove("ev-fp-drag-over");
		});
	}

	// ── Apply ─────────────────────────────────────────────────────────────────

	_on_apply() {
		// Read ALL items from current DOM order (respects drag-to-reorder).
		// Hidden items (from search filter) are still read — their checked state persists.
		const regular = [];
		const ct = [];
		this.$list[0].querySelectorAll(".ev-fp-item").forEach(el => {
			if (!el.querySelector(".ev-fp-check")?.checked) return;
			const fn = el.dataset.fieldname;
			if (fn.includes("__")) ct.push(fn);
			else regular.push(fn);
		});

		if (regular.length < 1 && ct.length < 1) {
			frappe.show_alert(
				{ message: __("Select at least one column"), indicator: "orange" },
				3
			);
			return;
		}

		// Persist separately — regular fields only go to list_view.fields on next load;
		// CT fields are fetched via a separate API call after data loads.
		frappe.model.user_settings.save(this.doctype, "excel_columns", regular);
		frappe.model.user_settings.save(this.doctype, "excel_ct_columns", ct);

		this._close_modal?.();
		this.board.apply_field_selection([...regular, ...ct]);
	}
};
