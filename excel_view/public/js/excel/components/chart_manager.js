/**
 * excel_view/components/chart_manager.js
 *
 * ChartManager — Insert tab chart workflow:
 *   1. Dialog: pick X axis + Y axis fields + title → live frappe.Chart preview
 *   2. "Add to Sheet" → creates a draggable/resizable overlay on .ev-hot-container
 *   3. Edit: pencil button on overlay header re-opens dialog pre-filled with current config
 *   4. Overlay state serialized in board.chart_overlays[] for workbook + user_settings persistence
 *
 * Requires frappe.Chart (frappe-charts) to be available globally via desk bundle.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.ChartManager = class ChartManager {
	constructor({ board }) {
		this.board = board;
		this._overlays = []; // live overlay objects: { id, $el, chart_instance, cfg }
	}

	/** Open the "Insert Chart" dialog for the given chart type. */
	open_dialog(chart_type = "bar") {
		this._chart_type = chart_type;
		this._edit_overlay_id = null; // fresh insert
		this._build_dialog();
	}

	/** Open dialog pre-filled to edit an existing overlay. */
	_open_edit_dialog(overlay) {
		this._chart_type    = overlay.cfg.type;
		this._edit_overlay_id = overlay.id;
		this._build_dialog(overlay.cfg);
	}

	/** Restore chart overlays from a saved workbook/user_settings config. */
	restore(overlays) {
		(overlays || []).forEach((cfg) => this._create_overlay(cfg));
		// Show only overlays for the current active sheet
		const active_id = this.board.sheet_manager?.get_current()?.id || "default";
		this._show_overlays_for_sheet(active_id);
	}

	/**
	 * Show only overlays belonging to `sheet_id`, hide all others.
	 * Called on every tab switch (from sheet_manager._apply_sheet).
	 */
	_show_overlays_for_sheet(sheet_id) {
		this._overlays.forEach((o) => {
			const belongs = !o.cfg.sheet_id || o.cfg.sheet_id === sheet_id;
			o.$el.toggle(belongs);
		});
	}

	/**
	 * Re-build labels/datasets for every visible overlay from current board data,
	 * then re-render the frappe.Chart.  Called from board.refresh() so charts
	 * stay in sync when filters change, new records are added, etc.
	 */
	rerender_all_visible() {
		const active_id = this.board.sheet_manager?.get_current()?.id || "default";
		this._overlays.forEach((overlay) => {
			const belongs = !overlay.cfg.sheet_id || overlay.cfg.sheet_id === active_id;
			if (!belongs) return;
			this._rebuild_overlay_data(overlay);
			this._rerender_overlay(overlay);
		});
	}

	/** Return the data for the currently active sheet (report/pivot/blank or base). */
	_get_sheet_data() {
		const active = this.board.sheet_manager?.get_current();
		if (active?.data?.length && (!active._data_is_stale || active.pivot_config)) return active.data;
		if (!active) return this.board.list_view?.data || [];
		return this.board.list_view?.data || [];
	}

	/**
	 * Re-compute labels/datasets from the active sheet's data,
	 * using the overlay's saved x_key / y_keys / row_limit.
	 * Updates overlay.cfg AND the stored entry in board.chart_overlays.
	 */
	_rebuild_overlay_data(overlay) {
		const data = this._get_sheet_data();
		const { x_key, y_keys, row_limit } = overlay.cfg;
		if (!x_key || !y_keys?.length) return;
		const rows    = row_limit > 0 ? data.slice(0, row_limit) : data;
		const labels  = rows.map((r) => String(r[x_key] ?? ""));
		const datasets = y_keys.map((key) => ({
			name:   this.board.columns?.find((c) => c.data === key)?.title || key,
			values: rows.map((r) => parseFloat(r[key]) || 0),
		}));
		overlay.cfg.labels   = labels;
		overlay.cfg.datasets = datasets;
		const stored = this.board.chart_overlays?.find((c) => c.id === overlay.id);
		if (stored) { stored.labels = labels; stored.datasets = datasets; }
	}

	/** Persist current chart_overlays to user_settings and mark workbook dirty. */
	_persist() {
		frappe.model.user_settings.save(
			this.board.doctype,
			"excel_chart_overlays",
			this.board.chart_overlays || [],
		);
		this.board._mark_unsaved?.();
	}

	// ── Dialog ──────────────────────────────────────────────────────────────

	/** @param {Object} [prefill] - existing overlay cfg for edit mode */
	_build_dialog(prefill = null) {
		const cols = this.board.columns || [];
		const data  = this._get_sheet_data();
		const is_edit = !!prefill;

		// X axis options — all columns
		const x_opts = cols.map((c) => {
			const sel = prefill && prefill.x_key === c.data ? "selected" : "";
			return `<option value="${c.data}" ${sel}>${frappe.utils.escape_html(c.title || c.data)}</option>`;
		}).join("");

		// Y axis chips — NO pre-selection; in edit mode highlight saved y_keys
		const saved_y_keys = new Set(prefill?.y_keys || []);
		const y_chips_html = cols.map((c) => {
			const on = saved_y_keys.has(c.data);
			return `<label class="ev-cd-y-chip ${on ? "ev-cd-y-chip--on" : ""}" data-key="${c.data}">
				<input type="checkbox" ${on ? "checked" : ""} style="display:none">
				<span>${frappe.utils.escape_html(c.title || c.data)}</span>
			</label>`;
		}).join("");

		// Chart type buttons
		const TYPES = [
			{ key: "bar",     label: __("Bar"),     icon: `<svg viewBox="0 0 20 20" fill="currentColor"><rect x="2" y="9" width="3" height="9"/><rect x="7" y="5" width="3" height="13"/><rect x="12" y="2" width="3" height="16"/></svg>` },
			{ key: "line",    label: __("Line"),    icon: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2,16 7,8 11,12 16,4"/><circle cx="2" cy="16" r="1.5" fill="currentColor"/><circle cx="7" cy="8" r="1.5" fill="currentColor"/><circle cx="11" cy="12" r="1.5" fill="currentColor"/><circle cx="16" cy="4" r="1.5" fill="currentColor"/></svg>` },
			{ key: "pie",     label: __("Pie"),     icon: `<svg viewBox="0 0 20 20"><path d="M10 2 A8 8 0 0 1 18 10 L10 10 Z" fill="#2196F3"/><path d="M18 10 A8 8 0 0 1 5 16.9 L10 10 Z" fill="#4CAF50"/><path d="M5 16.9 A8 8 0 0 1 10 2 L10 10 Z" fill="#FF9800"/></svg>` },
			{ key: "donut",   label: __("Donut"),   icon: `<svg viewBox="0 0 20 20"><path d="M10 3 A7 7 0 0 1 17 10 L13.5 10 A3.5 3.5 0 0 0 10 6.5 Z" fill="#2196F3"/><path d="M17 10 A7 7 0 0 1 5.5 16.1 L7.25 13.05 A3.5 3.5 0 0 0 13.5 10 Z" fill="#4CAF50"/><path d="M5.5 16.1 A7 7 0 0 1 10 3 L10 6.5 A3.5 3.5 0 0 0 7.25 13.05 Z" fill="#FF9800"/></svg>` },
			{ key: "scatter", label: __("Scatter"), icon: `<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="4" cy="14" r="2"/><circle cx="8" cy="7" r="2"/><circle cx="13" cy="11" r="2"/><circle cx="16" cy="4" r="2"/><circle cx="6" cy="16" r="1.5"/></svg>` },
		];

		const type_tabs_html = TYPES.map((t) => `
			<button class="ev-cd-type-btn ${t.key === this._chart_type ? "ev-cd-type-btn--active" : ""}"
				data-type="${t.key}" title="${t.label}">
				<span class="ev-cd-type-icon">${t.icon}</span>
				<span class="ev-cd-type-label">${t.label}</span>
			</button>
		`).join("");

		// Row limit — restore saved if editing
		const limit_val = prefill?.row_limit || 50;
		const limits = [25, 50, 100, 200, 0];
		const limit_opts = limits.map((v) =>
			`<option value="${v}" ${v === limit_val ? "selected" : ""}>${v === 0 ? __("All") : v}</option>`
		).join("");

		this.$modal = $(`
			<div class="ev-chart-dialog-backdrop">
				<div class="ev-chart-dialog">

					<!-- Header -->
					<div class="ev-cd-header">
						<div class="ev-cd-header-left">
							<svg class="ev-cd-header-icon" viewBox="0 0 20 20" fill="currentColor">
								<rect x="2" y="9" width="3" height="9" rx="1"/><rect x="7" y="5" width="3" height="13" rx="1"/><rect x="12" y="2" width="3" height="16" rx="1"/>
							</svg>
							<span class="ev-cd-header-title">${is_edit ? __("Edit Chart") : __("Insert Chart")}</span>
						</div>
						<button class="ev-chart-close ev-cd-close-btn" aria-label="${__("Close")}">
							<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
						</button>
					</div>

					<div class="ev-cd-body">
						<!-- Left Panel -->
						<div class="ev-cd-left">

							<!-- Chart type picker -->
							<div class="ev-cd-section">
								<div class="ev-cd-section-label">${__("Chart Type")}</div>
								<div class="ev-cd-type-grid">${type_tabs_html}</div>
							</div>

							<!-- Title -->
							<div class="ev-cd-section">
								<div class="ev-cd-section-label">${__("Title")}</div>
								<input class="ev-chart-title ev-cd-input"
									placeholder="${__("e.g. Monthly Sales")}"
									value="${frappe.utils.escape_html(prefill?.title || "")}">
							</div>

							<!-- X Axis -->
							<div class="ev-cd-section">
								<div class="ev-cd-section-label">${__("X Axis")} <span class="ev-cd-section-hint">${__("Labels")}</span></div>
								<div class="ev-cd-select-wrap">
									<select class="ev-chart-x ev-cd-select">
										<option value="" disabled ${prefill ? "" : "selected"}>${__("— pick a column —")}</option>
										${x_opts}
									</select>
									<svg class="ev-cd-select-arrow" viewBox="0 0 12 12" fill="currentColor"><path d="M6 8L1 3h10z"/></svg>
								</div>
							</div>

							<!-- Y Axis chips -->
							<div class="ev-cd-section">
								<div class="ev-cd-section-label">${__("Y Axis")} <span class="ev-cd-section-hint">${__("Values — toggle columns")}</span></div>
								<div class="ev-cd-y-chips">${y_chips_html}</div>
							</div>

							<!-- Aggregate toggle -->
							<div class="ev-cd-section ev-cd-section--inline">
								<label class="ev-cd-section-label" style="display:flex;align-items:center;gap:6px;cursor:pointer">
									<input type="checkbox" class="ev-cd-aggregate" ${prefill?.aggregate ? "checked" : ""}
										style="width:14px;height:14px;accent-color:var(--ev-green);cursor:pointer">
									<span>${__("Group & Sum by X Axis")}</span>
								</label>
							</div>

							<!-- Row limit -->
							<div class="ev-cd-section ev-cd-section--inline">
								<div class="ev-cd-section-label">${__("Row limit")}</div>
								<select class="ev-cd-row-limit ev-cd-select-sm">${limit_opts}</select>
							</div>

						</div>

						<!-- Right Panel: preview -->
						<div class="ev-cd-right">
							<div class="ev-cd-preview-area">
								<div class="ev-cd-empty-state">
									<svg viewBox="0 0 64 64" fill="none">
										<rect x="8" y="32" width="10" height="24" rx="2" fill="var(--ev-green)" opacity=".7"/>
										<rect x="22" y="20" width="10" height="36" rx="2" fill="var(--ev-green)" opacity=".85"/>
										<rect x="36" y="10" width="10" height="46" rx="2" fill="var(--ev-green)"/>
										<rect x="50" y="24" width="10" height="32" rx="2" fill="var(--ev-green)" opacity=".6"/>
									</svg>
									<p>${__("Select X Axis and at least one Y value,")}<br>${__("then click Preview")}</p>
								</div>
								<div class="ev-chart-preview-mount" style="display:none;width:100%;height:100%"></div>
							</div>
						</div>
					</div>

					<!-- Footer -->
					<div class="ev-cd-footer">
						<button class="ev-chart-preview ev-cd-preview-btn">
							<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/></svg>
							${__("Preview")}
						</button>
						<div style="flex:1"></div>
						<button class="ev-chart-cancel ev-cd-cancel-btn">${__("Cancel")}</button>
						<button class="ev-chart-add-to-sheet ev-cd-add-btn">
							<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>
							${is_edit ? __("Update Chart") : __("Add to Sheet")}
						</button>
					</div>

				</div>
			</div>
		`).appendTo(document.body);

		// Chart type switcher
		this.$modal.on("click", ".ev-cd-type-btn", (e) => {
			const $btn = $(e.currentTarget);
			this._chart_type = $btn.data("type");
			this.$modal.find(".ev-cd-type-btn").removeClass("ev-cd-type-btn--active");
			$btn.addClass("ev-cd-type-btn--active");
		});

		// Y chip toggles
		this.$modal.on("click", ".ev-cd-y-chip", (e) => {
			const $chip = $(e.currentTarget);
			const $cb   = $chip.find("input");
			$cb.prop("checked", !$cb.prop("checked"));
			$chip.toggleClass("ev-cd-y-chip--on", $cb.prop("checked"));
		});

		// Buttons
		this.$modal.find(".ev-chart-close, .ev-chart-cancel").on("click", () => this.$modal.remove());
		this.$modal.find(".ev-chart-preview").on("click",       () => this._render_preview());
		this.$modal.find(".ev-chart-add-to-sheet").on("click",  () => this._add_to_sheet());

		// Keyboard close
		$(document).on("keydown.ev_chart_dlg", (e) => {
			if (e.key === "Escape") { this.$modal?.remove(); $(document).off("keydown.ev_chart_dlg"); }
		});

		// In edit mode: auto-preview with existing data
		if (is_edit) this._render_preview();
	}

	_get_chart_data() {
		const x_key     = this.$modal.find(".ev-chart-x").val();
		const y_keys    = this.$modal.find(".ev-cd-y-chip--on").map((_, el) => $(el).data("key")).get();
		const title     = this.$modal.find(".ev-chart-title").val() || __("Chart");
		const limit     = parseInt(this.$modal.find(".ev-cd-row-limit").val()) || 50;
		const aggregate = this.$modal.find(".ev-cd-aggregate").is(":checked");
		const data      = this._get_sheet_data();
		// Exclude tree child rows (virtual rows — their parent header already has the summary)
		const base_rows = data.filter(r => !r._tree_is_child);
		const rows      = limit > 0 ? base_rows.slice(0, limit) : base_rows;

		let labels, datasets;
		if (aggregate) {
			// Group by X value — numeric fields → SUM, non-numeric (e.g. ID) → COUNT
			const order = [];
			const groups = {};
			rows.forEach(row => {
				const lbl = String(row[x_key] ?? "");
				if (!groups[lbl]) { groups[lbl] = {}; order.push(lbl); }
				y_keys.forEach(k => {
					const v = parseFloat(row[k]);
					groups[lbl][k] = (groups[lbl][k] || 0) + (isNaN(v) ? 1 : v);
				});
			});
			labels   = order;
			datasets = y_keys.map(key => {
				const col_title = this.board.columns.find(c => c.data === key)?.title || key;
				// Determine if this key is numeric by checking first non-null value
				const sample = rows.find(r => r[key] != null)?.[key];
				const is_numeric = sample != null && !isNaN(parseFloat(sample));
				return {
					name:   is_numeric ? col_title : `${col_title} (Count)`,
					values: order.map(lbl => groups[lbl][key] || 0),
				};
			});
		} else {
			labels   = rows.map(row => String(row[x_key] ?? ""));
			datasets = y_keys.map(key => ({
				name:   this.board.columns.find(c => c.data === key)?.title || key,
				values: rows.map(row => parseFloat(row[key]) || 0),
			}));
		}
		return { title, type: this._chart_type, x_key, y_keys, row_limit: limit, aggregate, labels, datasets };
	}

	_render_preview() {
		const $mount = this.$modal.find(".ev-chart-preview-mount");
		const $empty = this.$modal.find(".ev-cd-empty-state");
		const { type, title, labels, datasets } = this._get_chart_data();

		if (!datasets.length || !labels.length) {
			frappe.show_alert({ message: __("Select X Axis and at least one Y value"), indicator: "orange" }, 3);
			return;
		}

		$empty.hide();
		$mount.show().empty();

		try {
			new frappe.Chart($mount[0], {
				type,
				title,
				data:   { labels, datasets },
				height: $mount[0].clientHeight - 10 || 320,
				colors: ["#2196F3", "#4CAF50", "#FF9800", "#E91E63", "#9C27B0", "#00BCD4"],
			});
		} catch (e) {
			$mount.html(`<div class="ev-cd-preview-error">${__("Preview error")}: ${frappe.utils.escape_html(e.message)}</div>`);
		}
	}

	_add_to_sheet() {
		const chart_data = this._get_chart_data();
		if (!chart_data.datasets.length || !chart_data.labels.length) {
			frappe.show_alert({ message: __("Select X Axis and at least one Y value"), indicator: "orange" }, 3);
			return;
		}

		if (this._edit_overlay_id) {
			// Edit mode — update existing overlay
			const overlay = this._overlays.find((o) => o.id === this._edit_overlay_id);
			if (overlay) {
				Object.assign(overlay.cfg, chart_data);
				this._rerender_overlay(overlay);
				const stored = this.board.chart_overlays?.find((c) => c.id === overlay.id);
				if (stored) Object.assign(stored, chart_data);
				this._persist();
			}
		} else {
			// Insert mode — create new overlay
			const cfg = {
				id:        `chart_${Date.now()}`,
				left:      80,
				top:       80,
				width:     500,
				height:    300,
				sheet_id:  this.board.sheet_manager?.get_current()?.id || "default",
				...chart_data,
			};
			this._create_overlay(cfg);
			this._persist();
		}

		this.$modal.remove();
		$(document).off("keydown.ev_chart_dlg");
	}

	// ── Overlay ──────────────────────────────────────────────────────────────

	_create_overlay(cfg) {
		// Default sheet_id to current active sheet if not present
		if (!cfg.sheet_id) cfg.sheet_id = this.board.sheet_manager?.get_current()?.id || "default";

		const $el = $(`
			<div class="ev-chart-overlay" style="left:${cfg.left}px;top:${cfg.top}px;width:${cfg.width}px;height:${cfg.height}px">
				<div class="ev-chart-overlay-header">
					<span class="ev-chart-overlay-title">${frappe.utils.escape_html(cfg.title || "")}</span>
					<button class="ev-chart-overlay-move" title="${__("Move to sheet")}">
						<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M1.5 1h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-5a.5.5 0 0 1 1 0v5A1.5 1.5 0 0 1 12.5 15h-11A1.5 1.5 0 0 1 0 13.5v-11A1.5 1.5 0 0 1 1.5 1zm7 0h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0V2.707l-7.146 7.147a.5.5 0 0 1-.708-.708L12.293 2H8.5a.5.5 0 0 1 0-1z"/></svg>
					</button>
					<button class="ev-chart-overlay-edit" title="${__("Edit chart")}">
						<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/></svg>
					</button>
					<button class="ev-chart-overlay-close" title="${__("Remove")}">
						<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
					</button>
				</div>
				<div class="ev-chart-mount" style="width:100%;height:calc(100% - 28px)"></div>
				<div class="ev-chart-resize" title="${__("Resize")}"></div>
			</div>
		`).appendTo(this.board.$hot_container);

		let chart_instance = null;
		try {
			chart_instance = new frappe.Chart($el.find(".ev-chart-mount")[0], {
				type:   cfg.type,
				title:  cfg.title,
				data:   { labels: cfg.labels, datasets: cfg.datasets },
				height: cfg.height - 40,
				colors: ["#2196F3", "#4CAF50", "#FF9800", "#E91E63", "#9C27B0"],
			});
		} catch (e) {
			$el.find(".ev-chart-mount").html(`<div style="padding:8px;font-size:11px;color:red">${frappe.utils.escape_html(e.message)}</div>`);
		}

		const overlay = { id: cfg.id, $el, chart_instance, cfg: { ...cfg } };
		this._overlays.push(overlay);

		if (!this.board.chart_overlays) this.board.chart_overlays = [];
		this.board.chart_overlays.push(cfg);

		// Header buttons
		$el.find(".ev-chart-overlay-close").on("click", () => {
			this._remove_overlay(overlay);
			this._persist();
		});
		$el.find(".ev-chart-overlay-edit").on("click",  () => this._open_edit_dialog(overlay));
		$el.find(".ev-chart-overlay-move").on("click",  () => this._open_move_to_sheet_dialog(overlay));

		// Drag + resize
		this._bind_drag($el, overlay);
		this._bind_resize($el, overlay);
	}

	/** Re-render the frappe.Chart inside an existing overlay (after edit). */
	_rerender_overlay(overlay) {
		const $mount = overlay.$el.find(".ev-chart-mount");
		$mount.empty();
		overlay.$el.find(".ev-chart-overlay-title").text(overlay.cfg.title || "");
		try {
			overlay.chart_instance = new frappe.Chart($mount[0], {
				type:   overlay.cfg.type,
				title:  overlay.cfg.title,
				data:   { labels: overlay.cfg.labels, datasets: overlay.cfg.datasets },
				height: overlay.cfg.height - 40,
				colors: ["#2196F3", "#4CAF50", "#FF9800", "#E91E63", "#9C27B0"],
			});
		} catch (e) {
			$mount.html(`<div style="padding:8px;font-size:11px;color:red">${frappe.utils.escape_html(e.message)}</div>`);
		}
	}

	_remove_overlay(overlay) {
		overlay.$el.remove();
		this._overlays = this._overlays.filter((o) => o.id !== overlay.id);
		if (this.board.chart_overlays) {
			this.board.chart_overlays = this.board.chart_overlays.filter((c) => c.id !== overlay.id);
		}
	}

	/** Move chart overlay to a different sheet tab. */
	_open_move_to_sheet_dialog(overlay) {
		const sm = this.board.sheet_manager;
		const all_sheets = sm ? sm.get_all() : [];

		// Other sheets (not current)
		const current_id = overlay.cfg.sheet_id || sm?.get_current()?.id || "default";
		const others = all_sheets.filter((s) => s.id !== current_id);

		if (!others.length) {
			// No other sheet — offer to create a blank sheet for the chart
			frappe.confirm(
				__("No other sheets exist. Create a new blank sheet and move this chart there?"),
				() => {
					if (!sm) return;
					const new_id = sm.add_blank_sheet(__("Charts"));
					this._do_move_overlay(overlay, new_id);
					frappe.show_alert({ message: __("Chart moved to new sheet"), indicator: "green" }, 3);
				}
			);
			return;
		}

		const opts_html = others.map((s) =>
			`<div class="ev-cm-sheet-opt" data-id="${s.id}" style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-radius:4px;font-size:13px;border:1px solid var(--border-color);margin-bottom:6px">
				<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5L14 4.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5h-2z"/></svg>
				${frappe.utils.escape_html(s.label)}
			</div>`
		).join("") + `
			<div class="ev-cm-sheet-opt" data-id="__new__" style="display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;border-radius:4px;font-size:13px;border:1px dashed var(--border-color);margin-bottom:6px;color:var(--text-muted)">
				<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>
				${__("New blank sheet")}
			</div>`;

		const d = new frappe.ui.Dialog({
			title: __("Move Chart to Sheet"),
			fields: [{
				fieldtype: "HTML",
				options: `<div style="padding:4px 0">${opts_html}</div>`,
			}],
		});
		d.show();

		d.$wrapper.find(".ev-cm-sheet-opt").on("click", (e) => {
			const target_id = $(e.currentTarget).data("id");
			d.hide();
			if (target_id === "__new__") {
				const new_id = sm.add_blank_sheet(__("Charts"));
				this._do_move_overlay(overlay, new_id);
			} else {
				this._do_move_overlay(overlay, target_id);
			}
			frappe.show_alert({ message: __("Chart moved"), indicator: "green" }, 2);
		});
		d.$wrapper.find(".ev-cm-sheet-opt").on("mouseenter", (e) => {
			$(e.currentTarget).css("background", "var(--bg-color)");
		}).on("mouseleave", (e) => {
			$(e.currentTarget).css("background", "");
		});
	}

	/** Change overlay's sheet_id to target_id and hide it if target is not active. */
	_do_move_overlay(overlay, target_id) {
		overlay.cfg.sheet_id = target_id;
		const stored = this.board.chart_overlays?.find((c) => c.id === overlay.id);
		if (stored) stored.sheet_id = target_id;

		const active_id = this.board.sheet_manager?.get_current()?.id || "default";
		overlay.$el.toggle(target_id === active_id);
		this._persist();
	}

	_bind_drag($el, overlay) {
		$el.find(".ev-chart-overlay-header").on("pointerdown", (e) => {
			if ($(e.target).closest(".ev-chart-overlay-close, .ev-chart-overlay-edit").length) return;
			e.preventDefault();
			const rect  = $el[0].getBoundingClientRect();
			const ox    = e.clientX - rect.left;
			const oy    = e.clientY - rect.top;
			const $container      = this.board.$hot_container;
			const container_rect  = $container[0].getBoundingClientRect();

			const on_move = (me) => {
				const cw   = $container[0].clientWidth;
				const ch   = $container[0].clientHeight;
				const left = Math.min(Math.max(0, me.clientX - container_rect.left - ox), cw - $el[0].offsetWidth);
				const top  = Math.min(Math.max(0, me.clientY - container_rect.top  - oy), ch - $el[0].offsetHeight);
				$el.css({ left: left + "px", top: top + "px" });
				overlay.cfg.left = left;
				overlay.cfg.top  = top;
				const stored = this.board.chart_overlays?.find((c) => c.id === overlay.id);
				if (stored) { stored.left = left; stored.top = top; }
			};
			const on_up = () => {
				$(document).off("pointermove.ev_chart_drag pointerup.ev_chart_drag");
				this._persist();
			};
			$(document).on("pointermove.ev_chart_drag", on_move).on("pointerup.ev_chart_drag", on_up);
		});
	}

	_bind_resize($el, overlay) {
		$el.find(".ev-chart-resize").on("pointerdown", (e) => {
			e.preventDefault();
			const start_x  = e.clientX;
			const start_y  = e.clientY;
			const start_w  = $el[0].offsetWidth;
			const start_h  = $el[0].offsetHeight;
			const $container = this.board.$hot_container;

			const on_move = (me) => {
				// Clamp to container bounds: left + width <= containerWidth, top + height <= containerHeight
				const max_w = $container[0].clientWidth  - overlay.cfg.left;
				const max_h = $container[0].clientHeight - overlay.cfg.top;
				const w = Math.min(max_w, Math.max(200, start_w + me.clientX - start_x));
				const h = Math.min(max_h, Math.max(150, start_h + me.clientY - start_y));
				$el.css({ width: w + "px", height: h + "px" });
				overlay.cfg.width  = w;
				overlay.cfg.height = h;
				const stored = this.board.chart_overlays?.find((c) => c.id === overlay.id);
				if (stored) { stored.width = w; stored.height = h; }
			};
			const on_up = () => {
				$(document).off("pointermove.ev_chart_resize pointerup.ev_chart_resize");
				this._rerender_overlay(overlay);
				this._persist();
			};
			$(document).on("pointermove.ev_chart_resize", on_move).on("pointerup.ev_chart_resize", on_up);
		});
	}
};
