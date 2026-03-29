/**
 * excel_view_router.bundle.js
 *
 * Lightweight router-only bundle (~2KB).
 * Loaded on EVERY Frappe page via app_include_js.
 *
 * Responsibilities:
 *   1. Monkey-patch Frappe's router / view registration so the URL
 *      /app/{doctype}/view/excel resolves correctly on any page.
 *   2. Register a minimal ExcelView class that lazy-loads the full
 *      deps bundle (~1.4MB) only when the view is first opened.
 *
 * Zero cost for users who never open Excel View.
 */

frappe.provide("frappe.views");

// ── 1. Router: URL routing ────────────────────────────────────────────────────

if (!frappe.router.list_views.includes("excel")) {
	frappe.router.list_views.push("excel");
}
frappe.router.list_views_route["excel"] = "Excel";

// ── 2. view_modes: route validation + set_current_view recognition ────────────

if (!frappe.views.view_modes.includes("Excel")) {
	frappe.views.view_modes.push("Excel");
}

// ── 3. ListViewSelect.setup_views: add Excel menu item ────────────────────────
//
// Problem: setup_views() has a local `const views = { List: ..., Report: ... }`.
// The forEach does `views[view].condition` — crashes if "Excel" is in view_modes
// but NOT in the local views{} object.
//
// Solution: temporarily remove "Excel" from view_modes before calling original,
// restore it afterward, then manually add the Excel menu item.

const _orig_setup_views = frappe.views.ListViewSelect.prototype.setup_views;
frappe.views.ListViewSelect.prototype.setup_views = function () {
	const idx = frappe.views.view_modes.indexOf("Excel");
	if (idx > -1) frappe.views.view_modes.splice(idx, 1);

	_orig_setup_views.call(this);

	if (!frappe.views.view_modes.includes("Excel")) {
		frappe.views.view_modes.push("Excel");
	}

	if (this.current_view !== "Excel") {
		this.add_view_to_menu("Excel", () => this.set_route("excel"));
	}
};

// ── 4. BaseList.setup_view_menu: icon + label in view-switcher button ─────────

const _orig_setup_view_menu = frappe.views.BaseList.prototype.setup_view_menu;
frappe.views.BaseList.prototype.setup_view_menu = function () {
	_orig_setup_view_menu.call(this);
	if (this.views_list) {
		this.views_list.icon_map["Excel"] = "es-line-file-spreadsheet";
		this.views_list.label_map["Excel"] = __("Excel View");
	}
	if (this.view_name === "Excel" && this.views_menu) {
		this.views_menu
			.closest(".custom-btn-group")
			.find(".custom-btn-group-label")
			.text(__("Excel View"));
	}
};

// ── 5. ExcelView class — lazy shell ──────────────────────────────────────────
//
// This minimal class is registered immediately (so Frappe's ListFactory can
// find frappe.views["ExcelView"]).  The full implementation is injected by the
// deps bundle when it loads — it overwrites this class on window.
//
// The _deps_promise ensures the deps bundle is only fetched once even if
// render() is called multiple times before the first load completes.

frappe.views.ExcelView = class ExcelView extends frappe.views.ListView {
	get view_name() {
		return "Excel";
	}

	// ── Defaults ─────────────────────────────────────────────────────────────

	setup_defaults() {
		return super.setup_defaults().then(() => {
			this.view = "Report";
			this.page_length = frappe.is_large_screen() ? 500 : 100;
			this.fields = this._get_all_meta_fields();
			this.menu_items = [
				...this.menu_items,
				{
					label: __("Export to Excel (.xlsx)"),
					action: () => this.excel_board?.export_manager.export_xlsx(),
					standard: true,
				},
				{
					label: __("Export to CSV"),
					action: () => this.excel_board?.export_manager.export_csv(),
					standard: true,
				},
				{
					label: __("Import from Excel"),
					action: () => this.excel_board?.export_manager.import_xlsx(),
					condition: () => this.can_create,
					standard: true,
				},
				{
					label: __("Import from CSV"),
					action: () => this.excel_board?.export_manager.import_csv(),
					condition: () => this.can_create,
					standard: true,
				},
			];
		});
	}

	_get_all_meta_fields() {
		const SKIP_TYPES = new Set([
			"Column Break", "Section Break", "Tab Break", "Fold",
			"Heading", "HTML", "Custom HTML",
			"Table", "Table MultiSelect",
			"Password",
		]);

		// ── RBAC: only expose fields the current user can read ────────────────
		const perms = frappe.perm.get_perm(this.doctype) || [];
		const readable_permlevels = new Set(
			perms.filter(p => p.read).map(p => p.permlevel || 0)
		);
		const can_read = (df) => readable_permlevels.has(df.permlevel || 0);

		// System fields that are never useful as grid columns:
		// - docstatus: we show Status field which is human-readable
		// - idx: internal sort index, meaningless to users
		const ALWAYS_SKIP_FIELDS = new Set(["docstatus", "idx"]);

		// Label map for alphabetical sort (ID stays pinned at position 0)
		const label_map = {};
		(this.meta?.fields || []).forEach(df => {
			label_map[df.fieldname] = df.label || df.fieldname;
		});
		const by_label = (a, b) =>
			(__(label_map[a[0]] || a[0])).localeCompare(__(label_map[b[0]] || b[0]));

		const sort_fields = (arr) => {
			const name_entry = arr.shift(); // "name" always first
			arr.sort(by_label);
			arr.unshift(name_entry);
			return arr;
		};

		// ── Check for a previously saved column selection ─────────────────────
		const saved_columns = frappe.get_user_settings(this.doctype)?.excel_columns;

		if (Array.isArray(saved_columns) && saved_columns.length) {
			const valid = new Set(
				(this.meta?.fields || [])
					.filter(df =>
						!SKIP_TYPES.has(df.fieldtype) &&
						!ALWAYS_SKIP_FIELDS.has(df.fieldname) &&
						!df.is_virtual &&
						can_read(df)
					)
					.map(df => df.fieldname)
			);
			valid.add("name");

			const filtered = saved_columns.filter(f => valid.has(f));
			if (filtered.length) {
				// Preserve user's saved order (set via drag-to-reorder in field picker).
				// Drop any fields that no longer exist, are restricted, or always-skipped.
				return filtered.map(f => [f, this.doctype]);
			}
		}

		// Reuse ALWAYS_SKIP_FIELDS for the default path too
		const DEFAULT_SKIP_FIELDS = ALWAYS_SKIP_FIELDS;

		// ── Default: in_list_view === 1 fields (same logic as List/Report View) ─
		const fields = [["name", this.doctype]];
		(this.meta?.fields || []).forEach(df => {
			if (SKIP_TYPES.has(df.fieldtype)) return;
			if (df.fieldname === "name" || df.is_virtual) return;
			if (!can_read(df)) return;
			if (DEFAULT_SKIP_FIELDS.has(df.fieldname)) return;
			if (df.in_list_view) fields.push([df.fieldname, this.doctype]);
		});

		// ── Fallback: if no in_list_view fields defined, take first 10 readable ─
		if (fields.length === 1) {
			let count = 0;
			(this.meta?.fields || []).forEach(df => {
				if (count >= 10) return;
				if (SKIP_TYPES.has(df.fieldtype)) return;
				if (df.fieldname === "name" || df.is_virtual) return;
				if (!can_read(df)) return;
				if (DEFAULT_SKIP_FIELDS.has(df.fieldname)) return;
				fields.push([df.fieldname, this.doctype]);
				count++;
			});
		}

		return sort_fields(fields);
	}

	// ── Page / View setup ────────────────────────────────────────────────────

	setup_page() {
		super.setup_page();
		this.page.main.addClass("ev-page");
		$(".page-head").addClass("ev-page-active");
	}

	setup_view() {
		this.$formula_bar_wrapper = $('<div class="ev-formula-bar-outer">');
		this.$toolbar_wrapper = $('<div class="ev-toolbar-outer">');
		this.$frappe_list.prepend(this.$formula_bar_wrapper);
		this.$frappe_list.prepend(this.$toolbar_wrapper);
		super.setup_new_doc_event?.();
	}

	// ── Render — triggers lazy load ──────────────────────────────────────────

	render() {
		// Show a loading indicator while the bundle is being fetched
		if (!window._ev_deps_loaded && !window._ev_deps_loading) {
			this._show_loading_placeholder();
		}

		this._load_deps().then(() => {
			this._render_board();
		});
	}

	_show_loading_placeholder() {
		if (this.$result.find(".ev-loading").length) return;
		this.$result.html(
			`<div class="ev-loading" style="display:flex;align-items:center;justify-content:center;height:300px;color:var(--text-muted);">
				<div>
					<div class="spinner-border spinner-border-sm me-2" role="status"></div>
					${__("Loading Excel View…")}
				</div>
			</div>`
		);
	}

	_load_deps() {
		if (window._ev_deps_loaded) return Promise.resolve();
		if (window._ev_deps_loading) return window._ev_deps_loading;

		// Resolve hashed URL via Frappe's asset manifest (frappe.boot.assets_json)
		// so we get the content-hashed filename (e.g. excel_view.bundle.MR3ZSFIE.js)
		const url = frappe.boot?.assets_json?.["excel_view.bundle.js"]
			|| "/assets/excel_view/dist/js/excel_view.bundle.js";

		window._ev_deps_loading = new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src = url;
			script.onload = () => {
				window._ev_deps_loaded = true;
				window._ev_deps_loading = null;
				resolve();
			};
			script.onerror = (e) => {
				window._ev_deps_loading = null;
				console.error("[ExcelView] Failed to load deps bundle:", url, e);
				reject(e);
			};
			document.head.appendChild(script);
		});

		return window._ev_deps_loading;
	}

	_render_board() {
		if (!this.excel_board) {
			this.excel_board = new frappe.views.ExcelBoard({
				wrapper: this.$result[0],
				formula_bar: this.$formula_bar_wrapper[0],
				toolbar: this.$toolbar_wrapper[0],
				doctype: this.doctype,
				meta: this.meta,
				data: this.data,
				fields: this.fields,
				list_view: this,
			});
		}
		// Always call refresh — on first render this triggers CT enrichment and
		// join re-application; on subsequent renders it reloads data into HOT.
		this.excel_board.refresh(this.data);
	}

	/**
	 * Always keep the grid container visible — even when DocType has zero records.
	 * Frappe's base toggle_result_area hides $result and shows $no_result when
	 * data=[], which prevents HOT from initialising and shows the empty state.
	 */
	toggle_result_area() {
		super.toggle_result_area();
		this.$result.show();
		this.$no_result.hide();
	}

	render_header() {
		// intentionally empty — HOT renders its own column headers
	}

	/**
	 * Frappe's process_document_refreshes() patches this.data in-place then
	 * calls render_list().  Override so incremental realtime updates flow into HOT.
	 */
	render_list() {
		if (this.excel_board) {
			this.excel_board.refresh(this.data, { append: false });
		}
	}

	/**
	 * After super (which calls frappe.realtime.off("list_update")), re-register
	 * ExcelBoard's formula-cache/data handler so it survives every refresh() cycle.
	 */
	setup_realtime_updates() {
		super.setup_realtime_updates();
		this.excel_board?._register_formula_realtime();
	}

	/**
	 * Frappe's process_document_refreshes() calls this when the route check fails
	 * (ExcelView route is /view/excel, never matches "List/...").  The default
	 * calls frappe.realtime.doctype_unsubscribe() → server stops sending events.
	 * Override: skip the unsubscribe so the socket stays in the doctype room.
	 */
	disable_realtime_updates() {
		this.realtime_events_setup = false;
	}

	/**
	 * Frappe's default implementation gates on route[0] === "List" — ExcelView's
	 * route (/app/{doctype}/view/excel) never matches, so the pending queue is
	 * always discarded and disable_realtime_updates() is called instead of
	 * render_list().  Override to process the queue and refresh the grid directly.
	 */
	process_document_refreshes() {
		if (!this.pending_document_refreshes?.length) return;
		this.pending_document_refreshes = [];
		if (!this.excel_board || this.excel_board._destroyed) return;
		clearTimeout(this._excel_pdr_timer);
		this._excel_pdr_timer = setTimeout(() => {
			if (!this.excel_board?._destroyed) {
				this.last_args = null; // bypass no_change() 3-second throttle
				this.refresh();
			}
		}, 100);
	}

	// ── Sidebar ──────────────────────────────────────────────────────────────

	toggle_side_bar() {
		super.toggle_side_bar();
		// ResizeObserver on the grid wrapper handles the re-render automatically.
	}

	// ── Cleanup ──────────────────────────────────────────────────────────────

	on_hide() {
		$(".page-head").removeClass("ev-page-active");
		this.excel_board?.destroy();
		this.excel_board = null;
	}
};
