---
id: managing-sheets
title: Managing Sheets
sidebar_label: Managing Sheets
---

# Managing Sheets

## Adding a Sheet

Click the **[+]** button in the sheet tab bar at the bottom. A dialog appears asking for the sheet type:

- **DocType Sheet** — pick a DocType
- **Report Sheet** — pick a Frappe report
- **Blank Sheet** — empty scratch pad
- **Query Sheet** — visual SQL builder

## Switching Sheets

Click any sheet tab. The grid instantly switches to that sheet's data.

## Renaming a Sheet

Double-click the sheet tab → type the new name → press Enter.

:::note
You can only rename sheets in a saved Workbook. See [Workbooks](/docs/sheets/workbooks).
:::

## Reordering Sheets

Right-click a sheet tab → **Move Left** or **Move Right**.

## Deleting a Sheet

Right-click a sheet tab → **Delete Sheet**. You'll be asked to confirm. The underlying Frappe data is NOT deleted — only the sheet configuration is removed.

## Duplicating a Sheet

Right-click a sheet tab → **Duplicate**. Creates a copy of the sheet with the same DocType/report configuration and column setup.

---

## Sheet Persistence

Sheet configurations (which DocType/report, column selection, filters, Smart Lookup config) are saved automatically to your user settings under the key `excel_sheets`. They persist across browser sessions.

When you close and reopen Excel View for a DocType, your sheets are restored exactly as you left them.

---

## Multiple Sheets, Same DocType

You can have multiple sheets pointing to the same DocType with different column configurations or filters. For example:

- **Sheet 1**: Sales Invoice — all columns, all statuses
- **Sheet 2**: Sales Invoice — only Amount fields, only Submitted
- **Sheet 3**: Sales Invoice Pivot

This is the recommended way to create different "views" of the same data.
