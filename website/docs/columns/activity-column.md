---
id: activity-column
title: Activity Column
sidebar_label: Activity Column
---

# Activity Column (_social)

The **Activity Column** is a virtual column that shows social/collaboration actions for each record — likes, comments, assignments, and tags — directly in the grid row.

---

## Enabling the Activity Column

View tab → **Activity Column** toggle.

The `_social` column appears at the far right of the grid (after the meta column if both are enabled).

---

## What It Shows

Each row's activity cell shows icon buttons:

| Icon | Action |
|---|---|
| ❤ Heart | Like / Unlike the record. Count shown next to icon. |
| 💬 Comment | Open comment dialog to add a comment |
| 👤 Assign | Assign the record to a user (creates a ToDo) |
| 🏷 Tag | Add or remove tags |

For **submittable DocTypes** (Sales Invoice, Purchase Order, etc.), a **docstatus badge** also appears showing Draft / Submitted / Cancelled.

---

## Liking a Record

Click the heart icon. The count increments immediately (optimistic update). The like is saved to Frappe in the background. Click again to unlike.

## Adding a Comment

Click the comment icon → a dialog opens → type your comment → click **Add**. The comment is saved as a `Comment` document linked to the record.

## Assigning a Record

Click the assign icon → a dialog opens → search for a user → optionally add a description and due date → click **Assign**. This creates a `ToDo` linked to the record.

## Tagging a Record

Click the tag icon → a dialog opens → type or select tags → click **Save**. Tags are stored as `Tag Link` records.

---

## Dark Theme

The activity column is fully dark-theme compatible. All icons and dialogs use Frappe CSS variables for automatic theme switching.

---

## Persistence

Activity column visibility is saved in user settings and workbooks.
