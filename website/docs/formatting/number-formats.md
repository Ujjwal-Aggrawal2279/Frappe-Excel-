---
id: number-formats
title: Number Formats
sidebar_label: Number Formats
---

# Number Formats

Apply number formats to control how numeric values display — currencies, percentages, dates, or custom patterns — without changing the underlying data.

---

## Applying a Preset Format

1. Select one or more cells
2. Home tab → **Number Format** dropdown
3. Choose a preset:

| Preset | Example |
|---|---|
| General | 1234.56 |
| Number | 1,234.56 |
| Currency (INR) | ₹1,234.56 |
| Currency (USD) | $1,234.56 |
| Percent | 23.45% |
| Date | 17-Apr-2026 |
| Time | 14:30:00 |
| Datetime | 17-Apr-2026 14:30 |
| Scientific | 1.23E+03 |
| Text | 001234 (no numeric interpretation) |

---

## Custom Format Strings

Click **Number Format → Custom…** to enter an Excel-compatible format string.

Examples:

| Format String | Input | Display |
|---|---|---|
| `#,##0.00` | 1234.5 | 1,234.50 |
| `"₹"#,##0.00` | 1234 | ₹1,234.00 |
| `0.00%` | 0.2345 | 23.45% |
| `DD-MMM-YYYY` | 2026-04-17 | 17-Apr-2026 |
| `[Red]#,##0;[Blue]-#,##0` | -500 | -500 (blue) |
| `0000` | 42 | 0042 |

The format engine is **numfmt** — compatible with all standard Excel number format strings.

---

## Clearing a Format

Select cells → Format tab → **Clear Format**. Returns to General (no special formatting).

---

## Persistence

Number formats are stored in `format_store` in your user settings and in any saved workbook. They persist across sessions.
