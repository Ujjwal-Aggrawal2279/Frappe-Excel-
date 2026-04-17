---
id: pivot-tables
title: Pivot Tables
sidebar_label: Pivot Tables
---

# Pivot Tables

Pivot tables summarize large datasets into a compact, interactive table — group by any dimension, aggregate any metric.

---

## Creating a Pivot Table

### Method 1 — Insert Pivot Tab
1. Insert tab → **Insert Pivot**
2. The pivot builder dialog opens with the current sheet's data as the source

### Method 2 — New Pivot Sheet
1. Click **[+]** in the sheet tabs
2. Select **Pivot Sheet**
3. Choose the source sheet and configure in the dialog

---

## The Pivot Builder Dialog

**Data Source** — choose any DocType or Report sheet in the workbook.

**Row Fields** — drag fields here to group rows by that value. Multiple row fields create nested grouping (e.g., Country → City → Customer).

**Column Fields** — drag fields here to create column-based groupings (e.g., Month, Quarter).

**Value Fields** — drag numeric fields here. For each value field, choose an aggregation:
- Sum
- Count
- Average
- Min / Max
- Count Distinct

**Filters** — add optional filter conditions to restrict the pivot's source data.

Click **Build** to generate the pivot table.

---

## Interacting with the Pivot

- **Expand/Collapse rows** — click the `+` / `-` next to grouped values
- **Sort** — click column headers to sort
- **Drill down** — double-click a cell to see the underlying records that make up that aggregated value (opens in a new sheet)

---

## Live Refresh

Pivot sheets automatically recompute when:
- The source DocType sheet is refreshed (data changes in Frappe)
- A `list_update` realtime event arrives for the source DocType

This means your pivot stays current in real time during active work sessions.

---

## Exporting Pivot Data

Export the pivot table result to XLSX via the toolbar Export button. The pivot layout (rows, columns, groupings) is preserved in the exported file.

---

## Cross-Sheet Pivots

A pivot sheet can source data from any sheet in the workbook — including Report sheets and Query sheets. This lets you pivot report output without manually copying data.
