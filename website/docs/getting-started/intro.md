---
id: intro
title: What is Excel View?
sidebar_label: Introduction
---

# What is Excel View?

Excel View is a **custom Frappe app** that adds a full spreadsheet experience to every DocType in your Frappe/ERPNext installation. Instead of working through a one-record-at-a-time form or a limited list view, Excel View gives you a live, editable grid — exactly like working in Microsoft Excel or Google Sheets — with all your Frappe data.

---

## Why Excel View?

The standard Frappe list view is read-heavy. You can filter and bulk-delete, but bulk-editing 50 Sales Orders or updating 200 inventory items requires opening each form one at a time. Excel View was built to close that gap without touching Frappe core.

| Pain Point | Excel View Solution |
|---|---|
| Can't edit multiple records at once | Full inline grid editing with instant save |
| Child tables require opening every parent form | Inline child table expand & edit |
| HTML / rich text fields are unreadable in grids | Live HTML preview + custom rich text modal |
| Clicking a record goes to form — no context | ID column becomes a direct link; grid stays open |
| Export has no company/report name | Export header rows: company, sheet name, active filters |
| Formula bar shows raw HTML markup | Auto-strips HTML — shows readable plain text |
| No pivot, chart, or data analysis | Built-in pivot tables, charts, and visual query builder |

---

## Feature Highlights

### Live Grid Editing
Every cell in every DocType is editable inline. Press **Enter** or **double-click** to start editing. Changes are staged and saved with a single **Save** button or **Ctrl+S**.

### Multiple Sheet Types
- **DocType Sheet** — live data from any Frappe DocType
- **Report Sheet** — any Script/Query Report with live filter bar
- **Pivot Sheet** — drag-and-drop pivot table from any data source
- **Blank Sheet** — scratch pad with formula support
- **Query Sheet** — visual SQL query builder (QueryFlowPanel)

### Smart Lookup (Cross-DocType Joins)
Pull data from any linked DocType into your sheet as extra columns — employee name from GL Entry, item description from Purchase Order lines — without writing any SQL.

### Frappe-Native Formulas
Seven ERP-specific HyperFormula functions work inside any sheet cell:

```
=FRAPPE_GET("Sales Invoice", "INV-0001", "grand_total")
=GL_BALANCE("Cash - Company")
=STOCK_QTY("ITEM-001", "Main Warehouse")
=ITEM_PRICE("ITEM-001", "Standard Selling")
```

### Charts & Pivot Tables
Insert bar/line/scatter/pie charts and interactive pivot tables from any sheet's data — no external tool needed.

### Import & Export
- Export to `.xlsx` with optional company/report header rows
- Bulk CSV/XLSX import for any DocType (flat and tree structures)

### Collaboration Sidebar
See who else is viewing the same DocType, add inline comments, assign tasks, and like records — all from the grid.

---

## Version History

| Version | Highlight |
|---|---|
| V1 | Core grid, inline editing, formula engine |
| V2 | Workbooks, pivot, charts, conditional formatting |
| V2.4 | IntelliFlow visual join canvas + AI discovery |
| V3.1 | Focus cell, hide/unhide rows, precedent highlighting, meta column |
| V3.2 | Report filter bar, Smart Lookup, activity column |
| V3.3 | Flash Fill, column reorder, Frappe-native validators |
| V3.4 | Child table expand & inline edit, rich text editor modal |
| V3.5 | Clean Data Panel, PROMPT() formula |

See the full [Changelog](/docs/changelog) for details.

---

## Browser Support

Excel View runs entirely in the browser. No Electron, no plugins.

| Browser | Support |
|---|---|
| Chrome 110+ | Full |
| Firefox 110+ | Full |
| Edge 110+ | Full |
| Safari 16+ | Full |
| Mobile browsers | Read-only (editing requires desktop) |

---

## Next Steps

- [Install Excel View →](/docs/getting-started/installation)
- [Open your first view →](/docs/getting-started/first-view)
- [Keyboard shortcuts reference →](/docs/reference/keyboard-shortcuts)
