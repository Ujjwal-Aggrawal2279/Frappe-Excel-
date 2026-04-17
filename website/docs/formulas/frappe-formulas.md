---
id: frappe-formulas
title: Frappe-Native Formulas
sidebar_label: Frappe Formulas
---

# Frappe-Native Formulas

Excel View extends HyperFormula with 7 ERP-specific functions that pull **live data from Frappe** directly into formula results.

:::tip Live Data
These formulas call Frappe's API at evaluation time. Results reflect the current state of your Frappe database — no data export or copy-paste needed.
:::

---

## FRAPPE_GET

Get a single field value from any Frappe document.

```
=FRAPPE_GET(doctype, docname, fieldname)
```

**Arguments:**
- `doctype` — the DocType name (e.g., `"Sales Invoice"`)
- `docname` — the document name/ID (e.g., `"INV-00001"`)
- `fieldname` — the field to retrieve (e.g., `"grand_total"`)

**Examples:**
```
=FRAPPE_GET("Sales Invoice", "INV-00001", "grand_total")
=FRAPPE_GET("Customer", A2, "credit_limit")
=FRAPPE_GET("Item", B5, "standard_rate")
```

Use a cell reference for `docname` to make the formula dynamic — it updates as you change the referenced cell.

---

## FRAPPE_SUM

Sum a numeric field across all documents of a DocType matching optional filters.

```
=FRAPPE_SUM(doctype, fieldname, [filter_field, filter_value, ...])
```

**Examples:**
```
=FRAPPE_SUM("Sales Invoice", "grand_total")
=FRAPPE_SUM("Sales Invoice", "grand_total", "customer", "Acme Corp")
=FRAPPE_SUM("Sales Invoice", "grand_total", "docstatus", 1, "customer", A2)
```

Filters are pairs: `field, value, field, value, ...` (up to 5 filter pairs supported).

---

## FRAPPE_COUNT

Count documents matching optional filters.

```
=FRAPPE_COUNT(doctype, [filter_field, filter_value, ...])
```

**Examples:**
```
=FRAPPE_COUNT("Sales Invoice")
=FRAPPE_COUNT("Sales Invoice", "docstatus", 1)
=FRAPPE_COUNT("Customer", "territory", "India")
```

---

## FRAPPE_AVG

Average a numeric field across filtered documents.

```
=FRAPPE_AVG(doctype, fieldname, [filter_field, filter_value, ...])
```

**Example:**
```
=FRAPPE_AVG("Sales Invoice", "grand_total", "customer", A2)
```

---

## GL_BALANCE

Get the current General Ledger balance for an account.

```
=GL_BALANCE(account_name, [company], [as_of_date])
```

**Arguments:**
- `account_name` — exact GL account name (e.g., `"Cash - Test Company"`)
- `company` (optional) — defaults to default company
- `as_of_date` (optional) — defaults to today

**Examples:**
```
=GL_BALANCE("Cash - Test Company")
=GL_BALANCE("Debtors - TC", "Test Company")
=GL_BALANCE("Cash - TC", "Test Company", "2026-03-31")
```

---

## STOCK_QTY

Get the current stock quantity for an item in a warehouse.

```
=STOCK_QTY(item_code, [warehouse])
```

**Examples:**
```
=STOCK_QTY("ITEM-001")
=STOCK_QTY("ITEM-001", "Main Warehouse - TC")
=STOCK_QTY(A2, B2)
```

Returns the sum of all bins if no warehouse is specified.

---

## ITEM_PRICE

Get the price list price for an item.

```
=ITEM_PRICE(item_code, price_list, [uom], [date])
```

**Examples:**
```
=ITEM_PRICE("ITEM-001", "Standard Selling")
=ITEM_PRICE("ITEM-001", "Standard Selling", "Nos")
=ITEM_PRICE(A2, "Wholesale", "Kg", "2026-04-01")
```

---

## Performance Notes

Each Frappe formula function makes an API call to the Frappe server. For sheets with many formula cells:

- Results are **cached per session** — the same `FRAPPE_GET("Item", "ITEM-001", "name")` is called only once
- Use `FRAPPE_SUM` / `FRAPPE_COUNT` instead of many individual `FRAPPE_GET` calls where possible
- Press **Ctrl+Shift+R** (full refresh) to invalidate the formula cache and re-fetch all values
