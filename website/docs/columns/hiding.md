---
id: hiding
title: Hiding Columns
sidebar_label: Hiding Columns
---

# Hiding Columns

Sometimes you want to keep a column in your configuration (for reference or formula use) but not show it in the main view. Hiding columns keeps them configured but invisible.

## Hiding a Column

Right-click a column header → **Hide Column**.

The column disappears. Its data is still present in memory.

## Showing Hidden Columns

Right-click any visible column header → **Show Hidden Columns**. All hidden columns reappear.

## Difference from Removing a Column

| Hide | Remove (via Column Picker) |
|---|---|
| Column stays in configuration | Column is removed from config |
| Still available for formula references | No longer accessible |
| Data loaded from Frappe | Data not loaded |
| Quick to show/hide | Requires reopening column picker |

Use **hide** when you temporarily don't want to see a column but may want it back soon. Use **remove** when you never want to see that field.
