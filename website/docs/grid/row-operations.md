---
id: row-operations
title: Row Operations
sidebar_label: Row Operations
---

# Row Operations

## Adding Rows

### Append at Bottom
Click the **+ Add Row** button in the Home tab, or press **Ctrl+Alt+N**. A new blank row appears at the bottom of the grid with a light green background indicating it is new and unsaved.

### Insert Above/Below
Right-click any row → **Insert Row Above** or **Insert Row Below**.

### Pasting Multiple Rows
Copy rows from Excel or another source, click the target cell, and press **Ctrl+V**. Excel View pastes the data starting at the selected cell and creates new rows as needed.

---

## Deleting Rows

1. Select one or more rows by clicking their row numbers
2. Right-click → **Delete Row**, or press the **Delete** button in the Home tab
3. The row shows a strikethrough to indicate it is marked for deletion
4. Press **Ctrl+S** to confirm deletion in Frappe

:::warning Cannot Delete Submitted Documents
Submitted documents (`docstatus = 1`) cannot be deleted directly. You must cancel them first using the Frappe form, then delete.
:::

---

## Hiding Rows

Hiding rows removes them from view without deleting them from Frappe.

1. Select one or more rows by clicking their row numbers
2. Click **View** tab → **Hide Rows**
3. Selected rows disappear from the grid

### Unhiding Rows
- A thin **▲ / ▼ clickable band** appears at the boundary where rows are hidden
- Click the band to unhide all adjacent hidden rows
- Or: click **View** tab → **Show All Rows**

Hidden rows are saved to your user settings and persist between sessions.

---

## Copying & Pasting Rows

| Action | Shortcut |
|---|---|
| Copy selected cells | Ctrl+C |
| Cut selected cells | Ctrl+X |
| Paste | Ctrl+V |
| Copy row to next row | Select row, Ctrl+D (fill down) |

When pasting from external sources (Excel, Google Sheets), Excel View parses tab-separated values automatically.

---

## Selecting Multiple Rows

- Click row number, then **Shift+click** another row number — selects a contiguous range
- **Ctrl+click** row numbers to select non-contiguous rows
- **Ctrl+A** selects all rows in the sheet

With multiple rows selected, **Delete**, **Hide**, **Copy**, and **Format** operations all apply to the entire selection at once.

---

## Row Height

Drag the bottom edge of a row number to resize the row height. The new height is saved automatically.

To reset a row to default height: right-click the row number → **Reset Height**.

---

## Fill Down (Duplicate Value)

1. Type a value in a cell
2. Select that cell and the cells below it
3. Press **Ctrl+D**

The value fills down into all selected cells. This works on multiple columns simultaneously.

---

## Flash Fill (Pattern Fill)

See [Flash Fill](/docs/data-entry/flash-fill) for the full guide. In summary:

1. Enter a few examples in a new blank column showing the pattern you want
2. Press **Ctrl+E**
3. Excel View detects the pattern and fills the rest of the column
