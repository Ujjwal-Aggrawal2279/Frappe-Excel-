---
id: charts
title: Charts
sidebar_label: Charts
---

# Charts

Excel View includes a built-in chart builder powered by **@observablehq/plot** and **uPlot** for high-performance rendering.

---

## Inserting a Chart

1. Select the data range you want to chart (optional — you can configure it in the dialog)
2. Insert tab → **Insert Chart**
3. The chart builder dialog opens

---

## Chart Types

| Type | Best For |
|---|---|
| **Bar** | Comparing categories |
| **Stacked Bar** | Comparing parts of a whole across categories |
| **Line** | Trends over time |
| **Area** | Cumulative trends |
| **Scatter** | Correlation between two numeric fields |
| **Pie** | Distribution / proportions |
| **Donut** | Same as pie, with center label |
| **Sparkline** | Inline trend in a single cell |

---

## Configuring the Chart

In the chart dialog:

1. **Data source** — current sheet, or select any sheet in the workbook
2. **X Axis** — choose a column (usually a date or category)
3. **Y Axis** — choose one or more numeric columns
4. **Group by** — optional column to color/split by
5. **Chart title** — optional label
6. **Colors** — auto-assigned or manually picked

Click **Preview** to see a live preview. Click **Insert** to add the chart below the grid.

---

## Editing a Chart

Click on an inserted chart to select it. A toolbar appears above the chart:
- **Edit** — re-open the chart builder dialog
- **Resize** — drag corner handles to resize
- **Move** — drag to reposition
- **Delete** — remove the chart

---

## Chart Data Refresh

Charts automatically update when the underlying sheet data refreshes (Ctrl+Shift+R). For Pivot sheets, the chart updates when the pivot recomputes.

---

## Time-Series Charts

For date-based X axes, Excel View automatically:
- Parses the date column
- Renders a proper time axis with appropriate tick density
- Shows a crosshair tooltip on hover with the exact date and value

---

## Sparklines

Sparklines are mini inline charts rendered inside a grid cell. To add a sparkline:

1. Click a blank cell where you want the sparkline
2. Insert tab → **Sparkline**
3. Choose the data range (a row or column of numbers)
4. Choose style: Line, Column, Win/Loss

Sparklines are display-only cells — they do not save to Frappe.
