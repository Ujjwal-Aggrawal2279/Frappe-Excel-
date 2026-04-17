---
id: faq
title: Frequently Asked Questions
sidebar_label: FAQ
---

# Frequently Asked Questions

## General

### Does Excel View modify Frappe core?
No. Excel View is a monkey-patched custom app — it adds behavior without modifying any Frappe core files. Upgrading Frappe will not break Excel View.

### Does it work with ERPNext?
Yes. Excel View works with both plain Frappe and ERPNext. It works with any DocType, including all ERPNext doctypes (Sales Invoice, Item, Customer, GL Entry, Stock Entry, etc.).

### What happens if I uninstall Excel View?
All Excel Workbook documents and user settings stored under `excel_*` keys are removed. Your Frappe data is completely unaffected.

---

## Data & Editing

### Will my edits break anything in Frappe?
Excel View uses the same `frappe.client.save()` API that forms use. Any validation logic, server scripts, or document hooks run as normal when you save from the grid.

### Can I edit submitted documents?
No. Documents with `docstatus = 1` (submitted) are read-only in the grid, just as they are in form view. You must cancel the document first.

### Can multiple users edit the same record simultaneously?
Two users can have the same record in their grid and attempt to edit it. Frappe uses timestamp-based conflict detection — the second save will get a "Document has been modified after you have opened it" error. Refresh to get the latest version.

### Does auto-save exist?
No. All saves are intentional (Ctrl+S). This mirrors Excel behavior and prevents accidental overwrites.

---

## Formulas

### Are formulas saved to Frappe?
No. Formula cells are display-only and computed client-side by HyperFormula. Only raw values can be saved back to Frappe. To save a formula result, copy the cell → Paste Special → Values Only.

### Do FRAPPE_GET / GL_BALANCE formulas update automatically?
They update on page load and when you press Ctrl+Shift+R (full refresh). They do not auto-update on a timer.

---

## Smart Lookup

### Can I edit Smart Lookup columns?
No. Smart Lookup columns are read-only. The data comes from the source document — to change it, click the ID link to open the source document's form.

### Does Smart Lookup work on Report sheets?
Yes. Smart Lookup works on both DocType sheets and Report sheets.

---

## Performance

### How many rows can Excel View handle?
Excel View loads data in pages (default 200 rows). It supports virtual scrolling for up to 100,000+ rows. The DuckDB WASM query engine handles analytical queries on large in-memory datasets.

### Why is the initial load slow?
The first load of a DocType fetches metadata + data. Subsequent loads use cached metadata. For very wide DocTypes with many fields, the initial column render may take a moment. This is a one-time cost.

---

## Export

### Can I export with my company name in the header?
Yes — XLSX exports include 3 header rows: company name, sheet name + date, and active filters. See [Export to XLSX](/docs/import-export/export-xlsx).

### Does the exported file open in Excel correctly?
Yes. The export uses ExcelJS to produce proper `.xlsx` files with formatting, number formats, and correct data types.

---

## Workbooks

### Are workbooks per-user or shared?
Workbooks are per-user by default. You can share them with other users or roles via the Excel Workbook DocType's share settings.

### Is there a limit on how many workbooks I can save?
No limit. Each workbook is a Frappe document stored in your database.
