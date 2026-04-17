---
id: sheet-types
title: Sheet Types
sidebar_label: Sheet Types
---

# Sheet Types

Excel View supports five types of sheets. Each sheet tab at the bottom of the screen represents one sheet.

---

## DocType Sheet

The most common sheet type. Shows live data from a single Frappe DocType.

- Every row is one Frappe document
- Cells are editable (subject to permissions)
- Changes are saved back to Frappe via the Save button
- Supports: filters, sorting, column chooser, smart lookup, child table expand, meta column, activity column

**How to add**: Click **[+]** in the sheet tabs → **DocType Sheet** → choose a DocType.

---

## Report Sheet

Shows the output of a Frappe Script Report or Query Report.

- A **filter bar** appears below the toolbar, showing the report's filter fields
- Change filters and click **Refresh** to re-run the report
- Data is read-only (you cannot save changes back via a report sheet)
- Supports: Smart Lookup, charts, pivot, export

**How to add**: Click **[+]** → **Report Sheet** → choose a report from the list.

---

## Pivot Sheet

An interactive pivot table built from any DocType or Report sheet in the workbook.

- Drag fields to Row / Column / Value areas
- Choose aggregation: Sum, Count, Average, Min, Max
- Live refresh when source data changes (realtime if source is a DocType sheet)

**How to add**: Click **[+]** → **Pivot Sheet**, then configure the source in the pivot builder dialog.

Or: Insert tab → **Insert Pivot** to add a pivot built from the current active sheet's data.

---

## Blank Sheet

A scratch pad sheet with no Frappe data binding.

- Supports full HyperFormula formula engine (500+ Excel-compatible functions)
- Good for quick calculations, summaries, or cross-referencing data from other sheets
- Data typed here is NOT saved to Frappe (it lives only in the workbook)

**How to add**: Click **[+]** → **Blank Sheet**.

---

## Query Sheet (QueryFlowPanel)

A visual SQL query builder. Build joins, filters, aggregations using a drag-and-drop canvas.

- Drag DocType nodes onto the canvas
- Connect nodes to define joins
- Add filter nodes, aggregate nodes, and sort nodes
- The generated SQL query runs via DuckDB WASM in the browser (client-side)
- Output appears as a grid of results in the sheet

**How to add**: Click **[+]** → **Query Sheet**.

:::note
Query sheets do not write back to Frappe. They are analysis-only.
:::
