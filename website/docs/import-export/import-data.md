---
id: import-data
title: Importing Data
sidebar_label: Import Data
---

# Importing Data

Excel View can bulk-import records from a CSV or XLSX file into any Frappe DocType.

---

## Opening the Import Dialog

Data tab → **Import** → **Import from File**

---

## Supported File Formats

- `.csv` (comma-separated, UTF-8)
- `.xlsx` (Excel workbook)

---

## Import Flow

1. **Upload file** — drag & drop or click to browse
2. **Map columns** — a column-mapping dialog appears:
   - Left column: your file's headers
   - Right column: Frappe DocType fields
   - Excel View auto-maps columns with matching names
   - Manually adjust any mismatches
3. **Preview** — a preview of the first 10 rows is shown
4. **Validate** — click Validate to check for errors (missing mandatory fields, invalid Link values, etc.)
5. **Import** — click Import to begin

A progress dialog shows import progress. Each row is saved to Frappe individually. Rows that fail show individual error messages.

---

## Mandatory Fields

Frappe DocTypes often have mandatory fields. The import validator checks all mandatory fields and flags rows where they are missing before the import starts.

---

## Duplicate Handling

If you include a **Name** column in your import file:
- If a document with that name already exists → the row **updates** the existing document
- If no document exists with that name → a **new document** is created

If you omit the Name column, all rows create new documents (Frappe auto-generates names based on the naming series).

---

## Import Template

Click **Download Template** to get a blank XLSX file with all the DocType's fields as column headers. Fill it in and re-upload for a guaranteed column match.

---

## Error Handling

Rows that fail to import are listed in the error panel with their row number and the Frappe error message. You can:
- Download the error rows as a CSV, fix the issues, and re-import
- Skip error rows and import the rest

---

## Post-Import

After import completes, click **Refresh** to reload the grid and see the newly imported records.
