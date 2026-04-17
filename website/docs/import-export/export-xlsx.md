---
id: export-xlsx
title: Export to XLSX
sidebar_label: Export to XLSX
---

# Export to XLSX

Export the current sheet's data to a `.xlsx` file that opens in Microsoft Excel, Google Sheets, or LibreOffice Calc.

---

## Exporting

1. Click **Data → Export → Export as XLSX**
2. The file downloads immediately to your browser's downloads folder

The filename is `{DocType or Report Name} - {Date}.xlsx`.

---

## What Is Exported

| Component | Exported? |
|---|---|
| Column headers (field labels) | ✅ |
| All visible rows | ✅ |
| Cell values (raw) | ✅ |
| Number formats | ✅ (applied in XLSX) |
| Cell colors (background + text) | ✅ |
| Bold / Italic / Alignment | ✅ |
| Borders | ✅ |
| Conditional Formatting | ❌ (static at time of export) |
| Formulas | ❌ (values only, not formulas) |
| Smart Lookup columns | ✅ (values) |
| Child table rows (if expanded) | ✅ |
| Hidden rows | ❌ (hidden rows are not exported) |

---

## Report Header Rows

For DocType sheets, the XLSX file includes **3 header rows** before the data:

| Row | Content |
|---|---|
| Row 1 | Company name (from Frappe defaults) |
| Row 2 | DocType name + export date |
| Row 3 | Active filter summary |

These rows are bold, merged across all columns, with a light blue background.

To disable header rows: Data → Export → **Export Settings** → uncheck "Include report header".

---

## Large Exports

Excel View exports the **currently loaded rows** only. If you've loaded 500 of 5,000 rows, only 500 rows are exported.

To export all rows:
1. Scroll to the bottom of the grid
2. Click **Load All** (or keep clicking Load More)
3. Then export

Or use the **Export All** option in the export settings, which fetches all matching rows from Frappe in the background before generating the XLSX.

---

## Formatting in XLSX

The exported file uses ExcelJS to write a fully formatted `.xlsx` file. Number formats, colors, borders, and bold/italic are preserved in a way that Excel can read. The resulting file looks the same as the grid.
