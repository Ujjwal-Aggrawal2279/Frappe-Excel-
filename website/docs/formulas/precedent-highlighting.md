---
id: precedent-highlighting
title: Formula Precedent Highlighting
sidebar_label: Precedent Highlighting
---

# Formula Precedent Highlighting

When you select a formula cell, Excel View can outline all cells that the formula depends on (its "precedents") with a green border. This makes it easy to visually trace where a formula's inputs come from.

---

## Enabling Precedent Highlighting

1. View tab → **Formula Precedents** toggle

When enabled, selecting any cell that contains a formula causes its dependent cells to get a green outline automatically.

---

## How It Works

Excel View calls `HyperFormula.getCellDependencies(row, col)` to get the full list of cells the formula references. All referenced cells get a `2px solid green` outline. The outline updates with an 80ms debounce as you navigate.

---

## Disabling

View tab → **Formula Precedents** (click again to toggle off).

---

## Limitations

- Only shows **direct precedents** (one level up). For deeper dependency tracing, you'd need to navigate to each precedent cell.
- Works within the current sheet only — cross-sheet precedents are not highlighted (but are supported by the formula engine).
