---
id: tree-import
title: Tree Import
sidebar_label: Tree Import
---

# Tree Import

For DocTypes that use a tree structure (Account, Cost Center, Territory, Item Group, Customer Group, etc.), Excel View supports importing hierarchical data from a flat XLSX file.

---

## Preparing the Import File

Your XLSX file must have:

| Column | Required | Description |
|---|---|---|
| `name` | ✅ | Document name / ID |
| `parent_account` (or `parent_<doctype>`) | ✅ | Parent node's name. Leave blank for root nodes. |
| Other fields | Optional | Any other DocType fields |

The parent reference column name depends on the DocType:
- **Account** → `parent_account`
- **Cost Center** → `parent_cost_center`
- **Territory** → `parent_territory`
- Custom tree DocTypes → `parent_{doctype_snake_case}`

---

## Import Flow

1. Data tab → **Import → Tree Import**
2. Choose the DocType (must be a tree DocType)
3. Upload your file
4. Map columns
5. Preview the detected tree structure
6. Click **Import**

Excel View processes the tree in the correct order:
- Root nodes (no parent) are created first
- Child nodes are created after their parent exists
- The import handles arbitrary depth

---

## Example: Importing a Chart of Accounts

```
name,               parent_account,         account_type, root_type
Application of Funds,,                      ,             Asset
Fixed Assets,       Application of Funds,   Fixed Asset,  Asset
Furniture,          Fixed Assets,           ,             Asset
Computers,          Fixed Assets,           ,             Asset
```

Root node `Application of Funds` has no parent. `Fixed Assets` → `Application of Funds` → root.

---

## Error Handling

If a parent node doesn't exist (e.g., referenced before it's created, or missing from the file), the row fails with: `"Parent '[name]' not found"`. Fix: ensure all parent nodes appear in the file (even if already in Frappe).

---

## Updating Existing Nodes

Including a node name that already exists in Frappe will **update** that node's fields (except the parent, which cannot be changed via import — use the Frappe form to restructure the tree).
