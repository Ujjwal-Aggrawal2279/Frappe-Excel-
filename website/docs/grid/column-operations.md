---
id: column-operations
title: Column Operations
sidebar_label: Column Operations
---

# Column Operations

## Adding Columns (Choose Columns)

Click **Data → Choose Columns** or press **Ctrl+Shift+C**.

The field picker modal shows all available fields for the current DocType. Use the search box to find fields quickly. Check/uncheck fields to add/remove them. Click **Apply**.

Your selection is saved server-side per DocType per user — it persists across sessions and devices.

:::note
Child table fields do **not** appear here. Child table data is accessed via the expand arrow (▶) on each row.
:::

---

## Reordering Columns

Drag any column header left or right to reorder it. A blue indicator line shows where the column will land. Release to drop.

The new column order is saved automatically to your user settings.

---

## Resizing Columns

Drag the right edge of a column header to resize. Double-click the right edge of a column header to auto-fit the column to its content.

Resize state is saved per DocType per user.

---

## Hiding Columns

Right-click a column header → **Hide Column**. The column disappears.

To show hidden columns: right-click any visible column header → **Show Hidden Columns**.

---

## Formula Columns

You can add a computed column that runs a HyperFormula formula across all rows:

1. Right-click any column header → **Insert Formula Column**
2. Name the column
3. Enter a formula (e.g., `=C1*D1` to multiply Qty × Rate)

Formula column cells update automatically when their source cells change. Formula columns are **not saved back to Frappe** — they are display-only.

---

## Smart Lookup Columns

Smart Lookup adds columns from a related DocType. See [Smart Lookup](/docs/data/smart-lookup) for the full guide.

After a Smart Lookup is applied, the joined columns appear at the right of the grid with an italic header. They are **read-only** in the grid (the underlying source document can be opened via the ID link).

---

## Column Pinning (Freeze)

To keep the leftmost N columns visible while scrolling right:

1. Click **View → Freeze Columns**
2. Enter the number of columns to freeze (e.g., `2`)

The frozen columns get a thicker right border. To unfreeze: View → Freeze Columns → set to `0`.

---

## Column Header Right-Click Menu

Right-click any column header for:

| Option | Effect |
|---|---|
| Sort Ascending | Sort grid by this column A→Z / 0→9 |
| Sort Descending | Sort grid by this column Z→A / 9→0 |
| Insert Formula Column | Add a computed column to the right |
| Hide Column | Hide this column |
| Show Hidden Columns | Show all hidden columns |
| Column Width | Set exact width in pixels |
| Reset Width | Reset to default width |
