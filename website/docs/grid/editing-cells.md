---
id: editing-cells
title: Editing Cells
sidebar_label: Editing Cells
---

# Editing Cells

## Starting an Edit

You can start editing a cell in three ways:

| Action | Result |
|---|---|
| **Enter** or **F2** on selected cell | Opens cell for editing, cursor at end |
| **Double-click** a cell | Opens cell for editing |
| **Start typing** on selected cell | Replaces cell content immediately |

When editing begins:
- The cell grows a text cursor
- The formula bar shows the raw value/formula
- Navigation arrows move the cursor within the cell (not to other cells)

## Confirming an Edit

| Key | Effect |
|---|---|
| **Enter** | Confirm and move **down** |
| **Tab** | Confirm and move **right** |
| **Shift+Enter** | Confirm and move **up** |
| **Shift+Tab** | Confirm and move **left** |
| **Ctrl+Enter** | Confirm and stay on same cell |
| **Escape** | Cancel — discard the edit |

## Field-Type Specific Editors

Excel View uses the appropriate editor for each Frappe field type:

| Frappe Field Type | Editor |
|---|---|
| Data / Small Text | Plain text input |
| Int / Float / Currency | Numeric input with validation |
| Select | Dropdown picker with all options |
| Date | Date picker |
| Datetime | Datetime picker |
| Link | Autocomplete search (fetches matching docs) |
| Check | Checkbox toggle |
| Text / Long Text | Plain text editor + formula bar |
| **Text Editor** | **[Rich Text Modal](#rich-text-fields)** (double-click) |
| **HTML** | **[Rich Text Modal](#rich-text-fields)** (double-click) |
| Attach / Attach Image | Read-only in grid; open form to change |
| Password | Masked — read-only in grid |

## Link Field Autocomplete

When editing a **Link** field (e.g., Customer, Item, Employee):

1. Start typing — a dropdown appears with matching document names
2. Use **arrow keys** to navigate the suggestions
3. Press **Enter** or click to select
4. If the value you type doesn't match any existing document, the cell shows a **red validation error** and the save will be blocked

## Date Picker

When editing a **Date** field:

1. A calendar picker appears
2. Navigate months with **< >** buttons
3. Click a date to select it
4. Or type the date directly in `YYYY-MM-DD` format

## Checkbox

For **Check** fields, double-click or press **Space** to toggle the checkbox. No typing required.

## Rich Text Fields

For **Text Editor** or **HTML** fields (e.g., Notes, Description, Item Description), the cell shows a **live HTML preview**. Double-clicking opens the **Excel View Rich Text Editor modal**:

- Full **ProseMirror** editor (same as Frappe's native form editor)
- **Bold / Italic / Underline** toolbar
- **Ordered and unordered lists**
- **Tables** inside the editor
- **Ctrl+S** inside the modal to save
- **Escape** to close without saving

The formula bar shows the plain-text version (HTML tags stripped).

:::tip Questionnaire Trees and Custom HTML
If you've built complex HTML content (like a questionnaire tree with custom CSS) inside a Text Editor field, Excel View will render it faithfully in both the cell preview and the RTE modal — all custom HTML and inline CSS is preserved.
:::

## Validated Fields

Excel View validates certain field types before allowing a save:

| Field Type | Validation |
|---|---|
| Int | Must be a whole number |
| Float / Currency | Must be a number |
| Select | Must be one of the allowed options |
| Link | Must match an existing document |
| Date | Must be a valid date (YYYY-MM-DD) |

Failed validations show a **red cell border** and a tooltip explaining the error. The row cannot be saved until all validation errors are resolved.

## Undo / Redo

- **Ctrl+Z** — undo the last cell change
- **Ctrl+Y** — redo

Undo history is per-session (cleared on page refresh). Saved changes cannot be undone via Ctrl+Z — use Frappe's document history / version control for that.
