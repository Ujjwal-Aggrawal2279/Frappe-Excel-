---
id: child-tables
title: Child Tables
sidebar_label: Child Tables
---

# Child Tables

Many Frappe DocTypes have **child tables** — embedded sub-records with multiple rows. Examples:

- **Sales Invoice** → Items table (item, qty, rate, amount)
- **Purchase Order** → Supplier Quotation Items
- **Project** → Tasks table
- **BOM** → BOM Items

Excel View lets you expand any parent row to reveal and edit its child table rows inline in the same grid.

---

## Expanding a Child Table

1. Look for the **▶ expand arrow** in the row header (far left) of any row
2. If a row has child table data, the arrow is visible
3. Click **▶** to expand

The parent row stays visible. Below it, child rows appear indented with a **light blue background** (`#f4f8ff`). Each child row represents one child table record.

---

## The Child Table Panel

When you click the expand arrow, a **slide-down panel** appears below the parent row showing:

- A mini-grid with all child table fields as columns
- One row per child record
- Fully editable cells (same inline editing as the main grid)
- A footer showing the child row count
- A **+ Add Row** button to append new child records
- A **Delete** button (trash icon) on each child row to delete that child

---

## Editing Child Table Cells

Click any cell in the child table panel to edit it. The same rules apply as the main grid:

- Link fields show autocomplete
- Select fields show a dropdown
- Date fields show a date picker
- **Text Editor / HTML fields** show a rich text preview with a pencil button — click the pencil to open the [Rich Text Editor modal](/docs/data-entry/rich-text-fields)

Changes in the child table panel save immediately when you click outside the cell (auto-save on blur). You do not need to press Ctrl+S separately for child table changes.

---

## Adding Child Rows

Click the **+ Add Row** button at the bottom of the child table panel. A new blank row is appended. Fill in the required fields and click outside to save.

---

## Deleting Child Rows

Click the **trash icon** on the far right of a child row. A confirmation appears. On confirm, the child record is deleted from Frappe immediately.

:::warning
Child row deletion is immediate and cannot be undone from Excel View. Use the Frappe form's version history if you need to recover a deleted child row.
:::

---

## Collapsing

Click the **▼** arrow (now pointing down, indicating expanded) to collapse the child table and hide the panel.

---

## Scrolling in the Child Panel

The child table panel has its own scroll. If the child table has many rows:

- Scroll **inside the panel** using the mouse wheel while hovering over the panel
- The main grid will NOT scroll while you are scrolling inside the panel (scroll isolation)

---

## Child Tables and Export

When exporting a DocType sheet to XLSX:
- If child table expand is **collapsed**: only the parent row is exported (no child rows)
- If child table expand is **expanded**: the parent row and its visible child rows are both included in the export

---

## Supported Doctypes

Any DocType that has at least one field of type `Table` (child table field) will show the expand arrow. If a parent record has zero child rows, the expand arrow is still present but the panel will show an empty state.
