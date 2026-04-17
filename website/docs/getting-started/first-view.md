---
id: first-view
title: Opening Your First View
sidebar_label: First View
---

# Opening Your First Excel View

There are three ways to open Excel View for any DocType.

---

## Method 1 — From List View (Recommended)

1. Navigate to any DocType list in Frappe (e.g., **CRM > Customer**)
2. Click the **View** dropdown in the toolbar (next to the search bar)
3. Select **Excel View**

The grid opens immediately with the same filters and sort order you had in the list view.

---

## Method 2 — Direct URL

Navigate directly to:

```
https://yoursite.local/app/{doctype}/view/excel
```

For example:
- `/app/customer/view/excel` — Customer grid
- `/app/sales-invoice/view/excel` — Sales Invoice grid
- `/app/item/view/excel` — Item grid

The URL slug uses hyphens (Frappe's standard URL format for DocType names with spaces).

---

## Method 3 — Workspace Shortcut

You can pin a direct link to any Excel View in your Frappe Workspace:

1. Open any Workspace in edit mode
2. Add a **Link** shortcut
3. Set the URL to `/app/{doctype}/view/excel`
4. Save the workspace

---

## What You See on First Open

When Excel View opens for a DocType for the first time:

1. **Loading indicator** — brief spinner while fetching data and metadata
2. **Grid** — rows of data, one record per row
3. **Default columns** — the same fields shown in list view (usually Name, Status, Company, Modified)
4. **Toolbar** — ribbon across the top with tab groups: Home, View, Data, Insert, Format
5. **Formula bar** — below the toolbar, shows the raw value of the selected cell
6. **Sheet tabs** — at the bottom, one tab per open sheet
7. **Status bar** — at the very bottom, shows row count, selected cell count, and quick stats

---

## Choosing What Columns to Show

By default, only the standard list view fields appear. To add or remove columns:

1. Click **Data** tab in the toolbar
2. Click **Choose Columns** (or press **Ctrl+Shift+C**)
3. A modal opens showing all available fields for the DocType
4. Check/uncheck fields, use the search box to find specific fields
5. Click **Apply**

Your column selection is saved automatically per DocType per user.

:::note Child Table Fields
Child table fields (like Sales Invoice items) do **not** appear in the column chooser — they are accessed via the **child table expand** feature on each row (see [Child Tables](/docs/data-entry/child-tables)).
:::

---

## Your First Edit

1. Click any cell to select it
2. Press **Enter** or **F2** to begin editing
3. Type the new value
4. Press **Enter** to confirm (moves down) or **Tab** to confirm (moves right)
5. Press **Ctrl+S** or click the **Save** button to write changes to Frappe

A **green dot** on unsaved rows indicates pending changes. A **save confirmation toast** appears in the bottom-right when the save succeeds.

---

## Navigation Basics

| Action | Shortcut |
|---|---|
| Move between cells | Arrow keys |
| Begin editing | Enter or F2 |
| Confirm edit & move down | Enter |
| Confirm edit & move right | Tab |
| Cancel edit | Escape |
| Select entire row | Click row number |
| Select entire column | Click column header |
| Select all | Ctrl+A |
| Open in Frappe Form | Click the **Name** (ID) link in the first column |

For the complete shortcut reference, see [Keyboard Shortcuts](/docs/reference/keyboard-shortcuts).
