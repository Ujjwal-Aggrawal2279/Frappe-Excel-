---
id: export-csv
title: Export to CSV
sidebar_label: Export to CSV
---

# Export to CSV

Export the current sheet to a plain `.csv` file for use in other tools.

---

## Exporting

Data → Export → **Export as CSV**

The file downloads immediately. Filename: `{Sheet name} - {Date}.csv`.

---

## CSV Format

- **Delimiter**: Comma (`,`)
- **Encoding**: UTF-8 with BOM (for Excel compatibility)
- **Quotes**: All text fields containing commas or newlines are quoted
- **Date format**: `YYYY-MM-DD` (ISO 8601)
- **Number format**: Raw numbers (no currency symbols or thousand separators)

---

## What Is Not Exported

- Formatting (colors, bold, etc.) — CSV is plain text only
- Report header rows — CSV exports data rows only
- Hidden rows
- Child table rows (unless you manually expand and then export XLSX)

---

## For Data Pipeline Use

If you're exporting CSV for programmatic consumption (Python, Excel Power Query, databases), the raw CSV format is ideal — no formatting noise, consistent date format, UTF-8 encoding.
