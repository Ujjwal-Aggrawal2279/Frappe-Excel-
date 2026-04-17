---
id: permissions
title: Permissions
sidebar_label: Permissions
---

# Permissions

Excel View uses **Frappe's standard DocType permission system** — no additional permission configuration is required.

---

## How Permissions Map to Grid Actions

| Frappe Permission | Grid Behavior |
|---|---|
| **Read** | Can open the grid and view data (read-only mode) |
| **Write** | Can edit cells and save changes |
| **Create** | Can add new rows (+ Add Row button enabled) |
| **Delete** | Can delete rows via right-click → Delete |
| **Submit** | Can submit documents (if Workflow Actions feature enabled) |
| **Cancel** | Can cancel submitted documents |

If a user has only **Read** permission, all cells in the grid are non-editable. The Save button is hidden.

---

## Field-Level Permissions

Frappe supports field-level read/write permissions (via DocType field settings or User Permissions). Excel View respects these:

- Fields marked `read_only: 1` in the DocType → non-editable in grid
- Fields hidden by Frappe's `perm` rules → not loaded and not shown in column picker

---

## User Permissions (Record-Level)

Frappe's User Permissions (e.g., "User X can only see records for Company Y") are applied server-side. Excel View sends the user's session cookie with every API call, so Frappe automatically filters records based on User Permissions.

---

## Permission Errors

If you try to save a record that your permissions don't allow (e.g., someone else changed permissions while you were editing), Frappe returns a `PermissionError`. Excel View displays this as a red error badge on the failed row with the message "Insufficient permission".

---

## No Extra Roles Needed

Excel View does not ship any custom roles or permission documents. It operates entirely within Frappe's existing permission model.
