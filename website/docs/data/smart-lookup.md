---
id: smart-lookup
title: Smart Lookup
sidebar_label: Smart Lookup
---

# Smart Lookup

Smart Lookup joins data from a related Frappe DocType into your sheet as extra read-only columns — without writing any SQL or code. Think of it as an automated VLOOKUP powered by Frappe's schema.

---

## Use Cases

- Sales Invoice sheet → pull **Customer Group** and **Territory** from Customer
- GL Entry sheet → pull **Employee Name** from Employee (via employee field)
- Purchase Order sheet → pull **Item Description** and **HSN Code** from Item
- Stock Entry sheet → pull **Supplier** and **Lead Time** from Item Supplier child table

---

## Opening Smart Lookup

1. Click the **Data** tab in the toolbar
2. Click **Smart Lookup**
3. A sidebar panel opens on the right side of the screen

---

## How It Works — 4-Layer Suggestion Engine

Smart Lookup analyzes your sheet and suggests which DocType to join and which field to use as the join key:

| Layer | Method |
|---|---|
| **0c** — Structural FK | `frappe.scrub(target_doctype) == source_col_fieldname` — detects obvious FK matches like `customer` → Customer |
| **1** — Meta Links | Finds Link fields in your DocType that point to the target |
| **2** — Header fuzzy match | Compares column headers using `rapidfuzz` |
| **3** — Data overlap | Checks if values in your column appear in the target DocType's name field |

Each suggestion shows a **confidence bar** (0–100%). Higher confidence = better FK match.

---

## Configuring a Lookup

1. In the Smart Lookup sidebar, you'll see a list of suggested target DocTypes with confidence scores
2. Click a suggestion to expand it
3. Choose which **fields from the target DocType** to pull in (use the checkbox list)
4. Click **Apply**

The selected fields appear as new columns in the grid with italic headers (e.g., *Customer Group*, *Territory*).

---

## Refreshing Lookup Data

Smart Lookup data is fetched when the sheet loads. Click **Refresh** in the toolbar to re-fetch from Frappe (picks up any changes in the source documents).

---

## Multiple Lookups

You can add multiple Smart Lookup configurations to the same sheet — one per related DocType. For example, on a Sales Invoice sheet you could join both Customer fields and Item fields.

---

## Smart Lookup on Report Sheets

Smart Lookup also works on Report sheets. It uses the same source field matching — the join key is detected from the report output columns.

---

## Persistence

Smart Lookup configurations are saved in your user settings and in workbooks. The target DocType, join field, and selected columns are all persisted.

---

## Read-Only Columns

Smart Lookup columns are **read-only** in the grid — you cannot edit the joined values directly. To change a joined value, click the ID link to open the source document's form.

This is intentional: the join is a read view of the source document. To avoid data inconsistency, edits should go through the source form.
