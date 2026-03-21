/**
 * excel_view/components/context_menu.js
 *
 * Builds the Handsontable 6.x contextMenu configuration object.
 * Context menu appears on right-click on any cell.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.ContextMenu = class ContextMenu {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.board - ExcelBoard instance
	 */
	constructor(opts) {
		this.board = opts.board;
	}

	/**
	 * Returns the HOT contextMenu config to pass into new Handsontable().
	 * @returns {Object}
	 */
	get_config() {
		const board = this.board;

		return {
			items: {
				// ── Row operations ─────────────────────────────────────────────
				insert_row_above: {
					name: () => __("Insert row above"),
					callback: (key, selection) => {
						const row = selection[0].start.row;
						board.hot.alter("insert_row", row, 1);
					},
					disabled: () => !board.list_view.can_create,
				},

				insert_row_below: {
					name: () => __("Insert row below"),
					callback: (key, selection) => {
						const row = selection[0].end.row + 1;
						board.hot.alter("insert_row", row, 1);
					},
					disabled: () => !board.list_view.can_create,
				},

				remove_row: {
					name: () => {
						const sel = board.hot.getSelected();
						const count =
							sel && sel.length ? Math.abs(sel[0][2] - sel[0][0]) + 1 : 1;
						return count > 1
							? __("Remove {0} rows", [count])
							: __("Remove row");
					},
					callback: (key, selection) => {
						const start = Math.min(selection[0].start.row, selection[0].end.row);
						const end = Math.max(selection[0].start.row, selection[0].end.row);
						frappe.confirm(
							__("Delete {0} record(s)? This cannot be undone.", [
								end - start + 1,
							]),
							() => board.data_manager.delete_rows(start, end)
						);
					},
					disabled: () => !board.list_view.can_write,
				},

				// V3.1 — Hide / Unhide rows (HOT 6: uses board._hide_rows / _unhide_all_rows)
			hide_row: {
				name: () => {
					const sel = board.hot.getSelected();
					const count = sel?.length ? Math.abs(sel[0][2] - sel[0][0]) + 1 : 1;
					return count > 1 ? __("Hide {0} Rows", [count]) : __("Hide Row");
				},
				callback: (key, selection) => {
					const rows = [];
					selection.forEach(({ start, end }) => {
						const r1 = Math.min(start.row, end.row);
						const r2 = Math.max(start.row, end.row);
						for (let r = r1; r <= r2; r++) rows.push(r);
					});
					board._hide_rows(rows);
				},
			},

			show_rows: {
				name: () => __("Unhide Rows"),
				disabled: () => !board._hidden_rows?.length,
				callback: () => board._unhide_all_rows(),
			},

			sep1: "---------",

				// ── Clipboard ─────────────────────────────────────────────────
				copy: {
					name: () => __("Copy") + "\t\tCtrl+C",
					callback: () => board.hot.copyPaste.copy(),
				},

				cut: {
					name: () => __("Cut") + "\t\tCtrl+X",
					callback: () => board.hot.copyPaste.cut(),
					disabled: () => !board.list_view.can_write,
				},

				paste: {
					name: () => __("Paste") + "\t\tCtrl+V",
					callback: () => board.hot.copyPaste.paste(),
					disabled: () => !board.list_view.can_write,
				},

				sep2: "---------",

				// ── Cell operations ───────────────────────────────────────────
				clear_cell: {
					name: () => __("Clear cell(s)"),
					callback: (key, selection) => {
						const sel = selection[0];
						const changes = [];
						for (let r = sel.start.row; r <= sel.end.row; r++) {
							for (let c = sel.start.col; c <= sel.end.col; c++) {
								const col_def = board.columns[c];
								if (!col_def?._readonly) {
									changes.push([r, c, ""]);
								}
							}
						}
						board.hot.setDataAtCell(changes);
					},
					disabled: () => !board.list_view.can_write,
				},

				sep3: "---------",

				// ── Undo / Redo ───────────────────────────────────────────────
				undo: {
					name: () => __("Undo") + "\t\tCtrl+Z",
					callback: () => board.hot.undo(),
					disabled: () => !board.hot.isUndoAvailable(),
				},

				redo: {
					name: () => __("Redo") + "\t\tCtrl+Y",
					callback: () => board.hot.redo(),
					disabled: () => !board.hot.isRedoAvailable(),
				},

				sep4: "---------",

				// ── Column visibility ─────────────────────────────────────────
				hide_col: {
					name: () => {
						const sel = board.hot.getSelected();
						if (!sel?.length) return __("Hide column");
						// Collect unique column indices across ALL selection ranges
						// (supports Ctrl+click for non-contiguous selections)
						const cols = new Set();
						sel.forEach(([r1, c1, r2, c2]) => {
							for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) cols.add(c);
						});
						return cols.size > 1
							? __("Hide {0} columns", [cols.size])
							: __("Hide column");
					},
					callback: (key, selection) => {
						// Collect unique column indices from all HOT selection ranges
						const cols = new Set();
						selection.forEach(({ start, end }) => {
							for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
								cols.add(c);
							}
						});
						board._hide_columns([...cols]);
					},
				},

				show_all_cols: {
					name: () => __("Show all columns"),
					callback: () => board._show_all_columns(),
					disabled: () => !board._hidden_col_keys?.size,
				},

				sep4b: "---------",

				// ── Column freeze ─────────────────────────────────────────────
				freeze_col: {
					name: () => {
						const sel = board.hot.getSelected();
						if (!sel?.length) return __("Freeze up to this column");
						const col = Math.max(sel[0][1], sel[0][3]);
						const label = board.columns[col]?.title || board._col_idx_to_letter(col);
						return __("Freeze up to column: {0}", [label]);
					},
					callback: (key, selection) => {
						const col = Math.max(
							selection[0].start.col,
							selection[0].end.col
						);
						board._set_freeze(col + 1);
					},
				},

				unfreeze_cols: {
					name: () => __("Unfreeze columns"),
					callback: () => board._set_freeze(0),
					disabled: () => !board._frozen_cols,
				},

				sep4c: "---------",

				// ── Formula column ─────────────────────────────────────────────
				add_blank_col: {
					name: () => __("Add Blank Column"),
					callback: (key, selection) => {
						const col = Math.max(selection[0].start.col, selection[0].end.col);
						board._add_blank_column(col);
					},
				},

				remove_blank_col: {
					name: () => __("Remove Blank Column"),
					callback: (key, selection) => {
						const start_col = Math.min(selection[0].start.col, selection[0].end.col);
						const end_col   = Math.max(selection[0].start.col, selection[0].end.col);
						board._remove_blank_columns(start_col, end_col);
					},
					disabled: () => {
						const sel = board.hot.getSelected();
						if (!sel?.length) return true;
						const start_col = Math.min(sel[0][1], sel[0][3]);
						const end_col   = Math.max(sel[0][1], sel[0][3]);
						for (let c = start_col; c <= end_col; c++) {
							if (board.columns[c]?._is_blank_col) return false;
						}
						return true;
					},
				},

				sep4d: "---------",

				add_formula_col: {
					name: () => __("Add formula column"),
					callback: () => board._add_formula_column(),
				},

				remove_formula_col: {
					name: () => {
						const sel = board.hot.getSelected();
						if (!sel?.length) return __("Remove formula column");
						const start_col = Math.min(sel[0][1], sel[0][3]);
						const end_col   = Math.max(sel[0][1], sel[0][3]);
						let count = 0;
						for (let c = start_col; c <= end_col; c++) {
							if (board.columns[c]?._is_formula_col) count++;
						}
						return count > 1
							? __("Remove {0} formula columns", [count])
							: __("Remove formula column");
					},
					callback: (key, selection) => {
						const start_col = Math.min(
							selection[0].start.col,
							selection[0].end.col
						);
						const end_col = Math.max(
							selection[0].start.col,
							selection[0].end.col
						);
						board._remove_formula_columns(start_col, end_col);
					},
					disabled: () => {
						const sel = board.hot.getSelected();
						if (!sel?.length) return true;
						const start_col = Math.min(sel[0][1], sel[0][3]);
						const end_col   = Math.max(sel[0][1], sel[0][3]);
						for (let c = start_col; c <= end_col; c++) {
							if (board.columns[c]?._is_formula_col) return false;
						}
						return true; // no formula col in selection → greyed out
					},
				},


				// ── Fill Column ───────────────────────────────────────────────
				fill_column: {
					name: () => __("Fill Column ↓  (All Rows)"),
					callback: (key, selection) => {
						const row = Math.min(selection[0].start.row, selection[0].end.row);
						const col = Math.min(selection[0].start.col, selection[0].end.col);
						board._fill_column_all_rows(col, row);
					},
					disabled: () => {
						const sel = board.hot.getSelected();
						if (!sel?.length) return true;
						const [r1, c1] = sel[0];
						const val = board.hot.getDataAtCell(r1, c1);
						return !board.formula_bridge?.is_formula(val);
					},
				},

				sep5: "---------",

				// ── Open form ─────────────────────────────────────────────────
				open_form: {
					name: () => __("Open in Form View"),
					callback: (key, selection) => {
						const row_idx = selection[0].start.row;
						const doc_name = board.list_view.data[row_idx]?.name;
						if (doc_name) {
							frappe.set_route("Form", board.doctype, doc_name);
						}
					},
				},
			},
		};
	}
};
