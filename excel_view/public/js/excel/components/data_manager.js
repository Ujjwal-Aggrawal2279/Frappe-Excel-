/**
 * excel_view/components/data_manager.js
 *
 * Handles all Frappe DB interactions:
 *  - Convert list data → 2D matrix for HOT
 *  - Determine cell read-only state from permissions + field config
 *  - Debounced save of edited cells → frappe.db.set_value
 *  - Row deletion
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.DataManager = class DataManager {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.board - ExcelBoard instance
	 */
	constructor(opts) {
		this.board = opts.board;
		// { doc_name: { fieldname: value, ... }, ... }
		this._save_queue = {};
		this._save_debounced = frappe.utils.debounce(
			this._flush_saves.bind(this),
			800
		);
		this._dirty = false;
	}

	// ── Data transformation ───────────────────────────────────────────────────

	/**
	 * Convert Frappe list data (array of objects) → 2D matrix aligned to HOT columns.
	 * @param {Object[]} data
	 * @param {Object[]} columns - HOT column config array
	 * @returns {Array[]}
	 */
	to_matrix(data, columns) {
		return data.map((row) =>
			columns.map((col) => {
				const val = row[col.data];
				// Normalise null/undefined to empty string
				return val !== null && val !== undefined ? val : "";
			})
		);
	}

	// ── Cell meta (HOT `cells` callback) ─────────────────────────────────────

	/**
	 * Called by HOT for every rendered cell.
	 * Returns { readOnly, className } based on permissions + field config.
	 * @param {number} row
	 * @param {number} col
	 * @returns {Object}
	 */
	get_cell_meta(row, col) {
		const col_def = this.board.columns[col];
		if (!col_def) return {};

		const is_readonly =
			col_def._readonly ||
			!this.board.list_view.can_write ||
			// name column always read-only
			col_def._is_name_col;

		if (is_readonly) {
			return { readOnly: true, className: "htDimmed" };
		}
		return {};
	}

	// ── Save queue ────────────────────────────────────────────────────────────

	/**
	 * Queue a batch of cell changes for debounced save to Frappe DB.
	 * @param {Array[]} changes - HOT changes [[row, col, oldVal, newVal], ...]
	 */
	queue_save(changes) {
		if (!changes || !this.board.list_view.can_write) return;

		const data = this.board.list_view.data;
		const columns = this.board.columns;
		let any_queued = false;

		changes.forEach(([row, fieldname, , newVal]) => {
			const doc = data[row];
			// In array-of-objects mode, HOT gives fieldname as 'col' (the prop key)
			const col_def = columns.find((c) => c.data === fieldname);
			// Skip formula/join columns — they exist only in the grid, never in the DB
			// Skip _is_new rows — they are pending inline inserts, not yet in the DB
			if (!doc || doc._is_new || !col_def || col_def._readonly || col_def._is_name_col
				|| col_def._is_formula_col || col_def._is_join_col) return;

			const doc_name = doc.name;
			if (!doc_name || !fieldname) return;

			if (!this._save_queue[doc_name]) this._save_queue[doc_name] = {};
			this._save_queue[doc_name][fieldname] = newVal;
			any_queued = true;
		});

		// Nothing was actually queued (e.g. all changes were formula/readonly columns)
		// — don't show the dirty indicator or schedule a pointless flush.
		if (!any_queued) return;

		this._dirty = true;
		this._show_dirty_indicator();
		this._save_debounced();
	}

	/**
	 * Flush all queued saves to Frappe DB.
	 * Called automatically after debounce delay.
	 */
	async _flush_saves() {
		if (!Object.keys(this._save_queue).length) return;

		const queue = { ...this._save_queue };
		this._save_queue = {};

		const doctype = this.board.doctype;
		// Single HTTP round-trip: server iterates sequentially in one transaction.
		// Prevents MySQL deadlocks that occur when parallel set_value calls lock
		// the same child tables or related rows concurrently.
		const updates = Object.entries(queue).map(([name, fields]) => ({ name, fields }));

		try {
			const r = await frappe.call({
				method: "excel_view.api.bulk_set_value",
				args: { doctype, updates: JSON.stringify(updates) },
			});
			const errors = r.message?.errors || [];
			if (errors.length) {
				frappe.show_alert(
					{ message: __("{0} record(s) failed to save", [errors.length]), indicator: "red" },
					4
				);
			} else {
				this._dirty = false;
				this._clear_dirty_indicator();
				frappe.show_alert({ message: __("Saved"), indicator: "green" }, 1);
			}
		} catch (_) {
			frappe.show_alert({ message: __("Save failed — please retry"), indicator: "red" }, 4);
		}
	}

	// ── Row deletion ──────────────────────────────────────────────────────────

	/**
	 * Delete rows from HOT and from Frappe DB.
	 * @param {number} start_row - Inclusive start row index
	 * @param {number} end_row   - Inclusive end row index
	 */
	async delete_rows(start_row, end_row) {
		const data = this.board.list_view.data;
		const to_delete = data.slice(start_row, end_row + 1);

		const failures = [];
		for (const doc of to_delete) {
			try {
				await frappe.db.delete_doc(this.board.doctype, doc.name);
			} catch (e) {
				failures.push(doc.name);
				console.error("Excel View delete error:", e);
			}
		}

		if (failures.length) {
			frappe.show_alert(
				{
					message: __("Failed to delete: {0}", [failures.join(", ")]),
					indicator: "red",
				},
				5
			);
		} else {
			frappe.show_alert(
				{
					message: __(
						"{0} record(s) deleted",
						[to_delete.length]
					),
					indicator: "green",
				},
				2
			);
			// Remove from HOT and refresh
			this.board.hot.alter("remove_row", start_row, end_row - start_row + 1);
			this.board.list_view.refresh();
		}
	}

	// ── Dirty state ───────────────────────────────────────────────────────────

	_show_dirty_indicator() {
		this.board.list_view?.page?.set_indicator(__("Unsaved changes"), "orange");
	}

	_clear_dirty_indicator() {
		this.board.list_view?.page?.clear_indicator();
	}

	/**
	 * Returns true if there are unsaved changes.
	 */
	is_dirty() {
		return this._dirty || Object.keys(this._save_queue).length > 0;
	}
};
