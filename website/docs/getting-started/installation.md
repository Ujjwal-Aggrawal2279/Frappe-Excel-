---
id: installation
title: Installation
sidebar_label: Installation
---

# Installation

## Prerequisites

- Frappe Framework **v15** or newer
- ERPNext (optional — Excel View works with plain Frappe too)
- Python 3.10+
- Node.js 18+

---

## Install the App

```bash
# From your Frappe bench directory
cd /path/to/your/bench

# Get the app
bench get-app https://github.com/Ujjwal-Aggrawal2279/Frappe-Excel-.git

# Install on your site
bench --site yoursite.local install-app excel_view

# Migrate (creates the Excel Workbook DocType)
bench --site yoursite.local migrate

# Build the JS/CSS assets
bench --site yoursite.local build --app excel_view
```

:::tip Asset Build
If you're in developer mode, you can also run `bench watch` to automatically rebuild assets when source files change.
:::

---

## Python Dependencies

Excel View uses the following Python packages (automatically installed with the app):

| Package | Purpose |
|---|---|
| `rapidfuzz` | Fuzzy matching for Smart Lookup header detection |
| `networkx` | Graph traversal for IntelliFlow join discovery |
| `scikit-learn` | TF-IDF vectors for AI discovery layer |
| `pdfplumber` | PDF data extraction |

These are listed in `requirements.txt` and installed automatically by `bench get-app`.

---

## Verify Installation

1. Open your site in the browser
2. Navigate to any DocType's list view (e.g., Customer)
3. Click the **View** dropdown in the list view toolbar
4. You should see **Excel View** as an option

If Excel View does not appear, check:
- The app is installed: `bench --site yoursite.local list-apps`
- Assets were built: re-run `bench --site yoursite.local build --app excel_view`
- Clear browser cache (Ctrl+Shift+R)

---

## Permissions

Excel View inherits Frappe's standard DocType permissions:

- **Read** access → can open the grid (read-only mode)
- **Write** access → can edit cells and save
- **Create** access → can add new rows
- **Delete** access → can delete rows via right-click menu

No additional permission setup is required after installation.

---

## Upgrading

```bash
cd /path/to/your/bench

# Pull latest changes
bench update --pull

# Or update just this app
bench get-app excel_view  # re-fetches from GitHub

# Migrate and rebuild
bench --site yoursite.local migrate
bench --site yoursite.local build --app excel_view
```
