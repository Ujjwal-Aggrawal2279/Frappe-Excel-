---
id: validation
title: Validation
sidebar_label: Validation
---

# Validation

Excel View validates cell values against Frappe's field type rules before allowing a save. Validation errors are shown inline — no dialog boxes.

---

## Real-Time Validation

Validation runs as you type (or as soon as you leave the cell). Invalid cells show:

- A **red border** around the cell
- A **tooltip** on hover explaining the error (e.g., "Must be a number", "Not a valid Customer")
- The row save is **blocked** until the error is fixed

---

## Validation Rules by Field Type

| Field Type | Rule |
|---|---|
| **Int** | Must be a whole number (no decimals, no letters) |
| **Float / Currency** | Must be a valid number |
| **Select** | Must match one of the allowed options exactly |
| **Link** | Must match an existing Frappe document of the linked DocType |
| **Date** | Must be a valid date in `YYYY-MM-DD` format |
| **Datetime** | Must be a valid datetime |
| **Email** | Must be a valid email format |
| **Phone** | Must be digits, `+`, `-`, spaces only |

---

## Link Field Validation

For **Link** fields (fields that reference another DocType like Customer, Item, Employee), Excel View checks that the value you type exists in Frappe:

1. You type a value in a Link field
2. Excel View calls Frappe's API to check if a document with that name exists
3. If it does → cell turns green, value accepted
4. If it does not → cell turns red, tooltip: `"[value] is not a valid [DocType]"`

Results are cached in memory so the same lookup isn't repeated multiple times for the same value within a session.

---

## Frappe-Level Validation on Save

Even after passing client-side validation, Frappe may still reject a save if:
- A mandatory field is empty
- A unique field constraint is violated
- A custom server-side validation script raises an error

When this happens, the failed row shows a **red left border** and the Frappe error message appears in a toast notification.

---

## Bypassing Validation (Power Users)

If you paste data in bulk and some values fail validation, you can still attempt a save — Frappe will reject the invalid rows and save the valid ones. Review the error rows, fix them, and save again.

There is no way to permanently disable validation — it protects data integrity in Frappe.
