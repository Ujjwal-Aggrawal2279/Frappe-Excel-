# Excel View for Frappe

A full spreadsheet experience built into Frappe — edit, format, and analyze any DocType data in a familiar Excel-style grid, without leaving your ERP.

Works on **vanilla Frappe** and optionally unlocks ERPNext-specific formula functions (`GL_BALANCE`, `STOCK_QTY`, `ITEM_PRICE`) when ERPNext is installed.

---

## Features

- **Spreadsheet grid** — powered by Handsontable 6.x, works with any DocType
- **Formula engine** — HyperFormula with 400+ built-in functions (SUM, IF, VLOOKUP, etc.)
- **Frappe Formula Library** — 7 ERP-native functions: `FRAPPE_GET`, `FRAPPE_SUM`, `FRAPPE_COUNT`, `FRAPPE_AVG`, `GL_BALANCE`, `STOCK_QTY`, `ITEM_PRICE`
- **Formula bar** — Excel-style formula editing with cell reference display
- **Custom cell editors** — Date picker, Link selector, Select listbox, Currency formatter, Checkbox
- **Formatting toolbar** — Bold, Italic, Underline, Strikethrough, Alignment, Wrap, Font, Size, Text color, Fill color
- **Autofill** — Drag formulas down/up with automatic relative reference adjustment
- **Context menu** — Right-click to insert/delete rows, hide/show columns, freeze columns, add formula columns
- **Find & Replace** — Ctrl+F / Ctrl+H with match-case, whole-cell options; draggable panel
- **Column Freeze** — Freeze any number of leading columns; state persisted per user
- **Status bar** — Live selection stats (Count, Sum, Average, Min, Max) in a fixed footer
- **Saved Workbooks** — Save named views with formula columns, column layout, filters, join config, and sheet tabs
- **Multi-Sheet Workbooks** — Multiple DocType tabs in one workbook; each tab is an independent query with its own fields, filters, and sort
- **Export** — Export to `.xlsx` (Excel) or `.csv`
- **Import** — Import from `.xlsx` or `.csv` with column mapping
- **Inline save** — Cell edits sync back to Frappe DB in real time
- **IntelliFlow Join Canvas** — Visual multi-DocType join builder; drag-and-drop nodes, SVG bezier wires, grade badges (S/A/B/C/D/F), cardinality + coverage stats; canvas auto-saved on every structural change
- **Child Table Support** — Child-table DocTypes (e.g. `Timesheet Detail`, `Sales Invoice Item`) can be added as canvas nodes; teal `CT` badge distinguishes them; system fields (`parent`, `parenttype`, `parentfield`, `idx`) auto-filtered
- **Aggregate Mode** — CT nodes replace field checkboxes with a `📊 Aggregate` panel: choose field + function (SUM/COUNT/AVG/MIN/MAX) per column; generates a `GROUP BY` subquery so you always get 1 row per parent record (no fan-out)
- **Per-Node Transform Panel** — Non-CT nodes get a collapsible `🔧 Transform` section: Row Filters (=, !=, >, <, >=, <=, like, in) evaluated server-side, and Computed Columns (Python expressions via `frappe.safe_eval`)
- **AI Join Suggestions** — networkx graph + TF-IDF + RapidFuzz surface related DocTypes automatically; right-side drawer with per-node ✨ targeting, live search, and teal CT stripe for child-table suggestions
- **AI Analysis Panel** — post-Apply `🤖 Analyze` button opens right-side drawer: Anomaly Detection (IsolationForest) and Clustering (MiniBatchKMeans with silhouette auto-k); results injected as `_anomaly_score`/`_cluster` columns with row highlighting
- **Join Path Finder** — BFS shortest path through schema graph; auto-builds multi-hop node chains in one click
- **4-Layer Validation Engine** — Meta Guard → Pattern Matcher → Type Gate (hard incompatibility → instant red wire) → Value Overlap → Semantic (RapidFuzz); works entirely without LLMs
- **Association Rule Mining** — mlxtend Apriori on joined data surfaces co-occurrence patterns (IF customer=X THEN territory=Y, lift ≥ 1.2)
- **Generative BI Chat** — Natural language join discovery: "show me tasks to employee" with enhanced NLP (50+ stopwords, pattern matching, fuzzy DocType matching); clean modern UI with staggered card animations and smooth hover expansion
- **Excel Ribbon Toolbar** — 4-tab ribbon (Home / Insert / Data / View) with Quick Access green bar; Format Painter, Borders (10 presets), Merge & Center, Number Formats, Conditional Formatting button
- **Charts** — 5 chart types (Bar/Line/Pie/Donut/Scatter) via frappe-charts; draggable + resizable overlays; per-sheet visibility; saved in workbook config
- **PivotTable Builder** — 4 drop zones (Rows/Columns/Values/Filters), SUM/COUNT/AVG aggregation, subtotals; "Insert to Sheet" pushes pivot into a new blank sheet tab
- **Conditional Formatting** — 4 rule types (Cell Value / Color Scale / Top-Bottom N / Duplicate-Unique); persisted per user
- **1:N Child Table Tree View** — CT columns with multiple rows show `▶ N` expand badge in row header; click to expand individual child rows inline
- **Focus Cell / Crosshair** — View tab toggle highlights the active row and column; color-customizable; persisted per user
- **Hide / Unhide Rows** — Right-click to hide rows; Excel-style ▲/▼ click-to-unhide band indicator; hidden state saved in user_settings and workbook
- **Repeat Last Action (F4)** — Replays the last formatting action (bold, align, fill, border, resize, number format) on the current selection
- **Formula Precedent Highlighting** — Select a formula cell → all dependency cells get a green outline using HyperFormula's dependency graph
- **Created / Updated Meta Column** — The 4 Frappe audit fields (owner, creation, modified_by, modified) are automatically grouped into one compact visual column with avatars, CR/MD badges, and dates
- **Full Format Persistence** — All Home tab formatting, column widths, row heights, and hidden rows survive page refresh (user_settings) and are saved/restored via workbook "Save View"
- **Report Filter Bar** — Load any Frappe Script/Query Report via Data → Get Data → From Reports; a live filter bar appears above the grid with fieldtype-aware Frappe controls (Link with autocomplete, Date picker, Select dropdown, DateRange as two pickers); Refresh re-runs the report with updated filters; report metadata persisted in workbook
- **Smart Lookup** — Data tab → Smart Lookup; 3-layer join column detection (Layer 1: Frappe meta Link fields → Layer 2: fuzzy header match via rapidfuzz → Layer 3: Jaccard data overlap); works across any two sheets including report sheets; suggestion cards with confidence bars; Apply delegates to IntelliLookup flow
- **Activity Column** — The 6 Frappe social fields (`_user_tags`, `_comments`, `_assign`, `_liked_by`, `docstatus`, `idx`) are automatically grouped into one compact "Activity" virtual column with CRUD click handlers: like toggle (♥), assign dialog, tag add prompt, comment → route to form; docstatus badge (Draft/Submitted/Cancelled); avatar chips for assigned users
- **Conditional Formatting — Dark Theme** — CF dialog fully dark-theme compatible; all `background:#fff` inline styles removed and replaced with CSS variables (`var(--fg-color)`, `var(--text-color)`, `var(--border-color)`) via SCSS classes; `[data-theme="dark"]` override block
- **CF Persistence Fix** — Fixed `frappe.model.user_settings` race condition where deleting a CF rule was restored on page refresh; root cause: concurrent saves read stale in-memory cache; fix uses synchronous cache-patch + `update()` (bypasses no-change guard) instead of `save()`

---

## Installation

### Standard (bare-metal / VM bench)

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app $URL_OF_THIS_REPO
bench --site your-site.com install-app excel_view
```

Python ML dependencies (networkx, scikit-learn, mlxtend, rapidfuzz, etc.) are listed in `pyproject.toml` and installed automatically by pip when the app is installed. If for any reason they are missing:

```bash
bench pip install -r apps/excel_view/requirements.txt
```

### Docker-based ERPNext (frappe_docker)

If you are running ERPNext via [frappe_docker](https://github.com/frappe/frappe_docker), follow these steps to add Excel View to your deployment.

#### 1. Add the app to your `apps.json` (custom image build)

Edit (or create) your `apps.json` file that is used by `frappe_docker`'s CI to build a custom image:

```json
[
  {
    "url": "https://github.com/frappe/erpnext",
    "branch": "version-15"
  },
  {
    "url": "https://github.com/YOUR_ORG/excel_view",
    "branch": "main"
  }
]
```

Build the custom image:

```bash
export APPS_JSON_BASE64=$(base64 -w 0 apps.json)

docker build \
  --build-arg=FRAPPE_PATH=https://github.com/frappe/frappe \
  --build-arg=FRAPPE_BRANCH=version-15 \
  --build-arg=APPS_JSON_BASE64=$APPS_JSON_BASE64 \
  --tag=myorg/erpnext-excel:latest \
  --file=images/layered/Containerfile .
```

#### 2. Update `docker-compose.yml` / `compose.yaml`

Point `image:` in every `backend`, `frontend`, `queue-*`, and `scheduler` service to your custom image tag:

```yaml
services:
  backend:
    image: myorg/erpnext-excel:latest
  frontend:
    image: myorg/erpnext-excel:latest
  queue-long:
    image: myorg/erpnext-excel:latest
  queue-short:
    image: myorg/erpnext-excel:latest
  scheduler:
    image: myorg/erpnext-excel:latest
```

#### 3. Install the app on your site

```bash
# exec into the backend container
docker compose exec backend bash

# install the app
bench --site your-site.localhost install-app excel_view
bench --site your-site.localhost migrate
```

#### 4. Install Python ML dependencies inside the container

The pip install runs automatically during the image build via `pyproject.toml`. If you are attaching to an **already-running** container and the packages are missing:

```bash
docker compose exec backend bash
bench pip install -r apps/excel_view/requirements.txt
```

#### 5. JS assets — nothing to do

JS bundles are built **automatically** during `docker build` (the layered `Containerfile` runs `bench build` as part of the image build). The runtime worker containers do **not** have Node.js; do not attempt to run `bench build` inside a running container.

After bringing the stack up, just restart `frontend` so nginx picks up fresh static files:

```bash
docker compose restart frontend
```

#### Updating (Docker)

The correct update flow is to **rebuild the image** — not `git pull` inside a running container (worker images have no Node.js so assets can't be rebuilt at runtime).

```bash
# 1. Update apps.json to the new commit/branch, then rebuild the image
export APPS_JSON_BASE64=$(base64 -w 0 apps.json)
docker build \
  --build-arg=FRAPPE_PATH=https://github.com/frappe/frappe \
  --build-arg=FRAPPE_BRANCH=version-15 \
  --build-arg=APPS_JSON_BASE64=$APPS_JSON_BASE64 \
  --tag=myorg/erpnext-excel:latest \
  --file=images/layered/Containerfile .

# 2. Roll the stack
docker compose up -d

# 3. Run migrations if DocTypes changed
docker compose exec backend bench --site your-site.localhost migrate

# 4. Reload nginx
docker compose restart frontend
```

> **Note:** `bench build` is NOT needed at runtime — assets are baked into the image during step 1.

### Updating (bare-metal)

```bash
cd apps/excel_view && git pull
bench build --app excel_view   # required after every pull (dist files are not committed)
```

---

## Release Notes

### v3.2 — Mar 2026

**Zero-LLM Intelligence — Report Filter Bar + Smart Lookup + Activity Column + Dark Theme Fixes**

**Report Filter Bar**
- Load any Frappe Script Report or Query Report via Data → Get Data → From Reports
- A collapsible filter bar renders above the HOT grid with proper Frappe controls for each filter:
  - Link fields → autocomplete with `get_query` / `filters` constraints from the report JS file respected
  - Date → datepicker, DateRange → two date pickers side by side, Select → native dropdown
- Refresh button re-runs the report with the current filter values via `frappe.desk.query_report.run`
- Report name, filter definitions, and current filter values persisted in workbook serialize/restore
- Filter bar collapses/expands via ▾/▸ toggle; autosaved per sheet
- z-index fix: parent has no stacking context so `.awesomplete ul` (z-index 1100) floats above HOT grid headers

**Smart Lookup (Data tab → Smart Lookup)**
- 3-layer AI join column detection — zero LLM, entirely server-side:
  - **Layer 1**: Frappe meta — `frappe.get_meta(doctype).fields` → Link fields pointing to the target DocType (confidence 0.97)
  - **Layer 2**: Header fuzzy match — `rapidfuzz.fuzz.token_sort_ratio` on label/fieldname pairs (threshold ≥ 75%)
  - **Layer 3**: Data value overlap — Jaccard similarity on sampled unique values per column pair (threshold ≥ 20%)
- Works across any two sheets including report sheets (not just DocType sheets)
- Suggestion cards show: strategy icon (🔗/🔤/📊), confidence %, source→target column, reason, color-coded bar
- Apply → delegates to IntelliLookup column picker (reuses proven lookup flow)

**Activity Column (Social Virtual Column)**
- When `_user_tags`, `_comments`, `_assign`, `_liked_by`, `docstatus`, `idx` are in the column selection, they are automatically grouped into one compact "Activity" column (mirrors the Meta Column pattern)
- Each row shows: docstatus badge (Draft/Submitted/Cancelled) · assigned user avatar chips · like button (♥ count, fills red when current user has liked) · comment count · tag chips · idx index
- CRUD click handlers via jQuery event delegation on `$hot_container` with `data-sc` attributes:
  - Like → `frappe.desk.like.toggle_like` API + in-place re-render
  - Assign → `frappe.desk.form.assign_to.get` + Dialog
  - Tags → `frappe.prompt` + `frappe.desk.tags.add_tag`
  - Comment → `frappe.set_route` to doc form
- Workbook save/load: stored as `{ fieldname: "_social", is_social_col: true }` marker; expanded to `["docstatus","idx"]` on load (underscore fields auto-fetched by list view)
- `_social_html_cache` Map keyed by `name:tags:comments:assign:liked:docstatus:idx` — skips re-render if unchanged; cleared on refresh

**Dark Theme & Layout Fixes**
- **New-row cells / fetch-auto cells**: `rgba()` on HOT white `<td>` produced cream in dark mode → replaced with opaque `#1a2a1e` / `#1c2820` overrides in `[data-theme="dark"]`
- **Inline insert bar**: was `position:absolute;top:0` inside `$hot_container` — covered HOT column headers; fixed to `prependTo($grid_main)` with `width:100%;flex-shrink:0` (in-flow flex child)
- **Sheet tabs**: `.ev-sheet-tabs` / `.ev-sheet-tab` CSS was entirely absent — tabs defaulted to `display:block` and stacked; full CSS block added
- **CF dialog**: removed all `background:#fff` hardcoded inline styles from both the main dialog and editor sub-dialog HTML; replaced with CSS classes + `[data-theme="dark"]` SCSS block using `var(--fg-color)` / `var(--text-color)` / `var(--border-color)`

**Conditional Formatting Persistence Fix**
- Root cause: `frappe.model.user_settings.save()` does NOT update the in-memory cache synchronously — only in the async callback. Concurrent saves (e.g. `sheet_manager` saving `excel_sheets` right after `hot.render()`) read the stale cache (still containing the deleted rule) and POST it after the delete's POST, restoring the old rule
- Fix: `cf_manager._save_rules()` now (1) patches `frappe.model.user_settings[doctype].excel_cf_rules` synchronously before posting, and (2) calls `frappe.model.user_settings.update()` instead of `save()` to bypass the no-change guard (which would skip the POST if the cache was already patched)
- CF rules removed from workbook serialization/restoration — they are `user_settings`-only; workbook restore no longer touches `excel_cf_rules`

---

### v3.1 — Mar 2026

**Grid Intelligence — Focus Cell, Hide Rows, Repeat Last Action, Precedents, Meta Column, Full Format Persistence**

**Focus Cell / Crosshair (View tab)**
- Horizontal + vertical highlight lines intersecting at the active cell
- Toggle in View tab ("Focus Cell" button); color customizable via Pickr color swatch
- 10% opacity tint on the row/column, 20% at the intersection cell
- Setting persisted in `user_settings("excel_focus_cell")` — survives page refresh

**Hide / Unhide Rows**
- Right-click row header → "Hide Row(s)" — works on single or multi-row selection
- HOT 6.2.2 has no `hiddenRows` plugin — implemented via `display:none` on TR elements using `afterRenderer`, `afterGetRowHeader`, and `afterRender` sync of left-clone TRs
- Click-to-unhide indicators: ▲ button above and ▼ button below hidden blocks (green `#217346` band, Excel-style)
- Hidden rows persisted in `user_settings("excel_hidden_rows")` AND encoded in workbook `format_store.__hidden_rows`
- Hidden state loaded **before** `_init_hot()` so initial render never shows blank space

**Repeat Last Action (F4)**
- Records last formatting action automatically: bold, italic, underline, strikethrough, alignment, H-align, V-align, text color, fill color, borders, number format, column resize, row resize
- F4 replays the action on the current selection
- Uses HOT `beforeKeyDown` hook with `stopImmediatePropagation` (HOT intercepts F4 for formula cycling — `stopImmediatePropagation` is required, not just `preventDefault`)

**Formula Precedent Highlighting**
- Select any formula cell → all cells it depends on get a **green outline** (`2px solid #4caf50`)
- Uses `HyperFormula.getCellDependencies()` — supports both single-cell and range dependencies
- Clears automatically when a non-formula cell is selected
- Toggle in View tab ("Show Precedents")

**Created / Updated Meta Column**
- When `owner`, `creation`, `modified_by`, `modified` fields are in the column selection, they are automatically grouped into one virtual "Created / Updated" column
- Each row shows: avatar + CR badge + creation date (top row) and avatar + MD badge + last modified date (bottom row); full username in tooltip on hover
- Column is read-only, 200px wide, excluded from DB saves; the 4 underlying fields remain in `list_view.fields` for the server query
- Workbook save/load: stored as `{ fieldname: "_meta", is_meta_col: true }` marker; expanded back to the 4 audit fields on load + `_inject_meta_column()` re-runs automatically

**Full Format Persistence (user_settings + Workbook)**
- All Home tab formatting — bold, italic, underline, strikethrough, alignment, text color, fill color, borders, number formats — persisted in `user_settings("excel_format_store")`
- Column widths: fixed for HOT 6.2.2 (uses `plugin.manualColumnWidths[]` array, not the broken `columnWidthsMap`)
- Row heights: persisted in `user_settings("excel_row_heights")` as `manualRowHeights[]` array
- Workbook "Save View" captures all of the above + hidden rows + row heights (encoded in `format_store.__hidden_rows` / `format_store.__row_heights` — no schema change needed)
- Workbook deselect clears all workbook-specific keys from `user_settings` (`excel_hidden_rows`, `excel_row_heights`, `excel_columns`, `excel_format_store`, `excel_cf_rules`, etc.) so the view reverts to clean state

**Bug Fixes**
- Fixed `"Field not permitted in query: tabEmployee._meta"` — `VIRTUAL_KEYS` set in `apply_field_selection` filters out `_meta` and other virtual column keys before building `list_view.fields`
- Fixed column width application in `apply_config` — now uses a `key→width` map matched against actual `board.columns` (index-based apply was wrong after meta column injection shifted indices)
- Fixed workbook column widths in `get_config` — used broken `columnWidthsMap.get()` (undefined in HOT 6.2.2); now reads `plugin.manualColumnWidths[phys_i]` directly

---

### v2.6 — Mar 2026

**Excel Ribbon Toolbar + Charts + PivotTable + Conditional Formatting + Tree View**

**Ribbon Toolbar — 4-tab Excel-style ribbon**
- **Quick Access Bar** (green header): Save View split-button · Views dropdown · Columns picker · Link Sheets
- **Home tab**: Format Painter · Font family/size · Bold/Italic/Underline/Strikethrough · Text color · Fill color · Borders dropdown (10 presets: All Borders, Outside, Thick Box, etc.) · Merge & Center dropdown · Alignment (H+V) · Wrap · Indent · Number format (General/Currency/Percentage/Comma/Accounting) · Decimal +/- · Conditional Formatting button
- **Insert tab**: 5 chart types (Bar/Line/Pie/Donut/Scatter) · PivotTable builder
- **Data tab**: Sort A→Z / Z→A · Filter · Insert record · Duplicate · Delete selected rows
- **View tab**: Freeze Panes dropdown (First Row / First Column / At Selection / Unfreeze) · Gridlines toggle
- Tab strip uses CSS variables for glass-morphism blur — light and dark theme both covered

**Charts (Insert → Charts)**
- Uses `frappe.Chart` (frappe-charts 2.0.0-rc27) already bundled in Frappe desk — zero new npm deps
- Dialog: pick X-axis field + multi-select Y-axis fields + title + live preview
- **Group & Sum by X Axis** toggle — when enabled, duplicate X values are aggregated; auto-detects per Y field: numeric fields → SUM, non-numeric fields (e.g. ID) → COUNT with `(Count)` label suffix; ideal for customer-wise order counts or revenue totals without needing a PivotTable
- Tree child rows automatically excluded from chart data (parent header row already contains the summary)
- Output: draggable + resizable overlay on the grid (`position: absolute`)
- Serialized in workbook config → restored on workbook load
- Per-sheet visibility: charts are scoped to the sheet tab they were created on

**PivotTable Builder (Insert → PivotTable)**
- Pure client-side JS — no library
- 4 drop zones: Rows · Columns · Values · Filters; SUM/COUNT/AVG per value field
- Subtotals row and column; grand total row
- **"Insert to Sheet"** button — pushes pivot result as a new blank sheet tab with custom column headers

**Conditional Formatting (Home → Styles)**
- Rule types: Cell Value (= / > / < / >= / <= / <> / between / contains) · Color Scale (min/mid/max interpolation) · Top/Bottom N (absolute or %) · Duplicate/Unique
- Color pickers for fill + text color per rule
- Rules evaluated in `afterRenderer` — layered on top of format_store
- Persisted in user_settings (`excel_cf_rules`) and restored on load

**Number Formatting (Home → Number)**
- Formats: General · Number · Currency · Accounting · Percentage · Fraction · Scientific · Text
- `ExcelBoard._format_num()` static method; right-aligns numeric output automatically
- `$` and `%` quick buttons; decimal precision increase/decrease

**Borders (Home → Borders)**
- Portal-based dropdown (position: fixed — avoids ribbon overflow clipping)
- 10 presets including Outside Borders (applies only outer edges of the selection range)
- Stored per cell in `format_store.borders`, applied as inline `border-*` styles

**Merge & Center**
- HOT `mergeCells` plugin integration; dropdown: Merge & Center · Merge Across · Merge Cells · Unmerge

**Format Painter**
- Click to capture format from active cell; button stays highlighted (`.ev-active`)
- Click any target cell to apply captured format; clears paint mode automatically

**1:N Child Table Tree View**
- When a CT column has multiple child rows per parent: row number header shows `▶ N` badge
- Collapsed by default (comma-joined summary visible in header row)
- Click the row number to expand → individual child rows appear below with `└` indicator
- Expand state preserved across re-renders via `_expanded_keys` Set

**Dark Theme**
- All new V2.6 popup elements (borders popup, merge popup, chart overlay, portals) have full dark theme overrides
- Tree row badge adapts (teal on dark, green-tinted on light)
- Selected cell now shows Excel-blue tint (`--ev-sel-fill`) instead of white

**Bug Fixes (Mar 2026 session)**
- Workbook deselect: replaced `user_settings.save()` (no-change guard skipped server POST) with direct `update()` call
- Blank sheet guard in `board.refresh()`: skips HOT `loadData` but still rerenders charts
- Chart live data on blank sheets: triggers `list_view.refresh()` on sheet switch when charts are present
- Formulas tab dropdowns clipped by ribbon `overflow: hidden`: fixed with portal pattern (position: fixed, appended to body)
- `CurrencyEditor.beginEditing` throw on formula insert: wrapped in try/catch + cell editor overridden to `'text'` type before insert + cursor moved to end to prevent select-all-on-focus replacing the formula prefix
- Cell selection turning white on dark theme: `td.current` fallback changed from `--ev-cell-bg` (#fff) to `--ev-sel-fill` (#deebf7)
- `hot.loadData` called with 2D matrix instead of array-of-objects: fixed in tree toggle and CT enrichment
- Inline insert `TypeError: '>' not supported between 'str' and 'float'`: HOT cell values are always strings; now coerced via meta fieldtype (`Float/Currency/Int/Percent` → `parseFloat`, `Check` → `0/1`) before `frappe.client.insert`, for both parent doc and CT child fields
- CF default range now always spans all rows for the selected columns (was capturing single-row selection, causing unexpected partial highlights)
- CF tree child rows: range check now uses parent header's HOT index (was bypassing row range entirely, causing unrelated tree children to be highlighted)

---

### v2.5+ — Feb 2026

**Child Table Support + Aggregate Mode in IntelliFlow Canvas**

- **Child table nodes** — DocTypes with `istable=1` (e.g. `Timesheet Detail`, `Sales Invoice Item`, `Purchase Order Item`) can now be added to the canvas. AI Suggestions automatically surfaces them with a teal `CT` badge and stripe.
- **Aggregate panel** — CT nodes show a `📊 Aggregate` builder instead of field checkboxes. Add any number of `[field] [SUM/COUNT/AVG/MIN/MAX]` rows. The SQL engine generates a `GROUP BY` subquery — no fan-out, always 1 row per parent record.
  ```sql
  -- Example: Task → Timesheet Detail (SUM hours)
  LEFT JOIN (
      SELECT task, SUM(hours) AS `Timesheet Detail__hours`
      FROM `tabTimesheet Detail`
      GROUP BY task
  ) t1 ON t0.name = t1.task
  ```
- **Schema graph updated** — `_get_all_link_edges()` no longer filters out `istable=1` sources; adds `is_child_src` flag; `suggest_joins()` uses `method: "child_table"` for these; sort order: meta → child_table → ML. Cache key bumped to `v2`.
- **1:N fan-out fix** — `_apply_join_result()` in `excel_board.js` now detects when `joined_rows` has multiple entries per base record (1:N regular join) and expands `list_view.data` by cloning base rows — preserving all data instead of overwriting with the last row.
- **Canvas auto-save layout** — Canvas state now persists on every structural change (valid edge created, node removed, node dragged), not only after Apply. Removing all non-base nodes explicitly clears `user_settings` so refresh starts clean.

---

### v2.5 — Feb 2026

**Multi-Sheet Workbooks + Transform Panel + AI Analysis**

**Sheet Tabs**
- Tab strip at bottom of grid (Excel / Google Sheets style)
- Each tab = independent DocType query with its own field picker, filters, sort, and column widths
- `+` button → DocType picker dialog; double-click to rename; `×` to remove (Sheet 1 locked)
- HyperFormula multi-sheet registration (`hf.addSheet` per tab); active sheet tracked via `formula_bridge.set_active_sheet()`
- HOT swap on tab switch: `hot.updateSettings({ columns })` + `hot.loadData(data)` — instant, no re-fetch if data cached
- Lazy fetch — only the active tab loads data on open
- Workbook save/load includes full `sheets[]` state (`Excel Workbook.sheets` Code/JSON field)

**IntelliLookup Banner**
- After adding a second sheet tab, a non-intrusive banner auto-detects if the new DocType links to the current one (meta L1A/L1B + value sampling L2)
- "Add lookup column →" injects a client-side join column without any formula

**Per-Node Transform Panel (`🔧 Transform`)**
- Collapsible panel on every non-CT, non-base canvas node
- **Row Filters**: `[field] [=|!=|>|<|>=|<=|like|in] [value]` evaluated server-side in `_apply_node_transforms()`; `like` and `in` operators handled specially; numeric and string comparisons auto-detected
- **Computed Columns**: `label` + Python expression evaluated via `frappe.safe_eval` with `row` context; safe builtins only; errors → `#ERR!`
- State serialized into `join_config.nodes[].row_filter` and `computed_cols`; restored from workbook/user_settings

**AI Analysis Panel (`🤖 Analyze`)**
- Button appears in canvas header after Apply
- Right-side drawer with two tabs:
  - **Anomaly Detection** — scikit-learn `IsolationForest`; contamination slider (5–30%); injects `_anomaly_score` + `_is_anomaly` per row; anomalous rows highlighted red in grid
  - **Clustering** — `MiniBatchKMeans`; K=Auto (silhouette) or manual 2–6; injects `_cluster` column; rows colored by cluster (6 pastel colors); centroid summary dialog
- Results injected into `board.list_view.data` in-place; `board.hot.render()` picks up row coloring via extended `cells` callback

**New API endpoints**: `detect_lookup`, `detect_anomalies`, `cluster_data`, `_apply_node_transforms`

---

### v2.4.5 — Feb 2026

**IntelliFlow AI — 4-Layer Validation + AI Discovery**

- **4-Layer validation pipeline:** L0 Meta Guard → L1 Pattern Matcher → L2 Type Gate → L3 Value Overlap → L4 Semantic
  - L1 detects `naming_series` / `hash` / `email` / `date` / `numeric` / `text` patterns per field
  - L2 is a hard gate — type-incompatible pairs (date ↔ numeric, email ↔ hash, etc.) reject immediately; wire turns **red** with no delay
  - L3 value overlap combined with L1 pattern score (composite = max of both)
  - L4 RapidFuzz `token_sort_ratio` + `partial_ratio` + dynamic `std_fields` boost
  - Final confidence = 0.7 × composite + 0.3 × semantic
  - Grades: **S** (meta link) / **A** (≥0.80) / **B** (≥0.60) / **C** (≥0.40) / **D** (≥0.25) / **F** (rejected)
- **`✨ AI` Suggestions drawer** — right-side panel (slides in), cards with left color stripe (green = direct Link, blue = ML), score bar, + Add button, live search filter
  - Per-node targeting: click ✨ on any canvas node to get suggestions for that DocType
  - ↻ Refresh button to bust the 5-min Redis cache on demand
  - Returns ALL candidates (no top-5 cap) — direct Link DocTypes first, then ML-ranked
- **`🔗 Path` finder** — `frappe.prompt` → BFS via networkx on cached schema graph → auto-builds multi-hop node chain
- **`📊 Patterns`** — mlxtend Apriori on applied join data; IF/THEN table with support, confidence, lift (lift ≥ 2 highlighted green)
- **Port glow during wire drag** — `rank_field_matches` (TF-IDF + rapidfuzz) scores target ports; high-score ports pulse green, mid-score amber
- **Badge enrichment** — grade chip + `1:N | 87% cov` appended to each edge label
- **Performance** — single SQL JOIN on `tabDocField` + `UNION` Custom Fields + 5-min Redis cache replaces N×`get_meta()` calls

---

### v2.4 — Feb 2026

**IntelliFlow — Visual Join Canvas**

- Full-screen overlay canvas with draggable DocType nodes and SVG bezier wire edges
- `+ Add DocType` button → searchable node added to canvas
- Draw wires from right-side output ports to left-side input ports to create joins
- 2-layer validation: meta Link field check → data value overlap sampling (≥30% = valid)
- Valid edge: green solid wire + confidence badge; Invalid: red dashed + auto-remove after 3s
- Field checkboxes on target nodes to select which columns to include in output
- **Preview** (5 rows) + **Apply** → `get_joined_data` → dynamic LEFT JOIN SQL → virtual join columns in grid (read-only, excluded from DB saves)
- **Canvas persistence** — state (nodes, positions, edges, field selections) saved in `user_settings` and inside Workbook DocType; auto-restored and re-validated on next open

---

### v2.3 — Feb 2026

**Frappe Formula Library — 7 ERP-native HyperFormula functions**
- `=FRAPPE_GET(doctype, name, fieldname)` — fetch any field from any document
- `=FRAPPE_SUM(doctype, fieldname [, filter_field, filter_val …])` — live aggregate with SUMIF-style filters
- `=FRAPPE_COUNT(doctype [, filter_field, filter_val …])` — live count
- `=FRAPPE_AVG(doctype, fieldname [, filter_field, filter_val …])` — live average
- `=GL_BALANCE(account, company [, from_date, to_date, cost_center, finance_book])` — net GL balance (ERPNext only)
- `=STOCK_QTY(item_code, warehouse [, as_of_date])` — current or point-in-time stock qty (ERPNext only)
- `=ITEM_PRICE(item_code, price_list [, qty, customer, uom])` — live price list lookup (ERPNext only)
- Async two-pass cache: cells show `#LOADING…` shimmer while fetching, then auto-update
- GPU-composited shimmer animation (`transform` on `::after`, `will-change: transform`)
- Permission enforcement: `#PERM_DENIED` on access denied; `#ERR!` on server error
- Dynamic field validation — respects custom fields from any installed app
- ERPNext functions conditionally registered — gracefully absent on vanilla Frappe

---

### v2.2 — Feb 2026

**Column Freeze**
- Right-click any column header → "Freeze up to this column" / "Unfreeze All Columns"
- Visual indicator: soft shadow border on freeze boundary
- Freeze position saved in `user_settings` — restored automatically on next load

**Find & Replace**
- Ctrl+F → Find panel; Ctrl+H → Find & Replace panel
- Options: Match case, Whole cell only
- Navigation: Enter / Shift+Enter cycles through all matches (count badge shown)
- Replace One / Replace All — readonly cells skipped automatically
- Draggable floating panel

**Status Bar**
- Fixed footer showing live selection stats: address, Count, Sum, Average, Min, Max
- Performance guard: skips numeric scan for selections > 5,000 cells
- Correctly handles formula cells (uses HyperFormula evaluated result)
- Strict numeric detection — date strings like `"2026-02-22"` are not counted as numbers

---

### v2.1 — Feb 2026

**Saved Workbooks**
- Save named workbooks per DocType: column selection, order, widths, formula columns, filters, sort
- Load/switch workbooks from toolbar "Views" dropdown
- "Save View" split-button: overwrite current or save as new ("Save As…")
- My Views / Shared Views sections; delete with confirmation
- Workbook state auto-restored on page refresh (server-side via `Excel Workbook` DocType)

**Formula Columns**
- Add virtual columns not tied to any Frappe field
- Supports formulas (`=SUM`, `=IF`, Frappe functions, etc.) and plain values
- Saved and restored as part of workbook (per-doc values keyed by `doc.name`)
- Autofill works with relative reference adjustment

---

### v2.0 — Feb 2026

**Performance**
- Lazy loading — 4KB router bundle loads everywhere; 1.6MB deps bundle loads only when Excel View is opened
- Zero cost for users who never open Excel View

**Field Picker — "Choose Columns" dialog**
- Select which DocType fields to display; drag-to-reorder; saved server-side per user
- RBAC-aware — respects `permlevel` field permissions
- Live search by label or fieldname; Select All / Deselect All

**Toolbar & Grid**
- Full formatting toolbar wired for single cell and multi-cell range selection
- Rich color palette: 3-section Excel 2007 style (theme + standard + recent + custom hex)
- `outsideClickDeselects: false` — toolbar clicks don't deselect the grid
- Column widths persist per user per DocType

---

### v1.0 — Initial Release

- Full spreadsheet grid for any DocType
- HyperFormula integration (400+ formulas), formula bar, autofill
- Custom cell editors: Date, Link, Select, Currency, Check
- Formatting toolbar: font, size, bold/italic/underline/strike, alignment, wrap, text/fill color
- Context menu (insert/delete rows)
- Export to `.xlsx` / `.csv`, Import from `.xlsx` / `.csv`
- Inline real-time save to Frappe DB
- View switcher integration (alongside List, Kanban, Report views)

---

## Upcoming

### v3.3 — Zero-LLM Intelligence II + Data Integrity

- **Flash Fill (Ctrl+E)** — auto-detect and fill patterns from 2+ examples (prefix/suffix stripping, delimiter split, case transform, regex extraction); server-side strategy engine in `api.py`
- **Formula Autodetect / Ghost Text** — type `=` in a cell → header-aware ghost text suggests `=SUM(...)`, `=TEXT(...,"mmmm")`, etc.; Tab to accept
- **`=DETECT_LANGUAGE(cell)`** — langdetect-powered language detection formula (returns "en", "es", "fr", etc.)
- **`=TRANSLATE(cell, lang)`** — dict-based business term translation (Invoice→Factura, etc.; no LLM)
- **Frappe-Native Validators** — `beforeChange` hook validates Currency/Float/Int (non-numeric → reverts), strips whitespace, checks Link field existence (red triangle indicator on invalid)
- **Live Pivot Refresh** — Frappe SocketIO `list_update` event triggers debounced pivot recompute; pivot sheet updates in-place without losing filter state
- **Smart Lookup N-hop** — NetworkX schema graph enhancement: Layer 1 extended to traverse multi-hop paths (Sales Invoice → Customer → Territory) using `nx.shortest_path`

### v3.4 — Agent Mode

- **Agent Mode Sidebar** — right-side panel; deterministic intent parsing (regex, no LLM); built-in agents: amortization schedule, invoice summary, date sequence, Fibonacci, times table; all compute client-side

### v3.5 — Clean Data Panel + PROMPT() Formula

- **Clean Data Panel** — rapidfuzz clusters similar text values (typo detection), flags mixed-type columns; Apply to fix in bulk
- **`=PROMPT("task", cell)`** — deterministic text extraction: first name, last name, city, country, sentiment (TextBlob), case transforms; zero LLM

---

## Tech Stack

| Layer | Library |
|---|---|
| Grid | [Handsontable](https://handsontable.com/) 6.2.2 (Community, GPL-3.0) |
| Formula engine | [HyperFormula](https://hyperformula.handsontable.com/) 2.x (GPL-3.0) |
| Excel export/import | [ExcelJS](https://github.com/exceljs/exceljs) (lazy-loaded) |
| CSV parsing | [PapaParse](https://www.papaparse.com/) |
| ML | networkx, scikit-learn, rapidfuzz, mlxtend, scipy, pandas (all open-source, no LLMs) |
| PDF parsing | pdfplumber (planned: Import from PDF) |

---

## Contributing

```bash
cd apps/excel_view
pre-commit install
bench build --app excel_view --watch
```

PRs welcome. No LLM-based features — all AI/ML uses only open-source classical libraries (scikit-learn, rapidfuzz, networkx).

---

## License

MIT
