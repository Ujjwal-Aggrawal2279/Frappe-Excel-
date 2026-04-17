---
id: navigation
title: Navigating the Interface
sidebar_label: Interface Overview
---

# Navigating the Interface

## Layout Overview

```
┌─────────────────────────────────────────────────────┐
│  TOOLBAR  (Home | View | Data | Insert | Format)    │
├─────────────────────────────────────────────────────┤
│  FORMULA BAR  [Cell ref]  [Cell value / formula]    │
├──────┬──────────────────────────────────────────────┤
│  Row │  Col A    Col B    Col C    Col D    …        │
│  #   │  data     data     data     data              │
│      │  data     data     data     data              │
│      │  …                                           │
├──────┴──────────────────────────────────────────────┤
│  [Sheet 1] [Sheet 2] [+]                  STATUS BAR│
└─────────────────────────────────────────────────────┘
```

---

## The Toolbar

The toolbar is organized into tabs, each grouping related actions.

### Home Tab
- **Save** — write all pending changes to Frappe
- **Refresh** — reload data from Frappe (discards unsaved changes)
- **Add Row** — append a new blank row at the bottom
- **Delete Row** — delete the selected row(s)
- **Bold / Italic / Align** — text formatting
- **Number Format** — format cells as Currency, Percent, Date, etc.
- **Background Color / Text Color** — fill and font color pickers

### View Tab
- **Focus Cell (Crosshair)** — highlight the active row/column intersection
- **Hide Rows** — hide selected rows from view
- **Show Hidden** — reveal all hidden rows
- **Formula Precedents** — outline all cells a formula depends on
- **Freeze Columns** — freeze N columns from the left

### Data Tab
- **Choose Columns** — add/remove DocType fields as grid columns
- **Smart Lookup** — join data from a linked DocType as extra columns
- **Sort** — multi-level sort
- **Filter** — advanced filter builder (for DocType sheets)
- **Refresh** — same as Home > Refresh

### Insert Tab
- **Insert Chart** — create a chart from selected data
- **Insert Pivot** — create a pivot table from sheet data
- **New Sheet** — add a blank, DocType, or Query sheet

### Format Tab
- **Conditional Formatting** — rule-based cell highlighting
- **Borders** — cell border editor
- **Clear Format** — remove all formatting from selected cells

---

## The Formula Bar

Located below the toolbar. Shows:

- **Cell reference box** (left) — e.g., `A1`, `B3` — click to navigate to a cell directly
- **Value display** (right) — shows the raw value of the selected cell

For **Text Editor** / **Long Text** fields that contain HTML, the formula bar automatically strips the HTML tags and shows clean readable text.

For **formula cells**, the bar shows the formula (e.g., `=SUM(A1:A10)`) rather than the computed value.

---

## Sheet Tabs

At the bottom of the screen. Each tab represents one open sheet.

- **Click** a tab to switch to that sheet
- **Double-click** a tab to rename it (workbook sheets only)
- **Right-click** a tab for: Rename, Duplicate, Delete, Move Left/Right
- **[+] button** — add a new sheet (blank, DocType, or query)

Tab types are visually distinguished:
- Plain tab — DocType sheet
- Green icon — Report sheet
- Blue icon — Pivot sheet
- Gray tab — Blank sheet

---

## The Status Bar

At the very bottom of the page. Shows:

- **Row count** — total rows in the current sheet
- **Selected** — number of selected cells/rows
- **Sum / Avg / Count** — live stats for the selected numeric range
- **Save status** — "All changes saved" or pending change indicator

---

## Opening the Frappe Form

Every row in a DocType sheet has a **Name** column (the first column, usually labeled with the DocType name). The value is a **clickable blue link**.

Click the link → the Frappe form for that record opens in the same tab (standard Frappe SPA navigation — no page reload). Press the browser back button to return to Excel View with your scroll position and selection preserved.

---

## The Collaboration Sidebar

A panel on the right side that shows:
- Who else is currently viewing the same DocType
- Recent activity (comments, assignments, likes)
- Realtime update notifications

Toggle it with the chat-bubble icon in the top-right corner of the toolbar, or press **Ctrl+Shift+K**.
