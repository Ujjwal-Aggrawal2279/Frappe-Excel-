/**
 * excel_view/utils/export_manager.js
 *
 * Phase 3 — xlsx / csv import-export via ExcelJS and PapaParse.
 * Phase 1: stubs only — menu items are wired, dialogs show "Coming Soon".
 */

import Papa from "papaparse";

frappe.provide("frappe.views.excel");

frappe.views.excel.ExportManager = class ExportManager {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.board - ExcelBoard instance
	 */
	constructor(opts) {
		this.board = opts.board;
	}

	// ── Lazy load ExcelJS ────────────────────────────────────────────────────

	/**
	 * Lazy-load ExcelJS from CDN (not bundled — uses async generators / ES2018
	 * which Frappe's esbuild target es2017 cannot transform).
	 * Resolves with window.ExcelJS once loaded.
	 */
	_load_exceljs() {
		if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
		return new Promise((resolve, reject) => {
			const script = document.createElement("script");
			script.src =
				"https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
			script.onload = () => resolve(window.ExcelJS);
			script.onerror = () => reject(new Error("Failed to load ExcelJS"));
			document.head.appendChild(script);
		});
	}

	// ── Export ────────────────────────────────────────────────────────────────

	/**
	 * Returns board.columns reordered to match HOT's current visual column order.
	 * After manualColumnMove drag-reorder, hot.toPhysicalColumn(visualIdx) maps
	 * visual position → physical index in board.columns. Without this, exports
	 * reflect the original load order, not what the user sees on screen.
	 */
	_get_export_columns() {
		const hot = this.board.hot;
		const cols = this.board.columns;
		const n = cols.length;
		const ordered = [];
		for (let vis = 0; vis < n; vis++) {
			const phys = hot.toPhysicalColumn(vis);
			if (phys != null && cols[phys]) ordered.push(cols[phys]);
		}
		return ordered.length === n ? ordered : cols;
	}

	/**
	 * Export current grid data to .xlsx using ExcelJS.
	 * Phase 3: full implementation (cell types, widths, formatting).
	 */
	async export_xlsx() {
		const ExcelJS = await this._load_exceljs();
		const workbook = new ExcelJS.Workbook();
		workbook.creator = "Frappe Excel View";
		workbook.created = new Date();

		const sheet = workbook.addWorksheet(this.board.doctype);
		const columns = this._get_export_columns();
		const data = this.board.list_view.data;

		// Header row
		sheet.columns = columns.map((col) => ({
			header: col.title,
			key: col.data,
			width: Math.max(12, (col.width || 120) / 7), // px → character units approx
		}));

		// Data rows
		data.forEach((row) => {
			const row_data = {};
			columns.forEach((col) => {
				row_data[col.data] = row[col.data] ?? "";
			});
			sheet.addRow(row_data);
		});

		// Style header row
		sheet.getRow(1).font = { bold: true };
		sheet.getRow(1).fill = {
			type: "pattern",
			pattern: "solid",
			fgColor: { argb: "FFE8F4FD" },
		};

		// Write and trigger download
		const buffer = await workbook.xlsx.writeBuffer();
		const blob = new Blob([buffer], {
			type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		});
		this._download(blob, `${this.board.doctype}.xlsx`);

		frappe.show_alert({ message: __("Exported to Excel"), indicator: "green" }, 3);
	}

	/**
	 * Export current grid data to CSV using PapaParse.
	 */
	export_csv() {
		const columns = this._get_export_columns();
		const data = this.board.list_view.data;

		const rows = data.map((row) => columns.map((col) => row[col.data] ?? ""));
		const headers = columns.map((col) => col.title);

		const csv = Papa.unparse({ fields: headers, data: rows });
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
		this._download(blob, `${this.board.doctype}.csv`);

		frappe.show_alert({ message: __("Exported to CSV"), indicator: "green" }, 3);
	}

	// ── Import ────────────────────────────────────────────────────────────────

	/**
	 * Show import dialog and handle .xlsx file upload.
	 * Phase 3: will create/update Frappe docs in bulk.
	 */
	import_xlsx() {
		const d = new frappe.ui.Dialog({
			title: __("Import from Excel"),
			fields: [
				{
					fieldtype: "Attach",
					fieldname: "file",
					label: __("Upload .xlsx file"),
					options: "xlsx",
				},
				{
					fieldtype: "Check",
					fieldname: "update_existing",
					label: __("Update existing records (match by name/ID)"),
					default: 1,
				},
				{
					fieldtype: "HTML",
					options: `<div class="alert alert-warning" style="margin-top:8px">
						<b>${__("Note")}:</b> ${__("First row must contain column headers matching field names or labels.")}
					</div>`,
				},
			],
			primary_action_label: __("Import"),
			primary_action: async (values) => {
				if (!values.file) {
					frappe.show_alert({ message: __("Please select a file"), indicator: "orange" });
					return;
				}
				d.hide();
				await this._process_xlsx_import(values.file, values.update_existing);
			},
		});
		d.show();
	}

	/**
	 * Show import dialog for CSV.
	 */
	import_csv() {
		const d = new frappe.ui.Dialog({
			title: __("Import from CSV"),
			fields: [
				{
					fieldtype: "Attach",
					fieldname: "file",
					label: __("Upload .csv file"),
				},
				{
					fieldtype: "Check",
					fieldname: "update_existing",
					label: __("Update existing records (match by name/ID)"),
					default: 1,
				},
			],
			primary_action_label: __("Import"),
			primary_action: async (values) => {
				if (!values.file) {
					frappe.show_alert({ message: __("Please select a file"), indicator: "orange" });
					return;
				}
				d.hide();
				await this._process_csv_import(values.file, values.update_existing);
			},
		});
		d.show();
	}

	// ── Private ───────────────────────────────────────────────────────────────

	async _process_xlsx_import(file_url, update_existing) {
		frappe.show_alert({ message: __("Reading file..."), indicator: "blue" });
		try {
			const ExcelJS = await this._load_exceljs();
			const response = await fetch(file_url);
			const buffer = await response.arrayBuffer();
			const workbook = new ExcelJS.Workbook();
			await workbook.xlsx.load(buffer);

			const sheet = workbook.worksheets[0];
			const rows = [];
			sheet.eachRow((row, row_number) => {
				if (row_number === 1) return; // skip header
				const row_data = {};
				row.eachCell((cell, col_number) => {
					const header = sheet.getRow(1).getCell(col_number).value;
					if (header) row_data[header] = cell.value ?? "";
				});
				rows.push(row_data);
			});

			await this._bulk_save(rows, update_existing);
		} catch (e) {
			frappe.show_alert({ message: __("Import failed: ") + e.message, indicator: "red" });
		}
	}

	async _process_csv_import(file_url, update_existing) {
		frappe.show_alert({ message: __("Reading file..."), indicator: "blue" });
		try {
			const response = await fetch(file_url);
			const text = await response.text();
			const result = Papa.parse(text, { header: true, skipEmptyLines: true });

			if (result.errors.length) {
				frappe.show_alert({
					message: __("CSV parsing errors: ") + result.errors[0].message,
					indicator: "orange",
				});
			}
			await this._bulk_save(result.data, update_existing);
		} catch (e) {
			frappe.show_alert({ message: __("Import failed: ") + e.message, indicator: "red" });
		}
	}

	async _bulk_save(rows, update_existing) {
		const doctype = this.board.doctype;
		let saved = 0,
			errors = 0;

		frappe.show_alert({
			message: __("Importing {0} records...", [rows.length]),
			indicator: "blue",
		});

		for (const row of rows) {
			try {
				if (update_existing && row.name) {
					await frappe.db.set_value(doctype, row.name, row);
				} else {
					await frappe.db.insert({ doctype, ...row });
				}
				saved++;
			} catch (e) {
				errors++;
				console.error("Excel import row error:", e);
			}
		}

		frappe.show_alert(
			{
				message: __(
					"Import complete: {0} saved, {1} errors",
					[saved, errors]
				),
				indicator: errors ? "orange" : "green",
			},
			5
		);

		// Refresh the list view to show imported data
		this.board.list_view.refresh();
	}

	_download(blob, filename) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		}, 100);
	}
};
