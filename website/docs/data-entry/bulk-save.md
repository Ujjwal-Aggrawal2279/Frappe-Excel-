---
id: bulk-save
title: Bulk Save
sidebar_label: Bulk Save
---

# Bulk Save

Excel View stages all your changes and lets you save them all at once.

---

## Save Flow

1. Edit cells across multiple rows — all changes are staged in memory
2. A **save indicator** in the toolbar shows the number of unsaved rows
3. Press **Ctrl+S** or click **Save** in the Home tab
4. A progress bar appears as Excel View saves rows in parallel
5. A success toast confirms: "Saved X rows"

---

## Parallel Saves

Excel View saves multiple rows simultaneously (up to 5 parallel API calls). For 100 modified rows, this typically takes 3–8 seconds depending on server load.

---

## Save Results

After a bulk save:

| Result | Visual |
|---|---|
| All rows saved | Green success toast, rows return to white |
| Some rows failed | Red error toast per failed row with Frappe error message |
| Server unreachable | Warning toast, all rows remain in pending state |

Failed rows retain their amber modification indicator so you can identify and fix them.

---

## Auto-Save

Excel View does **not** auto-save on a timer. All saves are intentional (Ctrl+S or Save button). This mirrors Excel's behavior and prevents accidental data writes.

---

## Discarding Changes

Press **Ctrl+Z** to undo your last cell change.

To discard **all** pending changes: click **Refresh** in the toolbar (or press **Ctrl+Shift+R**). This reloads data from Frappe and discards all unsaved changes. A confirmation dialog appears before discarding.
