---
id: rich-text-fields
title: Rich Text Fields
sidebar_label: Rich Text Fields
---

# Rich Text Fields (Text Editor / HTML)

Fields of type **Text Editor** or **HTML** contain formatted content — HTML markup, inline CSS, embedded lists, tables, or even complex custom layouts like questionnaire trees.

Excel View handles these fields with a live preview in the grid cell and a dedicated rich text editor modal for editing.

---

## Cell Preview

In the grid, Text Editor and HTML cells show a **live HTML preview**:

- The actual rendered HTML is displayed (fonts, bold, lists, etc.)
- Custom CSS embedded in the HTML is also rendered
- The preview is clipped to the cell height — hover over the cell to see a tooltip
- The formula bar shows the **plain text version** (HTML tags stripped for readability)

:::tip Questionnaire Trees & Custom HTML
If you've built a custom HTML structure inside a Text Editor field (like an interactive questionnaire, a formatted table, or a tree with CSS), Excel View renders it faithfully — all custom markup and inline CSS is preserved and visible.
:::

---

## Opening the Rich Text Editor

**Double-click** any Text Editor or HTML cell to open the **Excel View Rich Text Editor modal**.

The modal opens with:
- A **green accent header** showing the field name and an animated "Editing" badge
- The full **ProseMirror editor** (same as Frappe's native form editor)
- A rich formatting toolbar inside the editor
- A footer with **Save** and **Cancel** buttons

---

## Inside the Editor

The ProseMirror editor supports:

| Feature | How |
|---|---|
| Bold | Ctrl+B or toolbar button |
| Italic | Ctrl+I or toolbar button |
| Underline | Ctrl+U or toolbar button |
| Ordered list | Toolbar button |
| Unordered list | Toolbar button |
| Heading (H1–H3) | Toolbar dropdown |
| Table | Toolbar → Insert Table |
| Link | Ctrl+K or toolbar button |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y |

---

## Saving from the Modal

| Action | Shortcut |
|---|---|
| Save and close | **Ctrl+S** |
| Save button | Click **Save** in the footer |
| Close without saving | **Escape** or click **Cancel** |

When you save, the change is written to Frappe immediately (the modal handles its own API call). The cell preview in the grid updates instantly.

---

## Read-Only Fields

If the field is marked `read_only: 1` in the DocType definition, the RTE modal opens in **view-only mode**:
- The editor is not editable
- The footer shows only a **Close** button (no Save)
- This matches Frappe's native form behavior for read-only fields

---

## Child Table Rich Text Fields

The same behavior applies to Text Editor / HTML fields inside child tables. In the child table panel:
- Cells show a rich preview with a **pencil icon** button
- Clicking the pencil opens the same EV Rich Text Editor modal
- Saving writes to the child record directly

---

## Keyboard Shortcut Summary

| Shortcut | Action |
|---|---|
| Double-click cell | Open RTE modal |
| Ctrl+S (inside modal) | Save and close |
| Escape (inside modal) | Cancel / close |
| Ctrl+B / I / U (inside modal) | Bold / Italic / Underline |
