---
id: conditional-formatting
title: Conditional Formatting
sidebar_label: Conditional Formatting
---

# Conditional Formatting

Conditional formatting automatically highlights cells based on their values. Use it to spot overdue invoices, negative balances, low stock, or any other threshold.

---

## Adding a Rule

1. Select the cells or column you want to format
2. Click **Format → Conditional Formatting** in the toolbar
3. The CF dialog opens

In the dialog:
1. Choose an **operator**: Greater than, Less than, Equal to, Between, Contains text, Is empty, etc.
2. Enter the **threshold value(s)**
3. Choose a **highlight style**: background color, text color, bold, or a combination
4. Click **Add Rule**

Multiple rules can be added to the same range. Rules are evaluated in order — the first matching rule wins.

---

## Rule Types

| Operator | Use Case |
|---|---|
| Greater than / Less than | Numeric thresholds (amounts, quantities) |
| Equal to | Status matches ("Overdue", "Cancelled") |
| Between | Value in range (e.g., stock between 10 and 50) |
| Contains | Text contains a substring |
| Is empty | Highlight missing required values |
| Is not empty | Highlight filled cells |
| Top N | Highlight top N values in the column |
| Bottom N | Highlight bottom N values |

---

## Color Scales

You can apply a **2-color or 3-color scale** to a numeric range:

1. Select the range
2. Format → Conditional Formatting → **Color Scale** tab
3. Choose min, midpoint (optional), and max colors

The grid interpolates colors between the min and max values, creating a gradient heatmap.

---

## Managing Rules

Click **Format → Conditional Formatting → Manage Rules** to see all active rules for the current sheet:
- **Edit** an existing rule
- **Delete** a rule
- **Reorder** rules (drag to change priority)

---

## Persistence

Conditional formatting rules are stored in your **user settings** (server-side, per DocType per user). They are NOT stored in workbooks. Rules persist across sessions.

---

## Example: Highlight Overdue Invoices

1. Select the **Due Date** column
2. Format → Conditional Formatting
3. Operator: **Less than**
4. Value: **=TODAY()** (the formula resolves to today's date)
5. Style: Red background, white text
6. Click Add Rule

All invoices with a due date in the past now show in red.
