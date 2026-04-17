---
id: cell-colors
title: Cell & Text Colors
sidebar_label: Cell Colors
---

# Cell & Text Colors

## Background Color (Fill)

1. Select one or more cells
2. Home tab → **Background Color** button (paint bucket icon)
3. A color palette opens — choose from:
   - **Theme colors** (Frappe brand palette)
   - **Standard colors** (16 common colors)
   - **Custom color picker** (full HSV picker via Pickr)

Click a color to apply it immediately.

## Text Color

1. Select one or more cells
2. Home tab → **Text Color** button (A with underline icon)
3. Same palette as background color

## Clearing Colors

Select cells → Format tab → **Clear Format** removes all cell formatting including colors.

Or: select cells → Background Color → pick **white** (for light theme) / **black** (for dark theme).

## Dark Theme Compatibility

Cell colors are stored as-is. In dark theme, the grid renders the same colors on the dark cell background. Pure white cells maintain their white background in both themes (Excel View enforces this via CSS overrides).

## Color Persistence

Cell colors are stored in `format_store` in your user settings and in any saved workbook.
