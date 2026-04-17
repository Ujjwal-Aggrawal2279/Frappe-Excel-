---
id: tree-view
title: Tree View
sidebar_label: Tree View
---

# Tree View

For DocTypes that support a tree structure (like Account, Cost Center, Territory, Item Group, or any custom DocType with `is_tree = true`), Excel View renders the hierarchy inline in the grid.

## How It Works

- Parent records show an **expand/collapse arrow** (▶ / ▼) in the row header
- Clicking the arrow expands to show child records indented below the parent
- Children are visually indented with a left-margin indicator
- Collapse by clicking ▼ again

## Visual Indicators

| Element | Meaning |
|---|---|
| ▶ in row header | Has children, currently collapsed |
| ▼ in row header | Has children, currently expanded |
| Indented row | Child record |
| Leaf icon | No children |

## Use Cases

- **Chart of Accounts** — expand account groups to see all leaf accounts
- **Territory hierarchy** — see country → state → city structure
- **Item Groups** — browse the full item catalog hierarchy
- **Cost Centers** — drill down from company to department

## Editing in Tree View

Tree view rows are fully editable — just like regular rows. Changes to a child record are saved to that child document in Frappe.

You cannot move a node in the tree from the grid (changing the parent). To restructure the tree, use the Frappe form view.

## Importing Trees

Excel View supports importing tree-structured data from XLSX. See [Tree Import](/docs/import-export/tree-import).
