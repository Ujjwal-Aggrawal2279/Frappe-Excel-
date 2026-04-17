---
id: undo-redo
title: Undo / Redo
sidebar_label: Undo & Redo
---

# Undo & Redo

## Shortcuts

| Action | Shortcut |
|---|---|
| Undo last change | **Ctrl+Z** |
| Redo (re-apply undone change) | **Ctrl+Y** |

## What Can Be Undone

- Cell value edits
- Cell format changes (color, bold, italic, alignment, border)
- Number format changes
- Row additions (new rows)
- Column reorders

## What Cannot Be Undone

- **Saved changes** — once you press Ctrl+S and changes are written to Frappe, they cannot be undone via Ctrl+Z. Use Frappe's document version history to recover previous values.
- **Deleted rows** — deletion + save is permanent. Use Frappe form's version history.
- **Child table saves** — child table changes auto-save immediately and cannot be undone in the grid.

## Undo History Depth

The undo history holds up to **50 operations** per session. Closing and reopening Excel View clears the history.
