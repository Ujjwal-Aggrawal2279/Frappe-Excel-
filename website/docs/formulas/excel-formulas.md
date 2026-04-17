---
id: excel-formulas
title: Excel-Compatible Formulas
sidebar_label: Excel Formulas
---

# Excel-Compatible Formulas

HyperFormula powers Excel View's formula engine with 500+ Excel-compatible functions. Here are the most useful ones for ERP/business data work.

---

## Lookup & Reference

### VLOOKUP
```
=VLOOKUP(lookup_value, table_array, col_index_num, [range_lookup])
```
Find a value in the first column and return a value from a specified column.

```
=VLOOKUP(A2, ItemPrices!A:C, 3, FALSE)
```

### XLOOKUP (Excel 365 compatible)
```
=XLOOKUP(lookup_value, lookup_array, return_array, [if_not_found])
```
More flexible than VLOOKUP — no column number needed, works in any direction.

```
=XLOOKUP(A2, Customers!A:A, Customers!C:C, "Not Found")
```

### INDEX + MATCH
```
=INDEX(return_array, MATCH(lookup_value, lookup_array, 0))
```
Classic alternative to VLOOKUP with no column-number limitation.

---

## Conditional Aggregation

### SUMIF / SUMIFS
```
=SUMIF(range, criteria, sum_range)
=SUMIFS(sum_range, range1, criteria1, range2, criteria2, ...)
```
Sum values that meet conditions.

```
=SUMIFS(C:C, B:B, "Submitted", D:D, ">="&DATE(2026,1,1))
```

### COUNTIF / COUNTIFS
```
=COUNTIF(range, criteria)
```
Count cells meeting a condition.

### AVERAGEIF / AVERAGEIFS
```
=AVERAGEIF(range, criteria, average_range)
```

---

## Date Functions

### DATEDIF
```
=DATEDIF(start_date, end_date, unit)
```
Units: `"D"` (days), `"M"` (months), `"Y"` (years)

```
=DATEDIF(A2, TODAY(), "D")   → Days since a date
=DATEDIF(A2, TODAY(), "M")   → Months since a date
```

### NETWORKDAYS
```
=NETWORKDAYS(start_date, end_date, [holidays])
```
Working days between two dates (excludes weekends and optional holiday list).

### EDATE
```
=EDATE(start_date, months)
```
Add or subtract months from a date.

---

## Text Functions

### TEXTJOIN
```
=TEXTJOIN(delimiter, ignore_empty, text1, text2, ...)
```
Join multiple text values with a delimiter.

```
=TEXTJOIN(", ", TRUE, A2:A20)
```

### TEXT
```
=TEXT(value, format_string)
```
Format a number as text.

```
=TEXT(A2, "DD-MMM-YYYY")
=TEXT(B2, "₹#,##0.00")
```

---

## Financial Functions

### NPV
```
=NPV(rate, value1, [value2, ...])
```

### IRR
```
=IRR(values, [guess])
```

### PMT
```
=PMT(rate, nper, pv)
```
Monthly payment for a loan.

```
=PMT(8%/12, 60, -500000)   → Monthly EMI for ₹5L loan at 8% over 5 years
```

---

## Array Formulas

HyperFormula supports implicit array formulas. For example:
```
=SUM(A1:A10 * B1:B10)   → Sum of element-wise products (no Ctrl+Shift+Enter needed)
```
