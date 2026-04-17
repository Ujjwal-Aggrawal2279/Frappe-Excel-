---
id: flash-fill
title: Flash Fill
sidebar_label: Flash Fill
---

# Flash Fill

Flash Fill (`Ctrl+E`) automatically completes a column based on a pattern you demonstrate in the first few rows. It works like Excel's Flash Fill — you show the pattern, Excel View figures out the rule.

---

## How to Use Flash Fill

1. Add a **blank column** to the right of your data (right-click column header → Insert Formula Column, or just click in the next empty column)
2. In the first cell of the blank column, type the value you want
3. Optionally type one or two more examples to make the pattern clearer
4. Press **Ctrl+E**

Excel View analyzes your examples and fills the rest of the column automatically.

---

## Supported Patterns

| Pattern | Example Input | Example Output |
|---|---|---|
| **Text extraction** | "John Smith" → "John" | First name from full name |
| **Date formatting** | "2026-04-17" → "April 17, 2026" | Reformatted date string |
| **Code generation** | "INV-001", "INV-002" → "INV-003" | Sequential codes |
| **Concatenation** | "John" + "Smith" → "John Smith" | Combine columns |
| **Prefix/suffix** | "100" → "USD 100" | Add prefix or suffix |
| **Case conversion** | "john smith" → "JOHN SMITH" | Uppercase conversion |

---

## Alert on Blank Column

If you press Ctrl+E on a column that is **not blank** (already has data), you'll see a warning:

> "This column already has data. Flash Fill will overwrite it. Continue?"

Click **Yes** to proceed or **No** to cancel.

---

## Limitations

- Flash Fill works only on columns where you provide at least **1 example** in the first cell
- It detects patterns from the **first visible column** to the left that contains data
- Very complex multi-step transforms (e.g., extracting a middle name while handling initials) may not be detected — provide more examples in that case
- Flash Fill does **not** write back to Frappe (the filled column is a new formula column in the grid, not a DocType field save)
