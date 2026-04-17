---
id: find-replace
title: Find & Replace
sidebar_label: Find & Replace
---

# Find & Replace

## Opening the Find Bar

Press **Ctrl+F** to open the Find & Replace bar. It appears above the grid.

## Finding Text

1. Type your search text in the **Find** box
2. Matching cells are highlighted in yellow
3. Press **Enter** or **F3** to jump to the next match
4. Press **Shift+Enter** or **Shift+F3** to go to the previous match
5. The status bar shows "X of Y matches"

## Replacing Text

1. Press **Ctrl+H** (or click the expand arrow in the find bar to show the Replace field)
2. Enter the search text in **Find**
3. Enter the replacement in **Replace**
4. Click **Replace** to replace the current match, or **Replace All** to replace all at once

:::caution
**Replace All** stages all matching changes at once. You still need to press **Ctrl+S** to save them to Frappe. Review the yellow-highlighted changed cells before saving.
:::

## Options

| Option | Effect |
|---|---|
| **Match case** | `Invoice` does not match `invoice` |
| **Whole cell** | Only matches if the entire cell equals the search text |
| **Search in** | Current sheet only, or all sheets in the workbook |
| **Search by** | Rows (left-to-right, top-to-bottom) or Columns |

## Closing

Press **Escape** to close the Find & Replace bar without losing your selection.
