---
id: formula-bar
title: Formula Bar
sidebar_label: Formula Bar
---

# Formula Bar

The formula bar sits directly below the toolbar. It shows the **raw value or formula** of the selected cell.

---

## What It Shows

| Cell Type | Formula Bar Shows |
|---|---|
| Text / number | Raw value |
| Date | ISO date string (`YYYY-MM-DD`) |
| Formula cell | The formula (`=SUM(A1:A10)`) |
| Text Editor / HTML cell | Plain text (HTML tags stripped) |
| Empty cell | (blank) |

For **Text Editor** and **HTML** fields, the formula bar strips the HTML markup and shows the readable plain text content. This is useful for fields like Notes or Description where the cell preview shows formatted HTML but you want to read the text quickly.

---

## Editing via Formula Bar

1. Click the **formula bar input area** (right side of the bar)
2. Edit the value or formula directly
3. Press Enter to confirm or Escape to cancel

This is useful for:
- Entering long formulas without the cell being too small to read
- Editing a cell value without accidentally activating cell navigation

---

## Cell Reference Box

The left side of the formula bar shows the selected cell's coordinates (e.g., `A1`, `C14`).

Click the cell reference box and type a coordinate (e.g., `B42`) and press Enter to jump directly to that cell. This is faster than scrolling for large sheets.

---

## Formula Bar for Multi-Cell Selections

When multiple cells are selected, the formula bar shows the value of the **top-left cell** in the selection.
