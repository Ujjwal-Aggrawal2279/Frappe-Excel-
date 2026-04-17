---
id: query-flow
title: QueryFlow (Visual Query Builder)
sidebar_label: QueryFlow Panel
---

# QueryFlow — Visual Query Builder

QueryFlow is a drag-and-drop canvas for building SQL-like queries across multiple DocTypes — without writing SQL. Queries run client-side using **DuckDB WASM**, making them fast even for large datasets.

---

## Opening QueryFlow

1. Click **[+]** in the sheet tab bar
2. Select **Query Sheet**
3. The QueryFlow canvas opens

---

## Canvas Elements

### DocType Nodes
Drag any DocType from the left panel onto the canvas. Each node represents a table.

- Click a node to expand its field list
- Check fields to include them in the output

### Join Connections
Drag from a field on one node to a matching field on another node to create a **JOIN**.

- The join type (INNER, LEFT, RIGHT) can be set by right-clicking the connection line
- Multiple joins can be chained

### Filter Nodes
Drag a **Filter** node from the sidebar onto the canvas. Connect it to a DocType node. Configure:
- Field to filter
- Operator
- Value (can be a static value or a reference to another node's output)

### Aggregate Nodes
Drag an **Aggregate** node to add GROUP BY + aggregation:
- Choose GROUP BY fields
- Choose aggregate fields (SUM, COUNT, AVG, MIN, MAX)

### Sort Node
Drag a **Sort** node to add ORDER BY.

---

## Running the Query

Click the **Run** button (play icon, top-right of the canvas). The query executes in DuckDB WASM in the browser. Results appear in the sheet grid below.

The generated SQL is shown in the **SQL Preview** panel (bottom of the canvas) — useful for debugging or copying to run elsewhere.

---

## Performance

DuckDB WASM runs in your browser. For datasets up to ~100,000 rows, queries typically complete in under 2 seconds. For larger datasets, increase the sample size in settings or filter down your DocType nodes first.

---

## Saving a Query

Query sheet configurations (node positions, join definitions, filter values) are saved in the workbook. Reloading the workbook restores the canvas exactly.

---

## Limitations

- QueryFlow queries are **read-only** — results cannot be saved back to Frappe
- Complex recursive CTEs are not supported in the visual builder (use the SQL editor mode for advanced queries)
- DuckDB WASM loads only data that has been fetched to the client — filters on DocType nodes limit the loaded data before the query runs
