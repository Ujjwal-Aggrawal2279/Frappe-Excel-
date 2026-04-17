---
id: overview
title: Grid Overview
sidebar_label: Overview
---

# The Grid

The grid is the core of Excel View. It behaves like a spreadsheet but is backed by live Frappe data.

---

## Anatomy of a Row

Each row represents one Frappe document (one record). The columns represent fields of that DocType.

| Column type | Description |
|---|---|
| **Name (ID)** | First column. Shows the document name. Clickable — opens the Frappe form. |
| **Standard fields** | Any DocType field you have added via Choose Columns |
| **Meta column** | Optional virtual column showing modified time + author |
| **Activity column** | Optional virtual column with social actions (like, comment, assign, tag) |
| **Smart Lookup columns** | Extra columns joined from a linked DocType |
| **Formula columns** | Columns driven by HyperFormula expressions |

---

## Row States

Rows have visual states to communicate their status:

| State | Visual | Meaning |
|---|---|---|
| Normal | White background | Unmodified, saved data |
| **Modified** | Light yellow/amber left border | Cell has unsaved changes |
| **New** | Light green background | Newly added row, not yet saved |
| **Deleted** | Strikethrough text | Marked for deletion |
| **Error** | Red left border | Save failed for this row |
| **Submitted** | Lock icon in status cell | `docstatus = 1` (submitted document) |
| **Cancelled** | Gray text | `docstatus = 2` (cancelled document) |

---

## Column Header

- **Click** a column header to select the entire column
- **Double-click** to rename (formula/blank sheets only — DocType field names cannot be changed)
- **Drag** a column header to reorder it (saved automatically)
- **Right-click** for: Sort Ascending, Sort Descending, Hide Column, Column Width, Insert Formula Column

---

## Row Header

- **Click** the row number to select the entire row
- **Shift+click** another row number to range-select
- **Right-click** for: Insert Row, Delete Row, Hide Row, Copy Row
- **Expand arrow** (▶) on rows of DocTypes with child tables — expands to show the child table inline

---

## Virtual Columns

Some columns are virtual — they don't correspond to a real Frappe field and are never saved back to the database:

- `_meta` — Created/Modified info column
- `_social` — Like/Comment/Assign/Tag action buttons
- `_sl_*` — Smart Lookup join columns (read-only; the source doc can be edited via the linked form)
- Formula columns — computed by HyperFormula, not saved to Frappe

Virtual columns are visually distinguished by a lighter column header background and an italic column label.

---

## Grid Scrolling

- **Mouse wheel** — scroll vertically
- **Shift+mouse wheel** — scroll horizontally
- **Scroll bars** — standard scrollbars on right and bottom edges
- **Ctrl+End** — jump to the last used cell (last row, last column)
- **Ctrl+Home** — jump to cell A1
- **Ctrl+Arrow** — jump to the last non-empty cell in a direction

---

## Loading More Rows

Excel View loads the first **200 rows** by default for performance. A **Load More** bar appears at the bottom when more rows are available.

- Click **Load More** to fetch the next batch
- Excel View supports up to **100,000+ rows** with virtual scrolling (data is fetched in pages; only visible rows are rendered)

The page size can be changed via the status bar row count control.

---

## Context Menu (Right-Click)

Right-click any cell or selection to get:

- **Copy** / **Cut** / **Paste**
- **Insert Row Above / Below**
- **Delete Row**
- **Hide Row**
- **Clear Cell**
- **Add Comment**
- **Open Form** (opens the Frappe form for the row's document)
- **Copy Link** (copies the Frappe form URL to clipboard)
