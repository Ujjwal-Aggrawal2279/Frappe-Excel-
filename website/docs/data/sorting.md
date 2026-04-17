---
id: sorting
title: Sorting
sidebar_label: Sorting
---

# Sorting

## Quick Sort from Column Header

Right-click any column header:
- **Sort Ascending** — A→Z, 0→9, oldest→newest
- **Sort Descending** — Z→A, 9→0, newest→oldest

The sort is applied to the currently loaded data (client-side). For DocType sheets with many records, use the **Data → Sort** dialog for server-side sorting.

---

## Multi-Level Sort

Data tab → **Sort** → Sort dialog:

1. Choose the **primary sort field** and direction
2. Click **Add Level** for a secondary sort
3. Add up to 5 sort levels

Click **Apply** — the data re-loads from Frappe with the specified sort order applied server-side.

---

## Sort on Report Sheets

Report sheets sort their output client-side only (the report's data is fetched and sorted in the browser). For large reports, click column headers to sort.

---

## Default Sort

The default sort order for DocType sheets is **Modified Date descending** — most recently changed records appear first. This matches Frappe's standard list view default.
