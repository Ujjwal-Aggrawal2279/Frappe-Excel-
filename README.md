# Excel View for Frappe / ERPNext

> **"Talk with your data live"** — the only spreadsheet that speaks ERP natively, runs on your server, and writes back.

A full spreadsheet experience built into Frappe — edit, format, analyze, join, query, and bulk-import any DocType data in a familiar Excel-style grid, without leaving your ERP. Works on **vanilla Frappe** and unlocks ERPNext-specific formula functions (`GL_BALANCE`, `STOCK_QTY`, `ITEM_PRICE`) when ERPNext is installed.

---

## Table of Contents

1. [Feature Overview](#feature-overview)
2. [Tech Stack](#tech-stack)
3. [Installation](#installation)
4. [Release Notes](#release-notes)
   - [v3.3 — Grid Intelligence + IntelliFlow SQL Engine](#v33--grid-intelligence--intelliflow-sql-engine-mar-2026)
   - [v3.2 — Smart Lookup + Activity Column](#v32--smart-lookup--activity-column-mar-2026)
   - [v3.1 — Format Persistence + Focus Cell](#v31--format-persistence--focus-cell-mar-2026)
   - [v2.6 — Ribbon Toolbar + Charts + Pivot + CF](#v26--ribbon-toolbar--charts--pivot--conditional-formatting)
   - [v2.5 — Multi-Sheet + IntelliLookup + AI Analysis](#v25--multi-sheet-workbooks--intellilookup--ai-analysis)
   - [v2.4 — IntelliFlow Join Canvas + AI Discovery](#v24--intelliflow-join-canvas--ai-discovery)
   - [v2.3 — Frappe Formula Library](#v23--frappe-formula-library)
   - [v2.2 — Status Bar + Column Freeze + Find & Replace](#v22--status-bar--column-freeze--find--replace)
   - [v2.1 — Saved Workbooks](#v21--saved-workbooks)
   - [v1 — Core Spreadsheet Grid](#v1--core-spreadsheet-grid)
5. [Architecture & File Structure](#architecture--file-structure)
6. [Competitor Gap](#competitor-gap)

---

## Feature Overview

### Core Grid
| Feature | Detail |
|---|---|
| Spreadsheet grid | Handsontable 6.2.2 — any DocType, any number of columns |
| Formula engine | HyperFormula 400+ built-in functions (SUM, IF, VLOOKUP, INDEX/MATCH…) |
| Formula bar | Excel-style cell reference display + formula editing |
| Custom editors | Date picker, Link selector, Select listbox, Currency formatter, Checkbox |
| Autofill | Drag formula down/up with relative reference adjustment |
| Find & Replace | Ctrl+F / Ctrl+H, match-case, whole-cell; draggable panel |
| Export | `.xlsx` (Excel) or `.csv` |
| Performance | O(1) `afterRenderer` via 5 HTML caches; 1,000+ row sheets stay smooth |
| Inline save | `afterChange` → `frappe.client.set_value` → optimistic render |
| Validators | `beforeChange` — Currency/Float/Int numeric check; Link existence; Select options; Date format |

### ERP-Native Formulas
```
=GL_BALANCE("Debtors - TC", "Test Company")               → live GL balance
=STOCK_QTY("Laptop", "Main Warehouse")                    → live stock quantity
=ITEM_PRICE("Laptop", "Standard Selling")                 → price list rate
=FRAPPE_GET("Customer", "CUST-001", "credit_limit_amount")
=FRAPPE_SUM("Sales Invoice", "grand_total", "customer", "Tata Motors")
=FRAPPE_COUNT("Sales Order", "name", "status", "Draft")
=FRAPPE_AVG("Sales Invoice", "outstanding_amount", "customer", "Acme")
```
All execute server-side via whitelisted Frappe API — **no data leaves your server**.

### Formatting & Persistence
- Full Home-tab ribbon: Bold, Italic, Underline, Strikethrough, Alignment, Wrap, Font, Size, Text color, Fill color, Borders (10 presets), Merge & Center, Number Formats
- Format Painter (one-shot and sticky mode)
- Repeat Last Action (F4) — replays last bold/align/fill/border/resize on current selection
- Conditional Formatting — 4 rule types: Cell Value, Color Scale, Top-Bottom N, Duplicate-Unique
- Column widths, row heights, hidden rows — all saved to `user_settings` and workbook
- Column Reorder — drag headers; persisted across sessions
- Focus Cell / Crosshair — View tab toggle; Pickr color picker; dark-theme safe (opaque pre-blend)

### Views & Sheets
- **Multi-Sheet Workbooks** — multiple DocType tabs, pivot sheets, formula sheets, blank sheets, Query Result sheets; all in one saved workbook
- **PivotTable Builder** — 4 drop zones (Rows/Columns/Values/Filters), SUM/COUNT/AVG; "Insert to Sheet" creates a new tab; live refresh via `frappe.realtime`
- **Charts** — 5 types (Bar/Line/Pie/Donut/Scatter) via frappe-charts; draggable + resizable overlays; saved in workbook
- **Report sheets** — load any Frappe Script/Query Report with a live filter bar; re-runs with Refresh; persisted in workbook
- **Query Result sheets** — DuckDB-powered analytical SQL results with infinite scroll pagination; compact `query_ast` storage (not raw rows)

### Collaboration
- **Activity Column** — virtual `_social` column grouping `_user_tags`, `_comments`, `_assign`, `_liked_by`, `docstatus`, `idx` into one compact cell with SVG icon buttons
- **Live Collaboration Sidebar** — real-time user avatars, row-level comments, ToDo assignment, tags, likes; no page redirect; Frappe WebSocket realtime

### Intelligence
- **IntelliFlow Join Canvas** — visual multi-DocType join builder; drag nodes, SVG bezier wires, auto-grade badges (S→F), cardinality + coverage stats
- **Query Flow Panel (QFP)** — full visual SQL builder inside IntelliFlow: SELECT fields, JOINs, WHERE filters, GROUP BY aggregations, window functions (SUM/AVG/ROW_NUMBER/LAG/LEAD/RANK), COMPUTE columns (arithmetic + CASE/WHEN), ORDER BY, LIMIT
- **DAG Flowchart** — interactive node canvas showing the query pipeline as a directed acyclic graph; dagre auto-layout, SVG bezier edges, fan-out/fan-in for window functions; Figma-style grab-to-pan
- **DuckDB WASM Engine** — executes SQL entirely in-browser via DuckDB WebAssembly; IndexedDB cache (10-min TTL); pre-warmed on page load for near-instant query execution
- **Smart Lookup** — 4-layer join column detection: Layer 0c structural FK → Layer 1 meta Link fields → Layer 2 rapidfuzz header match → Layer 3 Jaccard overlap; confidence scores
- **GenBI AI Join Discovery** — networkx + rapidfuzz + TF-IDF; runs 100% on-premise; zero LLM/API calls
- **AI Analysis Panel** — Anomaly Detection (IsolationForest) + Clustering (MiniBatchKMeans, silhouette auto-k); results injected as `_anomaly_score` / `_cluster` columns
- **Association Rule Mining** — mlxtend Apriori on joined data; surfaces co-occurrence patterns

### Bulk Import
- Flat CSV/XLSX import with column mapping, field type detection, child table support
- **Tree Import Engine** — hierarchical multi-level bulk import: Pattern 1 (NSM self-referential trees: Employee, Department, Territory) + Pattern 2 (cross-document reference trees: BOM → sub-BOMs); zero DocType hardcoding; 6-layer architecture with dep graph visualization, pre-creation, topological sort, atomic rollback, realtime progress

---

## Tech Stack

### Frontend

| Library | Version | Role |
|---|---|---|
| **Handsontable** | 6.2.2 | Spreadsheet grid engine — rendering, selection, cell editors, hooks |
| **HyperFormula** | latest | Formula engine — 400+ built-in functions + 7 custom ERP formula plugins |
| **DuckDB WASM** | `@duckdb/duckdb-wasm` | In-browser analytical SQL engine; runs window functions, aggregations, JOINs entirely client-side |
| **dagre** | ^0.8.5 | Directed Acyclic Graph layout engine — powers the QFP DAG flowchart (LR layout, fan-out/fan-in) |
| **frappe-charts** | latest | Chart rendering (Bar / Line / Pie / Donut / Scatter) |
| **Pickr** | latest | Color picker for Focus Cell crosshair customization |
| **IndexedDB (native)** | — | Client-side DuckDB table cache with 10-min TTL; avoids repeat server fetches |
| **Vanilla JS (ES6+)** | — | All component logic — no Vue/React/Angular; framework-free for grid performance |
| **SCSS** | — | All styles; two-block pattern (light + `[data-theme="dark"]` override) |

### Backend (Python)

| Library | Role |
|---|---|
| **Frappe Framework** v14/v15 | DocType ORM, whitelisted API, realtime WebSocket, user_settings, background jobs |
| **ERPNext** *(optional)* | Unlocks `GL_BALANCE`, `STOCK_QTY`, `ITEM_PRICE` formula functions |
| **networkx** | Directed graph traversal for join path discovery (IntelliFlow + GenBI) and dep topological sort |
| **rapidfuzz** | Fuzzy string matching for header similarity + value overlap in Smart Lookup |
| **scikit-learn** | `IsolationForest` (anomaly detection), `MiniBatchKMeans` (clustering), silhouette auto-k |
| **mlxtend** | Apriori association rule mining on joined datasets |
| **pdfplumber** | PDF import support |
| **langdetect** | Language detection (roadmap: PROMPT() formula) |
| **textblob** | Text processing (roadmap: TRANSLATE(), EXTRACT_AMOUNT()) |

### Infrastructure

| Component | Role |
|---|---|
| **MariaDB** | Primary database; all Frappe DocType storage |
| **Redis** | Cache + realtime pub/sub channel |
| **Socket.io** | WebSocket server; routes `ev_dep_progress` / `ev_tree_progress` / `ev_tree_progress` events |
| **frappe-bench** | Build pipeline (`bench build --app excel_view`), migrations, deployment |

### Zero-LLM Policy

All intelligence features run **100% on-premise** — no data ever leaves your server:

| Feature | Algorithm |
|---|---|
| Join Discovery (IntelliFlow) | networkx graph traversal + rapidfuzz + TF-IDF cosine similarity |
| Smart Lookup | Structural FK detection + meta Link fields + rapidfuzz header match + Jaccard overlap |
| SQL Generation | Deterministic `SQLGenerator` class: `QueryAST → DuckDB SQL`; no LLM |
| Anomaly Detection | scikit-learn IsolationForest |
| Clustering | MiniBatchKMeans + silhouette score auto-k |
| Association Rules | mlxtend Apriori |
| Flash Fill patterns | Regex-based date/code/text pattern detection |
| Tree Import | Topological sort (Kahn's algorithm) + DFS cycle detection |

---

## Installation

### Standard (bare-metal / VM bench)

```bash
cd /path/to/your/bench
bench get-app https://github.com/YOUR_ORG/excel_view
bench --site your-site.com install-app excel_view
bench --site your-site.com migrate
bench build --app excel_view
```

Python ML dependencies (networkx, scikit-learn, mlxtend, rapidfuzz, etc.) are listed in `pyproject.toml` and installed automatically. If missing:

```bash
bench pip install -r apps/excel_view/requirements.txt
```

### Docker (frappe_docker)

#### 1. `apps.json`
```json
[
  { "url": "https://github.com/frappe/erpnext", "branch": "version-15" },
  { "url": "https://github.com/YOUR_ORG/excel_view", "branch": "main" }
]
```

#### 2. Build custom image
```bash
export APPS_JSON_BASE64=$(base64 -w 0 apps.json)
docker build \
  --build-arg=FRAPPE_PATH=https://github.com/frappe/frappe \
  --build-arg=FRAPPE_BRANCH=version-15 \
  --build-arg=APPS_JSON_BASE64=$APPS_JSON_BASE64 \
  --tag=myorg/erpnext-excel:latest \
  --file=images/layered/Containerfile .
```

#### 3. Point services to new image + install app
```bash
docker compose exec backend bash
bench --site your-site.localhost install-app excel_view
bench --site your-site.localhost migrate
docker compose restart frontend
```

### Updating (bare-metal)
```bash
cd apps/excel_view && git pull
bench build --app excel_view
bench --site your-site.com migrate  # only if DocTypes changed
```

---

## Release Notes

---

### v3.3 — Grid Intelligence + IntelliFlow SQL Engine (Mar 2026)

#### Flash Fill (Ctrl+E)
- Add blank column → type one or more example values → Ctrl+E fills all rows
- Pattern detection: date sequences, code prefixes (`CUST-001` → `CUST-002`…), text extraction, constant fill
- `source="flash_fill"` skips `afterChange` validation/save handlers

#### Column Reorder (Drag Header)
- Drag column headers to reorder in-place
- Order persisted to `user_settings("excel_col_order")` — restored on next load
- `_original_columns` snapshot ensures drag-index reads are accurate

#### Frappe-Native Validators
`beforeChange` HOT hook → `_validate_changes()`:
- **Float/Currency/Int** — rejects non-numeric input with red alert
- **Link fields** — `frappe.db.exists(doctype, value)` existence check; `_link_validator_cache` prevents duplicate API calls
- **Select** — value must be in field's `options` list
- **Date** — validates `YYYY-MM-DD` format
- Invalid cells show red border; changes blocked

#### Live Pivot Refresh
- `frappe.realtime.on("list_update", doctype)` in `sheet_manager.js`
- Any create/update/delete on base DocType auto-triggers `_recompute_pivot_sheet()` for all derived pivot sheets

#### IntelliFlow SQL Engine (Query Flow Panel)

The crown jewel of v3.3 — a full visual SQL builder integrated into IntelliFlow that turns drag-and-drop operations into analytical DuckDB SQL executed entirely in the browser.

**Query Flow Panel (QFP) — Visual SQL Builder:**

The QFP sidebar appears in IntelliFlow and supports the full query lifecycle:

| Step | UI | What it builds |
|---|---|---|
| Source | Automatically set from canvas | `FROM "tabGL Entry" AS t0` |
| Fields | Checkbox field picker per node | `SELECT t0.account, t0.debit, …` |
| JOINs | Canvas wires become JOINs | `LEFT JOIN "tabCustomer" AS t1 ON t0.party = t1.name` |
| WHERE | Condition rows with field/op/value | `WHERE t0.is_opening = 'No'` |
| GROUP BY | Aggregate toggle + field/function pairs | `GROUP BY t0.account HAVING SUM(…) > 0` |
| Window Functions | `+ Add Window` — fn/field/partition/order | `SUM(t0.debit) OVER (PARTITION BY t0.account ORDER BY t0.posting_date)` |
| Compute | Alias + expression (arithmetic / CASE WHEN) | Outer query `running_debit - running_credit AS balance` |
| ORDER BY | Field + direction chips | `ORDER BY t0.account ASC, t0.posting_date ASC` |
| LIMIT | Numeric input | `LIMIT 10000` |

**Supported window functions:** `SUM`, `AVG`, `COUNT`, `MIN`, `MAX`, `ROW_NUMBER`, `RANK`, `DENSE_RANK`, `LAG`, `LEAD`, `FIRST_VALUE`, `LAST_VALUE`, `NTILE`

**DAG Flowchart — Interactive Query Visualization:**

After building a query, the "Flowchart" button reveals an interactive directed acyclic graph showing the query pipeline as colored node cards:

```
[SOURCE]──▶[WHERE]──▶[JOIN t1]──▶[AGG]──▶[WINDOW: running_debit]──▶[COMPUTE]──▶[ORDER/LIMIT]
                                                                  ╲──▶[WINDOW: running_credit]──╱
```

- **dagre LR auto-layout** — nodes positioned automatically; fan-out for parallel window functions
- **SVG bezier edges** — smooth curved connections with arrowheads
- **Per-type color coding** — SOURCE (green), JOIN (blue), WHERE (amber), AGGREGATE (purple), WINDOW (teal), COMPUTE (orange), OUTPUT (indigo)
- **Grab-to-pan** — Figma-style click-drag scrolling; cursor changes to grabbing hand
- **In-place diff** — same query structure patches node bodies without re-layout; pulse ring animation on updates

**DuckDB WASM Engine:**

SQL executes entirely in-browser via DuckDB WebAssembly — zero server round-trips for query execution:

- **`DuckDBEngineV2`** — singleton (`frappe.views.excel.duckdb_v2`); WASM worker + connection managed once per session
- **IndexedDB cache** — 10-minute TTL; fetched DocType data survives tab switches without re-fetching from server
- **`bulk_fetch(doctype)`** — checks IDB → if miss, calls `excel_view.api.bulk_fetch_for_duckdb` (server) → loads into DuckDB via CSV buffer
- **`run_ast(ast)`** — `QueryAST → SQLGenerator → SQL → DuckDB → {headers, rows}`; auto-ensures all join tables are loaded
- **Pre-warm on page load** — `_prewarm_and_rerun_ast_sheets()` starts WASM init + IDB pre-load in background as soon as query_ast sheets are detected in user_settings; by the time user clicks the tab, DuckDB is hot
- **Infinite scroll pagination** — initial fetch: 100 rows; scroll near bottom → `_query_sheet_fetch()` appends next 100 rows via incremented `OFFSET`; stops when page returns < 100 rows

**Compact persistence:**

Query Result sheets save only the `query_ast` JSON (~1–2 KB) in `user_settings`, not the full row data (previously ~100 KB+ as `blank_data`). On page refresh, the query automatically re-runs from the stored AST.

---

### v3.2 — Smart Lookup + Activity Column (Mar 2026)

**Zero-LLM Intelligence — Report Filter Bar, Smart Lookup, Activity Column, Dark Theme Fixes**

#### Report Filter Bar
- Data → Get Data → From Reports — loads any Frappe Script/Query Report
- Live filter bar above grid with fieldtype-aware Frappe controls (Link autocomplete, DateRange, Select)
- Refresh re-runs report with current filter values

#### Smart Lookup (Data tab)
4-layer AI join column detection — **zero LLM**, entirely deterministic:
- **Layer 0c** — structural FK: `frappe.scrub(target_doctype) == source_fieldname` (conf: 0.94–0.99)
- **Layer 1** — Frappe meta Link fields (conf: 0.97)
- **Layer 2** — `rapidfuzz.fuzz.token_sort_ratio` on header pairs (threshold ≥ 75%)
- **Layer 3** — Jaccard data value overlap (threshold ≥ 20%)
- Works on DocType sheets, report sheets, pivot sheets
- Suggestion cards: icon, confidence bar, source→target column, reason text

#### Activity Column (Social Virtual Column)
- Groups `_user_tags`, `_comments`, `_assign`, `_liked_by`, `docstatus`, `idx` into one compact cell
- SVG icon buttons for like, assign, tag, comment
- Docstatus badge (Draft/Submitted/Cancelled) — only on submittable DocTypes
- `_social_html_cache` keyed by all 6 values — O(1) `afterRenderer`

#### Key Bug Fixes
- **excel_sheets never persisted** — `report_meta._controls` (jQuery DOM objects) caused `JSON.stringify` to throw inside `frappe.request.prepare()`, silently aborting all `update()` calls. Fixed: `serialize()` strips `_controls`
- **user_settings race condition** — sync-patch `frappe.model.user_settings[doctype][key]` BEFORE calling `update()` — applied everywhere
- **Pivot/Chart `active_sheet`** — `board.sheet_manager.active_sheet` does NOT exist; API is `get_current()`. Fixed in PivotBuilder and ChartManager

---

### v3.1 — Format Persistence + Focus Cell (Mar 2026)

**Grid Intelligence — Focus Cell, Hide Rows, Repeat Last Action, Precedents, Meta Column, Full Format Persistence**

#### Focus Cell / Crosshair
- View tab toggle; color-customizable via Pickr swatch
- 10% opacity tint on row/column, 20% at intersection cell
- Dark theme: pre-blended opaque `rgb()` over `bg=28` base — no white bleed-through
- Persisted in `user_settings("excel_focus_cell")`

#### Hide / Unhide Rows
- Right-click row header → "Hide Row(s)"
- HOT 6.2.2 has **no** `hiddenRows` plugin — implemented via `display:none` on TR using `afterRenderer` + `afterGetRowHeader` + `afterRender` sync of `ht_clone_left` TRs
- Click-to-unhide ▲▼ bands above/below hidden blocks
- Hidden state saved in `user_settings` AND `format_store.__hidden_rows` in workbook

#### Repeat Last Action (F4)
- Auto-records: bold, italic, align, text/fill color, borders, number format, col/row resize
- HOT `beforeKeyDown` hook with `stopImmediatePropagation` — required because HOT intercepts F4 for formula cycling

#### Formula Precedent Highlighting
- Select formula cell → HyperFormula `getCellDependencies()` → green outline on all dependency cells
- Debounced 80ms; View tab toggle

#### Created / Updated Meta Column
- Virtual `_meta` column groups owner/creation/modified_by/modified into one visual cell
- Avatar + relative time via `frappe.datetime.comment_when()` + first name only
- Pencil SVG icon for recently-modified rows; `_meta_html_cache` for O(1) `afterRenderer`

#### Full Format Persistence
- All cell formats (bold/color/align/borders/numfmt) saved to `user_settings("excel_format_store")`
- Column widths: HOT 6.2.2 internal `plugin.manualColumnWidths[]` array (NOT `columnWidthsMap`)
- Workbook save/load: full `format_store` snapshot including `__hidden_rows` and `__row_heights`

---

### v2.6 — Ribbon Toolbar + Charts + Pivot + Conditional Formatting

**Excel Ribbon Toolbar:**
- 4-tab ribbon: Home / Insert / Data / View
- Quick Access green bar (Save, Refresh, column picker, workbook buttons)
- Format Painter (one-shot and sticky), Borders 10-preset popover, Merge & Center, Number Format selector

**Charts:**
- 5 types: Bar, Line, Pie, Donut, Scatter via frappe-charts
- Draggable + resizable floating panel overlaid on grid
- Per-sheet visibility; saved in workbook config

**PivotTable Builder:**
- 4 drop zones: Rows, Columns, Values, Filters
- SUM / COUNT / AVG aggregation; subtotals row
- "Insert to Sheet" creates a new blank sheet tab populated with pivot data

**Conditional Formatting:**
- 4 rule types: Cell Value (6 operators), Color Scale (2–3 stops), Top/Bottom N, Duplicate/Unique
- Rules persisted per user via `user_settings` (not workbook — intentionally user-specific)
- Full dark-theme support via CSS class refactor

**Tree View (1:N Child Table):**
- CT columns with N child rows show `▶ N` expand badge in row header
- Click to expand individual child rows inline below parent

---

### v2.5 — Multi-Sheet Workbooks + IntelliLookup + AI Analysis

**Multi-Sheet Workbooks:**
- Multiple DocType tabs, pivot tabs, formula tabs, blank tabs — all in one saved workbook
- Sheet tab bar with `+` add, `×` close, rename, reorder
- Each tab has independent query, filters, column selection, sort

**IntelliLookup:**
- Smart cross-DocType column injection based on IntelliFlow join config
- Per-join field selection dialog; stale flag prevents blank-data joins on non-refreshed sheets

**AI Analysis Panel:**
- Post-Apply `🤖 Analyze` drawer in IntelliFlow canvas
- **Anomaly Detection** — scikit-learn `IsolationForest` on numeric columns; injects `_anomaly_score` column
- **Clustering** — `MiniBatchKMeans` with silhouette score auto-k (2–8); injects `_cluster` column
- Row highlighting by anomaly/cluster; legend in panel

**Canvas Auto-Save:**
- Every structural change (add node, connect wire, change field) auto-saves canvas state
- No "Save Canvas" button needed

**Aggregate Mode (Child Table nodes):**
- CT nodes get `📊 Aggregate` panel instead of field checkboxes
- Choose field + function (SUM/COUNT/AVG/MIN/MAX)
- Generates `GROUP BY` subquery: always 1 row per parent (no fan-out)

---

### v2.4 — IntelliFlow Join Canvas + AI Discovery

**IntelliFlow Visual Join Canvas:**
- Drag-and-drop node builder for multi-DocType joins
- SVG bezier wires between nodes; color-coded by grade (S=green → F=red)
- Cardinality detection (1:1, 1:N, N:1, N:N) + coverage % per join
- "Discover Joins" — AI scans schema + sample data; shows suggestions in right drawer with confidence scores
- BFS Join Path Finder — auto-builds multi-hop chains ("Customer → Sales Order → Sales Invoice") in one click
- Per-node Transform panel: Row Filters + Computed Columns (Python `safe_eval`)
- Canvas state persisted to `Excel Workbook` DocType

**4-Layer AI Validation Engine (zero LLM):**
1. **Meta Guard** — structural FK detection via `frappe.scrub()`
2. **Pattern Matcher** — header name similarity via rapidfuzz
3. **Type Gate** — hard incompatibility check (hard red wire)
4. **Value Overlap + Semantic** — Jaccard + RapidFuzz fuzzy value matching

**Association Rule Mining:**
- mlxtend Apriori on joined data
- Surfaces co-occurrence patterns with lift ≥ 1.2
- "IF customer=Tata THEN territory=West, lift=2.3"

---

### v2.3 — Frappe Formula Library

7 ERP-native HyperFormula functions registered as custom plugins:

| Function | Description |
|---|---|
| `GL_BALANCE(account, company, [from_date], [to_date])` | Live GL account balance |
| `STOCK_QTY(item_code, warehouse)` | Current stock quantity |
| `ITEM_PRICE(item_code, price_list, [uom])` | Price list rate |
| `FRAPPE_GET(doctype, name, fieldname)` | Single field value from any doc |
| `FRAPPE_SUM(doctype, value_field, filter_field, filter_value)` | Aggregated sum |
| `FRAPPE_COUNT(doctype, value_field, filter_field, filter_value)` | Count matching docs |
| `FRAPPE_AVG(doctype, value_field, filter_field, filter_value)` | Average of matching docs |

All functions execute via `frappe.call` → whitelisted Python endpoints → return cached results.

---

### v2.2 — Status Bar + Column Freeze + Find & Replace

- **Status bar** — fixed footer showing Count, Sum, Average, Min, Max for current selection
- **Column Freeze** — freeze leading N columns; state persisted per user
- **Find & Replace** — Ctrl+F / Ctrl+H; match-case, whole-cell, direction; draggable panel; Replace All

---

### v2.1 — Saved Workbooks

- `Excel Workbook` DocType — saves named views with full config: formula columns, column layout, filters, sort, join config, format_store, sheet tabs
- WorkbookManager JS class — save, load, delete, rename workbooks
- Workbook list in Quick Access bar; last-used workbook auto-loaded on return
- Sync-patch pattern prevents race conditions on concurrent workbook saves

---

### v1 — Core Spreadsheet Grid

- Handsontable 6.2.2 grid on any Frappe DocType list view
- HyperFormula formula engine with 400+ functions
- Excel-style formula bar with cell reference display
- Custom cell editors: Date picker, Link selector (frappe autocomplete), Select listbox, Currency formatter, Checkbox toggle
- Context menu: insert/delete rows, hide/show columns, freeze, add formula column
- Lazy loading — `app_include_js` loads only the router bundle; main deps bundle loaded dynamically
- Field picker — column selection with search; persisted per user per DocType
- Inline save — `afterChange` hook → `frappe.client.set_value` → optimistic render
- Export to `.xlsx` / `.csv`
- Import from `.xlsx` / `.csv` with column mapping dialog
- Dark theme compatibility throughout

---

## Architecture & File Structure

### File Structure
```
apps/excel_view/
├── excel_view/
│   ├── api.py                   # Whitelisted endpoints: bulk import, tags, workbook API, bulk_fetch_for_duckdb
│   ├── tree_import.py           # Tree Import Engine: analyze_import_deps, pre_create_deps, import_tree
│   ├── excel_view/
│   │   └── doctype/
│   │       └── excel_workbook/  # Workbook DocType (stores saved view configs as JSON)
│   └── public/
│       ├── js/
│       │   ├── excel/
│       │   │   ├── components/
│       │   │   │   ├── excel_board.js          # Main grid orchestrator; inline save, scroll, validators
│       │   │   │   ├── toolbar.js              # Ribbon toolbar, all import logic, TreeImportEngine
│       │   │   │   ├── sheet_manager.js        # Multi-sheet tab management; query_ast re-run; pre-warm
│       │   │   │   ├── workbook_manager.js     # Save/load workbooks
│       │   │   │   ├── pivot_builder.js        # PivotTable builder
│       │   │   │   ├── chart_manager.js        # Chart overlay manager
│       │   │   │   ├── cf_manager.js           # Conditional formatting
│       │   │   │   ├── join_canvas.js          # IntelliFlow canvas + QFP sidebar + DAG flowchart
│       │   │   │   └── ...
│       │   │   └── utils/
│       │   │       ├── frappe_formula_plugin.js  # HyperFormula ERP formula functions
│       │   │       ├── query_ast.js              # QueryAST class — canonical in-memory query representation
│       │   │       ├── sql_generator.js          # QueryAST → DuckDB SQL compiler
│       │   │       ├── duckdb_engine_v2.js       # DuckDB WASM engine + IDB cache + singleton
│       │   │       └── duckdb_engine.js          # V1 pivot-only DuckDB engine (legacy)
│       │   └── canvas/
│       │       ├── collaboration_sidebar_vanilla.js
│       │       └── collaboration_dialog_vanilla.js
│       └── scss/
│           └── excel_view.bundle.scss       # All styles: light + dark theme two-block pattern
└── genbi/
    ├── schema_graph.py          # networkx DocType relationship graph
    ├── join_suggester.py        # TF-IDF + rapidfuzz join discovery
    └── grid_intent.py           # Deterministic NL intent parser
```

### Key Design Decisions

- **Vanilla JS throughout** — no Vue/React; performance-critical grid code stays framework-free
- **HOT 6.2.2 internal APIs** — `plugin.manualColumnWidths[]` array (not Map); no `hiddenRows` plugin available
- **user_settings race condition** — always sync-patch `frappe.model.user_settings[doctype][key]` before `update()`, never use `save()`
- **SheetManager API** — `get_current()` returns active sheet; `active_sheet` property does NOT exist
- **report_meta._controls** — NEVER serialize; strip in `serialize()` to prevent JSON.stringify circular-ref crash
- **Realtime room** — `user=frappe.session.user` (routes to `user:{user}` room) for tree/dep progress
- **CSS** — two-block pattern: base light + `[data-theme="dark"]` override; never `rgba()` on HOT white cells in dark mode
- **Zero LLM policy** — all AI features: networkx + rapidfuzz + scikit-learn + mlxtend + DuckDB only; no API calls to any LLM service
- **query_ast persistence** — Query Result sheets store only the compact AST JSON in user_settings, never raw row data; re-executed on page restore
- **DuckDB pre-warm** — `_prewarm_and_rerun_ast_sheets()` fires on restore: WASM init → parallel IDB table pre-load → SQL execution; perceived latency near-zero for cached datasets

---

## Competitor Gap

| Feature | Excel | Google Sheets | Zoho Zia | Odoo Spreadsheet | **Excel View** |
|---|:---:|:---:|:---:|:---:|:---:|
| ERP-native formulas (GL_BALANCE etc.) | ✗ | ✗ | ✗ | ✗ | **✓ 7 functions** |
| Live ERP data (any DocType) | ✗ | ✗ | Zoho only | Odoo only | **✓** |
| Write-back to ERP from grid | ✗ | ✗ | ✗ | ✗ | **✓** |
| In-browser analytical SQL (DuckDB WASM) | ✗ | ✗ | ✗ | ✗ | **✓** |
| Visual SQL builder with DAG flowchart | ✗ | ✗ | ✗ | ✗ | **✓ QFP** |
| Window functions (running totals, rank) | ✓ | ✓ | ✗ | ✗ | **✓ in-browser** |
| Multi-level / tree bulk import | ✗ | ✗ | ✗ | ✗ | **✓** |
| Visual join canvas with AI discovery | ✗ | ✗ | ✗ | ✗ | **✓ IntelliFlow** |
| Cross-doctype joins (any DocTypes) | ✗ | BigQuery only | ✗ | ✗ | **✓** |
| Live collaboration (avatars/comments/assign) | ✗ | ✓ | Partial | ✗ | **✓** |
| Deterministic AI (no LLM, air-gapped) | ✗ | ✗ | ✗ | ✓ | **✓** |
| Proactive anomaly / clustering insights | Copilot/paid | Gemini/paid | Basic | ✗ | **✓ on-premise** |
| Format persistence (workbook + user) | ✓ | ✓ | Partial | ✗ | **✓ full** |

---

## License

MIT License — see `license.txt`

---

*Built with ❤️ on Frappe Framework · Handsontable 6.2.2 · HyperFormula · DuckDB WASM · dagre · frappe-charts · Pickr · networkx · rapidfuzz · scikit-learn · mlxtend · pdfplumber · MariaDB · Redis · Socket.io*
