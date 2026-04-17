---
id: filtering
title: Filtering
sidebar_label: Filtering
---

# Filtering

## DocType Sheet Filters

For DocType sheets, filters are applied server-side — only matching records are fetched from Frappe.

### Opening the Filter Builder

Click **Data → Filter** or press **Ctrl+Shift+F**.

The filter builder dialog lets you add multiple filter conditions:

1. Choose a **field** (any DocType field)
2. Choose an **operator**: equals, not equals, contains, starts with, ends with, greater than, less than, between, is empty, is not empty, in, not in
3. Enter a **value**
4. Click **Add Filter**

Add multiple filters — all conditions are combined with `AND`.

### Clearing Filters

Click **Data → Clear Filters** to remove all active filters and reload all records.

### Active Filter Indicator

When filters are active, the **Data** tab shows a badge count (e.g., "Filter ●2") indicating how many filters are applied.

---

## Column Header Quick Filter

Right-click any column header → **Filter by this value** → type or select a value. This adds a quick equals filter for the column.

---

## Report Sheet Filters

Report sheets use their own filter bar (see [Report Sheets](/docs/data/report-sheets)). You cannot use the DocType filter builder on a report sheet.

---

## Filter Persistence

Active filters are saved in user settings per DocType. They persist across sessions. When you restore a workbook, the same filters are applied.

---

## Search Bar

The search bar at the top of the sheet (Ctrl+F) performs a **client-side search** on the currently loaded data — it does not re-query Frappe. Use filters for server-side filtering of large datasets.
