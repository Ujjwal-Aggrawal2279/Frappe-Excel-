---
id: frappe-formulas-reference
title: Frappe Formulas Reference
sidebar_label: Frappe Formulas
---

# Frappe Formulas — Quick Reference

| Function | Syntax | Returns |
|---|---|---|
| `FRAPPE_GET` | `FRAPPE_GET(doctype, name, field)` | Single field value |
| `FRAPPE_SUM` | `FRAPPE_SUM(doctype, field, [f1, v1, ...])` | Sum of field |
| `FRAPPE_COUNT` | `FRAPPE_COUNT(doctype, [f1, v1, ...])` | Document count |
| `FRAPPE_AVG` | `FRAPPE_AVG(doctype, field, [f1, v1, ...])` | Average of field |
| `GL_BALANCE` | `GL_BALANCE(account, [company], [date])` | GL balance |
| `STOCK_QTY` | `STOCK_QTY(item, [warehouse])` | Current stock qty |
| `ITEM_PRICE` | `ITEM_PRICE(item, price_list, [uom], [date])` | Price list price |

## Filter Syntax for FRAPPE_SUM / COUNT / AVG

Filters are passed as field/value pairs after the required arguments:

```
=FRAPPE_COUNT("Sales Invoice", "docstatus", 1, "customer", "Acme Corp")
```

Supported operators: exact match only (value equality). For range/comparison filters, use `FRAPPE_GET` in combination with `SUMIF` on the fetched data.

## Full Documentation

See [Frappe-Native Formulas](/docs/formulas/frappe-formulas) for complete syntax, examples, and performance notes.
