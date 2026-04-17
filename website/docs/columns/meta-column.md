---
id: meta-column
title: Meta Column
sidebar_label: Meta Column
---

# Meta Column (_meta)

The **Meta Column** is a virtual column (not a real Frappe field) that shows **who last modified a record and when**. It gives you an at-a-glance change history right in the grid.

---

## Enabling the Meta Column

View tab → **Meta Column** toggle.

The column appears at the far right of the grid with the label `_meta`.

---

## What It Shows

Each cell in the meta column shows:

- **Relative time** — "2 hours ago", "Yesterday", "3 days ago"
- **Author first name** — the user who last modified the record
- A **pencil icon** if the record has been modified (not just created)
- An **avatar placeholder** in the color matching the user

Hover over a meta cell for the full details: exact timestamp + full username.

---

## Persistence

Meta column visibility is saved per DocType in user settings and in workbooks.

---

## Performance

Meta column data is included in the initial data load — no extra API call. The relative time strings are computed by `frappe.datetime.comment_when()` and cached per row.
