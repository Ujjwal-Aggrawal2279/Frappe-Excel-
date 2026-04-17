---
id: report-sheets
title: Report Sheets
sidebar_label: Report Sheets
---

# Report Sheets

A Report Sheet displays the output of any Frappe **Script Report** or **Query Report** in the Excel View grid.

---

## Adding a Report Sheet

1. Click **[+]** in the sheet tab bar
2. Select **Report Sheet**
3. A list of all available Frappe reports is shown
4. Click a report to add it as a new sheet

---

## The Report Filter Bar

When a Report Sheet is active, a **filter bar** appears below the main toolbar, just above the grid. Each filter in the report's definition appears as an interactive control:

- **Link fields** — autocomplete input
- **Select fields** — dropdown
- **Date fields** — date picker
- **Currency/Number** — numeric input

Change any filter and click **Refresh** (or press **Ctrl+Shift+R**) to re-run the report with the new filters. Results update in the grid.

---

## Read-Only Data

Report sheet data is **read-only**. You cannot edit cells in a report sheet or save changes back to Frappe. This is by design — reports aggregate and transform data; editing them directly would be ambiguous.

You can:
- Apply **conditional formatting** to highlight values
- Add **Smart Lookup** columns to enrich report output
- Export to XLSX
- Build a **Pivot table** from report data
- Build a **Chart** from report data

---

## Auto-Refresh

When you switch away from a Report Sheet and switch back, Excel View marks the data as stale and automatically re-runs the report to fetch fresh data. This ensures the report is always current when you view it.

---

## Persistent Filters

The active filters for each report sheet are saved in your user settings and workbooks. When you restore a workbook, the same filters are loaded and the report is re-run automatically.

---

## Combining Reports with Smart Lookup

A common pattern:

1. Open a **GL Entry Report** sheet
2. Apply Smart Lookup → Employee → pull Employee Name from the GL Entry's `against` field
3. Now you can see both GL details and employee names in one view

This works because Smart Lookup supports non-base (report) sheets as the source.
