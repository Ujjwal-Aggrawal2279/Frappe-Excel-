---
id: troubleshooting
title: Troubleshooting
sidebar_label: Troubleshooting
---

# Troubleshooting

## Excel View doesn't appear in the View dropdown

**Possible causes:**
1. App not installed — run `bench --site yoursite.local list-apps`
2. Assets not built — run `bench --site yoursite.local build --app excel_view`
3. Browser cache — hard refresh with Ctrl+Shift+R

---

## Grid shows no data

**Check:**
1. Do you have **Read** permission for this DocType?
2. Are there active **filters** that exclude all records? Click Data → Clear Filters
3. Is the DocType empty? Check in the standard list view

---

## Save fails with "PermissionError"

Your Frappe user doesn't have **Write** permission for this DocType or for the specific records you're trying to edit. Contact your system administrator.

---

## Save fails with a validation error

The error message in the red toast explains the specific validation failure. Common causes:
- A mandatory field is empty
- A Link field value doesn't exist in Frappe
- A unique constraint is violated (duplicate name)

Fix the highlighted red cells and try saving again.

---

## Smart Lookup suggestions are empty or wrong

**Possible causes:**
1. The DocType has no Link fields pointing to other DocTypes → only fuzzy/data-overlap layers run, which may not find anything
2. The data in your source column has very different values from the target DocType names (low overlap) → check the confidence scores
3. The report sheet has filtered data with near-zero overlap with the target DocType → Layer 0c (structural FK) should still work; check that the field names match

---

## Pivot table shows no data

**Common fix:** The pivot source sheet may have no data loaded or the `_data_is_stale` flag was not cleared. Switch away from the pivot sheet and back — this triggers a recompute. Or click **Refresh**.

---

## Charts are empty after refresh

Charts are data-bound to the sheet. If the sheet was refreshed and data changed, click the chart → **Edit** → click **Rebuild** to re-bind.

---

## Formula shows `#NAME?`

The function name is unrecognized. Check:
- Spelling is correct (`FRAPPE_GET`, not `frappe_get`)
- HyperFormula is loaded (visible if other formulas work)

---

## Formula shows `#VALUE!` for FRAPPE_GET

The API call returned an error. Check:
- DocType name is spelled correctly (exact case, e.g., `"Sales Invoice"` not `"sales invoice"`)
- Document name exists in Frappe
- Field name is correct (use `fieldname`, e.g., `"grand_total"` not `"Grand Total"`)

---

## Rich text modal opens but is blank

The cell contains empty HTML (e.g., `<div></div>`). Start typing — the editor is working, the content is just empty.

---

## Child table expand arrow not visible

The DocType has no child table fields, or the record has `docstatus = 1` (submitted). Submitted documents cannot have their child tables edited inline.

---

## Columns reset after page refresh

Your user settings save may have failed silently. Check the browser console for network errors. If `frappe.model.user_settings.update()` is failing, it may be a Frappe server issue.

---

## "excel_view.bundle.js" 404 error in console

The asset build didn't include the correct manifest. Re-run:
```bash
bench --site yoursite.local build --app excel_view --force
```

---

## Getting More Help

- Open an issue: [GitHub Issues](https://github.com/Ujjwal-Aggrawal2279/Frappe-Excel-/issues)
- Include: Frappe version, Excel View version, browser, steps to reproduce, and the browser console error if any
