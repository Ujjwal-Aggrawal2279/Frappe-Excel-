---
id: overview
title: Formulas Overview
sidebar_label: Overview
---

# Formulas

Excel View includes a full formula engine powered by **HyperFormula** — a library that implements 500+ Excel-compatible functions. Formulas work in any cell on any sheet, including DocType sheets.

---

## Entering a Formula

1. Select a cell
2. Type `=` to start a formula
3. Type the formula (e.g., `=SUM(A1:A10)`)
4. Press Enter

The formula is evaluated immediately. The cell displays the result; the formula bar shows the formula text.

---

## Formula Cells vs Data Cells

- **Data cells** — contain a raw value (text, number, date). Editable. Can be saved to Frappe.
- **Formula cells** — contain a `=formula`. Display-only. **Not saved to Frappe** (they live only in the grid).

Formula cells have a small indicator in the corner to distinguish them from data cells.

---

## Cell References

| Reference Type | Syntax | Example |
|---|---|---|
| Same sheet | `A1`, `B3` | `=A1+B1` |
| Absolute | `$A$1` | `=$A$1*B1` |
| Mixed | `$A1`, `A$1` | `=$A1*2` |
| Range | `A1:A10` | `=SUM(A1:A10)` |
| Cross-sheet | `SheetName!A1` | `=Sales!B2` |

---

## Common Excel Functions (Supported)

**Math & Stats**
- `SUM`, `AVERAGE`, `COUNT`, `COUNTA`, `MIN`, `MAX`, `MEDIAN`
- `ROUND`, `ROUNDUP`, `ROUNDDOWN`, `FLOOR`, `CEILING`, `ABS`
- `POWER`, `SQRT`, `MOD`, `INT`, `TRUNC`

**Text**
- `LEFT`, `RIGHT`, `MID`, `LEN`, `TRIM`, `UPPER`, `LOWER`, `PROPER`
- `CONCATENATE`, `CONCAT`, `TEXTJOIN`
- `SUBSTITUTE`, `REPLACE`, `FIND`, `SEARCH`
- `TEXT` (number formatting in formula)

**Logic**
- `IF`, `IFS`, `AND`, `OR`, `NOT`
- `IFERROR`, `IFNA`, `ISERROR`, `ISBLANK`, `ISNUMBER`, `ISTEXT`
- `SWITCH`

**Lookup**
- `VLOOKUP`, `HLOOKUP`, `INDEX`, `MATCH`
- `XLOOKUP` (Excel 365 compatible)
- `OFFSET`, `INDIRECT`

**Date & Time**
- `TODAY`, `NOW`, `DATE`, `YEAR`, `MONTH`, `DAY`
- `DATEDIF`, `EDATE`, `EOMONTH`, `WORKDAY`, `NETWORKDAYS`
- `DATEVALUE`, `TIMEVALUE`

---

## Frappe-Native Functions

Excel View adds 7 ERP-specific functions that call live Frappe data:

| Function | Description |
|---|---|
| `FRAPPE_GET` | Get any field from any Frappe document |
| `FRAPPE_SUM` | Sum a field across filtered documents |
| `FRAPPE_COUNT` | Count documents matching a filter |
| `FRAPPE_AVG` | Average a field across filtered documents |
| `GL_BALANCE` | Get General Ledger balance for an account |
| `STOCK_QTY` | Get current stock quantity for an item/warehouse |
| `ITEM_PRICE` | Get the price list price for an item |

See [Frappe Formulas](/docs/formulas/frappe-formulas) for full syntax and examples.

---

## Cross-Sheet References

Reference data on another sheet with:

```
=SheetName!A1
=SUM('Sales Data'!B1:B100)
```

Use single quotes around the sheet name if it contains spaces.

---

## Formula Errors

| Error | Meaning |
|---|---|
| `#VALUE!` | Wrong argument type (e.g., text in numeric formula) |
| `#REF!` | Referenced cell doesn't exist |
| `#DIV/0!` | Division by zero |
| `#NAME?` | Unknown function name |
| `#NUM!` | Invalid numeric operation |
| `#N/A` | Lookup value not found |
| `#NULL!` | Invalid cell range |
| `#CYCLE!` | Circular reference detected |

Use `=IFERROR(formula, "fallback")` to handle errors gracefully.
