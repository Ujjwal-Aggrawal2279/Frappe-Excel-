---
id: inline-editing
title: Inline Editing
sidebar_label: Inline Editing
---

# Inline Editing

Inline editing is the core of Excel View. Every cell maps to a Frappe document field, and you can edit it directly in the grid without opening a form.

---

## How Changes Are Tracked

When you edit a cell:

1. The cell background turns **light amber** — indicating an unsaved change
2. The row number shows a **pencil icon** — indicating this row has pending changes
3. The **Save** button in the toolbar turns orange with a count badge showing how many rows have changes
4. The status bar shows "N unsaved rows"

---

## Saving Changes

Press **Ctrl+S** or click **Save** in the toolbar.

Excel View saves all pending rows in parallel using Frappe's API. A progress indicator appears. On completion:
- A green success toast shows "Saved X rows"
- Modified cells return to white background
- Row pencil icons disappear

If any row fails to save, a red error toast appears for that row with the error message from Frappe.

---

## Partial Saves

If 5 out of 6 modified rows save successfully and 1 fails, the 5 successful rows are cleared from the pending state. The 1 failed row remains in the modified state with a red error indicator.

---

## What Can Be Edited

- Any field where you have **Write** permission in Frappe
- Non-virtual, non-read-only fields (as defined in DocType meta)
- Fields not listed as `read_only: 1` in the DocType definition

Fields that **cannot** be edited inline:
- `Attach` / `Attach Image` — file uploads require the form
- `Password` — masked and non-editable in grid
- `Read Only` fields as marked in DocType definition
- Virtual columns (_meta, _social, Smart Lookup join columns)
- Submitted/Cancelled document fields (locked by docstatus)

---

## Bulk Editing the Same Field

To set the same value in multiple rows at once:

1. Edit the first cell and enter the value
2. Copy it (Ctrl+C)
3. Select the cells below (Shift+click or Shift+arrow)
4. Paste (Ctrl+V)

Or use **Fill Down** (Ctrl+D) if the cells are contiguous.

---

## Editing Submitted Documents

Documents with `docstatus = 1` (Submitted) are **locked** — cells are read-only. To edit a submitted document you must cancel it first via the Frappe form (click the ID link to open the form).

Cancelled documents (`docstatus = 2`) are also read-only in the grid.
