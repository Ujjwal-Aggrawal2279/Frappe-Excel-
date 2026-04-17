---
id: choosing-columns
title: Choosing Columns
sidebar_label: Choosing Columns
---

# Choosing Columns

The column picker lets you control exactly which DocType fields appear in the grid.

---

## Opening the Column Picker

- **Data tab → Choose Columns**
- **Keyboard shortcut**: Ctrl+Shift+C

A centered modal opens.

---

## The Field Picker Modal

The modal shows two panels:

**Left panel — Available Fields**
All fields for the current DocType, grouped by type:
- Data / Text fields
- Numeric fields (Int, Float, Currency, Percent)
- Date / Datetime fields
- Link fields
- Select fields
- Other types

Use the **search box** at the top to filter fields by name or label.

**Right panel — Selected Fields**
Fields currently shown in the grid. Drag to reorder within this panel.

---

## Adding a Field

Tick the checkbox next to any field in the left panel. It moves to the right panel.

## Removing a Field

Untick a field's checkbox, or click the × button in the right panel.

## Reordering Fields

Drag fields in the right panel to set their left-to-right column order.

---

## Applying Changes

Click **Apply**. The grid immediately re-renders with the new columns. Your selection is saved to Frappe's user settings.

## Canceling

Click **Cancel** or press **Escape** to close without changes.

---

## What Doesn't Appear Here

- **Child table fields** — e.g., Sales Invoice items. Accessible via child table expand.
- **Virtual columns** — _meta, _social — added via View tab.
- **Formula columns** — added via right-click → Insert Formula Column.

---

## Per-DocType Persistence

Your column selection is stored per DocType per user in `frappe.model.user_settings`. Different users can have different column configurations for the same DocType.
