---
id: focus-cell
title: Focus Cell (Crosshair)
sidebar_label: Focus Cell
---

# Focus Cell (Crosshair)

The **Focus Cell** feature highlights the entire row and column of the active cell with a colored tint, creating a crosshair effect. This makes it much easier to read across wide spreadsheets.

---

## Enabling Focus Cell

1. Click the **View** tab in the toolbar
2. Click **Focus Cell** toggle

The active cell's row and column are immediately highlighted.

---

## Changing the Highlight Color

1. With Focus Cell enabled, click the **color swatch** next to the Focus Cell button in the View tab
2. A color picker opens (Pickr)
3. Choose any color — the crosshair updates in real time
4. The color is saved to your user settings

---

## Dark Theme

In dark theme, the Focus Cell uses an **opaque blended color** rather than a transparent tint. This prevents the white grid cell background from bleeding through.

The color you pick is automatically blended over the dark background (#1c1c1c) at a fixed opacity, so the crosshair looks clean regardless of what color you choose.

---

## Persistence

Focus Cell state (on/off) and the chosen color are saved to `frappe.model.user_settings` and persist across sessions per DocType.
