---
id: sharing
title: Sharing Workbooks
sidebar_label: Sharing
---

# Sharing Workbooks

Workbooks are Frappe documents and can be shared using standard Frappe document sharing.

## Sharing a Workbook

1. Open the **Excel Workbook** DocType in Frappe (search in the top bar)
2. Find your workbook by name
3. Open it
4. Click the **Share** button in the form's sidebar
5. Add users or roles
6. Set permission level (Read, Write)
7. Save

## Opening a Shared Workbook

When another user opens their Excel View for a DocType, shared workbooks for that DocType appear in the **Workbook** dropdown.

## Permission Boundaries

Even if you share a workbook, each user's **Frappe document permissions** still apply. A user without Read access to Purchase Orders cannot see those records in the grid, even if you share a workbook configured for Purchase Orders.

Workbook sharing only shares the **configuration** (which sheets, which columns, which Smart Lookups) — not the underlying data.

## Public Workbooks

You can share a workbook with the `All Users` role to make it available to everyone on the site.
