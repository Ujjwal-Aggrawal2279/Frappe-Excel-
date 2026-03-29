/**
 * excel_view/excel_view.js
 *
 * ExcelView — extends frappe.views.ListView to provide a full
 * spreadsheet experience for any Frappe DocType.
 *
 * Class discovery: ListFactory looks for frappe.views["ExcelView"]
 * Route: /app/{doctype}/view/excel
 */

frappe.provide("frappe.views");

frappe.views.ExcelView = class ExcelView extends frappe.views.ListView {
	// ── Identity ──────────────────────────────────────────────────────────────

	get view_name() {
		return "Excel";
	}

	// ── Defaults ──────────────────────────────────────────────────────────────

	setup_defaults() {
		return super.setup_defaults().then(() => {
			// Reuse the reportview server method — it returns the same
			// { keys, values } format that BaseList.prepare_data expects.
			this.view = "Report";

			// Load 100 rows initially; infinite scroll appends 100 more on demand
			this.page_length = 100;

			// ── Override field list ────────────────────────────────────────────
			// super.setup_defaults() only loads the user's List View column config
			// (what they've pinned). For Excel View we want EVERY field on the
			// DocType, including custom fields, so the sheet behaves like a DB table.
			// meta is guaranteed to be loaded at this point (super waits for it).
			this.fields = this._get_all_meta_fields();

			// Extend menu items with Excel-specific actions
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

	/**
	 * Build a [[fieldname, doctype], ...] list for ALL non-layout fields on
	 * this DocType (including custom fields).  This is what drives both the
	 * server-side data fetch (frappe.desk.reportview.get) and the HOT columns.
	 *
	 * Skipped field types:
	 *   Layout-only  → Column Break, Section Break, Tab Break, Fold, Heading,
	 *                   HTML, Custom HTML  (no DB column)
	 *   Child tables → Table, Table MultiSelect  (separate child tables; can't
	 *                   be fetched in a flat row query)
	 *   Security     → Password
	 */
	_get_all_meta_fields() {
		const SKIP_TYPES = new Set([
			"Column Break", "Section Break", "Tab Break", "Fold",
			"Heading", "HTML", "Custom HTML",
			"Table", "Table MultiSelect",
			"Password",
		]);

		// Always put name first (shown as the ID column)
		const fields = [["name", this.doctype]];

		(this.meta?.fields || []).forEach((df) => {
			if (SKIP_TYPES.has(df.fieldtype)) return;
			if (df.fieldname === "name") return; // already added
			if (df.is_virtual) return;            // virtual fields aren't in DB
			fields.push([df.fieldname, this.doctype]);
		});

		return fields;
	}

	// ── Page setup ────────────────────────────────────────────────────────────

	setup_page() {
		super.setup_page();
		this.page.main.addClass("ev-page");
		// Raise .page-head z-index above HOT overlay clones (z-index 101-106).
		// page-head is position:sticky with z-index:6 by default; HOT clones at
		// 101-106 (global stacking context) would otherwise paint over the
		// view-switcher dropdown, clipping it.
		$(".page-head").addClass("ev-page-active");
	}

	// ── View setup ────────────────────────────────────────────────────────────

	setup_view() {
		// DOM order (top → bottom inside .frappe-list):
		//   1. Toolbar  (.ev-toolbar-outer)
		//   2. Formula bar (.ev-formula-bar-outer)
		//   3. Grid wrapper (this.$result — populated by ExcelBoard)
		this.$formula_bar_wrapper = $('<div class="ev-formula-bar-outer">');
		this.$toolbar_wrapper = $('<div class="ev-toolbar-outer">');

		// Prepend in reverse order so toolbar ends up at the top
		this.$frappe_list.prepend(this.$formula_bar_wrapper);
		this.$frappe_list.prepend(this.$toolbar_wrapper);

		// Optional: trigger new-doc shortcut same as ListView
		super.setup_new_doc_event?.();
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	/**
	 * Called by BaseList.refresh() after data is fetched.
	 * Initialise ExcelBoard on first render; call refresh() on subsequent renders.
	 */
	render() {
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
			// Hide Frappe's "no records" empty state — Excel View always shows
			// the grid + toolbar even when the DocType has zero records.
			this.$no_result?.hide();
		} else {
			// Pass append=true when this is a load-more (start > 0) so
			// board.refresh() can preserve the current scroll position.
			this.excel_board.refresh(this.data, { append: this.start > 0 });
			this.$no_result?.hide();
		}
	}

	/**
	 * Suppress the default List View column header row.
	 * HOT renders its own column headers.
	 */
	render_header() {
		// intentionally empty
	}

	/**
	 * Frappe's process_document_refreshes() patches this.data in-place then
	 * calls render_list() — NOT render().  Override here so incremental
	 * realtime updates (document saved in another window) flow into HOT.
	 */
	render_list() {
		if (this.excel_board) {
			this.excel_board.refresh(this.data, { append: false });
		}
	}

	/**
	 * Frappe's setup_realtime_updates() calls frappe.realtime.off("list_update")
	 * which wipes every handler — including ExcelBoard's formula-cache listener.
	 * Re-register it after super so it survives every refresh() cycle.
	 */
	setup_realtime_updates() {
		super.setup_realtime_updates();
		this.excel_board?._register_formula_realtime();
	}

	/**
	 * Frappe's process_document_refreshes() calls disable_realtime_updates() when
	 * the current route doesn't match "List/<doctype>" — which is always true for
	 * ExcelView (/app/customer/view/excel).  The default implementation calls
	 * frappe.realtime.doctype_unsubscribe() which tells the server to stop sending
	 * events to this socket.  After the very first realtime event we'd be silently
	 * unsubscribed and never receive another update.
	 *
	 * Override: skip the unsubscribe; only reset the flag so that the next
	 * setup_realtime_updates() call (triggered by list_view.refresh()) re-registers
	 * all handlers cleanly.
	 */
	disable_realtime_updates() {
		this.realtime_events_setup = false;
	}

	/**
	 * Override toggle_result_area so Excel View always keeps the grid
	 * container ($result) visible — even when the DocType has zero records.
	 * Without this, Frappe hides $result and shows $no_result when data=[],
	 * which prevents HOT from initialising and renders an empty-state message
	 * instead of the blank grid + toolbar.
	 */
	toggle_result_area() {
		super.toggle_result_area();
		this.$result.show();
		this.$no_result.hide();
	}

	// ── Sidebar ───────────────────────────────────────────────────────────────

	toggle_side_bar() {
		super.toggle_side_bar();
		// HOT needs an explicit re-render after the container width changes
		requestAnimationFrame(() => {
			this.excel_board?.resize();
		});
	}

	// ── Cleanup ───────────────────────────────────────────────────────────────

	/**
	 * Destroy the HOT instance when navigating away from Excel View.
	 * BaseList / ListView don't have a built-in destroy hook, but
	 * frappe.router re-creates the view on each route change, so the
	 * old instance will be garbage-collected. Explicitly destroy HOT
	 * to free memory and unbind global event listeners.
	 */
	on_hide() {
		$(".page-head").removeClass("ev-page-active");
		this.excel_board?.destroy();
		this.excel_board = null;
	}
};
