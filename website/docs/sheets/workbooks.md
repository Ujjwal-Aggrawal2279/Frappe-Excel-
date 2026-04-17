---
id: workbooks
title: Workbooks
sidebar_label: Workbooks
---

# Workbooks

A **Workbook** is a saved collection of sheets with a name. Think of it like saving an Excel file — your sheet layout, column configuration, formatting, and data are all preserved.

---

## Creating a Workbook

1. Click the **Workbook** button in the top-right corner of the toolbar (or press **Ctrl+Shift+W**)
2. Click **Save as New Workbook**
3. Enter a name for the workbook (e.g., "Monthly Sales Review")
4. Click **Save**

The workbook is stored as an **Excel Workbook** DocType record in Frappe, linked to your user account.

---

## Opening a Workbook

1. Click the **Workbook** button
2. Your saved workbooks are listed
3. Click a workbook name to load it

When a workbook loads:
- All sheets are restored exactly as saved
- Column widths, row heights, hidden rows, formatting, Smart Lookup configuration, pivot config — everything is restored
- The active sheet tab is the one that was active when you last saved

---

## Saving a Workbook

Press **Ctrl+S** inside a workbook to save data changes AND workbook state. Or click **Workbook → Save**.

Workbooks auto-save their **structure** (sheets, config, formatting) whenever you make structural changes (add/remove sheets, change columns, etc.). Cell data changes are staged and saved to Frappe via the normal save flow.

---

## What Is Saved in a Workbook

| Component | Saved? |
|---|---|
| Sheet list and types | ✅ |
| Column selection per sheet | ✅ |
| Column widths | ✅ |
| Row heights | ✅ |
| Hidden rows | ✅ |
| Cell formatting (colors, bold, borders) | ✅ |
| Number formats | ✅ |
| Freeze column setting | ✅ |
| Smart Lookup configuration | ✅ |
| Pivot configuration | ✅ |
| Conditional Formatting rules | ❌ (stored in user settings, not workbooks) |
| Active filters | ✅ (for report sheets) |
| IntelliFlow canvas layout | ✅ |

---

## Sharing Workbooks

Workbooks are stored as Frappe documents. You can share them using standard Frappe document sharing:

1. Open the **Excel Workbook** DocType in Frappe
2. Find your workbook document
3. Use the **Share** button to share with other users or roles

When another user opens the shared workbook, they see the same sheet layout — but their own data filters and permissions apply.

---

## Deleting a Workbook

Workbook → **Manage Workbooks** → select a workbook → **Delete**.

Deleting a workbook only removes the saved configuration. It does **not** delete any Frappe data.
