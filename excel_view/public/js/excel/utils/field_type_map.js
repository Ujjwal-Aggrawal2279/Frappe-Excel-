/**
 * excel_view/utils/field_type_map.js
 *
 * Maps Frappe fieldtype strings → Handsontable 6.x column config objects.
 * Custom cell types (Link, Date, Currency, Select, Check) are registered
 * separately in cell_types/ and referenced here by name.
 */

frappe.provide("frappe.views.excel");

/**
 * Fieldnames that are always read-only in the grid.
 *
 * Derived from `frappe.model.std_fields` — the authoritative client-side list
 * of Frappe system fields (owner, creation, modified, modified_by, idx, etc.).
 * User-editable system fields (Tags, Assigned To, Comments) are excluded.
 *
 * This avoids hardcoding fieldnames — if Frappe adds a new system field it is
 * automatically picked up here.
 */
const _USER_EDITABLE_STD = new Set(["_user_tags", "_assign", "_liked_by", "_comments", "_seen"]);
const READONLY_FIELDNAMES = new Set(
	(frappe.model.std_fields || [])
		.map((f) => f.fieldname)
		.filter((name) => !_USER_EDITABLE_STD.has(name))
);

/**
 * Fieldtypes that are always read-only in the grid (system-managed).
 */
const READONLY_TYPES = new Set([
	"Attach",
	"Attach Image",
	"Barcode",
	"Button",
	"Code",
	"Color",
	"Column Break",
	"Fold",
	"Geolocation",
	"Heading",
	"HTML",
	"HTML Editor",
	"Image",
	"Markdown Editor",
	"Password",
	"Read Only",
	"Section Break",
	"Signature",
	"Table",
	"Table MultiSelect",
	"Tab Break",
	"Custom HTML",
]);

/**
 * Returns a Handsontable column config for a given Frappe DocField (df).
 *
 * @param {Object} df   - Frappe DocField descriptor ({ fieldtype, fieldname, options, ... })
 * @param {boolean} can_write - Whether the current user has write permission
 * @returns {Object}    - HOT column config object
 */
frappe.views.excel.get_column_config = function (df, can_write) {
	const read_only = !can_write || df.read_only
		|| READONLY_TYPES.has(df.fieldtype)
		|| READONLY_FIELDNAMES.has(df.fieldname);

	const base = {
		data: df.fieldname,
		title: __(df.label || df.fieldname),
		readOnly: read_only,
		className: read_only ? "htDimmed" : "",
		// Store df on each column for downstream use (formula bar, cell types, etc.)
		_df: df,
		_readonly: read_only,
	};

	switch (df.fieldtype) {
		// ── Numeric ────────────────────────────────────────────────────────────
		case "Int":
			return {
				...base,
				type: "numeric",
				numericFormat: { pattern: "0", culture: "en-US" },
			};

		case "Float":
		case "Percent":
			return {
				...base,
				type: "numeric",
				numericFormat: { pattern: "0.000000", culture: "en-US" },
			};

		case "Currency":
			return {
				...base,
				type: "ev-currency", // custom cell type (cell_types/currency_cell.js)
			};

		case "Rating":
			return {
				...base,
				type: "numeric",
				numericFormat: { pattern: "0", culture: "en-US" },
			};

		// ── Boolean ────────────────────────────────────────────────────────────
		case "Check":
			return {
				...base,
				type: "ev-check", // custom (cell_types/check_cell.js)
				className: (base.className + " htCenter").trim(),
			};

		// ── Date / Time ────────────────────────────────────────────────────────
		case "Date":
			return {
				...base,
				type: "ev-date", // custom (cell_types/date_cell.js)
			};

		case "Datetime":
			return {
				...base,
				type: "ev-date",
				_is_datetime: true,
			};

		case "Time":
			return {
				...base,
				type: "ev-time",
			};

		// ── Select ─────────────────────────────────────────────────────────────
		case "Select": {
			const options = (df.options || "").split("\n").filter(Boolean);
			return {
				...base,
				type: "ev-select", // custom (cell_types/select_cell.js)
				source: options,
			};
		}

		// ── Link (relational) ──────────────────────────────────────────────────
		case "Link":
		case "Dynamic Link":
			return {
				...base,
				type: "ev-link", // custom (cell_types/link_cell.js)
				_link_doctype: df.options, // target doctype for autocomplete
			};

		// ── Text ───────────────────────────────────────────────────────────────
		case "Small Text":
		case "Text":
		case "Long Text":
			return {
				...base,
				type: "text",
				wordWrap: false,
			};

		case "Text Editor":
			// Strip HTML tags for display; read-only
			return {
				...base,
				type: "text",
				readOnly: true,
				className: (base.className + " htDimmed").trim(),
			};

		// ── Always read-only types ─────────────────────────────────────────────
		default:
			if (READONLY_TYPES.has(df.fieldtype)) {
				return {
					...base,
					type: "text",
					readOnly: true,
					className: "htDimmed",
				};
			}
			// Fallback: plain text
			return { ...base, type: "text" };
	}
};

/**
 * Special column config for the document `name` field (always read-only link).
 */
frappe.views.excel.get_name_column_config = function (doctype) {
	return {
		data: "name",
		title: __("ID"),
		type: "text",
		readOnly: true,
		className: "htDimmed ev-name-col",
		_df: { fieldname: "name", fieldtype: "Data", label: "ID" },
		_readonly: true,
		_is_name_col: true,
	};
};
