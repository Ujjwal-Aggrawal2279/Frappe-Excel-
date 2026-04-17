---
id: changelog
title: Changelog
sidebar_label: Changelog
---

# Changelog

## V3.5 — April 2026

### New Features
- **Clean Data Panel** — proactive data quality dashboard: detects duplicates (rapidfuzz clustering), missing mandatory fields, overdue invoices, credit limit breaches, and formatting inconsistencies. Insight cards with one-click fix suggestions.
- **PROMPT() Formula** — HyperFormula function for deterministic text extraction using spaCy/regex patterns. Extract structured data from free-text fields directly in a formula.

---

## V3.4 — April 2026

### New Features
- **Child Table Expand & Inline Edit** — Every parent row now has an expand arrow (▶). Click to reveal all child table records inline in the grid. Edit cells, add rows, delete rows — all saved via Frappe API. Supports all child table field types including rich text.
- **Rich Text Editor Modal** — Text Editor and HTML fields now render live HTML previews in the grid. Double-click to open a full-featured EV-branded modal with ProseMirror editor. Ctrl+S to save. Works in both main grid and child table panels.
- **ID Column Links** — The Name (ID) column is now a clickable hyperlink. Click to navigate to the Frappe form for that record. Grid stays open.
- **Child Table Scroll Isolation** — Scrolling inside a child table panel no longer scrolls the parent grid.
- **Formula Bar Plain Text** — For Text Editor / HTML fields, the formula bar now shows plain text (HTML tags stripped) instead of raw HTML markup.

### Bug Fixes
- Formula bar no longer shows raw HTML for rich text cells
- Chevron column is preserved after using the field picker
- Child table fields removed from the Choose Columns dialog

---

## V3.3 — March 2026

### New Features
- **Flash Fill (Ctrl+E)** — Pattern-based column completion. Demonstrate a pattern in the first cell; Excel View fills the rest.
- **Column Reorder (drag header)** — Drag any column header to reorder. Persisted in user settings.
- **Frappe-Native Validators** — Client-side validation for Currency/Float/Int (numeric check), Link fields (existence check via `frappe.db.exists`), Select options, and Date format. `_link_validator_cache` prevents redundant API calls.
- **Live Pivot Refresh** — Pivot sheets auto-recompute when the source DocType receives a `list_update` realtime event.

### UI Refinements
- Smart Lookup sidebar redesigned — modern panel with CSS vars, no hardcoded colors
- Smart Lookup Layer 0c — structural FK detection: `frappe.scrub(target_doctype) == source_col_fieldname` → high-confidence matches even with near-zero data overlap
- Meta column redesigned — relative time, first name only, pencil SVG icon for modified rows
- Activity column redesigned — SVG icon buttons, conditional docstatus badge (submittable DocTypes only)

---

## V3.2 — March 2026

### New Features
- **Report Filter Bar** — Report sheets show an interactive filter bar with Frappe UI form controls. Change filters, click Refresh.
- **Smart Lookup** — Cross-DocType join sidebar. 4-layer suggestion engine (structural FK, meta link fields, fuzzy header match, data overlap). Results as read-only columns.
- **Activity / Social Column** — `_social` virtual column with like, comment, assign, tag buttons per row. Realtime like count. Conditional docstatus badge.
- **Smart Lookup on Report Sheets** — Smart Lookup now works on Report and Blank sheets (not just DocType sheets).
- **Report Sheet Auto-Refresh** — Switching to a report sheet auto-triggers a data refresh.

### Bug Fixes
- `excel_sheets` never persisted — root cause: `report_meta._controls` (Frappe jQuery objects) caused `JSON.stringify` to throw, silently aborting all `update()` calls. Fix: `serialize()` strips `_controls`.
- `_auto_persist_sheets` race condition — sync-patch before `update()`.
- Pivot table using wrong data — `active_sheet` property doesn't exist; fixed to use `get_current()`.
- Chart using wrong data — same `active_sheet` bug fixed in `chart_manager.js`.

---

## V3.1 — March 2026

### New Features
- **Focus Cell (Crosshair)** — View tab toggle. Pickr color picker. Dark theme opaque blend fix.
- **Hide / Unhide Rows** — CSS display:none on TR. ▲/▼ bands to unhide. Persisted in user settings + workbook.
- **Repeat Last Action (F4)** — Records bold/italic/align/colors/borders/numfmt/resize. `stopImmediatePropagation` to intercept HOT's F4.
- **Formula Precedent Highlighting** — `getCellDependencies()` → green outline. 80ms debounce.
- **Meta Column** — Virtual `_meta` col with avatar, relative time, pencil SVG for modified rows.
- **Full Format Persistence** — `format_store` saved to user settings + workbook. Row heights and hidden rows also persisted.

### Bug Fixes
- Column width fix — `plugin.manualColumnWidths[]` array (not Map-based API).
- Field Picker → centered modal (replaced `frappe.ui.Dialog`).

---

## V3.0 — February 2026

### Milestone
Architecture refactor — all V2 components modularized. No breaking changes for end users.

---

## V2.6 — February 2026

- Excel Ribbon Toolbar (tabbed: Home / View / Data / Insert / Format)
- Charts (bar, line, scatter, pie) via @observablehq/plot + uPlot
- Pivot Tables — interactive drag-and-drop
- Conditional Formatting — rules engine + color scales

---

## V2.5 — January 2026

- Multi-Sheet Workbooks
- IntelliLookup (predecessor to Smart Lookup)
- Canvas Transform
- AI Analysis Panel
- Child Table Aggregate Mode
- Canvas Auto-Save
- 1:N Fan-Out Fix

---

## V2.4 — January 2026

- IntelliFlow — Visual Join Canvas with persistence
- IntelliFlow AI — 4-Layer Validation + AI Discovery (networkx + rapidfuzz + TF-IDF)

---

## V2.3 — January 2026

- Frappe Formula Library — 7 ERP-native HyperFormula functions (FRAPPE_GET/SUM/COUNT/AVG, GL_BALANCE, STOCK_QTY, ITEM_PRICE)

---

## V2.2 — January 2026

- Status Bar (sum/avg/count)
- Column Freeze
- Find & Replace

---

## V2.1 — January 2026

- Saved Workbooks — Excel Workbook DocType + WorkbookManager JS

---

## V2.0 — January 2026

- Lazy loading
- Field picker
- Toolbar fixes
- Rich color palette

---

## V1.0 — February 2026

Initial release:
- Full spreadsheet grid for any DocType
- Handsontable 6.2.2 + HyperFormula
- Inline editing with save
- CSV/XLSX import and export
- Basic formatting
