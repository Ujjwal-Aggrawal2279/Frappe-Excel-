# Excel View for Frappe / ERPNext

> A full spreadsheet experience for every Frappe DocType — edit, analyze, and bulk-save live ERP data in a familiar grid without leaving your browser.

**📖 [Full Documentation & User Guide →](https://ujjwal-aggrawal2279.github.io/Frappe-Excel-/)**

---

## What it does

Excel View adds a spreadsheet view to any Frappe DocType — accessible just like List View or Report View. You get inline cell editing, 500+ Excel formulas, Smart Lookup joins, pivot tables, charts, child table expand, rich text editing, conditional formatting, bulk import/export, and more.

No modifications to Frappe core. Zero extra configuration after install.

---

## Highlights

| Feature | What you get |
|---|---|
| **Inline editing** | Edit any field directly in the grid. Ctrl+S saves all pending rows at once. |
| **Child table expand** | Click ▶ on any row to expand and edit its child records inline. |
| **Rich text fields** | HTML/Text Editor cells render live previews. Double-click opens a full ProseMirror editor modal. |
| **500+ formulas** | HyperFormula engine — all standard Excel functions work. |
| **ERP-native formulas** | `GL_BALANCE`, `STOCK_QTY`, `ITEM_PRICE`, `FRAPPE_GET/SUM/COUNT/AVG` pull live Frappe data. |
| **Smart Lookup** | Auto-detect FK relationships and join columns from related DocTypes — no SQL. |
| **Charts & Pivot** | Built-in chart builder and interactive pivot tables from any sheet. |
| **Workbooks** | Save multi-sheet configurations with formatting, Smart Lookup, and pivot state. |
| **Import** | Bulk import CSV/XLSX for any DocType including tree structures. |
| **Export** | Export to `.xlsx` with company name, sheet name, and active filter header rows. |
| **Dark theme** | Every component respects the Frappe theme toggle. |

---

## Installation

```bash
bench get-app https://github.com/Ujjwal-Aggrawal2279/Frappe-Excel-.git
bench --site yoursite.local install-app excel_view
bench --site yoursite.local migrate
bench --site yoursite.local build --app excel_view
```

Requires Frappe v15+. Works with plain Frappe and ERPNext.

---

## Quick Start

1. Open any DocType list view in Frappe
2. Click the **View** dropdown → **Excel View**
3. Or navigate directly to `/app/{doctype}/view/excel`

---

## Documentation

The full user guide covers every feature — from basic cell editing to Smart Lookup, child tables, formulas, import/export, and keyboard shortcuts.

**[https://ujjwal-aggrawal2279.github.io/Frappe-Excel-/](https://ujjwal-aggrawal2279.github.io/Frappe-Excel-/)**

---

## Version

Current: **v3.5** — Clean Data Panel, PROMPT() formula, child table inline edit, rich text modal, ID column links.

See the [full changelog](https://ujjwal-aggrawal2279.github.io/Frappe-Excel-/docs/changelog) in the documentation.

---

## License

MIT
