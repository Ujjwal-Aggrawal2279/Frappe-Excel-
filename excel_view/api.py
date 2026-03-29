# Copyright (c) 2026, Ujjwal Aggrawal and contributors
# For license information, please see license.txt

"""
excel_view.api — server-side endpoints for Excel View.

All methods are @frappe.whitelist(), meaning they are accessible via
frappe.call({ method: "excel_view.api.<name>", ... }) from the client.

Security model:
  - Any logged-in user can create workbooks.
  - A workbook is readable by its owner or by anyone if is_public = 1.
  - Only the owner (or System Manager) can update or delete a workbook.
  - Every method verifies that the caller has READ permission on the target
    DocType — so users can't save views for doctypes they can't access.

V2.3 — Frappe Formula Library
  Scalar async formula functions callable from HyperFormula cells:
    FRAPPE_GET(doctype, name, fieldname)
    FRAPPE_SUM(doctype, fieldname [, fk, fv …])
    FRAPPE_COUNT(doctype [, fk, fv …])
    FRAPPE_AVG(doctype, fieldname [, fk, fv …])
    GL_BALANCE(account, company [, from_date, to_date, cost_center, finance_book])
    STOCK_QTY(item_code, warehouse [, as_of_date])
    ITEM_PRICE(item_code, price_list [, qty, customer, uom])
"""

import frappe
from frappe import _


def _check_doctype_permission(doctype, ptype="read"):
	"""Check permission, skipping child table DocTypes (they inherit from parent)."""
	meta = frappe.get_meta(doctype)
	if meta.istable:
		return  # Child tables inherit permissions from parent; skip standalone check
	frappe.has_permission(doctype, ptype, throw=True)


# ── V2.3 helpers ──────────────────────────────────────────────────────────────

#: Fields that exist on every DocType but are NOT in meta.fields — always valid.
_SYSTEM_FIELDS: frozenset[str] = frozenset(
    {
        "name",
        "owner",
        "creation",
        "modified",
        "modified_by",
        "docstatus",
        "idx",
        "_user_tags",
        "_assign",
        "_comments",
        "_seen",
    }
)

#: Hard cap for frappe_aggregate SUM/AVG to avoid runaway DB scans.
_AGGREGATE_ROW_CAP = 50_000


def _validate_fieldname(doctype: str, fieldname: str) -> None:
    """
    Raise DoesNotExistError if *fieldname* is not a valid field on *doctype*.

    Checks system fields first (always allowed), then the live meta — which
    includes custom fields added by any installed app.  This makes the
    validation fully dynamic without any hardcoded field lists.
    """
    if fieldname in _SYSTEM_FIELDS:
        return

    meta = frappe.get_meta(doctype)
    valid_fields = {df.fieldname for df in meta.fields}

    if fieldname not in valid_fields:
        frappe.throw(
            _("Field '{0}' does not exist on DocType '{1}'.").format(fieldname, doctype),
            frappe.DoesNotExistError,
        )


_FILTER_OPS = frozenset({">", "<", ">=", "<=", "!=", "like", "not like", "in", "not in", "between"})


def _parse_filter_pairs(
    fk1=None, fv1=None,
    fk2=None, fv2=None,
    fk3=None, fv3=None,
    fk4=None, fv4=None,
) -> list:
    """
    Build a Frappe filter list from up to four SUMIF-style key/value pairs.

    Supports both exact-match and operator-style keys:
      Exact:    fk="ev_sales_person", fv="Arjun" → ["ev_sales_person", "=", "Arjun"]
      Operator: fk="transaction_date >=", fv="2026-03-01" → ["transaction_date", ">=", "2026-03-01"]

    Keys/values that are None or empty are silently skipped.
    Returns a list of [field, op, value] triples (frappe.get_list accepts this format).
    """
    filters = []
    for key, val in ((fk1, fv1), (fk2, fv2), (fk3, fv3), (fk4, fv4)):
        if not key or val is None or val == "":
            continue
        key = str(key).strip()
        # Detect trailing operator: "transaction_date >=" → field="transaction_date", op=">="
        parts = key.rsplit(" ", 1)
        if len(parts) == 2 and parts[1].lower() in _FILTER_OPS:
            filters.append([parts[0], parts[1], val])
        else:
            filters.append([key, "=", val])
    return filters


# ── Child Table Data ─────────────────────────────────────────────────────────

@frappe.whitelist()
def get_child_data(doctype: str, requests: str, parent_names: str) -> dict:
	"""
	Fetch child table fields for a list of parent doc names and aggregate values
	as comma-joined strings.

	Args:
	    requests: JSON dict  {table_fieldname: [child_fieldname, ...]}
	    parent_names: JSON list of parent doc names

	Returns:
	    {parent_name: {"table_fn__child_fn": "val1, val2", ...}}

	Security: requires READ on the parent DocType and on each child DocType.
	Child field names are validated against live meta (SQL-injection safe).
	"""
	frappe.has_permission(doctype, "read", throw=True)

	reqs: dict = frappe.parse_json(requests) or {}
	names: list = frappe.parse_json(parent_names) or []

	if not reqs or not names:
		return {}

	parent_meta = frappe.get_meta(doctype)
	result: dict = {}

	for table_fn, child_fields in reqs.items():
		# Validate table fieldname exists on parent and is a Table type
		table_df = next(
			(
				df
				for df in parent_meta.fields
				if df.fieldname == table_fn and df.fieldtype in ("Table", "Table MultiSelect")
			),
			None,
		)
		if not table_df:
			continue

		child_doctype: str = table_df.options

		# Child tables (istable=1) inherit perms from parent; _check_doctype_permission
		# skips the check for them, so this is safe without a separate perm row.
		_check_doctype_permission(child_doctype, "read")

		# Validate requested child fields against live meta (prevents SQL injection)
		child_meta = frappe.get_meta(child_doctype)
		valid_child_fields = {df.fieldname for df in child_meta.fields}
		safe_fields = [f for f in child_fields if f in valid_child_fields]
		if not safe_fields:
			continue

		# Fetch all matching child rows in one query
		children = frappe.get_all(
			child_doctype,
			filters={"parent": ["in", names], "parentfield": table_fn},
			fields=["parent"] + safe_fields,
			order_by="idx asc",
			ignore_permissions=False,
			limit=0,
		)

		# Group by parent, collect values per field
		parent_buckets: dict = {}
		for child in children:
			p = child.parent
			if p not in parent_buckets:
				parent_buckets[p] = {f: [] for f in safe_fields}
			for f in safe_fields:
				val = child.get(f)
				if val is not None and val != "":
					parent_buckets[p][f].append(str(val))

		# Build composite keys and join values
		for p, fields_data in parent_buckets.items():
			if p not in result:
				result[p] = {}
			for f, values in fields_data.items():
				result[p][f"{table_fn}__{f}"] = ", ".join(values)

	return result


# ── V2.3 formula endpoints ────────────────────────────────────────────────────


@frappe.whitelist()
def frappe_get(doctype: str, name: str, fieldname: str) -> dict:
    """
    Fetch a single field value from one document.

    Three access patterns are supported:

    1. Plain field:
           FRAPPE_GET("Customer", "Tata Motors", "credit_limit")

    2. Link-field traversal (dot notation — walks Link hops):
           FRAPPE_GET("Sales Person", "Arjun Sharma", "employee.ctc")
           → reads Sales Person.employee (Link→Employee), then Employee.ctc

    3. Child-table row access (bracket notation):
           FRAPPE_GET("Sales Invoice", "SINV-0001", "items[1].amount")
           → returns the `amount` field of the 1st row in the items child table
           The row index is 1-based. Returns None if row does not exist.

    Returns:
        {"value": <field_value>}
    """
    import re
    frappe.has_permission(doctype, "read", throw=True)

    # ── Pattern 3: child table bracket notation — "items[2].rate" ────────────
    child_match = re.match(r"^(\w+)\[(\d+)\]\.(\w+)$", fieldname)
    if child_match:
        child_field     = child_match.group(1)
        row_idx         = int(child_match.group(2)) - 1   # 1-based → 0-based
        child_fieldname = child_match.group(3)

        meta = frappe.get_meta(doctype)
        df   = meta.get_field(child_field)
        if not df or df.fieldtype not in ("Table", "Table MultiSelect"):
            frappe.throw(_(f"'{child_field}' is not a Table field on {doctype}"))

        doc  = frappe.get_doc(doctype, name)
        rows = doc.get(child_field) or []
        if row_idx < 0 or row_idx >= len(rows):
            return {"value": None}
        return {"value": rows[row_idx].get(child_fieldname)}

    # ── Pattern 2: Link-field traversal — "employee.ctc" ─────────────────────
    if "." in fieldname:
        parts           = fieldname.split(".")
        current_doctype = doctype
        current_name    = name

        for part in parts[:-1]:   # all but last are link fields to traverse
            _validate_fieldname(current_doctype, part)
            meta = frappe.get_meta(current_doctype)
            df   = meta.get_field(part)
            if not df or df.fieldtype != "Link":
                frappe.throw(_(f"'{part}' is not a Link field on {current_doctype}"))
            current_name = frappe.db.get_value(current_doctype, current_name, part)
            if not current_name:
                return {"value": None}
            current_doctype = df.options
            frappe.has_permission(current_doctype, "read", throw=True)

        final_field = parts[-1]
        _validate_fieldname(current_doctype, final_field)
        return {"value": frappe.db.get_value(current_doctype, current_name, final_field)}

    # ── Pattern 1: plain field ────────────────────────────────────────────────
    _validate_fieldname(doctype, fieldname)
    return {"value": frappe.db.get_value(doctype, name, fieldname)}


@frappe.whitelist()
def bulk_set_value(doctype: str, updates: str) -> dict:
    """
    Update multiple existing records of the same DocType in one server round-trip.

    updates: JSON array of {name: str, fields: {fieldname: value, ...}}

    All writes run sequentially in a single transaction — no concurrent locks,
    no MySQL deadlocks. A single frappe.db.commit() at the end commits everything.
    Returns {"errors": [{"name": ..., "error": ...}, ...]} — empty list = all OK.
    """
    frappe.has_permission(doctype, "write", throw=True)

    updates_data: list[dict] = frappe.parse_json(updates)
    errors: list[dict] = []
    saved_names: list[str] = []

    for item in updates_data:
        name   = item.get("name")
        fields = item.get("fields") or {}
        if not name or not fields:
            continue
        try:
            frappe.db.set_value(doctype, name, fields)
            saved_names.append(name)
        except Exception as exc:
            errors.append({"name": name, "error": str(exc)})

    if saved_names:
        # Queue list_update events before commit so flush_realtime_log fires
        # with the commit below — same pattern as Document.notify_update().
        for name in saved_names:
            frappe.publish_realtime(
                "list_update",
                {"doctype": doctype, "name": name, "user": frappe.session.user},
                after_commit=True,
            )
        frappe.db.commit()

    return {"errors": errors}


@frappe.whitelist()
def bulk_create_records(doctype: str, rows: str) -> dict:
    """
    Create multiple new Frappe documents from a JSON array of field-value dicts.

    Args:
        doctype: Target DocType, e.g. "Customer"
        rows:    JSON string — [{fieldname: value, ...}, ...]
                 Empty-string values are skipped (treated as unset).

    Returns:
        {
            "created": [{"idx": 0, "name": "CUST-001"}, ...],
            "errors":  [{"idx": 1, "message": "Customer Name is required"}, ...]
        }

    Security: caller must have Create permission on the DocType.
    Each document is saved with the caller's permissions (no ignore_permissions).
    """
    frappe.has_permission(doctype, "create", throw=True)

    rows_data: list[dict] = frappe.parse_json(rows)
    created: list[dict]   = []
    errors:  list[dict]   = []

    for idx, row in enumerate(rows_data):
        try:
            doc = frappe.new_doc(doctype)
            for field, value in row.items():
                # Skip empty values — let Frappe apply its own defaults
                if value is not None and value != "":
                    doc.set(field, value)
            doc.insert()
            created.append({"idx": idx, "name": doc.name})
        except Exception as exc:
            errors.append({"idx": idx, "message": str(exc)})

    if created:
        frappe.db.commit()

    return {"created": created, "errors": errors}


@frappe.whitelist()
def batch_check_links(doctype: str, rows_json: str, link_fields_json: str) -> dict:
    """
    Check which linked values in the rows don't exist in their target DocTypes.

    Args:
        doctype:          Source DocType being imported into (for permission check).
        rows_json:        JSON array of {fieldname: value} dicts (already mapped).
        link_fields_json: JSON array of {fieldname, options} describing Link fields.

    Returns:
        {"missing": {fieldname: [val1, val2, ...]}}
        Only fieldnames with at least one missing value are included.
    """
    frappe.has_permission(doctype, "create", throw=True)

    rows: list[dict] = frappe.parse_json(rows_json)
    link_fields: list[dict] = frappe.parse_json(link_fields_json)

    missing: dict[str, list[str]] = {}

    for lf in link_fields:
        fn = lf.get("fieldname")
        options_dt = lf.get("options")
        if not fn or not options_dt:
            continue

        # Collect unique non-empty values from the rows
        values = list({str(r.get(fn, "")).strip() for r in rows if r.get(fn)})
        if not values:
            continue

        try:
            existing = {
                r["name"]
                for r in frappe.get_list(
                    options_dt,
                    filters=[["name", "in", values]],
                    fields=["name"],
                    limit=len(values) + 1,
                    ignore_permissions=False,
                )
            }
        except Exception:
            continue

        missing_vals = [v for v in values if v not in existing]
        if missing_vals:
            missing[fn] = missing_vals

    return {"missing": missing}


@frappe.whitelist()
def create_link_record(doctype: str, value: str) -> dict:
    """
    Create a minimal record in a Link DocType with the given name/value.
    Determines the correct primary field from meta.autoname.

    Returns {"name": created_doc_name, "doctype": doctype}
    """
    frappe.has_permission(doctype, "create", throw=True)

    meta = frappe.get_meta(doctype)
    doc  = frappe.new_doc(doctype)
    autoname = meta.autoname or ""

    if autoname.lower().startswith("field:"):
        # e.g. "field:item_code" → set that field
        primary_field = autoname.split(":", 1)[1].strip()
        doc.set(primary_field, value)
    elif autoname.lower() in ("prompt", "name"):
        doc.name = value
    else:
        # Fallback: set first required Data field that is empty
        for f in meta.fields:
            if f.reqd and f.fieldtype == "Data" and not doc.get(f.fieldname):
                doc.set(f.fieldname, value)
                break

    # Fill remaining required fields so insert() doesn't throw MandatoryError.
    # - Data/Text fields   → use `value` as a sensible default
    # - Link fields        → use first existing record in the linked doctype
    # - Select fields      → use first option in the options list
    for f in meta.fields:
        if not f.reqd or doc.get(f.fieldname):
            continue
        if f.fieldtype in ("Data", "Small Text", "Text", "Long Text"):
            doc.set(f.fieldname, value)
        elif f.fieldtype == "Link" and f.options:
            first_val = frappe.db.get_value(f.options, {}, "name")
            if first_val:
                doc.set(f.fieldname, first_val)
        elif f.fieldtype == "Select" and f.options:
            first_opt = (f.options or "").strip().split("\n")[0]
            if first_opt:
                doc.set(f.fieldname, first_opt)

    doc.insert(ignore_permissions=False)
    frappe.db.commit()
    return {"name": doc.name, "doctype": doctype}


@frappe.whitelist()
def frappe_child_get(
    parent_doctype: str,
    parent_name: str,
    child_field: str,
    row_index: int,
    fieldname: str,
) -> dict:
    """
    Fetch one field from a specific row of a child table.

    Args:
        parent_doctype: e.g. "Sales Invoice"
        parent_name:    e.g. "SINV-0001"
        child_field:    Table fieldname on the parent, e.g. "items"
        row_index:      1-based row number (1 = first row)
        fieldname:      field to read from that child row, e.g. "amount"

    Returns:
        {"value": <field_value>}   — None if row does not exist

    Example:
        FRAPPE_CHILD_GET("Sales Invoice", "SINV-0001", "items", 1, "amount")
        → grand total of the first line item
    """
    frappe.has_permission(parent_doctype, "read", throw=True)

    meta = frappe.get_meta(parent_doctype)
    df   = meta.get_field(child_field)
    if not df or df.fieldtype not in ("Table", "Table MultiSelect"):
        frappe.throw(_(f"'{child_field}' is not a Table field on {parent_doctype}"))

    row_idx = int(row_index) - 1   # 1-based → 0-based
    if row_idx < 0:
        frappe.throw(_("row_index must be ≥ 1"))

    doc  = frappe.get_doc(parent_doctype, parent_name)
    rows = doc.get(child_field) or []
    if row_idx >= len(rows):
        return {"value": None}

    return {"value": rows[row_idx].get(fieldname)}


@frappe.whitelist()
def frappe_aggregate(
    doctype: str,
    fieldname: str | None = None,
    aggr_type: str = "sum",
    fk1=None, fv1=None,
    fk2=None, fv2=None,
    fk3=None, fv3=None,
    fk4=None, fv4=None,
) -> dict:
    """
    Compute SUM, COUNT, or AVG over a DocType filtered by SUMIF-style pairs.

    Accepts up to four field/value filter pairs.  Operator-style keys are
    supported: ``"transaction_date >="`` → ["transaction_date", ">=", value].

    Returns:
        {"value": <number>}
    """
    frappe.has_permission(doctype, "read", throw=True)

    aggr_type = (aggr_type or "sum").lower()
    if aggr_type not in ("sum", "count", "avg", "max", "min"):
        frappe.throw(_("aggr_type must be 'sum', 'count', 'avg', 'max', or 'min'."))

    if aggr_type != "count" and not fieldname:
        frappe.throw(_("fieldname is required for sum/avg/max/min aggregates."))

    if aggr_type != "count" and fieldname:
        _validate_fieldname(doctype, fieldname)

    filters = _parse_filter_pairs(fk1, fv1, fk2, fv2, fk3, fv3, fk4, fv4)

    if aggr_type == "count":
        return {"value": frappe.db.count(doctype, filters)}

    rows = frappe.get_list(
        doctype,
        filters=filters,
        fields=[fieldname],
        limit=_AGGREGATE_ROW_CAP,
        ignore_permissions=False,
    )

    raw_vals = [r[fieldname] for r in rows if r.get(fieldname) is not None]

    if not raw_vals:
        return {"value": 0 if aggr_type in ("sum", "avg") else ""}

    # max/min work on strings (ISO dates sort lexicographically) — no float cast
    if aggr_type == "max":
        return {"value": max(raw_vals)}
    if aggr_type == "min":
        return {"value": min(raw_vals)}

    vals = [float(v) for v in raw_vals]

    if aggr_type == "sum":
        return {"value": sum(vals)}

    return {"value": sum(vals) / len(vals)}


_AGG_BATCH_TTL = 30  # seconds — formula cells feel live; Redis not hammered on every keystroke


def _agg_batch_cache_key(raw: str) -> str:
	"""Stable Redis key: user + MD5 of the raw JSON queries string."""
	import hashlib
	digest = hashlib.md5(raw.encode(), usedforsecurity=False).hexdigest()
	return f"ev_agg_batch:{frappe.session.user}:{digest}"


def _invalidate_agg_cache_for_doctype(doc, method=None) -> None:
	"""
	Purge all cached batch aggregate results.

	Called as a Frappe document hook (after_insert / on_update / on_cancel /
	on_trash) whenever any document is saved so formula cells referencing the
	changed doctype are recomputed on the next grid load rather than returning
	stale Redis-cached values.

	Frappe's Redis cache key space is small (only cached values, not session/
	queue data) so the prefix scan is fast in practice.
	"""
	frappe.cache().delete_keys("ev_agg_batch:*")


@frappe.whitelist()
def frappe_aggregate_batch(queries: str) -> dict:
	"""
	Batch endpoint for FRAPPE_SUM / COUNT / AVG / MAX / MIN / GET formula functions.

	Receives a JSON array of aggregate query descriptors and returns results in
	the same order.  Queries that share the same (aggr_type, doctype, fieldname,
	fk1 key, static tail-filters fk2-fk4) are merged into a single SQL
	``WHERE fk1 IN (...) GROUP BY fk1`` — converting N DB round-trips into 1.

	Results are cached in Frappe's Redis layer for _AGG_BATCH_TTL seconds.
	Cache is automatically invalidated when any document is saved (see hooks).

	Returns:
	    {"results": [value, ...]}   — parallel to the input *queries* array.
	"""
	raw: str = queries if isinstance(queries, str) else frappe.as_json(queries)
	qs: list = frappe.parse_json(raw) if isinstance(queries, str) else (queries or [])
	if not qs:
		return {"results": []}

	# ── Redis cache check ────────────────────────────────────────────────────
	import time as _time
	t0 = _time.monotonic()
	cache_key = _agg_batch_cache_key(raw)
	cached = frappe.cache().get_value(cache_key)
	if cached is not None:
		cached["_cache"] = "hit"
		return cached

	results: list = [None] * len(qs)

	# ── Group queries for IN-query optimisation ─────────────────────────────
	# Group key: (aggr_type, doctype, fieldname, fk1 [simple field — no operator],
	#             fk2+fv2, fk3+fv3, fk4+fv4 static filters)
	# Only fv1 varies within a group — each row has a different FK value.
	groups: dict = {}   # group_key → [(index, fv1), ...]
	solo:   list = []   # [(index, query_dict), ...] — cannot be batched

	for i, q in enumerate(qs):
		aggr_type = (q.get("aggr_type") or "sum").lower()
		doctype   = str(q.get("doctype") or "")
		fieldname = str(q.get("fieldname") or "name")
		fk1 = str(q.get("fk1") or "")
		fv1 = q.get("fv1")
		fk2 = str(q.get("fk2") or "")
		fv2 = q.get("fv2")
		fk3 = str(q.get("fk3") or "")
		fv3 = q.get("fv3")
		fk4 = str(q.get("fk4") or "")
		fv4 = q.get("fv4")

		# Batch only when fk1 is a plain field name (no trailing operator like ">="
		# or "!=") and fv1 is a non-empty scalar.
		can_group = bool(
			fk1
			and fv1 is not None
			and fv1 != ""
			and " " not in fk1.strip()
		)

		if can_group:
			gk = (
				aggr_type, doctype, fieldname, fk1,
				fk2, str(fv2) if fv2 is not None else "",
				fk3, str(fv3) if fv3 is not None else "",
				fk4, str(fv4) if fv4 is not None else "",
			)
			groups.setdefault(gk, []).append((i, fv1))
		else:
			solo.append((i, q))

	# ── Execute groups (IN-query) ────────────────────────────────────────────
	for gk, items in groups.items():
		aggr_type, doctype, fieldname, fk1, fk2, fv2s, fk3, fv3s, fk4, fv4s = gk

		# Permission check (once per group)
		try:
			frappe.has_permission(doctype, "read", throw=True)
		except frappe.PermissionError:
			for idx, _ in items:
				results[idx] = "#PERM_DENIED"
			continue

		# Validate field names before embedding in SQL.
		# frappe.throw() raises frappe.ValidationError (a subclass of Exception),
		# NOT DoesNotExistError — catch the base Exception to be safe.
		try:
			if aggr_type not in ("count", "get"):
				_validate_fieldname(doctype, fieldname)
			if aggr_type != "get":
				_validate_fieldname(doctype, fk1)
			else:
				# "get" uses fk1="name" which is always a valid system field
				_validate_fieldname(doctype, fieldname)
		except Exception:
			for idx, _ in items:
				results[idx] = "#ARG!"
			continue

		# ── "get" path: SELECT name, fieldname FROM tab WHERE name IN (...) ──
		if aggr_type == "get":
			try:
				placeholders = ", ".join(["%s"] * len(unique_vals))
				sql = (
					f"SELECT `name`, `{fieldname}`"
					f" FROM `tab{doctype}`"
					f" WHERE `name` IN ({placeholders})"
				)
				rows    = frappe.db.sql(sql, unique_vals, as_dict=False)
				agg_map = {str(r[0]): r[1] for r in rows}
			except Exception:
				for idx, fv1 in items:
					solo.append((idx, {"aggr_type": "get", "doctype": doctype,
					                   "fieldname": fieldname, "fk1": "name", "fv1": fv1}))
				continue
			for fv1_str, idxs in fv1_to_idxs.items():
				val = agg_map.get(fv1_str, "")
				for idx in idxs:
					results[idx] = val
			continue

		# Map fv1 → [indices] (handles duplicate FK values across rows)
		fv1_to_idxs: dict = {}
		for idx, fv1 in items:
			fv1_to_idxs.setdefault(str(fv1), []).append(idx)
		unique_vals = list(fv1_to_idxs.keys())

		if len(unique_vals) == 1:
			# Single distinct value — delegate to the existing scalar endpoint
			res = frappe_aggregate(
				doctype=doctype, fieldname=fieldname, aggr_type=aggr_type,
				fk1=fk1, fv1=unique_vals[0],
				fk2=fk2 or None, fv2=fv2s or None,
				fk3=fk3 or None, fv3=fv3s or None,
				fk4=fk4 or None, fv4=fv4s or None,
			)
			val = res.get("value", 0)
			for idx in fv1_to_idxs[unique_vals[0]]:
				results[idx] = val
			continue

		# Build IN-query SQL (fk1 and fieldname already validated — safe as identifiers)
		table   = f"`tab{doctype}`"
		fk1_col = f"`{fk1}`"

		if aggr_type == "sum":
			agg_expr = f"SUM(`{fieldname}`)"
			default  = 0
		elif aggr_type == "avg":
			agg_expr = f"AVG(`{fieldname}`)"
			default  = 0
		elif aggr_type == "max":
			agg_expr = f"MAX(`{fieldname}`)"
			default  = ""
		elif aggr_type == "min":
			agg_expr = f"MIN(`{fieldname}`)"
			default  = ""
		else:  # count
			agg_expr = "COUNT(*)"
			default  = 0

		# Static tail-filters (fk2-fk4).
		# Supports operator-style keys like "transaction_date >=" — split off the
		# operator before validating the fieldname and before embedding in SQL.
		extra_sql    = ""
		extra_params: list = []
		for fk, fv in ((fk2, fv2s), (fk3, fv3s), (fk4, fv4s)):
			if not fk or not fv:
				continue
			parts = fk.rsplit(" ", 1)
			if len(parts) == 2 and parts[1].lower() in _FILTER_OPS:
				field, op = parts[0].strip(), parts[1].strip()
			else:
				field, op = fk.strip(), "="
			try:
				_validate_fieldname(doctype, field)
			except Exception:
				continue
			extra_sql    += f" AND `{field}` {op} %s"
			extra_params.append(fv)

		placeholders = ", ".join(["%s"] * len(unique_vals))
		sql = (
			f"SELECT {fk1_col}, {agg_expr}"
			f" FROM {table}"
			f" WHERE {fk1_col} IN ({placeholders}){extra_sql}"
			f" GROUP BY {fk1_col}"
		)
		params = unique_vals + extra_params

		try:
			rows    = frappe.db.sql(sql, params, as_dict=False)
			agg_map = {str(r[0]): r[1] for r in rows}
		except Exception:
			# SQL failure — fall back to individual scalar calls for this group
			for idx, q in [(idx, {"aggr_type": aggr_type, "doctype": doctype,
			                       "fieldname": fieldname, "fk1": fk1, "fv1": fv1,
			                       "fk2": fk2 or None, "fv2": fv2s or None,
			                       "fk3": fk3 or None, "fv3": fv3s or None,
			                       "fk4": fk4 or None, "fv4": fv4s or None})
			               for idx, fv1 in items]:
				solo.append((idx, q))
			continue

		for fv1_str, idxs in fv1_to_idxs.items():
			val = agg_map.get(fv1_str, default)
			for idx in idxs:
				results[idx] = val

	# ── Execute solo queries (ungroupable — operator filters, empty fv1, etc.) ─
	# (also receives "get" fallbacks pushed here by the group section)
	for idx, q in solo:
		try:
			aggr_type_s = (q.get("aggr_type") or "sum").lower()
			if aggr_type_s == "get":
				# Single FRAPPE_GET fallback — use frappe.get_value
				val = frappe.get_value(
					q.get("doctype", ""),
					q.get("fv1"),          # the document name
					q.get("fieldname") or "name",
				)
				results[idx] = val if val is not None else ""
			else:
				res = frappe_aggregate(
					doctype   = q.get("doctype", ""),
					fieldname = q.get("fieldname") or "name",
					aggr_type = aggr_type_s,
					fk1=q.get("fk1"), fv1=q.get("fv1"),
					fk2=q.get("fk2"), fv2=q.get("fv2"),
					fk3=q.get("fk3"), fv3=q.get("fv3"),
					fk4=q.get("fk4"), fv4=q.get("fv4"),
				)
				results[idx] = res.get("value", 0)
		except Exception:
			results[idx] = "#ERR!"

	# ── Cache and return ─────────────────────────────────────────────────────
	elapsed_ms = round((_time.monotonic() - t0) * 1000)
	out = {"results": results, "_cache": "miss", "_ms": elapsed_ms}
	frappe.cache().set_value(cache_key, out, expires_in_sec=_AGG_BATCH_TTL)
	return out


# ── Dashboard formula-column card aggregate ────────────────────────────────────


@frappe.whitelist()
def compute_card_aggregate(
    doctype: str,
    formula: str,
    col_fieldnames: str,
    filter_op: str,
    filter_val: str,
    aggregate: str,
    agg_fieldname: str | None = None,
    list_filters: str | None = None,
    extra_filters: str | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
) -> dict:
    """
    Server-side number card computation for formula columns (⚡).

    Fetches ALL rows for the DocType (no page-limit cap), evaluates the
    HyperFormula template formula for every row, applies the card filter and
    any extra plain-field filters, then returns the requested aggregate.

    Parameters
    ----------
    doctype         : Source DocType (the sheet's doctype)
    formula         : HyperFormula formula template, e.g.
                      ``=IF(FRAPPE_COUNT("Sales Order","customer",A1)>0,"Active","Inactive")``
    col_fieldnames  : JSON array of fieldnames in column order (A→[0], B→[1], …)
    filter_op       : Operator on the formula result: ``=``, ``!=``, ``contains``,
                      ``>``, ``<``, ``>=``, ``<=``
    filter_val      : Value to compare the formula result against
    aggregate       : ``count`` | ``sum`` | ``avg`` | ``min`` | ``max``
    agg_fieldname   : DB fieldname for sum/avg/min/max (ignored for count)
    list_filters    : JSON array of Frappe filter tuples (current sheet filters)
    extra_filters   : JSON array of ``{col, op, val}`` dicts for non-formula
                      card filters applied after formula evaluation
    """
    import json

    _check_doctype_permission(doctype)

    col_fields: list = json.loads(col_fieldnames) if isinstance(col_fieldnames, str) else (col_fieldnames or [])
    lst_filters: list = json.loads(list_filters) if isinstance(list_filters, str) and list_filters else []
    extra: list = json.loads(extra_filters) if isinstance(extra_filters, str) and extra_filters else []

    # agg_fieldname may be a formula/virtual col key (starts with _) — never a real DB field
    agg_field = (agg_fieldname or "").strip() or None
    if agg_field and agg_field.startswith("_"):
        agg_field = None

    # Substitute PERIOD_START() / PERIOD_END() placeholders with actual dates
    # (the client resolves these via formula_manager; pass them down so the server
    # can build correct SQL filters for formulas like FRAPPE_COUNT(...,PERIOD_START(),...))
    if period_start or period_end:
        formula = formula.replace("PERIOD_START()", f'"{period_start or ""}"')
        formula = formula.replace("PERIOD_END()",   f'"{period_end   or ""}"')

    # ── Determine which DB fields we need ────────────────────────────────
    import re

    fetch_fields: set = {"name"}
    for ref in re.findall(r'([A-Z]+)1\b', formula, re.IGNORECASE):
        idx = _col_letter_to_index(ref.upper())
        if idx < len(col_fields):
            fetch_fields.add(col_fields[idx])
    # agg_field is None if it was a virtual/formula col — skip it
    if agg_field:
        fetch_fields.add(agg_field)
    for ef in extra:
        col = (ef.get("col") or "").strip()
        if col and not col.startswith("_"):
            fetch_fields.add(col)

    # ── Strategy 1: SQL-first (no row fetching) ───────────────────────────
    # Parses the formula into a subquery + COUNT — 2 DB queries, zero memory.
    sql_result = _try_sql_formula_compute(
        doctype, formula, col_fields,
        filter_op, str(filter_val), aggregate, agg_field,
        lst_filters, extra,
    )
    if sql_result is not None:
        return {"value": sql_result}

    # ── Strategy 2: Row-fetch fallback (unparseable formulas) ─────────────
    # Hard cap: 50 000 rows.  Warns if data was truncated.
    _ROW_CAP = 50_000
    rows = frappe.get_all(
        doctype,
        fields=list(fetch_fields),
        filters=lst_filters,
        limit=_ROW_CAP + 1,
    )
    truncated = len(rows) > _ROW_CAP
    if truncated:
        rows = rows[:_ROW_CAP]

    # ── Evaluate HyperFormula template for every row → row["_val"] ───────
    _eval_formula_bulk(formula, rows, col_fields)

    # ── Apply formula column filter ───────────────────────────────────────
    rows = [r for r in rows if _card_match(str(r.get("_val", "")), filter_op, str(filter_val))]

    # ── Apply any extra plain-field card filters ──────────────────────────
    for ef in extra:
        col, op, val = (ef.get("col") or ""), (ef.get("op") or "="), str(ef.get("val") or "")
        if not col or col.startswith("_"):
            continue
        rows = [r for r in rows if _card_match(str(r.get(col, "") or ""), op, val)]

    # ── Compute aggregate ─────────────────────────────────────────────────
    if aggregate == "count":
        result = len(rows)
        return {"value": result, "truncated": truncated}

    if not agg_field:
        return {"value": len(rows), "truncated": truncated}

    nums = []
    for r in rows:
        try:
            nums.append(float(r.get(agg_field) or 0))
        except (TypeError, ValueError):
            pass

    if not nums:
        return {"value": 0}

    if aggregate == "sum":
        return {"value": round(sum(nums), 2), "truncated": truncated}
    if aggregate == "avg":
        return {"value": round(sum(nums) / len(nums), 2), "truncated": truncated}
    if aggregate == "min":
        return {"value": round(min(nums), 2), "truncated": truncated}
    if aggregate == "max":
        return {"value": round(max(nums), 2), "truncated": truncated}
    return {"value": len(rows), "truncated": truncated}


# ── SQL-first formula compute ──────────────────────────────────────────────────


def _try_sql_formula_compute(
    doctype, formula, col_fields,
    filter_op, filter_val, aggregate, agg_field,
    lst_filters, extra_filters,
):
    """
    Push formula-column card computation entirely into SQL — zero row fetching.

    Supports (any combination):
      =IF(FRAPPE_COUNT("DT", [fk,fv …], A1, …)  op  N,   "t", "f")
      =IF(FRAPPE_SUM  ("DT","sum_field",[fk,fv …],A1,…) op N, "t","f")
      =IF(FRAPPE_AVG  (…)  op N, "t", "f")
      =IF(FRAPPE_GET  ("DT", A1, "field") op "val", "t", "f")
      =IF(A1 op "val", "t", "f")          ← direct column comparison
      =IF(A1 op "val", "t", "f")  with filter_op "!=" / "contains" / …

    Also handles filter_op other than "=" by inverting the want_true logic.

    Returns the computed value (int/float) or None (caller falls back to row-fetch).
    """
    import re

    expr = formula.strip().lstrip("=").strip()

    # ── Require IF(condition, true_val, false_val) ────────────────────────
    parsed = _parse_if_expr(expr)
    if not parsed:
        return None
    cond_str, true_val, false_val = parsed

    # Determine which branch the card filter selects
    filter_val_s = str(filter_val).strip()
    true_val_s   = str(true_val).strip()
    false_val_s  = str(false_val).strip()

    if filter_op == "=":
        if   filter_val_s == true_val_s:  want_true = True
        elif filter_val_s == false_val_s: want_true = False
        else: return None
    elif filter_op == "!=":
        if   filter_val_s == true_val_s:  want_true = False
        elif filter_val_s == false_val_s: want_true = True
        else: return None
    else:
        # contains / numeric ops on formula strings — can't push to SQL
        return None

    # Collect plain (non-formula) extra card filters
    plain_extra = [
        [ef["col"], ef.get("op", "="), ef.get("val", "")]
        for ef in extra_filters
        if (ef.get("col") or "").strip() and not ef["col"].startswith("_")
    ]

    # ── Dispatch by condition type ────────────────────────────────────────
    return _sql_dispatch_condition(
        cond_str, want_true,
        doctype, col_fields, aggregate, agg_field,
        lst_filters, plain_extra,
    )


def _sql_dispatch_condition(cond_str, want_true, doctype, col_fields,
                             aggregate, agg_field, lst_filters, plain_extra):
    """Route a parsed IF-condition to the right SQL handler."""
    import re

    # ── FRAPPE_COUNT / FRAPPE_SUM / FRAPPE_AVG (...) op N ─────────────────
    m_agg = re.match(
        r'^(FRAPPE_COUNT|FRAPPE_SUM|FRAPPE_AVG)\s*\((.+)\)\s*([><=!]+|<>)\s*(.+)$',
        cond_str, re.I | re.S,
    )
    if m_agg:
        func    = m_agg.group(1).upper()
        args    = _parse_formula_args(m_agg.group(2))
        comp_op = m_agg.group(3).replace("<>", "!=")
        try:
            threshold = float(m_agg.group(4).strip().strip('"'))
        except (ValueError, TypeError):
            return None
        return _sql_frappe_numeric_func(
            func, args, comp_op, threshold, want_true,
            doctype, col_fields, aggregate, agg_field, lst_filters, plain_extra,
        )

    # ── FRAPPE_GET("DT", A1, "field") op "val" ────────────────────────────
    m_get = re.match(
        r'^FRAPPE_GET\s*\((.+)\)\s*([><=!]+|<>)\s*(.+)$',
        cond_str, re.I | re.S,
    )
    if m_get:
        args    = _parse_formula_args(m_get.group(1))
        comp_op = m_get.group(2).replace("<>", "!=")
        val     = _strip_formula_quotes(m_get.group(3).strip())
        return _sql_frappe_get(
            args, comp_op, val, want_true,
            doctype, col_fields, aggregate, agg_field, lst_filters, plain_extra,
        )

    # ── A1 op "val" — direct column comparison ────────────────────────────
    m_col = re.match(r'^([A-Z]+)1\s*([><=!]+|<>)\s*(.+)$', cond_str, re.I)
    if m_col:
        idx       = _col_letter_to_index(m_col.group(1).upper())
        row_field = col_fields[idx] if idx < len(col_fields) else "name"
        comp_op   = m_col.group(2).replace("<>", "!=")
        val       = _strip_formula_quotes(m_col.group(3).strip())
        neg_op    = {"=":"!=","!=":"=",">":"<=","<":">=",">=":"<","<=":">"}
        op        = comp_op if want_true else neg_op.get(comp_op, "!=")
        try:
            return _count_or_agg(
                doctype,
                lst_filters + plain_extra + [[row_field, op, val]],
                aggregate, agg_field,
            )
        except Exception:
            return None

    return None


def _sql_frappe_numeric_func(func, args, comp_op, threshold, want_true,
                              doctype, col_fields, aggregate, agg_field,
                              lst_filters, plain_extra):
    """
    Handle IF(FRAPPE_COUNT/SUM/AVG(…) op N, t, f).
    Builds a GROUP BY query on the link DocType, resolves passing keys,
    then counts/aggregates on the base DocType with IN / NOT IN.
    """
    if not args:
        return None

    link_doctype = _strip_formula_quotes(args[0])
    if not link_doctype:
        return None

    sum_field, arg_start = None, 1
    if func in ("FRAPPE_SUM", "FRAPPE_AVG"):
        if len(args) < 2:
            return None
        sum_field = _strip_formula_quotes(args[1])
        arg_start = 2

    # Parse fk/fv pairs — exactly one must be a dynamic cell reference (A1)
    static_link_filters: list = []
    dynamic_pair = None

    i = arg_start
    while i + 1 < len(args):
        fk     = _strip_formula_quotes(args[i])
        fv_raw = args[i + 1].strip()

        col_ref = _try_col_ref(fv_raw)
        if col_ref is not None:
            if dynamic_pair is not None:
                return None  # multiple dynamic cols — can't vectorise
            rf = col_fields[col_ref] if col_ref < len(col_fields) else "name"
            dynamic_pair = (fk, rf)
        else:
            # Operator may be embedded in fk: "transaction_date >="
            import re
            fk_m = re.match(r'^(.+?)\s+(>=|<=|!=|<>|>|<|=|like)\s*$', fk, re.I)
            if fk_m:
                static_link_filters.append(
                    [fk_m.group(1).strip(), fk_m.group(2).strip(), _strip_formula_quotes(fv_raw)]
                )
            else:
                static_link_filters.append([fk, "=", _strip_formula_quotes(fv_raw)])
        i += 2

    if dynamic_pair is None:
        return None

    link_field, row_field = dynamic_pair

    # ── Query 1: GROUP BY → per-key numeric value ─────────────────────────
    try:
        if func == "FRAPPE_COUNT":
            rows = frappe.db.get_all(
                link_doctype,
                fields=[link_field, "count(*) as _v"],
                filters=static_link_filters,
                group_by=link_field,
            )
            val_map = {str(r.get(link_field, "")): (r.get("_v") or 0) for r in rows}

        elif func == "FRAPPE_SUM" and sum_field:
            rows = frappe.db.get_all(
                link_doctype,
                fields=[link_field, f"sum({sum_field}) as _v"],
                filters=static_link_filters,
                group_by=link_field,
            )
            val_map = {str(r.get(link_field, "")): float(r.get("_v") or 0) for r in rows}

        elif func == "FRAPPE_AVG" and sum_field:
            rows = frappe.db.get_all(
                link_doctype,
                fields=[link_field, f"sum({sum_field}) as _s", "count(*) as _c"],
                filters=static_link_filters,
                group_by=link_field,
            )
            val_map = {
                str(r.get(link_field, "")): float(r.get("_s") or 0) / max(int(r.get("_c") or 1), 1)
                for r in rows
            }
        else:
            return None
    except Exception:
        return None

    # ── Classify keys: passing / failing / absent ─────────────────────────
    passing_keys = {k for k, v in val_map.items() if _num_compare(v, comp_op, threshold)}
    failing_keys = {k for k in val_map if k not in passing_keys}
    zero_passes  = _num_compare(0, comp_op, threshold)

    return _sql_apply_in_not_in(
        doctype, row_field, passing_keys, failing_keys, zero_passes,
        want_true, lst_filters, plain_extra, aggregate, agg_field,
    )


def _sql_frappe_get(args, comp_op, val, want_true,
                    doctype, col_fields, aggregate, agg_field,
                    lst_filters, plain_extra):
    """
    Handle IF(FRAPPE_GET("link_dt", A1, "field") op "val", t, f).
    Fetches matching names from link_dt, then IN/NOT IN on base doctype.
    """
    if len(args) < 3:
        return None

    link_doctype  = _strip_formula_quotes(args[0])
    fv_raw        = args[1].strip()
    target_field  = _strip_formula_quotes(args[2])

    col_ref = _try_col_ref(fv_raw)
    if col_ref is None:
        return None
    row_field = col_fields[col_ref] if col_ref < len(col_fields) else "name"

    # Query 1: find link_dt records where target_field op val
    try:
        matching = frappe.get_all(
            link_doctype,
            fields=["name"],
            filters=[[target_field, comp_op, val]],
            limit=0,
        )
        matching_names = {str(r["name"]) for r in matching}
    except Exception:
        return None

    passing_keys = matching_names
    failing_keys: set = set()  # we only know names of matching; non-matching = absence
    zero_passes  = not want_true  # rows absent from link_dt → comp_op might not apply

    # For FRAPPE_GET: absent rows have no value → treat as "no match" (False branch)
    # zero_passes = False (absent = no match)
    return _sql_apply_in_not_in(
        doctype, row_field, passing_keys, failing_keys, False,
        want_true, lst_filters, plain_extra, aggregate, agg_field,
    )


def _sql_apply_in_not_in(doctype, row_field, passing_keys, failing_keys, zero_passes,
                          want_true, lst_filters, plain_extra, aggregate, agg_field):
    """
    Build final base-DocType filters from passing/failing key sets and run aggregate.

    zero_passes = True  means rows ABSENT from the link table also satisfy the condition.
    want_true   = True  means we want rows where condition is True.
    """
    base = lst_filters + plain_extra

    try:
        if want_true:
            if zero_passes:
                # True = passing_keys ∪ (all rows not in val_map)
                # Equivalent: exclude failing_keys
                if failing_keys:
                    return _count_or_agg(doctype, base + [[row_field, "not in", list(failing_keys)]], aggregate, agg_field)
                else:
                    return _count_or_agg(doctype, base, aggregate, agg_field)
            else:
                # True = only passing_keys
                if not passing_keys:
                    return 0
                return _count_or_agg(doctype, base + [[row_field, "in", list(passing_keys)]], aggregate, agg_field)
        else:
            if zero_passes:
                # False = rows in val_map that don't pass = failing_keys
                if not failing_keys:
                    return 0
                return _count_or_agg(doctype, base + [[row_field, "in", list(failing_keys)]], aggregate, agg_field)
            else:
                # False = failing_keys ∪ (rows absent from val_map)
                # = total − passing_keys
                total = frappe.db.count(doctype, filters=base)
                if not passing_keys:
                    return total
                passing_count = frappe.db.count(doctype, filters=base + [[row_field, "in", list(passing_keys)]])
                return total - passing_count
    except Exception:
        return None


def _count_or_agg(doctype, filters, aggregate, agg_field):
    """Run COUNT or numeric aggregate on doctype with given filters."""
    if aggregate == "count" or not agg_field:
        return frappe.db.count(doctype, filters=filters)
    matched = frappe.get_all(doctype, fields=[agg_field], filters=filters, limit=0)
    nums = [float(r.get(agg_field) or 0) for r in matched if r.get(agg_field) is not None]
    if not nums:
        return 0
    if aggregate == "sum": return round(sum(nums), 2)
    if aggregate == "avg": return round(sum(nums) / len(nums), 2)
    if aggregate == "min": return round(min(nums), 2)
    if aggregate == "max": return round(max(nums), 2)
    return len(nums)


# ── compute_card_aggregate helpers ────────────────────────────────────────────


def _col_letter_to_index(letters: str) -> int:
    """'A' → 0, 'B' → 1, 'Z' → 25, 'AA' → 26"""
    result = 0
    for c in letters.upper():
        result = result * 26 + (ord(c) - ord("A") + 1)
    return result - 1


def _card_match(cell: str, op: str, val: str) -> bool:
    cell, val = cell.strip(), val.strip()
    if op == "=":        return cell == val
    if op == "!=":       return cell != val
    if op == "contains": return val.lower() in cell.lower()
    try:
        c, v = float(cell), float(val)
        if op == ">":  return c > v
        if op == "<":  return c < v
        if op == ">=": return c >= v
        if op == "<=": return c <= v
    except (ValueError, TypeError):
        pass
    return False


def _eval_formula_bulk(formula: str, rows: list, col_fields: list) -> None:
    """
    Evaluate a HyperFormula formula template for every row.
    Sets row["_val"] in-place.

    Supports nested IFs of arbitrary depth, FRAPPE_FUNC comparisons on
    both sides of a condition, and bare FRAPPE_FUNC / column references.
    """
    import re

    expr = formula.strip()
    if expr.startswith("="):
        expr = expr[1:].strip()

    # ── IF(condition, true_val, false_val) — handles nested IFs recursively
    parsed_if = _parse_if_expr(expr)
    if parsed_if:
        cond_str, true_val_str, false_val_str = parsed_if
        conds = _eval_condition_bulk(cond_str, rows, col_fields)
        true_rows  = [row for row, c in zip(rows, conds) if c]
        false_rows = [row for row, c in zip(rows, conds) if not c]
        if true_rows:
            _eval_branch_value(true_val_str, true_rows, col_fields)
        if false_rows:
            _eval_branch_value(false_val_str, false_rows, col_fields)
        return

    # ── Bare FRAPPE_* returning a number ─────────────────────────────────
    m = re.match(r'^(FRAPPE_COUNT|FRAPPE_SUM|FRAPPE_AVG|FRAPPE_GET)\s*\((.+)\)$', expr, re.I | re.S)
    if m:
        func, args_str = m.group(1).upper(), m.group(2)
        nums = _frappe_func_bulk(func, _parse_formula_args(args_str), rows, col_fields)
        for row, v in zip(rows, nums):
            row["_val"] = v
        return

    # ── Bare column reference A1 ─────────────────────────────────────────
    col_m = re.match(r'^([A-Z]+)1$', expr, re.I)
    if col_m:
        idx = _col_letter_to_index(col_m.group(1).upper())
        field = col_fields[idx] if idx < len(col_fields) else "name"
        for row in rows:
            row["_val"] = str(row.get(field, "") or "")
        return

    # ── Fallback ─────────────────────────────────────────────────────────
    for row in rows:
        row["_val"] = ""


def _eval_branch_value(val_str: str, rows: list, col_fields: list) -> None:
    """
    Evaluate one branch of an IF expression (may be a literal, nested IF,
    or FRAPPE_FUNC call) and set row["_val"] for each row in the subset.
    """
    import re

    val_str = val_str.strip()

    # Nested IF — recurse
    if re.match(r'^IF\s*\(', val_str, re.I):
        _eval_formula_bulk("=" + val_str, rows, col_fields)
        return

    # FRAPPE_FUNC returning a value
    fm = re.match(r'^(FRAPPE_COUNT|FRAPPE_SUM|FRAPPE_AVG|FRAPPE_GET)\s*\((.+)\)$', val_str, re.I | re.S)
    if fm:
        func = fm.group(1).upper()
        args = _parse_formula_args(fm.group(2))
        nums = _frappe_func_bulk(func, args, rows, col_fields)
        for row, v in zip(rows, nums):
            row["_val"] = v
        return

    # Literal string / number
    literal = _strip_formula_quotes(val_str)
    for row in rows:
        row["_val"] = literal


def _parse_if_expr(expr: str):
    """
    Parse ``IF(cond, true, false)`` → (cond_str, true_val, false_val) or None.
    """
    import re
    if not re.match(r'^IF\s*\(', expr, re.I):
        return None
    # Strip leading "IF("
    inner = re.sub(r'^IF\s*\(\s*', "", expr, flags=re.I)
    # Remove trailing ")"
    if inner.endswith(")"):
        inner = inner[:-1]
    parts = _parse_formula_args(inner)
    if len(parts) < 3:
        return None
    return (
        parts[0].strip(),
        _strip_formula_quotes(parts[1].strip()),
        _strip_formula_quotes(parts[2].strip()),
    )


def _eval_condition_bulk(cond_str: str, rows: list, col_fields: list) -> list:
    """Evaluate a condition string for all rows, returning list[bool]."""
    import re

    # FRAPPE_FUNC(...) op threshold
    fm = re.match(
        r'^(FRAPPE_COUNT|FRAPPE_SUM|FRAPPE_AVG|FRAPPE_GET)\s*\((.+)\)\s*([><=!]+|<>)\s*(.+)$',
        cond_str, re.I | re.S,
    )
    if fm:
        func = fm.group(1).upper()
        args = _parse_formula_args(fm.group(2))
        op   = fm.group(3).replace("<>", "!=")
        rhs  = fm.group(4).strip()
        lhs_nums = _frappe_func_bulk(func, args, rows, col_fields)

        # RHS may be another FRAPPE_FUNC (e.g. FRAPPE_SUM(...) >= FRAPPE_SUM(...))
        rhs_fm = re.match(
            r'^(FRAPPE_COUNT|FRAPPE_SUM|FRAPPE_AVG|FRAPPE_GET)\s*\((.+)\)$',
            rhs, re.I | re.S,
        )
        if rhs_fm:
            rhs_func = rhs_fm.group(1).upper()
            rhs_args = _parse_formula_args(rhs_fm.group(2))
            rhs_nums = _frappe_func_bulk(rhs_func, rhs_args, rows, col_fields)
            return [_num_compare(l, op, r) for l, r in zip(lhs_nums, rhs_nums)]

        try:
            threshold = float(rhs.strip('"'))
        except (ValueError, TypeError):
            threshold = 0.0
        return [_num_compare(v, op, threshold) for v in lhs_nums]

    # Column reference op literal  (A1 = "value")
    cm = re.match(r'^([A-Z]+)1\s*([><=!]+|<>)\s*(.+)$', cond_str, re.I)
    if cm:
        idx = _col_letter_to_index(cm.group(1).upper())
        field = col_fields[idx] if idx < len(col_fields) else "name"
        op  = cm.group(2).replace("<>", "!=")
        val = _strip_formula_quotes(cm.group(3).strip())
        return [_card_match(str(r.get(field, "") or ""), op, val) for r in rows]

    return [True] * len(rows)


def _frappe_func_bulk(func: str, args: list, rows: list, col_fields: list) -> list:
    """
    Evaluate FRAPPE_COUNT / FRAPPE_SUM / FRAPPE_AVG for all rows at once
    using a single GROUP BY query when possible.
    """
    import re

    if not args:
        return [0] * len(rows)

    link_doctype = _strip_formula_quotes(args[0])
    if not link_doctype:
        return [0] * len(rows)

    # FRAPPE_SUM / FRAPPE_AVG: 2nd arg is the sum field
    sum_field = None
    arg_start = 1
    if func in ("FRAPPE_SUM", "FRAPPE_AVG"):
        if len(args) < 2:
            return [0] * len(rows)
        sum_field = _strip_formula_quotes(args[1])
        arg_start = 2

    # Parse fk/fv pairs — fv may be a column ref (A1) or a string literal
    static_filters: list = []
    dynamic_pairs: list  = []  # (link_field, row_fieldname)

    i = arg_start
    while i + 1 < len(args):
        fk = _strip_formula_quotes(args[i])
        fv_raw = args[i + 1].strip()

        # Handle operator-embedded fieldnames: "transaction_date >=" → field="transaction_date", op=">="
        fk_op = "="
        fk_m = re.match(r'^(.+?)\s+(>=|<=|!=|<>|>|<|=|like)\s*$', fk, re.I)
        if fk_m:
            fk, fk_op = fk_m.group(1).strip(), fk_m.group(2).strip()

        col_ref = _try_col_ref(fv_raw)
        if col_ref is not None:
            rf = col_fields[col_ref] if col_ref < len(col_fields) else "name"
            dynamic_pairs.append((fk, rf))
        else:
            static_filters.append([fk, fk_op, _strip_formula_quotes(fv_raw)])
        i += 2

    # All-static: same value for every row
    if not dynamic_pairs:
        try:
            cnt = frappe.db.count(link_doctype, filters=static_filters) or 0
        except Exception:
            cnt = 0
        return [cnt] * len(rows)

    # Single dynamic field: one GROUP BY query covers all rows
    if len(dynamic_pairs) == 1:
        dyn_fk, dyn_rf = dynamic_pairs[0]
        row_vals = [r.get(dyn_rf) for r in rows]
        unique = list({v for v in row_vals if v is not None})
        if not unique:
            return [0] * len(rows)

        bulk_filters = static_filters + [[dyn_fk, "in", unique]]
        val_map: dict = {}
        try:
            if func == "FRAPPE_COUNT":
                agg_rows = frappe.db.get_all(
                    link_doctype,
                    fields=[dyn_fk, "count(*) as cnt"],
                    filters=bulk_filters,
                    group_by=dyn_fk,
                )
                val_map = {str(r.get(dyn_fk, "")): (r.get("cnt") or 0) for r in agg_rows}
            elif func == "FRAPPE_SUM" and sum_field:
                agg_rows = frappe.db.get_all(
                    link_doctype,
                    fields=[dyn_fk, f"sum({sum_field}) as s"],
                    filters=bulk_filters,
                    group_by=dyn_fk,
                )
                val_map = {str(r.get(dyn_fk, "")): float(r.get("s") or 0) for r in agg_rows}
            elif func == "FRAPPE_AVG" and sum_field:
                agg_rows = frappe.db.get_all(
                    link_doctype,
                    fields=[dyn_fk, f"sum({sum_field}) as s", "count(*) as cnt"],
                    filters=bulk_filters,
                    group_by=dyn_fk,
                )
                val_map = {
                    str(r.get(dyn_fk, "")): (
                        float(r.get("s") or 0) / max(int(r.get("cnt") or 1), 1)
                    )
                    for r in agg_rows
                }
        except Exception:
            pass

        return [val_map.get(str(rv), 0) for rv in row_vals]

    # Multiple dynamic fields: row-by-row (rare)
    results = []
    for row in rows:
        dyn_f = [[fk, "=", row.get(rf)] for fk, rf in dynamic_pairs]
        all_f = static_filters + dyn_f
        try:
            if func == "FRAPPE_COUNT":
                v: float = float(frappe.db.count(link_doctype, filters=all_f) or 0)
            elif func in ("FRAPPE_SUM", "FRAPPE_AVG") and sum_field:
                r_rows = frappe.db.get_all(link_doctype, fields=[sum_field], filters=all_f)
                nums = [float(x[sum_field] or 0) for x in r_rows if x.get(sum_field) is not None]
                v = sum(nums) if func == "FRAPPE_SUM" else (sum(nums) / len(nums) if nums else 0.0)
            else:
                v = 0.0
        except Exception:
            v = 0.0
        results.append(v)
    return results


def _parse_formula_args(args_str: str) -> list:
    """Split formula args on commas, respecting quoted strings and nested parens."""
    parts, current, depth, in_q = [], [], 0, False
    for ch in args_str:
        if ch == '"' and depth == 0:
            in_q = not in_q
            current.append(ch)
        elif not in_q:
            if ch == "(":
                depth += 1; current.append(ch)
            elif ch == ")":
                depth -= 1; current.append(ch)
            elif ch == "," and depth == 0:
                parts.append("".join(current))
                current = []
            else:
                current.append(ch)
        else:
            current.append(ch)
    if current:
        parts.append("".join(current))
    return parts


def _strip_formula_quotes(s: str) -> str:
    s = s.strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        return s[1:-1]
    return s


def _try_col_ref(s: str):
    """Return column index if s matches A1, B1, AA1 etc., else None."""
    import re
    m = re.match(r'^([A-Z]+)1$', s.strip(), re.I)
    return _col_letter_to_index(m.group(1).upper()) if m else None


def _num_compare(val, op: str, threshold: float) -> bool:
    try:
        v = float(val)
        if op == ">":  return v > threshold
        if op == "<":  return v < threshold
        if op == ">=": return v >= threshold
        if op == "<=": return v <= threshold
        if op == "=":  return v == threshold
        if op == "!=": return v != threshold
    except (TypeError, ValueError):
        pass
    return False


@frappe.whitelist()
def gl_balance(
    account: str,
    company: str,
    from_date: str | None = None,
    to_date: str | None = None,
    cost_center: str | None = None,
    finance_book: str | None = None,
) -> dict:
    """
    Return the net GL balance (debit − credit) for an account/company/period.

    Used by the ``GL_BALANCE(account, company, …)`` HyperFormula function.
    Returns ``{"value": 0, "note": "…"}`` if ERPNext is not installed so the
    formula degrades gracefully on vanilla Frappe setups.

    Args:
        account:      GL account name (e.g. "Cash - ACME").
        company:      Company name.
        from_date:    Start of period (inclusive).  None = no lower bound.
        to_date:      End of period (inclusive).    None = no upper bound.
        cost_center:  Optional cost-centre filter.
        finance_book: Optional finance-book filter (also matches IS NULL rows).

    Returns:
        {"value": <Decimal as float>}
    """
    if not frappe.db.table_exists("tabGL Entry"):
        return {"value": 0, "note": "GL Entry not available — ERPNext not installed"}

    frappe.has_permission("GL Entry", "read", throw=True)

    conditions = [
        "account  = %(account)s",
        "company  = %(company)s",
        "is_cancelled = 0",
    ]
    params: dict = {"account": account, "company": company}

    if from_date:
        conditions.append("posting_date >= %(from_date)s")
        params["from_date"] = from_date
    if to_date:
        conditions.append("posting_date <= %(to_date)s")
        params["to_date"] = to_date
    if cost_center:
        conditions.append("cost_center = %(cost_center)s")
        params["cost_center"] = cost_center
    if finance_book:
        conditions.append("(finance_book = %(finance_book)s OR finance_book IS NULL)")
        params["finance_book"] = finance_book

    where = " AND ".join(conditions)
    result = frappe.db.sql(
        f"SELECT COALESCE(SUM(debit), 0) - COALESCE(SUM(credit), 0) AS balance "
        f"FROM `tabGL Entry` WHERE {where}",
        params,
        as_dict=True,
    )

    return {"value": float(result[0].get("balance") or 0)}


@frappe.whitelist()
def stock_qty(
    item_code: str,
    warehouse: str,
    as_of_date: str | None = None,
) -> dict:
    """
    Return current or point-in-time stock quantity for an item/warehouse.

    Used by ``STOCK_QTY(item_code, warehouse [, as_of_date])``.
    When *as_of_date* is omitted the Bin table is used (fast current balance).
    When a date is supplied the Stock Ledger Entry table is queried to return
    the running total up to that date.

    Returns:
        {"value": <float>}
    """
    if not frappe.db.table_exists("tabBin"):
        return {"value": 0, "note": "Bin doctype not available — ERPNext not installed"}

    frappe.has_permission("Bin", "read", throw=True)

    if not as_of_date:
        qty = frappe.db.get_value(
            "Bin",
            {"item_code": item_code, "warehouse": warehouse},
            "actual_qty",
        )
        return {"value": float(qty or 0)}

    # Point-in-time balance via Stock Ledger Entry
    result = frappe.db.sql(
        """
        SELECT COALESCE(SUM(actual_qty), 0) AS qty
        FROM   `tabStock Ledger Entry`
        WHERE  item_code    = %(item)s
          AND  warehouse    = %(wh)s
          AND  posting_date <= %(date)s
          AND  docstatus    = 1
        """,
        {"item": item_code, "wh": warehouse, "date": as_of_date},
        as_dict=True,
    )
    return {"value": float(result[0].get("qty") or 0)}


@frappe.whitelist()
def item_price(
    item_code: str,
    price_list: str,
    qty: float | None = None,
    customer: str | None = None,
    uom: str | None = None,
) -> dict:
    """
    Return the selling price for an item from an Item Price record.

    Used by ``ITEM_PRICE(item_code, price_list [, qty, customer, uom])``.
    Picks the most recently valid price (valid_from ≤ today ≤ valid_upto).
    Falls back to the most recently modified price if no date-valid record
    exists.

    Args:
        item_code:  Item code.
        price_list: Price list name (e.g. "Standard Selling").
        qty:        Quantity (reserved for future tiered pricing — unused now).
        customer:   Customer (reserved for future customer-group pricing).
        uom:        Unit of measure filter.

    Returns:
        {"value": <float>}
    """
    if not frappe.db.table_exists("tabItem Price"):
        return {"value": 0, "note": "Item Price not available — ERPNext not installed"}

    frappe.has_permission("Item Price", "read", throw=True)

    filters: dict = {
        "item_code":  item_code,
        "price_list": price_list,
        "selling":    1,
    }
    if uom:
        filters["uom"] = uom

    prices = frappe.get_list(
        "Item Price",
        filters=filters,
        fields=["price_list_rate", "valid_from", "valid_upto"],
        order_by="valid_from desc",
    )

    if not prices:
        return {"value": 0}

    today = frappe.utils.today()

    for p in prices:
        valid_from  = p.get("valid_from")
        valid_upto  = p.get("valid_upto")

        # Skip if period hasn't started yet
        if valid_from and frappe.utils.getdate(valid_from) > frappe.utils.getdate(today):
            continue
        # Skip if period has already ended
        if valid_upto and frappe.utils.getdate(valid_upto) < frappe.utils.getdate(today):
            continue

        return {"value": float(p.get("price_list_rate") or 0)}

    # Fallback: first record (most recent valid_from regardless of date range)
    return {"value": float(prices[0].get("price_list_rate") or 0)}


# ── Read ──────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def get_workbooks(doctype_name: str) -> list[dict]:
	"""
	Return workbooks for *doctype_name* that the current user may open:
	  - workbooks they own, OR
	  - workbooks marked is_public = 1 (by any user).

	Returns a lightweight list (no heavy JSON fields) suitable for rendering
	the "Open View" dialog.
	"""
	frappe.has_permission(doctype_name, "read", throw=True)

	# Raw SQL is cleaner than chaining frappe.get_all OR-filters.
	return frappe.db.sql(
		"""
		SELECT name, title, owner, is_public, modified
		FROM   `tabExcel Workbook`
		WHERE  doctype_name = %(dt)s
		  AND  (owner = %(user)s OR is_public = 1)
		ORDER  BY modified DESC
		LIMIT  200
		""",
		{"dt": doctype_name, "user": frappe.session.user},
		as_dict=True,
	)


@frappe.whitelist()
def load_workbook(name: str) -> dict:
	"""
	Return the full workbook document (including JSON config fields).

	Returns {"not_found": True} when the workbook has been deleted so the
	client can silently clear its stale user_settings reference instead of
	showing a scary "Not found" error dialog.
	"""
	try:
		doc = frappe.get_doc("Excel Workbook", name)
	except frappe.DoesNotExistError:
		return {"not_found": True, "name": name}

	if doc.owner != frappe.session.user and not doc.is_public:
		frappe.throw(
			_("You don't have permission to open this view."),
			frappe.PermissionError,
		)

	return doc.as_dict()


# ── Write ─────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def save_workbook(
	title: str,
	doctype_name: str,
	columns_config: str,
	formula_columns: str,
	filters: str,
	sort_by: str | None = None,
	is_public: int = 0,
	workbook_name: str | None = None,
	join_config: str | None = None,
	sheets: str | None = None,
	chart_overlays: str | None = None,
	format_store: str | None = None,
	cond_fmt_rules: str | None = None,
	view_state: str | None = None,
) -> dict:
	"""
	Create a new workbook or update an existing one.
	"""
	frappe.has_permission(doctype_name, "read", throw=True)

	if workbook_name:
		doc = frappe.get_doc("Excel Workbook", workbook_name)
		if doc.owner != frappe.session.user and not frappe.has_role("System Manager"):
			frappe.throw(_("You can only update your own saved views."))
	else:
		doc = frappe.new_doc("Excel Workbook")
		doc.doctype_name = doctype_name

	doc.title           = title
	doc.is_public       = frappe.utils.cint(is_public)
	doc.columns_config  = columns_config
	doc.formula_columns = formula_columns
	doc.filters         = filters
	doc.sort_by         = sort_by or "{}"
	doc.join_config     = join_config or "{}"
	doc.sheets          = sheets or "[]"
	doc.chart_overlays  = chart_overlays or "[]"
	doc.format_store    = format_store or "{}"
	doc.cond_fmt_rules  = cond_fmt_rules or "[]"
	doc.view_state      = view_state or "{}"

	doc.save(ignore_permissions=False)

	return {"name": doc.name, "title": doc.title}


# ── Delete ────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def delete_workbook(name: str) -> dict:
	"""
	Delete a workbook.  Only the owner or a System Manager may do this.
	The controller's before_delete hook also enforces this, but we check
	early here to give a clear error message.
	"""
	doc = frappe.get_doc("Excel Workbook", name)

	if doc.owner != frappe.session.user and not frappe.has_role("System Manager"):
		frappe.throw(_("You can only delete your own saved views."))

	frappe.delete_doc("Excel Workbook", name, ignore_permissions=True)

	return {"success": True}


# ── V2.4.5 — IntelliFlow AI: helpers + 4-layer validation + discovery ─────────


# ── Shared helpers ────────────────────────────────────────────────────────────

def _sample_and_profile(doctype: str, field: str, limit: int = 100) -> dict:
	"""
	Sample `limit` values from doctype.field and detect their structural pattern.

	Returns:
	  {
	    "values":     set[str]           — sampled raw values
	    "raw_list":   list[str]          — ordered list (for cardinality check)
	    "pattern":    str                — one of:
	                    "naming_series"  (EMP-0001, SINV-2024-00001)
	                    "hash"           (len≥10, no spaces)
	                    "email"          (contains @)
	                    "date"           (YYYY-MM-DD…)
	                    "numeric"        (pure numbers / decimals)
	                    "text"           (everything else)
	    "prefix_set": set[str]           — naming-series prefixes (empty otherwise)
	  }
	"""
	import re

	raw = [str(r) for r in frappe.get_all(doctype, pluck=field, limit=limit) if r]
	if not raw:
		return {"values": set(), "raw_list": [], "pattern": "text", "prefix_set": set()}

	s = raw[:50]
	n = len(s)

	def _ratio(fn):
		return sum(1 for v in s if fn(v)) / n

	series_re = re.compile(r'^([A-Z][A-Z0-9-]*)-(?:\d{4}-)?[0-9]+$')

	if _ratio(lambda v: bool(re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', v))) >= 0.8:
		return {"values": set(raw), "raw_list": raw, "pattern": "email", "prefix_set": set()}

	if _ratio(lambda v: bool(re.match(r'^\d{4}-\d{2}-\d{2}', v))) >= 0.8:
		return {"values": set(raw), "raw_list": raw, "pattern": "date", "prefix_set": set()}

	if _ratio(lambda v: bool(re.match(r'^-?\d+\.?\d*$', v))) >= 0.8:
		return {"values": set(raw), "raw_list": raw, "pattern": "numeric", "prefix_set": set()}

	series_matches = [series_re.match(v) for v in s]
	if sum(1 for m in series_matches if m) / n >= 0.7:
		prefixes = {m.group(1) for m in series_matches if m}
		return {"values": set(raw), "raw_list": raw, "pattern": "naming_series", "prefix_set": prefixes}

	if _ratio(lambda v: len(v) >= 10 and " " not in v) >= 0.8:
		return {"values": set(raw), "raw_list": raw, "pattern": "hash", "prefix_set": set()}

	return {"values": set(raw), "raw_list": raw, "pattern": "text", "prefix_set": set()}


def _l1_pattern_score(src_prof: dict, tgt_prof: dict) -> float:
	"""Layer 1 score from structural pattern comparison."""
	sp = src_prof["pattern"]
	tp = tgt_prof["pattern"]

	if sp == "naming_series" and tp == "naming_series":
		# Boost if they share at least one naming-series prefix
		if src_prof["prefix_set"] & tgt_prof["prefix_set"]:
			return 0.95
		return 0.80

	if sp == "hash"    and tp == "hash":    return 0.70
	if sp == "email"   and tp == "email":   return 0.60
	if sp == tp:                            return 0.40   # same generic type
	return 0.10                                           # different


# Hard incompatible pattern pairs — type-gate (Layer 2)
_INCOMPATIBLE_PAIRS = {
	("date",           "numeric"),       ("numeric",        "date"),
	("date",           "email"),         ("email",          "date"),
	("numeric",        "email"),         ("email",          "numeric"),
	("numeric",        "naming_series"), ("naming_series",  "numeric"),
	("numeric",        "hash"),          ("hash",           "numeric"),
}


def _grade(composite: float, method: str) -> str:
	if method == "meta":    return "S"
	if composite >= 0.80:   return "A"
	if composite >= 0.60:   return "B"
	if composite >= 0.40:   return "C"
	if composite >= 0.25:   return "D"
	return "F"


def _cardinality_and_coverage(src_list: list, tgt_list: list):
	"""Returns (cardinality_str, coverage_float)."""
	from collections import Counter
	src_set = set(src_list)
	tgt_set = set(tgt_list)
	coverage = round(len(src_set & tgt_set) / max(len(src_set), 1), 2)
	tgt_cnt  = Counter(tgt_list)
	matched  = [v for v in src_list if v in tgt_set]
	max_m    = max((tgt_cnt.get(v, 0) for v in matched), default=0)
	return ("1:1" if max_m <= 1 else "1:N"), coverage


# ── Link-graph cache (V2.4.5) ─────────────────────────────────────────────────
#
# Instead of calling frappe.get_meta(dt) for every DocType in a loop
# (= N individual DB round-trips), we run ONE SQL JOIN on tabDocField
# that returns every Link field across the entire site, then cache the
# result in Redis for 5 minutes.
#
# Performance:
#   Before: suggest_joins ≈ 300 get_meta() calls  ≈ 300 DB queries
#   After : 1-2 SQL JOIN queries → edge list       → cached, no repeat

_GRAPH_CACHE_KEY = "ev_link_graph_edges_v3"  # v3: includes Dynamic Link
_GRAPH_CACHE_TTL = 300  # seconds
_DYNAMIC_LINK_CACHE_KEY = "ev_dynamic_link_edges_v1"
_DYNAMIC_LINK_SAMPLE_LIMIT = 500  # Sample size for Dynamic Link detection


def _get_all_link_edges() -> list:
	"""
	Return every Link-field edge across all non-single DocTypes in a SINGLE SQL
	query. Child tables (istable=1) are now included as edge SOURCES so that
	canvas users can join child-table DocTypes (e.g. "Timesheet Detail") that
	carry a Link field to the base DocType. The JOIN target is still restricted
	to non-child, non-single DocTypes.

	Custom fields (tabCustom Field) are merged via UNION ALL.
	Result is cached in Redis for 5 min; subsequent calls are instant.

	Each entry: {
	  "doctype": str, "fieldname": str, "label": str, "target": str,
	  "is_child_src": int   # 1 when the source DocType is a child table
	}
	"""
	cached = frappe.cache().get_value(_GRAPH_CACHE_KEY)
	if cached is not None:
		return cached

	sql = """
		SELECT df.parent      AS doctype,
		       df.fieldname,
		       COALESCE(NULLIF(df.label, ''), df.fieldname) AS label,
		       df.options     AS target,
		       src.istable    AS is_child_src
		FROM   `tabDocField` df
		JOIN   `tabDocType`  src ON src.name = df.parent
		JOIN   `tabDocType`  tgt ON tgt.name = df.options
		WHERE  df.fieldtype = 'Link'
		  AND  df.options IS NOT NULL AND df.options != ''
		  AND  src.issingle = 0
		  AND  tgt.issingle = 0 AND tgt.istable = 0

		UNION ALL

		SELECT cf.dt          AS doctype,
		       cf.fieldname,
		       COALESCE(NULLIF(cf.label, ''), cf.fieldname) AS label,
		       cf.options     AS target,
		       src.istable    AS is_child_src
		FROM   `tabCustom Field` cf
		JOIN   `tabDocType`  src ON src.name = cf.dt
		JOIN   `tabDocType`  tgt ON tgt.name = cf.options
		WHERE  cf.fieldtype = 'Link'
		  AND  cf.options IS NOT NULL AND cf.options != ''
		  AND  src.issingle = 0
		  AND  tgt.issingle = 0 AND tgt.istable = 0
	"""
	edges = [dict(row) for row in frappe.db.sql(sql, as_dict=True)]

	# Add Dynamic Link edges (polymorphic relationships)
	dynamic_edges = _get_dynamic_link_edges()
	edges.extend(dynamic_edges)

	frappe.cache().set_value(_GRAPH_CACHE_KEY, edges, expires_in_sec=_GRAPH_CACHE_TTL)
	return edges


def _get_dynamic_link_edges() -> list:
	"""
	Detect Dynamic Link relationships - polymorphic joins where target is determined
	by another field's value.

	Dynamic Link detection uses the `options` field to find the reference field,
	then determines targets based on that field's type:

	Case 1 - Select field (deterministic):
	  party_type (Select: "Customer\nSupplier\nEmployee")
	  party (Dynamic Link → party_type)
	  → Targets: Customer, Supplier, Employee (parsed from Select options)

	Case 2 - Link to DocType (data sampling):
	  reference_doctype (Link → DocType)
	  reference_name (Dynamic Link → reference_doctype)
	  → Sample data to discover which DocTypes are actually used

	Case 3 - Link with set_query (data sampling):
	  link_doctype (Link → DocType, controller restricts via set_query)
	  link_name (Dynamic Link → link_doctype)
	  → Sample data to discover actual usage

	Common in: Comment, Address, Contact, File, Version, Communication, Payment Entry

	Returns edges with metadata:
	  {
	    "doctype": source DocType,
	    "fieldname": Dynamic Link field,
	    "label": field label,
	    "target": discovered target DocType,
	    "is_child_src": 0 or 1,
	    "is_dynamic": True,
	    "ref_field": reference field name,
	    "ref_field_type": "Select" or "Link",
	    "detection_method": "select" or "data_sample",
	    "sample_count": count (None for Select, int for sampled)
	  }
	"""
	cached = frappe.cache().get_value(_DYNAMIC_LINK_CACHE_KEY)
	if cached is not None:
		return cached

	# Step 1: Find all Dynamic Link fields
	dynamic_fields_sql = """
		SELECT df.parent      AS doctype,
		       df.fieldname,
		       COALESCE(NULLIF(df.label, ''), df.fieldname) AS label,
		       df.options     AS ref_field,
		       src.istable    AS is_child_src
		FROM   `tabDocField` df
		JOIN   `tabDocType`  src ON src.name = df.parent
		WHERE  df.fieldtype = 'Dynamic Link'
		  AND  df.options IS NOT NULL AND df.options != ''
		  AND  src.issingle = 0

		UNION ALL

		SELECT cf.dt          AS doctype,
		       cf.fieldname,
		       COALESCE(NULLIF(cf.label, ''), cf.fieldname) AS label,
		       cf.options     AS ref_field,
		       src.istable    AS is_child_src
		FROM   `tabCustom Field` cf
		JOIN   `tabDocType`  src ON src.name = cf.dt
		WHERE  cf.fieldtype = 'Dynamic Link'
		  AND  cf.options IS NOT NULL AND cf.options != ''
		  AND  src.issingle = 0
	"""
	dynamic_fields = frappe.db.sql(dynamic_fields_sql, as_dict=True)

	if not dynamic_fields:
		frappe.cache().set_value(_DYNAMIC_LINK_CACHE_KEY, [], expires_in_sec=_GRAPH_CACHE_TTL)
		return []

	# Step 2: For each Dynamic Link field, determine targets based on ref field type
	edges = []

	for df in dynamic_fields:
		try:
			# Find the reference field's meta to determine how to get targets
			meta = frappe.get_meta(df["doctype"])
			ref_field_obj = meta.get_field(df["ref_field"])

			if not ref_field_obj:
				continue  # Reference field doesn't exist

			targets_data = []

			# Case 1: Select field - parse options directly (no data sampling needed!)
			if ref_field_obj.fieldtype == "Select" and ref_field_obj.options:
				# Options are newline-separated: "Customer\nSupplier\nEmployee"
				select_options = [opt.strip() for opt in ref_field_obj.options.split("\n") if opt.strip()]

				# Each option is a potential target DocType
				for target_dt in select_options:
					# First check if DocType exists in tabDocType (fast DB check)
					exists = frappe.db.exists("DocType", target_dt)
					if not exists:
						continue  # DocType doesn't exist - skip silently

					# Now safely get meta (we know it exists)
					try:
						target_meta = frappe.get_meta(target_dt)
						if not target_meta.issingle and not target_meta.istable:
							targets_data.append({
								"target_doctype": target_dt,
								"count": None,  # No count for Select (all are possible)
								"method": "select"
							})
					except Exception:
						continue  # Meta fetch failed - skip

			# Case 2 & 3: Link field (to DocType or restricted) - sample actual data
			elif ref_field_obj.fieldtype == "Link":
				sample_sql = """
					SELECT `{ref_field}` AS target_doctype, COUNT(*) AS count
					FROM `tab{doctype}`
					WHERE `{ref_field}` IS NOT NULL AND `{ref_field}` != ''
					GROUP BY `{ref_field}`
					LIMIT {limit}
				""".format(
					doctype=df["doctype"],
					ref_field=df["ref_field"],
					limit=_DYNAMIC_LINK_SAMPLE_LIMIT
				)

				sampled_targets = frappe.db.sql(sample_sql, as_dict=True)

				for row in sampled_targets:
					# First check if DocType exists (fast DB check)
					exists = frappe.db.exists("DocType", row["target_doctype"])
					if not exists:
						continue  # DocType doesn't exist - skip silently

					# Now safely get meta
					try:
						target_meta = frappe.get_meta(row["target_doctype"])
						if not target_meta.issingle and not target_meta.istable:
							targets_data.append({
								"target_doctype": row["target_doctype"],
								"count": row["count"],
								"method": "data_sample"
							})
					except Exception:
						continue

				# Create edges for discovered targets
				for target_info in targets_data:
					edges.append({
						"doctype": df["doctype"],
						"fieldname": df["fieldname"],
						"label": df["label"],
						"target": target_info["target_doctype"],
						"is_child_src": df["is_child_src"],
						"is_dynamic": True,
						"ref_field": df["ref_field"],
						"ref_field_type": ref_field_obj.fieldtype,
						"detection_method": target_info["method"],
						"sample_count": target_info.get("count")
					})

		except Exception:
			# If table doesn't exist or meta fetch fails, skip this Dynamic Link
			continue

	frappe.cache().set_value(_DYNAMIC_LINK_CACHE_KEY, edges, expires_in_sec=_GRAPH_CACHE_TTL)
	return edges


# ── Main validation endpoint ──────────────────────────────────────────────────

@frappe.whitelist()
def validate_join(
	src_doctype: str,
	src_field: str,
	tgt_doctype: str,
	tgt_field: str,
) -> dict:
	"""
	4-Layer join validation for IntelliFlow canvas (V2.4.5).

	Layer 0 — Meta Guard    : Frappe Link field → immediate Grade S result.
	Layer 1 — Pattern Match  : Naming series / hash / email / date / numeric / text.
	Layer 2 — Type Gate      : Hard incompatibility (date↔numeric etc.) → instant F.
	Layer 3 — Value Overlap  : Set intersection confidence score.
	Layer 4 — Semantic       : RapidFuzz + dynamic std_fields context boost.

	Returns dict with keys:
	  valid, confidence, method, grade, cardinality, coverage,
	  src_pattern, tgt_pattern, message
	"""
	from rapidfuzz import fuzz as _fuzz

	_check_doctype_permission(src_doctype)
	_check_doctype_permission(tgt_doctype)

	# ── Layer 0: Meta Guard ───────────────────────────────────────────────────
	# Case A: src_doctype.src_field is a Link → tgt_doctype, joined on tgt.name
	if tgt_field == "name":
		for df in frappe.get_meta(src_doctype).fields:
			if df.fieldtype == "Link" and df.options == tgt_doctype and df.fieldname == src_field:
				cardinality, coverage = _cardinality_and_coverage(
					[str(r) for r in frappe.get_all(src_doctype, pluck=src_field, limit=100) if r],
					[str(r) for r in frappe.get_all(tgt_doctype, pluck="name",    limit=100) if r],
				)
				return {
					"valid": True, "confidence": 1.0, "method": "meta", "grade": "S",
					"cardinality": cardinality, "coverage": coverage,
					"src_pattern": "naming_series", "tgt_pattern": "naming_series",
					"message": f"Link field: {src_doctype}.{df.label or df.fieldname} → {tgt_doctype}",
				}

	# Case B: tgt_doctype.tgt_field is a Link → src_doctype, joined on src.name
	if src_field == "name":
		for df in frappe.get_meta(tgt_doctype).fields:
			if df.fieldtype == "Link" and df.options == src_doctype and df.fieldname == tgt_field:
				cardinality, coverage = _cardinality_and_coverage(
					[str(r) for r in frappe.get_all(src_doctype, pluck="name",    limit=100) if r],
					[str(r) for r in frappe.get_all(tgt_doctype, pluck=tgt_field, limit=100) if r],
				)
				return {
					"valid": True, "confidence": 1.0, "method": "meta", "grade": "S",
					"cardinality": cardinality, "coverage": coverage,
					"src_pattern": "naming_series", "tgt_pattern": "naming_series",
					"message": f"Link field: {tgt_doctype}.{df.label or df.fieldname} → {src_doctype}",
				}

	# Case C: Child Table → Parent via "parent" system field
	# src_doctype is a child table, src_field="parent", tgt_field="name"
	# Validate that tgt_doctype actually uses src_doctype as a child table
	src_meta = frappe.get_meta(src_doctype)
	if src_meta.istable and src_field == "parent" and tgt_field == "name":
		# Check if tgt_doctype has a Table field with options=src_doctype
		parent_uses_child = frappe.db.exists({
			"doctype": "DocField",
			"parent": tgt_doctype,
			"fieldtype": "Table",
			"options": src_doctype,
		}) or frappe.db.exists({
			"doctype": "Custom Field",
			"dt": tgt_doctype,
			"fieldtype": "Table",
			"options": src_doctype,
		})

		if parent_uses_child:
			# Sample and validate the parent field values
			parent_vals = [str(r) for r in frappe.get_all(src_doctype, pluck="parent", limit=100) if r]
			tgt_vals = [str(r) for r in frappe.get_all(tgt_doctype, pluck="name", limit=100) if r]
			cardinality, coverage = _cardinality_and_coverage(parent_vals, tgt_vals)

			return {
				"valid": True, "confidence": 1.0, "method": "meta", "grade": "S",
				"cardinality": cardinality, "coverage": coverage,
				"src_pattern": "naming_series", "tgt_pattern": "naming_series",
				"message": f"Child table relationship: {src_doctype}.parent → {tgt_doctype}",
			}

	# ── Layers 1-4: ML pipeline ───────────────────────────────────────────────
	src_prof = _sample_and_profile(src_doctype, src_field)
	tgt_prof = _sample_and_profile(tgt_doctype, tgt_field)
	src_pat  = src_prof["pattern"]
	tgt_pat  = tgt_prof["pattern"]

	# Layer 2: type gate (hard incompatibility)
	if (src_pat, tgt_pat) in _INCOMPATIBLE_PAIRS:
		return {
			"valid": False, "confidence": 0.0, "method": "type_mismatch",
			"grade": "F", "cardinality": None, "coverage": None,
			"src_pattern": src_pat, "tgt_pattern": tgt_pat,
			"message": _(
				"Type mismatch: {0} ({1}) cannot join with {2} ({3})"
			).format(src_field, src_pat, tgt_field, tgt_pat),
		}

	# Layer 1: structural pattern score
	l1_score = _l1_pattern_score(src_prof, tgt_prof)

	# Layer 3: value overlap
	src_vals = src_prof["values"]
	tgt_vals = tgt_prof["values"]

	if not src_vals or not tgt_vals:
		return {
			"valid": False, "confidence": 0.0, "method": "no_data",
			"grade": "?", "cardinality": None, "coverage": None,
			"src_pattern": src_pat, "tgt_pattern": tgt_pat,
			"message": _("No data to sample — add records to both DocTypes first"),
		}

	overlap    = len(src_vals & tgt_vals)
	overlap_r  = round(overlap / max(len(src_vals), len(tgt_vals)), 2)
	composite  = round(max(l1_score, overlap_r), 2)   # best signal wins

	cardinality, coverage = _cardinality_and_coverage(
		src_prof["raw_list"], tgt_prof["raw_list"]
	)

	# Layer 4: semantic (RapidFuzz + dynamic std_fields boost)
	fuzz_ratio   = _fuzz.token_sort_ratio(src_field, tgt_field) / 100.0
	partial_r    = _fuzz.partial_ratio(src_field, tgt_field) / 100.0
	semantic     = round(max(fuzz_ratio, partial_r), 2)

	# Dynamic std_fields boost: same fieldname on both sides → strongly correlated
	try:
		std_names = {df.get("fieldname") for df in frappe.model.std_fields}
		if src_field in std_names and tgt_field == src_field:
			semantic = max(semantic, 0.85)
	except Exception:
		pass

	# Dynamic meta-context: catch Link fields to non-"name" targets
	try:
		src_df = next(
			(df for df in frappe.get_meta(src_doctype).fields if df.fieldname == src_field),
			None,
		)
		if src_df and src_df.fieldtype == "Link" and src_df.options == tgt_doctype:
			semantic = 1.0
	except Exception:
		pass

	final_confidence = round(0.7 * composite + 0.3 * semantic, 2)
	grade            = _grade(final_confidence, "ml")
	valid            = final_confidence >= 0.25

	# Human-readable message
	if valid:
		msg = f"{int(final_confidence * 100)}% confidence — {overlap} overlapping values"
		if grade == "D":
			msg += f" ({__('Low confidence — verify this join is intentional')})"
	else:
		msg = (
			f"Only {int(final_confidence * 100)}% confidence ({overlap} overlapping values) "
			"— these fields likely don't join correctly"
		)

	return {
		"valid":       valid,
		"confidence":  final_confidence,
		"method":      "ml",
		"grade":       grade,
		"cardinality": cardinality,
		"coverage":    coverage,
		"src_pattern": src_pat,
		"tgt_pattern": tgt_pat,
		"message":     msg,
	}


# ── AI Discovery endpoints ────────────────────────────────────────────────────

@frappe.whitelist()
def suggest_joins(base_doctype: str, force_refresh: bool = False) -> list:
	"""
	AI-powered join candidate discovery (V2.4.5).

	Layer A — cached edge scan (O(E), no per-DT meta calls):
	  Iterate _get_all_link_edges() (1-2 SQL queries, Redis-cached 5 min).
	  Any edge where one side == base_doctype → score 1.0, method "meta".

	Layer B — TF-IDF + rapidfuzz for non-meta candidates:
	  Batch-fetch field labels for up to 60 non-meta DTs in 2 SQL queries
	  (instead of 60 get_meta() calls).
	  composite = 0.6 * tfidf_cosine + 0.4 * fuzz_token_sort ≥ 0.40.

	force_refresh=True: bust the 5-min Redis edge-list cache before scanning.
	  Use when a new DocType or Link field has been added to the site schema.

	Returns [{doctype, src_field, tgt_field, score, method, reason}] sorted
	  meta-links alphabetically first, then ML by score desc.
	No hardcoded DocType names.  No per-DT get_meta() loops.
	"""
	if frappe.utils.cint(force_refresh):
		frappe.cache().delete_value(_GRAPH_CACHE_KEY)
	from sklearn.feature_extraction.text import TfidfVectorizer
	from sklearn.metrics.pairwise import cosine_similarity
	from rapidfuzz import fuzz

	frappe.has_permission(base_doctype, "read", throw=True)

	SKIP = {
		"Section Break", "Column Break", "Tab Break", "Fold", "Heading",
		"HTML", "Custom HTML", "Table", "Table MultiSelect", "Password",
	}

	candidates = {}

	# Layer 0: Intelligent Child Table Parent Detection (3-signal validation)
	# If base_doctype is a child table, use 3 signals to find parent DocType(s):
	#   Signal 1 (Meta):      Which DocTypes have Table field pointing to this child
	#   Signal 2 (Data):      Sample 'parent' field values and validate existence
	#   Signal 3 (Parenttype): Check what parenttype field says (polymorphic awareness)
	base_meta = frappe.get_meta(base_doctype)
	if base_meta.istable:
		# Signal 1: Meta - DocTypes with Table field options=base_doctype
		meta_parents = frappe.db.sql("""
			SELECT DISTINCT parent AS doctype, label, fieldname
			FROM `tabDocField`
			WHERE fieldtype = 'Table' AND options = %(child)s
			UNION
			SELECT DISTINCT dt AS doctype, label, fieldname
			FROM `tabCustom Field`
			WHERE fieldtype = 'Table' AND options = %(child)s
		""", {"child": base_doctype}, as_dict=True)

		if not meta_parents:
			pass  # No parents found in meta — skip child table detection
		else:
			# Signal 2: Data - sample parent field values (limit 200 for performance)
			try:
				parent_samples = frappe.get_all(
					base_doctype,
					fields=["parent"],
					filters={"parent": ["!=", ""]},
					limit_page_length=200,
					pluck="parent",
				)
				parent_samples_set = set(parent_samples) if parent_samples else set()
			except Exception:
				parent_samples_set = set()

			# Signal 3: Parenttype - what does the data say? (polymorphic child tables)
			try:
				# Validate doctype name before interpolation (only alphanumeric, space, hyphen)
				if not frappe.db.exists("DocType", base_doctype):
					raise ValueError(f"Unknown DocType: {base_doctype}")
				parenttype_counts = frappe.db.sql("""
					SELECT parenttype, COUNT(*) as count
					FROM `tab{0}`
					WHERE parenttype IS NOT NULL AND parenttype != ''
					GROUP BY parenttype
					ORDER BY count DESC
				""".format(base_doctype), as_dict=True)
				total_pt = sum(pt["count"] for pt in parenttype_counts) if parenttype_counts else 0
			except Exception:
				parenttype_counts = []
				total_pt = 0

			# Process each candidate parent with 3-signal scoring
			for p in meta_parents:
				try:
					if not frappe.has_permission(p["doctype"], "read"):
						continue

					parent_dt = p["doctype"]
					meta_conf = 1.0  # Meta signal is always 1.0 (definitive)

					# Data validation: how many sampled parent values exist in parent_dt?
					data_conf = 0.0
					if parent_samples_set:
						try:
							parent_dt_names = set(
								frappe.get_all(parent_dt, pluck="name", limit_page_length=300)
							)
							overlap = len(parent_samples_set & parent_dt_names)
							data_conf = overlap / len(parent_samples_set) if parent_samples_set else 0.0
						except Exception:
							data_conf = 0.0

					# Parenttype confirmation: does parenttype field point to this parent?
					pt_conf = 0.0
					if parenttype_counts and total_pt > 0:
						pt_match = next(
							(pt for pt in parenttype_counts if pt["parenttype"] == parent_dt),
							None,
						)
						if pt_match:
							pt_conf = pt_match["count"] / total_pt

					# Final confidence: weighted average of 3 signals
					# Meta=50% (definitive), Data=30% (validation), Parenttype=20% (confirmation)
					final_conf = round(0.50 * meta_conf + 0.30 * data_conf + 0.20 * pt_conf, 2)

					# Build reason string with signal breakdown
					reason_parts = [f"{base_doctype} (child table)"]
					if data_conf > 0:
						reason_parts.append(f"data: {int(data_conf * 100)}%")
					if pt_conf > 0:
						reason_parts.append(f"type: {int(pt_conf * 100)}%")

					candidates[parent_dt] = dict(
						doctype=parent_dt,
						src_field="parent",
						tgt_field="name",
						score=final_conf,
						method="child_parent",
						reason=" | ".join(reason_parts),
					)
				except Exception:
					pass

	# Layer A: scan cached edge list — O(E), 0 extra DB queries
	edges      = _get_all_link_edges()

	for e in edges:
		dt, tgt = e["doctype"], e["target"]
		is_ct   = bool(e.get("is_child_src"))

		if tgt == base_doctype and dt != base_doctype:
			# dt.field → base_doctype  (base is the JOIN target)
			# For child tables: join ON base.name = child.{link_field}
			if dt not in candidates:
				try:
					if frappe.has_permission(dt, "read"):
						candidates[dt] = dict(
							doctype=dt, src_field="name", tgt_field=e["fieldname"],
							score=1.0,
							method="child_table" if is_ct else "meta",
							reason=f"{dt}.{e['label']} → {base_doctype}",
						)
				except Exception:
					pass

		elif dt == base_doctype and tgt != base_doctype:
			# base_doctype.field → tgt  (base is the JOIN source)
			if tgt not in candidates:
				try:
					if frappe.has_permission(tgt, "read"):
						candidates[tgt] = dict(
							doctype=tgt, src_field=e["fieldname"], tgt_field="name",
							score=1.0, method="meta",
							reason=f"{base_doctype}.{e['label']} → {tgt}",
						)
				except Exception:
					pass

	# Layer B: TF-IDF + rapidfuzz for non-meta candidates
	# Collect up to 60 non-meta DTs that appear in the edge list
	seen_dts = {e["doctype"] for e in edges} | {e["target"] for e in edges}
	non_meta = [dt for dt in seen_dts
	            if dt not in candidates and dt != base_doctype][:60]

	base_meta   = frappe.get_meta(base_doctype)
	base_fields = [df for df in base_meta.fields
	               if df.fieldtype not in SKIP and not df.is_virtual]
	if not base_fields or not non_meta:
		return sorted(candidates.values(), key=lambda x: (-x["score"], x["doctype"]))

	base_corpus = [f"{df.label or df.fieldname} {df.fieldname}" for df in base_fields]

	# Batch-fetch fields for all non_meta DTs in 2 SQL queries (no per-DT meta calls)
	skip_list = list(SKIP)
	std_rows = frappe.db.sql("""
		SELECT parent AS doctype, fieldname,
		       COALESCE(NULLIF(label, ''), fieldname) AS label, fieldtype
		FROM   `tabDocField`
		WHERE  parent IN %(dts)s AND fieldtype NOT IN %(skip)s
		ORDER  BY parent, idx
	""", {"dts": non_meta, "skip": skip_list}, as_dict=True)

	cust_rows = frappe.db.sql("""
		SELECT dt AS doctype, fieldname,
		       COALESCE(NULLIF(label, ''), fieldname) AS label, fieldtype
		FROM   `tabCustom Field`
		WHERE  dt IN %(dts)s AND fieldtype NOT IN %(skip)s
	""", {"dts": non_meta, "skip": skip_list}, as_dict=True)

	dt_fields: dict = {}
	for r in list(std_rows) + list(cust_rows):
		dt_fields.setdefault(r["doctype"], []).append(r)

	vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), max_features=5000)

	for dt in non_meta:
		tgt_rows = dt_fields.get(dt)
		if not tgt_rows:
			continue
		try:
			if not frappe.has_permission(dt, "read"):
				continue
		except Exception:
			continue

		tgt_corpus = [f"{r['label']} {r['fieldname']}" for r in tgt_rows]
		try:
			tfidf     = vectorizer.fit_transform(base_corpus + tgt_corpus)
			base_vecs = tfidf[: len(base_corpus)]
			tgt_vecs  = tfidf[len(base_corpus):]
			sim       = cosine_similarity(base_vecs, tgt_vecs)
			bi, ti    = divmod(int(sim.argmax()), len(tgt_rows))
			best_sim  = float(sim[bi, ti])
			if best_sim < 0.45:
				continue
			b_df      = base_fields[bi]
			t_row     = tgt_rows[ti]
			fuzz_s    = fuzz.token_sort_ratio(b_df.fieldname, t_row["fieldname"]) / 100.0
			composite = round(0.6 * best_sim + 0.4 * fuzz_s, 2)
			if composite >= 0.40:
				candidates[dt] = dict(
					doctype=dt, src_field=b_df.fieldname, tgt_field=t_row["fieldname"],
					score=composite, method="ml",
					reason=(
						f"Field similarity: {b_df.label or b_df.fieldname}"
						f" ↔ {t_row['label']}"
					),
				)
		except Exception:
			continue

	# Sort: child_parent (intelligent 3-signal) first, then meta links, then child_table, then ML
	METHOD_ORDER = {"child_parent": 0, "meta": 1, "child_table": 2, "ml": 3}
	return sorted(
		candidates.values(),
		key=lambda x: (METHOD_ORDER.get(x["method"], 9), -x["score"], x["doctype"]),
	)


@frappe.whitelist()
def rank_field_matches(src_doctype: str, src_field: str, tgt_doctype: str) -> dict:
	"""
	Score every field in tgt_doctype against src_field using TF-IDF + rapidfuzz.
	Returns {fieldname: score 0-1}.
	Used by the canvas to highlight target ports while user drags a wire.
	"""
	from sklearn.feature_extraction.text import TfidfVectorizer
	from sklearn.metrics.pairwise import cosine_similarity
	from rapidfuzz import fuzz

	_check_doctype_permission(src_doctype)
	_check_doctype_permission(tgt_doctype)

	SKIP = {
		"Section Break", "Column Break", "Tab Break", "Fold", "Heading",
		"HTML", "Custom HTML", "Table", "Table MultiSelect", "Password",
	}

	src_meta = frappe.get_meta(src_doctype)
	tgt_meta = frappe.get_meta(tgt_doctype)
	src_df   = next((df for df in src_meta.fields if df.fieldname == src_field), None)
	src_lbl  = f"{src_df.label or src_field} {src_field}" if src_df else src_field

	# Always include "name" (ID) as a candidate target
	class _NameField:
		fieldname, label, fieldtype = "name", "ID", "Data"

	tgt_fields = [_NameField()] + [
		df for df in tgt_meta.fields
		if df.fieldtype not in SKIP and not df.is_virtual
	]
	tgt_corpus = [f"{df.label or df.fieldname} {df.fieldname}" for df in tgt_fields]

	scores = {}
	try:
		vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))
		tfidf      = vectorizer.fit_transform([src_lbl] + tgt_corpus)
		sims       = cosine_similarity(tfidf[0:1], tfidf[1:])[0]
		for i, df in enumerate(tgt_fields):
			fz = fuzz.token_sort_ratio(src_field, df.fieldname) / 100.0
			scores[df.fieldname] = round(0.6 * float(sims[i]) + 0.4 * fz, 2)
	except Exception:
		for df in tgt_fields:
			scores[df.fieldname] = round(
				fuzz.token_sort_ratio(src_field, df.fieldname) / 100.0, 2
			)
	return scores


@frappe.whitelist()
def find_join_path(src_doctype: str, tgt_doctype: str) -> list:
	"""
	Find the shortest join path between two DocTypes using networkx BFS.

	Graph is built from _get_all_link_edges() — 1-2 SQL queries, Redis-cached
	for 5 min — instead of N × get_meta() calls.  Permission is checked only
	for intermediate nodes on the found path (not all DocTypes).

	Returns [{from_doctype, to_doctype, src_field, tgt_field, via_label}]
	or [] if no path exists or any intermediate node is inaccessible.
	"""
	import networkx as nx

	_check_doctype_permission(src_doctype)
	_check_doctype_permission(tgt_doctype)

	# Build graph entirely from cached edge list — zero extra DB calls
	G = nx.DiGraph()
	for e in _get_all_link_edges():
		G.add_edge(
			e["doctype"], e["target"],
			src_field=e["fieldname"], tgt_field="name",
			label=e["label"],
		)

	try:
		path = nx.shortest_path(G, source=src_doctype, target=tgt_doctype)
	except (nx.NetworkXNoPath, nx.NodeNotFound):
		return []

	# Permission check: only intermediate nodes (src + tgt already checked)
	for dt in path[1:-1]:
		try:
			if not frappe.has_permission(dt, "read"):
				return []
		except Exception:
			return []

	hops = []
	for i in range(len(path) - 1):
		ed = G.get_edge_data(path[i], path[i + 1]) or {}
		hops.append(dict(
			from_doctype=path[i], to_doctype=path[i + 1],
			src_field=ed.get("src_field", "name"),
			tgt_field=ed.get("tgt_field", "name"),
			via_label=ed.get("label", ""),
		))
	return hops


@frappe.whitelist()
def mine_join_patterns(
	base_doctype: str,
	join_config: str,
	min_support: float = 0.1,
	min_confidence: float = 0.5,
) -> list:
	"""
	Discover association rules in the joined dataset using mlxtend Apriori.

	Fetches ≤500 rows, selects categorical columns (cardinality 2–30),
	one-hot encodes them, runs Apriori (min_support, max_len=3),
	filters by confidence ≥ min_confidence and lift ≥ 1.2.

	Returns top 20 rules [{antecedents, consequents, support, confidence, lift}].
	"""
	from mlxtend.frequent_patterns import apriori, association_rules
	import pandas as pd

	frappe.has_permission(base_doctype, "read", throw=True)

	cfg  = frappe.parse_json(join_config)
	rows = get_joined_data(base_doctype, frappe.as_json(cfg), limit=500)
	if len(rows) < 10:
		return []

	df      = pd.DataFrame(rows).drop(columns=["name"], errors="ignore")
	cat_cols = [c for c in df.columns if 2 <= int(df[c].nunique()) <= 30]
	if len(cat_cols) < 2:
		return []

	df_ohe = pd.get_dummies(
		df[cat_cols].fillna("(blank)").astype(str), prefix_sep="="
	).astype(bool)

	try:
		freq  = apriori(
			df_ohe, min_support=float(min_support), use_colnames=True, max_len=3
		)
		if freq.empty:
			return []
		rules = association_rules(
			freq, metric="confidence",
			min_threshold=float(min_confidence),
			num_itemsets=len(freq),
		)
		rules = (
			rules[rules["lift"] >= 1.2]
			.sort_values("lift", ascending=False)
			.head(20)
		)
	except Exception:
		return []

	return [
		dict(
			antecedents=list(r["antecedents"]),
			consequents=list(r["consequents"]),
			support=round(float(r["support"]), 3),
			confidence=round(float(r["confidence"]), 3),
			lift=round(float(r["lift"]), 2),
		)
		for _, r in rules.iterrows()
	]


def _safe_identifier(name: str) -> str:
	"""
	Validate a Frappe fieldname/doctype for use as a SQL identifier (backtick-quoted).
	Frappe fieldnames are always lowercase alphanumeric + underscore.
	Raises if the name contains unexpected characters.
	"""
	import re
	if not re.match(r'^[a-zA-Z_][a-zA-Z0-9_ ]*$', name):
		frappe.throw(f"Invalid identifier for SQL: {name!r}")
	return name


@frappe.whitelist()
def get_joined_data(base_doctype: str, join_config: str, limit: int = 1000) -> list:
	"""
	Execute dynamic LEFT JOINs from join_config and return flat rows.

	join_config JSON structure:
	  {
	    "base_doctype": "User",
	    "base_names": ["user1", "user2", ...],   // optional: filter to loaded rows
	    "nodes": [{"id": "node_0", "doctype": "User"}, ...],
	    "edges": [{
	      "src_node_id": "node_0", "src_field": "name",
	      "tgt_node_id": "node_1", "tgt_field": "user_id",
	      "selected_fields": ["department", "company"]
	    }, ...]
	  }

	Joined fields are aliased as "{TargetDoctype}__{fieldname}" in the result rows.
	All field/table names are backtick-quoted after identifier validation —
	never wrapped in frappe.db.escape() (which adds string-literal quotes, not identifier quotes).

	Security: frappe.has_permission() is checked for every DocType in the join.
	"""
	join_config = frappe.parse_json(join_config)
	frappe.has_permission(base_doctype, "read", throw=True)

	nodes = {n["id"]: n for n in join_config.get("nodes", [])}
	edges = join_config.get("edges", [])

	if not nodes:
		frappe.throw(_("join_config must contain at least one node"))

	# ── SQL building ──────────────────────────────────────────────────────────

	# Pre-compute: which src_fields does each node expose to downstream edges?
	# Needed so CT aggregate subqueries can include those fields via ANY_VALUE().
	node_downstream_src_fields: dict[str, set] = {}
	for edge in edges:
		src_id = edge.get("src_node_id")
		src_field = edge.get("src_field", "name")
		if src_id:
			node_downstream_src_fields.setdefault(src_id, set()).add(src_field)

	select_parts = ["`t0`.`name`"]
	# Include explicitly selected base-node fields (for Preview column parity)
	for _bf in (join_config.get("base_selected_fields") or []):
		_safe_bf = _safe_identifier(_bf)
		if _safe_bf and _safe_bf != "name":
			select_parts.append(f"`t0`.`{_safe_bf}`")
	joins_sql    = ""
	node_alias   = {join_config["nodes"][0]["id"]: "t0"}

	for i, edge in enumerate(edges, start=1):
		alias    = f"t{i}"
		tgt_node = nodes.get(edge.get("tgt_node_id", ""))
		if not tgt_node:
			continue
		tgt_dt = tgt_node["doctype"]
		frappe.has_permission(tgt_dt, "read", throw=True)

		src_alias = node_alias.get(edge.get("src_node_id", ""), "t0")
		node_alias[edge["tgt_node_id"]] = alias

		src_f = _safe_identifier(edge.get("src_field", "name"))
		tgt_f = _safe_identifier(edge.get("tgt_field", "name"))

		agg_cols = tgt_node.get("aggregate_cols")  # [{field, func}] for CT nodes

		if agg_cols:
			# ── Aggregate subquery: collapses CT fan-out → 1 row per parent key ──
			# e.g. LEFT JOIN (
			#   SELECT task, SUM(hours) AS `Timesheet Detail__hours`
			#   FROM `tabTimesheet Detail` GROUP BY task
			# ) t1 ON t0.name = t1.task
			VALID_FUNCS = frozenset({"SUM", "COUNT", "AVG", "MIN", "MAX"})
			sub_selects = [f"`{tgt_f}`"]  # group-by key always first

			# If downstream edges join FROM this CT node, include those src_fields
			# via ANY_VALUE() so they are accessible in the subquery result set.
			tgt_node_id = edge.get("tgt_node_id", "")
			extra_join_fields = node_downstream_src_fields.get(tgt_node_id, set())
			for ef in extra_join_fields:
				safe_ef = _safe_identifier(ef)
				if safe_ef and safe_ef != tgt_f:
					sub_selects.append(f"MIN(`{safe_ef}`) AS `{safe_ef}`")

			for col in agg_cols:
				safe_f = _safe_identifier(col.get("field", ""))
				if not safe_f:
					continue
				func = str(col.get("func", "SUM")).upper()
				if func not in VALID_FUNCS:
					func = "SUM"
				col_alias = f"{tgt_dt}__{safe_f}"
				sub_selects.append(f"{func}(`{safe_f}`) AS `{col_alias}`")
				select_parts.append(f"`{alias}`.`{col_alias}`")

			subquery = (
				f"(SELECT {', '.join(sub_selects)}"
				f" FROM `tab{tgt_dt}`"
				f" GROUP BY `{tgt_f}`)"
			)
			joins_sql += (
				f"\nLEFT JOIN {subquery} `{alias}`"
				f" ON `{src_alias}`.`{src_f}` = `{alias}`.`{tgt_f}`"
			)
		else:
			# ── Flat JOIN (regular non-CT nodes) ──────────────────────────────
			# Backtick-quote field identifiers (NOT frappe.db.escape — wrong quote type)
			for field in edge.get("selected_fields", []):
				safe_field = _safe_identifier(field)
				col_alias  = f"{tgt_dt}__{safe_field}"   # e.g. "Employee__date_of_birth"
				select_parts.append(f"`{alias}`.`{safe_field}` AS `{col_alias}`")

			joins_sql += (
				f"\nLEFT JOIN `tab{tgt_dt}` `{alias}`"
				f" ON `{src_alias}`.`{src_f}` = `{alias}`.`{tgt_f}`"
			)

	# ── Optional WHERE filter: restrict to the names already loaded in the grid ──
	# This ensures Apply returns exactly the rows the user sees, regardless of limit.
	where_sql  = ""
	where_vals = ()
	base_names = join_config.get("base_names") or []
	if base_names:
		placeholders = ", ".join(["%s"] * len(base_names))
		where_sql  = f"\nWHERE `t0`.`name` IN ({placeholders})"
		where_vals = tuple(base_names)

	# Ensure base_doctype exists before building raw SQL (defence-in-depth)
	if not frappe.db.exists("DocType", base_doctype):
		frappe.throw(_(f"Unknown DocType: {base_doctype}"))
	sql = (
		f"SELECT {', '.join(select_parts)}"
		f"\nFROM `tab{base_doctype}` `t0`"
		f"{joins_sql}"
		f"{where_sql}"
		f"\nLIMIT {frappe.utils.cint(limit)}"
	)
	rows = frappe.db.sql(sql, values=where_vals or None, as_dict=True)

	# ── V2.5: per-node Transform (row filters + computed columns) ─────────────
	node_list = list(nodes.values()) if nodes else []
	if node_list:
		rows = _apply_node_transforms(rows, node_list)

	return rows


def _apply_node_transforms(rows: list, nodes: list) -> list:
	"""
	Post-process join result with per-node row filters and computed columns.

	Each node may carry:
	  row_filter:    [{field, op, value}]  — keep rows matching ALL conditions
	  computed_cols: [{key, label, expr}]  — evaluate Python expr via frappe.safe_eval
	                                          with `row` context variable

	Field names in row_filter are matched with or without the DocType__ prefix.
	"""
	import operator as op_module

	OPS = {
		"=":  "eq", "!=": "ne",
		">":  "gt", "<":  "lt",
		">=": "ge", "<=": "le",
	}
	SAFE_ENV = {
		"__builtins__": {},
		"round": round, "len": len, "str": str,
		"int": int, "float": float, "abs": abs,
		"min": min, "max": max, "bool": bool,
	}

	for node in nodes:
		doctype = node.get("doctype", "")
		prefix  = f"{doctype}__"

		# ── Row filter ────────────────────────────────────────────────────────
		for f in node.get("row_filter", []):
			raw_field = f.get("field", "")
			op_key    = f.get("op", "=")
			val       = f.get("value", "")

			# Resolve fieldname with or without prefix
			field = (
				raw_field if raw_field.startswith(prefix)
				else f"{prefix}{raw_field}"
			)

			if op_key == "like":
				needle = str(val).replace("%", "").lower()
				rows = [r for r in rows if needle in str(r.get(field, "") or "").lower()]

			elif op_key == "in":
				allowed = {v.strip() for v in str(val).split(",")}
				rows = [r for r in rows if str(r.get(field, "") or "") in allowed]

			else:
				op_fn = getattr(op_module, OPS.get(op_key, "eq"))
				kept  = []
				for r in rows:
					cell = r.get(field, "") or ""
					try:
						kept.append(op_fn(float(cell), float(val)))
						if kept[-1]:
							pass
						else:
							kept.pop()
							continue
					except (ValueError, TypeError):
						kept.append(op_fn(str(cell), str(val)))
					if kept[-1]:
						pass
					else:
						kept.pop()
				# Rebuild rows from kept booleans — we need the actual row objects
				# Re-approach: filter in one pass
				new_rows = []
				for r in rows:
					cell = r.get(field, "") or ""
					try:
						if op_fn(float(cell), float(val)):
							new_rows.append(r)
					except (ValueError, TypeError):
						if op_fn(str(cell), str(val)):
							new_rows.append(r)
				rows = new_rows

		# ── Computed columns ──────────────────────────────────────────────────
		for col in node.get("computed_cols", []):
			key  = col.get("key", "")
			expr = col.get("expr", "")
			if not key or not expr:
				continue
			for r in rows:
				# Expose both prefixed and un-prefixed keys as context variables
				row_ctx: dict = {}
				for k, v in r.items():
					row_ctx[k] = v
					if k.startswith(prefix):
						row_ctx[k[len(prefix):]] = v
				try:
					r[key] = frappe.safe_eval(expr, SAFE_ENV, {"row": row_ctx, **row_ctx})
				except Exception:
					r[key] = "#ERR!"

	return rows


# ── V2.5 — IntelliLookup: detect_lookup ───────────────────────────────────────

@frappe.whitelist()
def detect_lookup(src_doctype: str, tgt_doctype: str) -> list:
	"""
	3-Layer IntelliLookup detection for Sheet Tabs (V2.5).

	Layer 1 — Direct Link field (meta, instant):
	  src_doctype has a Link→tgt_doctype field → confidence 1.0
	  tgt_doctype has a Link→src_doctype field → confidence 0.9 (reverse)

	Layer 2 — Value sampling (if Layer 1 empty):
	  Sample up to 15 unique values from candidate Data/Link fields on src.
	  For each, check frappe.db.exists(tgt_doctype, val).
	  If ≥70% match → valid candidate, confidence = match_ratio.

	Returns [{src_field, tgt_field, label, layer, confidence}] sorted by confidence desc.
	Returns [] if no link candidate found with confidence ≥ 0.3.
	"""
	_check_doctype_permission(src_doctype)
	_check_doctype_permission(tgt_doctype)

	results = []

	# ── Layer 1A: src has Link→tgt ────────────────────────────────────────────
	for df in frappe.get_meta(src_doctype).fields:
		if df.fieldtype == "Link" and df.options == tgt_doctype:
			results.append({
				"src_field":  df.fieldname,
				"tgt_field":  "name",
				"label":      df.label or df.fieldname,
				"layer":      1,
				"confidence": 1.0,
			})

	if results:
		return results

	# ── Layer 1B: tgt has Link→src (reverse) ─────────────────────────────────
	for df in frappe.get_meta(tgt_doctype).fields:
		if df.fieldtype == "Link" and df.options == src_doctype:
			results.append({
				"src_field":  "name",
				"tgt_field":  df.fieldname,
				"label":      df.label or df.fieldname,
				"layer":      1,
				"confidence": 0.9,
			})

	if results:
		return results

	# ── Layer 2: value-sampling on Data / Link fields ─────────────────────────
	SAMPLE_LIMIT = 15
	SKIP_FT = {
		"Section Break", "Column Break", "Tab Break", "Fold", "Heading",
		"HTML", "Custom HTML", "Table", "Table MultiSelect", "Password",
		"Text", "Long Text", "Code", "Attach", "Attach Image",
		"Date", "Datetime", "Time", "Check", "Int", "Float", "Currency",
		"Percent", "Rating", "Duration",
	}

	for df in frappe.get_meta(src_doctype).fields:
		if df.fieldtype in SKIP_FT or df.is_virtual:
			continue

		raw = frappe.get_all(src_doctype, pluck=df.fieldname, limit=SAMPLE_LIMIT)
		values = list({str(v) for v in raw if v})[:SAMPLE_LIMIT]
		if not values:
			continue

		hits = sum(
			1 for v in values
			if frappe.db.exists(tgt_doctype, v)
		)
		ratio = hits / len(values)
		if ratio >= 0.3:
			results.append({
				"src_field":  df.fieldname,
				"tgt_field":  "name",
				"label":      df.label or df.fieldname,
				"layer":      2,
				"confidence": round(ratio, 2),
			})

	return sorted(results, key=lambda x: -x["confidence"])


# ── V2.5 — Canvas AI Analysis: detect_anomalies + cluster_data ────────────────

@frappe.whitelist()
def detect_anomalies(
	rows: str,
	numeric_fields: str,
	contamination: float = 0.1,
) -> list:
	"""
	Run Isolation Forest anomaly detection on the joined result rows.

	Args:
	    rows:            JSON-encoded list of flat row dicts (from get_joined_data).
	    numeric_fields:  JSON-encoded list of fieldnames to use as features.
	    contamination:   Expected fraction of outliers (0.05 – 0.30).

	Returns the same rows list with two new keys per row:
	    _anomaly_score: float (higher = more normal; negative = anomalous)
	    _is_anomaly:    bool

	Minimum 5 rows required — returns unchanged rows if fewer.
	"""
	from sklearn.ensemble import IsolationForest
	import numpy as np, json

	rows_data = json.loads(rows)
	fields    = json.loads(numeric_fields)

	if len(rows_data) < 5 or not fields:
		for r in rows_data:
			r["_anomaly_score"] = 0.0
			r["_is_anomaly"]    = False
		return rows_data

	contamination = max(0.01, min(0.5, float(contamination)))

	X = np.array([
		[float(r.get(f, 0) or 0) for f in fields]
		for r in rows_data
	])

	clf    = IsolationForest(contamination=contamination, random_state=42)
	clf.fit(X)
	scores = clf.decision_function(X)  # more negative = more anomalous
	labels = clf.predict(X)            # -1 = anomaly, +1 = normal

	for i, r in enumerate(rows_data):
		r["_anomaly_score"] = round(float(scores[i]), 4)
		r["_is_anomaly"]    = bool(labels[i] == -1)

	return rows_data


@frappe.whitelist()
def cluster_data(
	rows: str,
	numeric_fields: str,
	n_clusters: int = 0,
) -> dict:
	"""
	K-Means clustering on the joined result rows.

	Args:
	    rows:           JSON-encoded list of flat row dicts.
	    numeric_fields: JSON-encoded list of fieldnames to use as features.
	    n_clusters:     Number of clusters (0 = auto-select via silhouette score).

	Returns:
	    {
	      "rows":       same rows with "_cluster" (int, 0-based) added,
	      "n_clusters": int — number of clusters used,
	      "summary":    [{cluster, <field>: centroid_value, ...}]
	    }

	Minimum 6 rows required; n_clusters auto-selects between k=2..6.
	"""
	from sklearn.cluster import MiniBatchKMeans
	from sklearn.preprocessing import StandardScaler
	from sklearn.metrics import silhouette_score
	import numpy as np, json

	rows_data = json.loads(rows)
	fields    = json.loads(numeric_fields)
	k         = frappe.utils.cint(n_clusters)

	if len(rows_data) < 6 or not fields:
		for r in rows_data:
			r["_cluster"] = 0
		return {"rows": rows_data, "n_clusters": 1, "summary": []}

	X     = np.array([[float(r.get(f, 0) or 0) for f in fields] for r in rows_data])
	scaler = StandardScaler()
	X_s   = scaler.fit_transform(X)

	# Auto-select k via silhouette score when k=0
	if k <= 0:
		best_k, best_sc = 2, -1.0
		for ck in range(2, min(7, len(rows_data))):
			labels_trial = MiniBatchKMeans(ck, random_state=42).fit_predict(X_s)
			try:
				sc = silhouette_score(X_s, labels_trial)
			except Exception:
				sc = -1.0
			if sc > best_sc:
				best_k, best_sc = ck, sc
		k = best_k

	km = MiniBatchKMeans(k, random_state=42).fit(X_s)

	for i, r in enumerate(rows_data):
		r["_cluster"] = int(km.labels_[i])

	# Cluster centroids in original (un-scaled) units
	centroids_unscaled = scaler.inverse_transform(km.cluster_centers_)
	summary = [
		{"cluster": ci, **{f: round(float(v), 4) for f, v in zip(fields, row)}}
		for ci, row in enumerate(centroids_unscaled)
	]

	return {"rows": rows_data, "n_clusters": k, "summary": summary}


# ── V2.5+ — Generative BI: NL Query → Auto-Canvas ────────────────────────────

def _extract_doctypes_from_query(query: str, threshold: float = 0.65) -> list:
	"""
	Extract DocType names from a natural language query using fuzzy matching.

	Uses rapidfuzz to match query tokens against all non-single, non-virtual DocTypes.
	Returns sorted list of {doctype, score, matched_token} dictionaries.

	Args:
	    query: Natural language query (e.g., "employee to salary slip flow")
	    threshold: Minimum fuzzy match score (0-1) to consider a match

	Returns:
	    [{doctype: str, score: float, matched_token: str}] sorted by score desc

	Examples:
	    "employee to salary slip" → [Employee, Salary Slip]
	    "user project task" → [User, Project, Task]
	"""
	from rapidfuzz import process, fuzz

	# Get all non-single, non-virtual DocTypes
	all_doctypes = frappe.get_all(
		"DocType",
		filters={
			"issingle": 0,
			"is_virtual": 0,
		},
		pluck="name",
	)

	if not all_doctypes:
		return []

	# Enhanced stopwords for natural language
	STOPWORDS = {
		"to", "from", "and", "or", "the", "a", "an", "of", "for", "with",
		"flow", "end", "give", "me", "show", "get", "find", "list", "all",
		"connect", "link", "join", "relate", "relationship", "between",
		"their", "my", "our", "is", "are", "was", "were", "have", "has",
		"on", "in", "at", "by", "via", "through", "using", "working",
		"assigned", "related", "linked", "connected", "associated",
		"what", "which", "where", "when", "how", "who", "that", "this",
		"i", "want", "need", "can", "you", "we", "they", "them", "it"
	}

	# Pre-process query to handle common patterns
	query_lower = query.lower()

	# Pattern matching for natural language structures
	import re
	patterns = [
		(r"show me (.*)", r"\1"),  # "show me projects" → "projects"
		(r"connect to (.*)", r"\1"),  # "connect to timesheet" → "timesheet"
		(r"link with (.*)", r"\1"),  # "link with salary" → "salary"
		(r"join with (.*)", r"\1"),  # "join with tasks" → "tasks"
		(r".*working on (.*)", r"\1"),  # "employees working on projects" → "projects"
		(r".*assigned to (.*)", r"\1"),  # "tasks assigned to users" → "users"
		(r"get all (.*)", r"\1"),  # "get all invoices" → "invoices"
	]

	for pattern, replacement in patterns:
		match = re.match(pattern, query_lower)
		if match:
			query_lower = re.sub(pattern, replacement, query_lower).strip()
			break

	# Tokenize query (split on spaces, remove stopwords)
	tokens = [
		t.strip().lower()
		for t in query_lower.split()
		if t.strip().lower() not in STOPWORDS and len(t.strip()) > 2
	]

	if not tokens:
		return []

	# Try matching full query first (for multi-word DocTypes)
	matches = []
	seen_doctypes = set()

	# Match entire cleaned query (handles "sales order", "salary slip" etc.)
	full_query_results = process.extract(
		query_lower,
		all_doctypes,
		scorer=fuzz.token_sort_ratio,
		limit=5,
	)

	for doctype, score, _ in full_query_results:
		normalized_score = score / 100.0
		if normalized_score >= max(threshold - 0.1, 0.5):  # Slightly lower threshold for full query
			matches.append({
				"doctype": doctype,
				"score": round(normalized_score, 2),
				"matched_token": query_lower,
			})
			seen_doctypes.add(doctype)

	# Match each token against all DocTypes (for partial matches)
	for token in tokens:
		# Use rapidfuzz process.extract for best matches
		results = process.extract(
			token,
			all_doctypes,
			scorer=fuzz.token_sort_ratio,
			limit=3,  # Top 3 matches per token
		)

		for doctype, score, _ in results:
			normalized_score = score / 100.0
			if normalized_score >= threshold and doctype not in seen_doctypes:
				matches.append({
					"doctype": doctype,
					"score": round(normalized_score, 2),
					"matched_token": token,
				})
				seen_doctypes.add(doctype)

	# Sort by score descending
	return sorted(matches, key=lambda x: -x["score"])


def _auto_select_fields(doctype: str, max_fields: int = 5) -> list:
	"""
	Auto-select the most relevant fields for a DocType to show in canvas output.

	Prioritizes:
	1. Link fields (for relationship context)
	2. Select/Data fields with short labels (key identifiers)
	3. Status/state fields (workflow info)
	4. Numeric fields (metrics)

	Excludes system fields, long text, attachments, etc.

	Args:
	    doctype: DocType name
	    max_fields: Maximum fields to return

	Returns:
	    [fieldname, fieldname, ...] sorted by relevance
	"""
	SKIP_TYPES = {
		"Section Break", "Column Break", "Tab Break", "Fold", "Heading",
		"HTML", "Custom HTML", "Table", "Table MultiSelect", "Password",
		"Long Text", "Text Editor", "Markdown Editor", "HTML Editor",
		"Attach", "Attach Image", "Signature", "Geolocation",
	}

	PRIORITY_TYPES = {
		"Link": 100,
		"Select": 80,
		"Data": 70,
		"Check": 60,
		"Currency": 50,
		"Int": 50,
		"Float": 50,
	}

	STATUS_KEYWORDS = {"status", "state", "stage", "workflow"}

	try:
		meta = frappe.get_meta(doctype)
	except Exception:
		# DocType doesn't exist or is invalid - return empty list
		return []

	scored_fields = []

	for df in meta.fields:
		if df.fieldtype in SKIP_TYPES or df.is_virtual or df.hidden:
			continue

		# Base score from field type
		score = PRIORITY_TYPES.get(df.fieldtype, 10)

		# Boost status/state fields
		label_lower = (df.label or df.fieldname).lower()
		if any(kw in label_lower for kw in STATUS_KEYWORDS):
			score += 50

		# Penalty for long labels (likely description fields)
		if len(df.label or df.fieldname) > 30:
			score -= 20

		# Boost required fields
		if df.reqd:
			score += 30

		scored_fields.append({
			"fieldname": df.fieldname,
			"score": score,
			"label": df.label or df.fieldname,
		})

	# Sort by score descending, take top N
	scored_fields.sort(key=lambda x: -x["score"])
	return [f["fieldname"] for f in scored_fields[:max_fields]]


@frappe.whitelist()
def generate_canvas_options(query: str, base_doctype: str = None) -> dict:
	"""
	Generate canvas options via BACKWARD SEARCH from base_doctype.

	CRITICAL CHANGE: Always starts from base_doctype (current DocType).
	Uses backward BFS from target entity to find ALL paths to base.

	Algorithm:
	1. Extract target DocType from query (e.g., "to sales order" → Sales Order)
	2. Build directed graph with reverse edges for backward search
	3. **Backward BFS** from target → base_doctype
	4. Find ALL paths (no limit), rank by quality
	5. Reverse paths to show: base → ... → target

	Args:
	    query: Target entity query (e.g., "to sales order", "employee to timesheet")
	    base_doctype: Starting DocType (MANDATORY) - current Excel View DocType

	Returns:
	    {
	      "query": str,
	      "base_doctype": str,
	      "extracted_entities": [{doctype, score, matched_token}],
	      "options": [{path: [base_doctype, ..., target]}]  # Always base-first!
	    }
	"""
	import networkx as nx

	# Step 0: Validate base_doctype
	if not base_doctype:
		frappe.throw(_("base_doctype is required"))

	frappe.has_permission(base_doctype, "read", throw=True)

	# Step 1: Extract target DocType from query
	# Remove base_doctype from query for better target matching
	query_clean = query.lower().replace(base_doctype.lower(), "").strip()
	entities = _extract_doctypes_from_query(query_clean or query, threshold=0.55)

	# Filter out base_doctype from entities (we already know it's the start)
	entities = [e for e in entities if e["doctype"] != base_doctype]

	if not entities:
		return {
			"query": query,
			"base_doctype": base_doctype,
			"extracted_entities": [],
			"options": [],
			"message": f"Could not identify target DocType from query. Base: {base_doctype}",
		}

	# Step 2: Build graph from cached edges + child table relationships
	G = nx.Graph()  # Undirected for bidirectional path finding
	edges_list = _get_all_link_edges()

	# Add all cached edges (Link, Dynamic Link, Child Table sources)
	for e in edges_list:
		# Add edges in both directions (undirected)
		G.add_edge(e["doctype"], e["target"], **e)
		G.add_edge(e["target"], e["doctype"], **e)

	# CRITICAL: Add child table → parent relationships via "parent" field
	# This allows paths like: Timesheet Detail (CT) → Timesheet (parent)
	# Query: SELECT parent AS doctype, options AS child FROM tabDocField WHERE fieldtype='Table'
	# IMPORTANT: Join with tabDocType to ensure both parent and child DocTypes exist
	child_parent_edges = frappe.db.sql("""
		SELECT DISTINCT df.parent AS parent_doctype, df.options AS child_doctype
		FROM `tabDocField` df
		JOIN `tabDocType` parent_dt ON parent_dt.name = df.parent
		JOIN `tabDocType` child_dt ON child_dt.name = df.options
		WHERE df.fieldtype = 'Table'
		  AND df.options IS NOT NULL
		  AND df.options != ''
		  AND parent_dt.issingle = 0
		  AND child_dt.istable = 1
		UNION
		SELECT DISTINCT cf.dt AS parent_doctype, cf.options AS child_doctype
		FROM `tabCustom Field` cf
		JOIN `tabDocType` parent_dt ON parent_dt.name = cf.dt
		JOIN `tabDocType` child_dt ON child_dt.name = cf.options
		WHERE cf.fieldtype = 'Table'
		  AND cf.options IS NOT NULL
		  AND cf.options != ''
		  AND parent_dt.issingle = 0
		  AND child_dt.istable = 1
	""", as_dict=True)

	for edge in child_parent_edges:
		parent_dt = edge["parent_doctype"]
		child_dt = edge["child_doctype"]

		# Add bidirectional edges: Child.parent → Parent.name
		G.add_edge(
			child_dt, parent_dt,
			doctype=child_dt, target=parent_dt,
			fieldname="parent", label="Parent",
			is_child_src=1, is_child_to_parent=True
		)
		G.add_edge(
			parent_dt, child_dt,
			doctype=parent_dt, target=child_dt,
			fieldname="(child)", label="Child Table",
			is_child_src=0, is_parent_to_child=True
		)

	# Step 3: Find ALL paths from base_doctype to each target entity
	# CRITICAL: Search from base → target (not bidirectional pairs!)
	options = []
	option_id = 0

	# Module sets for dynamic semantic scoring (defined once per call, not per path)
	_WEIRD_MODULES = frozenset({
		"Core", "Email", "Geo", "Printing", "Custom",
		"Desk", "Social", "Data Migration", "Portal", "Integrations",
	})
	_GOOD_MODULES = frozenset({
		"Selling", "Buying", "Accounts", "HR", "Manufacturing",
		"Projects", "Stock", "Assets", "Payroll", "CRM", "Loans",
		"Quality Management", "Support", "Maintenance",
	})

	for entity in entities:
		target_dt = entity["doctype"]
		target_score = entity["score"]

		# Permission check
		try:
			if not frappe.has_permission(target_dt, "read"):
				continue
		except Exception:
			continue

		# Find paths from base → target with smart performance limits
		# Use cutoff=5 (max 4 hops) to avoid timeout on complex graphs
		try:
			# CRITICAL: Use all_shortest_paths (BFS) to guarantee EVERY minimum-hop path
			# is collected — not just one. DFS (all_simple_paths) misses shorter paths when
			# its budget fills up with longer paths explored first.
			try:
				all_shortest = list(nx.all_shortest_paths(G, source=base_doctype, target=target_dt))
			except (nx.NetworkXNoPath, nx.NodeNotFound):
				all_shortest = []

			# Seed with all minimum-hop paths (BFS — guaranteed complete)
			seen_path_tuples = {tuple(p) for p in all_shortest}
			all_paths = list(all_shortest)

			# Fill remaining budget with longer paths via DFS
			if len(all_paths) < 100:
				path_generator = nx.all_simple_paths(
					G, source=base_doctype, target=target_dt, cutoff=5
				)
				for path in path_generator:
					t = tuple(path)
					if t not in seen_path_tuples:
						seen_path_tuples.add(t)
						all_paths.append(path)
					if len(all_paths) >= 100:
						break

		except (nx.NetworkXNoPath, nx.NodeNotFound):
			all_paths = []

		if not all_paths:
			continue

		# Sort paths by length first (shortest first for best quality)
		all_paths.sort(key=lambda p: len(p))

		# Generate options from paths
		for path_idx, path in enumerate(all_paths):  # No limit - we'll sort later
			# Validate all DocTypes in path exist before processing
			all_doctypes_valid = True
			for dt in path:
				try:
					frappe.get_meta(dt)
				except Exception:
					# DocType doesn't exist - skip this entire path
					all_doctypes_valid = False
					break

			if not all_doctypes_valid:
				continue

			# Build edge details for this path
			path_edges = []
			edge_quality_scores = []

			for k in range(len(path) - 1):
				from_dt = path[k]
				to_dt = path[k + 1]

				# Get edge data from graph
				edge_data = G.get_edge_data(from_dt, to_dt) or {}

				# Determine fields + edge quality based on edge direction
				# Parent-child edges use a "(child)" placeholder — replace with real fields.
				# edge_data["doctype"] == parent_dt always (second add_edge wins in undirected G).
				# Detect direction by comparing edge_data["doctype"] with from_dt.
				if edge_data.get("is_parent_to_child") or edge_data.get("is_child_to_parent"):
					if edge_data.get("doctype") == from_dt:
						# from_dt is the parent → traversing parent→child
						_src_f, _tgt_f = "name", "parent"
					else:
						# from_dt is the child → traversing child→parent
						_src_f, _tgt_f = "parent", "name"
					path_edges.append({
						"from": from_dt, "to": to_dt,
						"src_field": _src_f, "tgt_field": _tgt_f,
						"label": edge_data.get("label", ""),
						"is_child_src": edge_data.get("is_child_src", 0),
						"is_dynamic": False,
					})
				elif edge_data.get("doctype") == from_dt:
					# Forward Link edge: from_dt.fieldname → to_dt.name
					path_edges.append({
						"from": from_dt, "to": to_dt,
						"src_field": edge_data.get("fieldname", "name"),
						"tgt_field": "name",
						"label": edge_data.get("label", ""),
						"is_child_src": edge_data.get("is_child_src", 0),
						"is_dynamic": edge_data.get("is_dynamic", False),
					})
				else:
					# Reverse Link edge: from_dt.name → to_dt.fieldname
					path_edges.append({
						"from": from_dt, "to": to_dt,
						"src_field": "name",
						"tgt_field": edge_data.get("fieldname", "name"),
						"label": edge_data.get("label", ""),
						"is_child_src": edge_data.get("is_child_src", 0),
						"is_dynamic": edge_data.get("is_dynamic", False),
					})

				# Edge quality scoring per edge (must be inside loop — each edge scored)
				# Meta Link = 1.0, Parent-Child = 0.9, Dynamic Link = 0.7, ML = 0.3
				if not edge_data:
					edge_quality_scores.append(0.3)
				elif edge_data.get("is_child_to_parent") or edge_data.get("is_parent_to_child"):
					edge_quality_scores.append(0.9)
				elif edge_data.get("is_dynamic"):
					edge_quality_scores.append(0.7)
				elif edge_data.get("fieldname"):
					edge_quality_scores.append(1.0 if "is_child_src" in edge_data else 0.3)
				else:
					edge_quality_scores.append(0.5)

			# Advanced confidence scoring 🔥
			# Factor 1: Target extraction confidence (0.55-1.0)
			entity_conf = target_score

			# Factor 2: Path length penalty (shorter = better, but not too aggressive)
			# 2 nodes = 1.0, 3 nodes = 0.8, 4 nodes = 0.6, 5 nodes = 0.5
			path_len_score = max(0.3, 1.0 - (len(path) - 2) * 0.2)

			# Factor 3: Edge quality (average of all edges in path)
			edge_quality_avg = sum(edge_quality_scores) / len(edge_quality_scores) if edge_quality_scores else 0.5

			# Factor 4: Semantic relevance — dynamic, using Frappe DocType metadata
			# No hardcoded DocType names — driven by module metadata + is_submittable flag.
			intermediates = path[1:-1] if len(path) > 2 else []
			weird_count = 0
			good_count = 0
			for _inter_dt in intermediates:
				try:
					_meta = frappe.get_meta(_inter_dt, cached=True)
					if getattr(_meta, "is_submittable", 0):
						good_count += 1  # Submittable = core transactional doc
					elif _meta.module in _WEIRD_MODULES:
						weird_count += 1
					elif _meta.module in _GOOD_MODULES:
						good_count += 1
					# else: neutral (Setup, Website, etc.)
				except Exception:
					pass  # Unknown/inaccessible → neutral

			# Semantic score: penalize weird paths, boost good ones
			if weird_count > 0:
				semantic_score = max(0.3, 1.0 - weird_count * 0.3)
			elif good_count > 0:
				semantic_score = min(1.0, 0.8 + good_count * 0.1)
			else:
				semantic_score = 0.6  # Neutral

			# Factor 5: Canonical child-table bridge bonus
			# Pattern: A → CT → B where CT has explicit Link to A AND CT is a child of B
			# e.g. [Sales Order, Sales Invoice Item, Sales Invoice]:
			#   SII.sales_order → Sales Order (is_child_src=1, direct link, not parent edge)
			#   SII → Sales Invoice via parent (is_child_to_parent=True)
			# Non-canonical CT cross-links (DNI.against_sales_order + DNI.against_sales_invoice)
			# get NO bonus — they are opportunistic references, not the canonical join design.
			# Canonical bridge: CT must DIRECTLY bridge source → CT → target (path endpoints only).
			# Requiring path[k]==path[0] AND path[k+2]==path[-1] prevents false positives like
			# [Customer, Asset, Item, Packed Item, Sales Order] triggering on Item→Packed→SO.
			canonical_bridge_count = 0
			for _k in range(len(path) - 2):
				if path[_k] != path[0] or path[_k + 2] != path[-1]:
					continue  # Only fire when CT bridges source→target directly
				_e1 = G.get_edge_data(path[_k], path[_k + 1]) or {}
				_e2 = G.get_edge_data(path[_k + 1], path[_k + 2]) or {}
				if (
					_e1.get("is_child_src") == 1
					and not _e1.get("is_child_to_parent")
					and not _e1.get("is_parent_to_child")
					and (_e2.get("is_child_to_parent") or _e2.get("is_parent_to_child"))
				):
					canonical_bridge_count += 1
			ct_bonus = 1.0 + canonical_bridge_count * 0.15
			ct_bonus = min(ct_bonus, 1.3)  # Cap at 30%

			# Final confidence: weighted combination
			confidence = round(
				entity_conf * 0.25 +         # 25% entity match
				path_len_score * 0.20 +      # 20% path length
				edge_quality_avg * 0.30 +    # 30% edge quality (MOST IMPORTANT!)
				semantic_score * 0.25,       # 25% semantic relevance
				3
			) * ct_bonus

			confidence = min(confidence, 1.0)  # Cap at 1.0

			# Estimate total fields
			estimated_fields = sum(len(_auto_select_fields(dt, 5)) for dt in path[1:])

			# Generate title and description
			if len(path) == 2:
				title = f"Direct: {path[0]} → {path[-1]}"
				desc = f"Simple join between {path[0]} and {path[-1]}"
			else:
				title = f"Via {' → '.join(path[1:-1])}: {path[0]} → {path[-1]}"
				desc = f"Join path: {' → '.join(path)}"

			options.append({
				"id": f"opt_{option_id}",
				"title": title,
				"description": desc,
				"confidence": confidence,
				"path": path,
				"edges": path_edges,
				"estimated_fields": estimated_fields,
			})
			option_id += 1

	# Sort options by confidence (desc) then path length (asc)
	# This ensures shortest, highest-quality paths appear first
	options.sort(key=lambda x: (-x["confidence"], len(x["path"])))

	return {
		"query": query,
		"base_doctype": base_doctype,
		"extracted_entities": entities,
		"options": options,  # NO LIMIT - return ALL paths!
		"total_paths": len(options),
	}


@frappe.whitelist()
def build_canvas_from_option(option: str, base_doctype: str) -> dict:
	"""
	Build canvas configuration from selected path option.
	Creates nodes and edges for the frontend to render.

	Args:
		option: JSON string of selected option from generate_canvas_options
		base_doctype: Base DocType (starting node)

	Returns:
		Canvas configuration with nodes and edges
	"""
	import json

	option_data = json.loads(option) if isinstance(option, str) else option
	path = option_data["path"]
	path_edges = option_data["edges"]

	# Create node configurations
	nodes = []
	node_id_counter = 1
	doctype_to_node_id = {}

	# Horizontal layout: space nodes 350px apart
	x_spacing = 350
	y_position = 200

	for idx, doctype in enumerate(path):
		node_id = f"node_{node_id_counter}"
		doctype_to_node_id[doctype] = node_id
		node_id_counter += 1

		nodes.append({
			"id": node_id,
			"doctype": doctype,
			"x": 100 + (idx * x_spacing),
			"y": y_position,
		})

	# Create edge configurations
	edges = []
	for edge_data in path_edges:
		# Edge structure has "from" and "to" fields
		src_doctype = edge_data["from"]
		tgt_doctype = edge_data["to"]

		# Get node IDs
		src_node_id = doctype_to_node_id.get(src_doctype)
		tgt_node_id = doctype_to_node_id.get(tgt_doctype)

		if not src_node_id or not tgt_node_id:
			continue

		# Get field names from edge data (already has src_field and tgt_field)
		src_field = edge_data.get("src_field", "name")
		tgt_field = edge_data.get("tgt_field", "name")

		# Auto-select important fields from target DocType
		selected_fields = _auto_select_fields(tgt_doctype, max_fields=5)

		edges.append({
			"src_node_id": src_node_id,
			"tgt_node_id": tgt_node_id,
			"src_field": src_field,
			"tgt_field": tgt_field,
			"selected_fields": selected_fields,
		})

	return {
		"base_doctype": base_doctype,
		"nodes": nodes,
		"edges": edges,
	}



def _build_chained_canvas(base_doctype: str, entity_chain: list) -> dict | None:
	"""Build a multi-hop canvas by chaining paths: base → e1 → e2 → ...

	For a journey query like "Customer → Sales Order → Sales Invoice",
	this finds the best path for each consecutive pair and stitches them into
	one canvas config with all nodes and edges.

	Args:
	    base_doctype: Starting DocType
	    entity_chain: Ordered list of target entities (excluding base_doctype)

	Returns:
	    Canvas config dict (nodes + edges) or None if no path found for first leg
	"""
	import json as _json

	nodes = []
	edges = []
	node_id_counter = 1
	doctype_to_node_id: dict[str, str] = {}
	x_offset = 100
	X_SPACING = 350

	# Add base node
	base_node_id = f"node_{node_id_counter}"
	doctype_to_node_id[base_doctype] = base_node_id
	nodes.append({"id": base_node_id, "doctype": base_doctype, "x": x_offset, "y": 200})
	node_id_counter += 1
	x_offset += X_SPACING

	current_source = base_doctype
	for target in entity_chain:
		path_result = generate_canvas_options(target, current_source)
		if not path_result.get("options"):
			# No direct path — try to add node anyway as orphan
			if target not in doctype_to_node_id:
				nid = f"node_{node_id_counter}"
				doctype_to_node_id[target] = nid
				nodes.append({"id": nid, "doctype": target, "x": x_offset, "y": 200})
				node_id_counter += 1
				x_offset += X_SPACING
			current_source = target
			continue

		best = path_result["options"][0]
		path = best["path"]        # e.g. ["Customer", "Sales Order"]
		path_edges = best["edges"]  # [{from, to, src_field, tgt_field}, ...]

		# Add intermediate nodes from the found path (skip first — already added as current_source)
		for dt in path[1:]:
			if dt not in doctype_to_node_id:
				nid = f"node_{node_id_counter}"
				doctype_to_node_id[dt] = nid
				nodes.append({"id": nid, "doctype": dt, "x": x_offset, "y": 200})
				node_id_counter += 1
				x_offset += X_SPACING

		# Add edges for this leg
		for edge_data in path_edges:
			src_dt = edge_data["from"]
			tgt_dt = edge_data["to"]
			src_nid = doctype_to_node_id.get(src_dt)
			tgt_nid = doctype_to_node_id.get(tgt_dt)
			if src_nid and tgt_nid:
				edges.append({
					"src_node_id": src_nid,
					"tgt_node_id": tgt_nid,
					"src_field": edge_data.get("src_field", "name"),
					"tgt_field": edge_data.get("tgt_field", "name"),
					"selected_fields": _auto_select_fields(tgt_dt, max_fields=5),
				})

		current_source = path[-1]  # End of this leg becomes source for next leg

	if not edges:
		return None

	return {"base_doctype": base_doctype, "nodes": nodes, "edges": edges}


def _check_rate_limit(action: str, limit: int = 30, window_sec: int = 60) -> None:
	"""Simple Redis sliding-window rate limiter per user+action.

	Raises frappe.TooManyRequestsError if limit exceeded.
	"""
	user = frappe.session.user or "guest"
	key = f"ev_rl:{action}:{user}"
	pipe = frappe.cache.pipeline()
	pipe.incr(key)
	pipe.expire(key, window_sec)
	results = pipe.execute()
	count = results[0]
	if count > limit:
		frappe.throw(
			_(f"Too many requests. Max {limit} per {window_sec}s. Please wait."),
			exc=frappe.TooManyRequestsError,
		)


@frappe.whitelist()
def genbi_record_alias_feedback(query_term: str, resolved_doctype: str) -> dict:
	"""Record that a user-typed term resolved to a DocType (implicit confirmation).

	Called when the user clicks a path card or recommendation pill in GenBI.
	Stored in Redis (30-day TTL) and checked first in entity resolution.
	"""
	if not query_term or not resolved_doctype:
		return {"ok": False}
	# Validate the doctype exists and user has read permission
	if not frappe.db.exists("DocType", resolved_doctype):
		return {"ok": False}
	frappe.has_permission(resolved_doctype, "read", throw=True)

	from excel_view.genbi.entity_resolver import record_alias_feedback
	record_alias_feedback(query_term.strip().lower(), resolved_doctype)
	return {"ok": True}


@frappe.whitelist()
def genbi_chat(query: str, session_id: str, base_doctype: str) -> dict:
	"""
	AI conversational endpoint for Generative BI.

	Provides multi-turn conversation with intent classification, entity resolution,
	relationship explanation, and auto-canvas building.

	Args:
	    query: User's natural language query
	    session_id: Unique session ID for conversation continuity
	    base_doctype: Starting DocType (current Excel View DocType)

	Returns:
	    {
	        "intent": str,
	        "response": {
	            "type": "text" | "paths" | "canvas_config" | "explanation" | "data_insight",
	            "content": ...,
	            "followup_suggestions": [str]
	        },
	        "conversation_history": [...],
	        "needs_disambiguation": bool,
	        "disambiguation_options": [str]
	    }
	"""
	import json

	from excel_view.genbi.conversation import ConversationState
	from excel_view.genbi.data_insights import DataInsights
	from excel_view.genbi.entity_resolver import EntityResolver
	from excel_view.genbi.explainer import RelationshipExplainer
	from excel_view.genbi.intent_classifier import IntentClassifier
	from excel_view.genbi.query_parser import QueryParser

	# Permission check — user must have read access to the base DocType
	frappe.has_permission(base_doctype, "read", throw=True)

	# Rate limit: max 30 GenBI requests per user per minute
	_check_rate_limit("genbi_chat", limit=30, window_sec=60)

	# Load conversation state
	conv = ConversationState.load(session_id, base_doctype)

	# Classify intent (returns primary, confidence, optional secondary intent)
	classifier = IntentClassifier()
	intent, intent_confidence, secondary_intent = classifier.classify(query, conv.context)
	# Store secondary intent in context so next-turn handler can auto-trigger it
	if secondary_intent:
		conv.context["queued_intent"] = secondary_intent
	elif "queued_intent" in conv.context:
		conv.context.pop("queued_intent", None)

	# Extract entities
	resolver = EntityResolver()
	entities = resolver.extract_entities(query, conv.context)

	# Guard: if intent is EXPLAIN but the query contains a new entity (not base_doctype
	# and not already in last context) → user is asking about a NEW connection, not explaining
	# the last one. Override to FIND_PATH. Fixes: "how are customers linked to sales orders?"
	if intent == "EXPLAIN" and entities:
		last_entity_doctypes = set(conv.context.get("last_entities", []))
		new_entities = [e for e in entities
		                if e["doctype"] != base_doctype and e["doctype"] not in last_entity_doctypes]
		if new_entities:
			intent = "FIND_PATH"

	# Add user turn to conversation
	conv.add_turn(role="user", message=query, intent=intent, entities=entities)

	response = {}
	needs_disambiguation = False
	disambiguation_options = []

	# ===== INTENT ROUTING =====

	# 1. FIND_PATH - Find join paths from base to target
	if intent == "FIND_PATH":
		if not entities:
			response = {
				"type": "text",
				"content": f"I couldn't identify a target DocType from your query. Current DocType: **{base_doctype}**. Try asking 'to Customer' or 'connect to Sales Order'.",
				"followup_suggestions": [
					"What can I join?",
					"Show me common connections",
					"Suggest DocTypes",
				],
			}
		elif len(entities) > 1 and entities[0].get("alternatives"):
			# Needs disambiguation
			needs_disambiguation = True
			disambiguation_options = [entities[0]["doctype"]] + entities[0]["alternatives"]
			response = {
				"type": "text",
				"content": f"I found multiple matches for your query. Which DocType did you mean?",
				"followup_suggestions": [],
			}
		else:
			# Filter out base_doctype — it can't be its own target
			target_candidates = [e for e in entities if e["doctype"] != base_doctype]
			_is_journey = False  # set True only when chained journey is handled
			if not target_candidates:
				response = {
					"type": "text",
					"content": f"I couldn't identify a target DocType different from **{base_doctype}**. Try asking 'to Sales Order' or 'connect to Project'.",
					"followup_suggestions": ["What can I join?", "Suggest DocTypes"],
				}
			elif len(target_candidates) >= 2:
				# Multi-entity "journey/from X to Y" query — chain the paths
				import re as _re
				_q_lower = query.lower()
				_is_journey = bool(_re.search(r"\bjourney\b|\bfrom\b.+\bto\b|\bpipeline\b|\bworkflow\b|\bend.to.end\b", _q_lower))
				if _is_journey:
					entity1 = target_candidates[0]["doctype"]
					entity2 = target_candidates[1]["doctype"]
					pr1 = generate_canvas_options(entity1, base_doctype)
					pr2 = generate_canvas_options(entity2, entity1)
					legs1 = pr1.get("options") or []
					legs2 = pr2.get("options") or []

					# Stitch top leg combinations into up to 10 journey paths
					_insights_engine = DataInsights()
					journey_options = []
					_jopt_id = 0
					for _l1 in legs1[:3]:
						for _l2 in legs2[:4]:
							_l1_path = _l1.get("path", [base_doctype, entity1])
							_l2_path = _l2.get("path", [entity1, entity2])
							_stitched = _l1_path + _l2_path[1:]
							_stitched_edges = _l1.get("edges", []) + _l2.get("edges", [])
							_conf = round((_l1.get("confidence", 0.5) * _l2.get("confidence", 0.5)) ** 0.5, 3)
							_data_check = _insights_engine.check_path_data(_stitched, _stitched_edges)
							journey_options.append({
								"id": f"opt_j_{_jopt_id}",
								"title": " → ".join(_stitched),
								"description": f"Journey via {entity1}",
								"confidence": _conf,
								"path": _stitched,
								"edges": _stitched_edges,
								"estimated_fields": _l1.get("estimated_fields", 5) + _l2.get("estimated_fields", 5),
								"data_insights": _data_check,
								"is_journey": True,
							})
							_jopt_id += 1
							if len(journey_options) >= 10:
								break
						if len(journey_options) >= 10:
							break

					journey_options.sort(key=lambda x: x["confidence"], reverse=True)
					conv.context["last_paths"] = journey_options
					conv.context["follow_up_mode"] = "build"

					_j_pills = [
						{
							"type": "direct" if len(_jo["path"]) <= 3 else "shorter",
							"label": " → ".join(_jo["path"]),
							"path_idx": _ji,
							"hops": len(_jo["path"]) - 1,
						}
						for _ji, _jo in enumerate(journey_options[:3])
					]

					response = {
						"type": "paths",
						"content": {
							"base_doctype": base_doctype,
							"target_doctype": entity2,
							"paths": journey_options,
							"total": len(journey_options),
							"showing": len(journey_options),
							"recommendations": _j_pills,
							"is_journey": True,
							"journey_pivot": entity1,
						},
						"followup_suggestions": [
							f"Explain {entity1} to {entity2} connection",
							f"Build canvas from {base_doctype} to {entity2}",
							"Which path is shortest?",
						],
					}
				else:
					# Multiple entities but not a journey query — use first entity only
					target_candidates = [target_candidates[0]]

			if not _is_journey and target_candidates:
				target_entity = target_candidates[0]["doctype"]
				path_result = generate_canvas_options(target_entity, base_doctype)

				if not path_result.get("options"):
					response = {
						"type": "text",
						"content": f"No connection found from **{base_doctype}** to **{target_entity}**. They may not be related via Link fields.",
						"followup_suggestions": [
							"What can I join?",
							"Show me common connections",
						],
					}
				else:
					# Add data insights to paths
					insights_engine = DataInsights()
					options_with_insights = []
	
					for option in path_result["options"][:10]:  # Top 10 paths only
						path = option["path"]
						edges = option["edges"]
	
						# Check data availability
						data_check = insights_engine.check_path_data(path, edges)
	
						# Add insights to option
						option["data_insights"] = data_check
						options_with_insights.append(option)
	
					# Store paths in context for follow-up
					conv.context["last_paths"] = options_with_insights
					conv.context["follow_up_mode"] = "explain"

					# Build recommendation pills for shorter / direct paths
					top_len = len(options_with_insights[0]["path"]) if options_with_insights else 99
					rec_pills = []
					seen_pill_idx = set()
					for i, opt in enumerate(options_with_insights):
						hop_count = len(opt["path"]) - 1
						if hop_count == 1 and i not in seen_pill_idx:
							rec_pills.append({
								"type": "direct",
								"label": "⚡ Direct: " + " → ".join(opt["path"]),
								"path_idx": i,
								"hops": 1,
							})
							seen_pill_idx.add(i)
						elif hop_count < top_len - 1 and i not in seen_pill_idx:
							rec_pills.append({
								"type": "shorter",
								"label": "🔀 Shorter: " + " → ".join(opt["path"]) + f" ({hop_count} hop{'s' if hop_count > 1 else ''})",
								"path_idx": i,
								"hops": hop_count,
							})
							seen_pill_idx.add(i)

					response = {
						"type": "paths",
						"content": {
							"base_doctype": base_doctype,
							"target_doctype": target_entity,
							"paths": options_with_insights,
							"total": len(path_result["options"]),
							"showing": len(options_with_insights),
							"recommendations": rec_pills,
						},
						"followup_suggestions": [
							"Explain the first path",
							"Which path is best?",
							"Build canvas from top path",
							"Show me more paths",
						],
					}
	
	# 2. EXPLAIN - Explain relationships
	elif intent == "EXPLAIN":
		last_paths = conv.context.get("last_paths", [])

		if not last_paths:
			response = {
				"type": "text",
				"content": "I don't have any paths to explain yet. Try asking 'connect to Customer' first, then ask me to explain it.",
				"followup_suggestions": ["Find path to Customer", "Connect to Sales Order"],
			}
		else:
			# Explain the first path
			explainer = RelationshipExplainer()
			path_to_explain = last_paths[0]

			explanation = explainer.explain_path(
				path=path_to_explain["path"], edges_metadata=path_to_explain["edges"]
			)

			# If multiple paths, compare them
			comparison = None
			if len(last_paths) > 1:
				comparison = explainer.compare_paths(last_paths[0], last_paths[1])

			conv.context["follow_up_mode"] = "build"

			response = {
				"type": "explanation",
				"content": {
					"path": path_to_explain["path"],
					"explanation": explanation,
					"comparison": comparison,
				},
				"followup_suggestions": [
					"Build this canvas",
					"Show me a different path",
					"Why is this connection useful?",
				],
			}

	# 3. BUILD_CANVAS - Auto-build canvas from complex query
	elif intent == "BUILD_CANVAS":
		# Check if user wants to build from last explained path
		last_paths = conv.context.get("last_paths", [])

		if not entities and last_paths and query.lower().strip() in ["build this canvas", "build it", "build this", "create canvas"]:
			# Use the first path from last_paths (most recently explained)
			best_option = last_paths[0]
			canvas_config = build_canvas_from_option(
				json.dumps(best_option), base_doctype
			)

			conv.context["canvas_state"] = canvas_config
			conv.context["follow_up_mode"] = "refine"

			response = {
				"type": "canvas_config",
				"content": {
					"canvas": canvas_config,
					"parsed_query": None,
				},
				"followup_suggestions": [
					"Add more fields",
					"Show different path",
				],
			}
		else:
			# Try complex query parsing
			parser = QueryParser()
			parsed = parser.parse(query, base_doctype)

			if not parsed or parsed["confidence"] < 0.4:
				# Fallback: try simple path finding
				if entities:
					response = {
						"type": "text",
						"content": f"I couldn't fully parse your query. Did you want to find paths to **{entities[0]['doctype']}**?",
						"followup_suggestions": [
							f"Connect to {entities[0]['doctype']}",
							"Show me common connections",
						],
					}
				else:
					response = {
						"type": "text",
						"content": "I couldn't understand your query. Try something like: 'employee salary with deductions grouped by department'.",
						"followup_suggestions": [
							"Show me examples",
							"What can I build?",
						],
					}
			else:
				# Build canvas from parsed query — support multi-entity journey chains
				non_base_entities = [e for e in parsed["entities"] if e != base_doctype]

				if len(non_base_entities) >= 2:
					# Multi-entity journey: chain base → e1 → e2 → ...
					canvas_config = _build_chained_canvas(base_doctype, non_base_entities)
				elif non_base_entities:
					path_result = generate_canvas_options(non_base_entities[-1], base_doctype)
					canvas_config = (
						build_canvas_from_option(json.dumps(path_result["options"][0]), base_doctype)
						if path_result.get("options") else None
					)
				else:
					canvas_config = None

				if canvas_config:
					conv.context["canvas_state"] = canvas_config
					conv.context["follow_up_mode"] = "refine"
					response = {
						"type": "canvas_config",
						"content": {
							"canvas": canvas_config,
							"parsed_query": parsed,
						},
						"followup_suggestions": [
							"Add more fields",
							"Apply filters",
							"Change grouping",
						],
					}
				else:
					target_label = non_base_entities[-1] if non_base_entities else "target"
					response = {
						"type": "text",
						"content": f"Could not find a connection from **{base_doctype}** to **{target_label}**.",
						"followup_suggestions": ["What can I join?"],
					}

	# 4. ANALYZE_DATA - Data insights
	elif intent == "ANALYZE_DATA":
		insights_engine = DataInsights()

		if entities:
			# Check row count for mentioned DocType
			target_dt = entities[0]["doctype"]
			try:
				row_count = frappe.db.count(target_dt)
				filters = insights_engine.suggest_filters(target_dt)

				response = {
					"type": "data_insight",
					"content": {
						"doctype": target_dt,
						"row_count": row_count,
						"suggested_filters": filters,
					},
					"followup_suggestions": [
						f"Connect to {target_dt}",
						"Show me field details",
					],
				}
			except Exception as e:
				response = {
					"type": "text",
					"content": f"Could not analyze **{target_dt}**: {str(e)}",
					"followup_suggestions": ["Try a different DocType"],
				}
		else:
			# General data check for base DocType
			try:
				row_count = frappe.db.count(base_doctype)
				response = {
					"type": "data_insight",
					"content": {
						"doctype": base_doctype,
						"row_count": row_count,
					},
					"followup_suggestions": [
						"What can I join?",
						"Show common connections",
					],
				}
			except Exception as e:
				response = {
					"type": "text",
					"content": f"Could not analyze data: {str(e)}",
					"followup_suggestions": [],
				}

	# 5. SUGGEST - Suggest connections
	elif intent == "SUGGEST":
		# Find all direct connections from base_doctype
		import networkx as nx

		G = nx.Graph()
		edges_list = _get_all_link_edges()

		for e in edges_list:
			G.add_edge(e["doctype"], e["target"], **e)

		if base_doctype in G:
			neighbors = list(G.neighbors(base_doctype))[:10]  # Top 10

			response = {
				"type": "text",
				"content": f"**{base_doctype}** can be connected to: {', '.join(neighbors)}",
				"followup_suggestions": [f"Connect to {n}" for n in neighbors[:3]],
			}
		else:
			response = {
				"type": "text",
				"content": f"**{base_doctype}** has no direct Link field connections.",
				"followup_suggestions": [],
			}

	# 6. REFINE - Show paths re-sorted by a different criterion
	elif intent == "REFINE":
		last_paths = conv.context.get("last_paths", [])

		if not last_paths:
			response = {
				"type": "text",
				"content": "Nothing to refine yet. Try finding some paths first!",
				"followup_suggestions": ["Connect to Customer", "What can I join?"],
			}
		else:
			# Re-sort by a different criterion than original (confidence):
			# 1st refinement → sort by shortest path (fewest hops)
			# 2nd refinement → sort by data availability (has_data first)
			refine_count = conv.context.get("refine_count", 0) + 1
			conv.context["refine_count"] = refine_count

			if refine_count % 2 == 1:
				# Shortest first
				refined = sorted(last_paths, key=lambda p: len(p["path"]))
				sort_label = "shortest paths first"
			else:
				# Data-rich first
				refined = sorted(
					last_paths,
					key=lambda p: (not p.get("data_insights", {}).get("has_data", False), len(p["path"])),
				)
				sort_label = "paths with live data first"

			base_dt = refined[0]["path"][0] if refined else base_doctype
			target_dt = refined[0]["path"][-1] if refined else ""

			# Build recommendation pills for this refined view too
			refined_pills = []
			seen = set()
			top_len = len(refined[0]["path"]) if refined else 99
			for i, opt in enumerate(refined):
				hops = len(opt["path"]) - 1
				if hops == 1 and i not in seen:
					refined_pills.append({"type": "direct", "label": "⚡ Direct: " + " → ".join(opt["path"]), "path_idx": i, "hops": 1})
					seen.add(i)
				elif hops < top_len - 1 and i not in seen:
					refined_pills.append({"type": "shorter", "label": "🔀 Shorter: " + " → ".join(opt["path"]) + f" ({hops} hops)", "path_idx": i, "hops": hops})
					seen.add(i)

			response = {
				"type": "paths",
				"content": {
					"base_doctype": base_dt,
					"target_doctype": target_dt,
					"paths": refined,
					"total": len(refined),
					"showing": len(refined),
					"recommendations": refined_pills,
					"sort_label": sort_label,
				},
				"followup_suggestions": [
					"Show me a different path",
					"Explain first path",
					"Build canvas from top path",
				],
			}

	# Default fallback
	else:
		response = {
			"type": "text",
			"content": f"I understood your intent as **{intent}** but I'm not sure how to help. Try asking 'connect to Customer' or 'what can I join?'",
			"followup_suggestions": [
				"What can I join?",
				"Connect to Customer",
			],
		}

	# Add bot response to conversation
	conv.add_turn(role="bot", message=response)
	conv.save()

	return {
		"intent": intent,
		"intent_confidence": intent_confidence,
		"secondary_intent": secondary_intent,  # client can show "also doing: EXPLAIN" hint
		"response": response,
		"conversation_history": conv.get_recent_context(n=5),
		"needs_disambiguation": needs_disambiguation,
		"disambiguation_options": disambiguation_options,
	}


# ── V3.2 Get Data — External Sources ──────────────────────────────────────────


def _csv_to_headers_rows(text: str):
	"""Parse CSV text → {"headers": [...], "rows": [[...]]}."""
	import csv, io

	reader = csv.reader(io.StringIO(text))
	all_rows = list(reader)
	if not all_rows:
		return {"headers": [], "rows": []}
	return {"headers": all_rows[0], "rows": all_rows[1:]}



def _validate_external_url(url: str) -> None:
	"""Block SSRF: reject requests to RFC-1918 / loopback / link-local addresses."""
	import ipaddress, socket, re
	from urllib.parse import urlparse

	parsed = urlparse(url)
	if parsed.scheme not in ("http", "https"):
		frappe.throw(_("Only http/https URLs are allowed"))

	hostname = parsed.hostname or ""

	# Block raw IP addresses that are private / loopback / link-local
	try:
		ip = ipaddress.ip_address(hostname)
		if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
			frappe.throw(_("Requests to internal network addresses are not allowed"))
	except ValueError:
		# It's a hostname — resolve and check
		block_patterns = re.compile(
			r"^(localhost|.*\.local|.*\.internal|.*\.intranet|metadata\.google\.internal)$",
			re.I,
		)
		if block_patterns.match(hostname):
			frappe.throw(_("Requests to internal hostnames are not allowed"))
		try:
			resolved_ip = ipaddress.ip_address(socket.gethostbyname(hostname))
			if resolved_ip.is_private or resolved_ip.is_loopback or resolved_ip.is_link_local:
				frappe.throw(_("Requests to internal network addresses are not allowed"))
		except OSError:
			frappe.throw(_(f"Cannot resolve hostname: {hostname}"))


@frappe.whitelist()
def fetch_google_sheet(url: str, tab_name: str = ""):
	"""Fetch a public Google Sheet by URL and return headers + rows.

	Uses the CSV export endpoint — no API key needed for sheets shared
	as "Anyone with link can view".
	"""
	import re, requests

	match = re.search(r"/spreadsheets/d/([a-zA-Z0-9_-]+)", url)
	if not match:
		return {"error": "Invalid Google Sheets URL — could not find spreadsheet ID."}

	sheet_id = match.group(1)
	export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
	if tab_name:
		from urllib.parse import quote
		export_url += f"&sheet={quote(tab_name)}"

	try:
		resp = requests.get(export_url, timeout=20, allow_redirects=True)
		resp.raise_for_status()
		ct = resp.headers.get("content-type", "")
		if "text/html" in ct:
			return {"error": "Could not access sheet. Ensure it is shared as 'Anyone with link can view'."}
		return _csv_to_headers_rows(resp.text)
	except Exception as e:
		return {"error": str(e)}


@frappe.whitelist()
def fetch_url_text(url: str):
	"""Return raw text content of any URL (used by CSV / JSON import)."""
	import requests

	_validate_external_url(url)
	try:
		resp = requests.get(url, timeout=20)
		resp.raise_for_status()
		return {"text": resp.text}
	except Exception as e:
		return {"error": str(e)}


@frappe.whitelist()
def fetch_web_api(url: str, method: str = "GET", headers: str = "", json_path: str = ""):
	"""Call a REST endpoint and normalise the JSON response to headers + rows.

	Args:
		url:        Endpoint URL.
		method:     HTTP method (GET / POST).
		headers:    JSON-encoded dict of request headers.
		json_path:  Dot-notation path into the JSON response (e.g. "data.items").
	"""
	import json, requests

	_validate_external_url(url)
	hdrs: dict = {}
	if headers:
		try:
			hdrs = json.loads(headers) if isinstance(headers, str) else dict(headers)
		except Exception:
			pass

	try:
		fn = getattr(requests, method.lower(), requests.get)
		resp = fn(url, headers=hdrs, timeout=25)
		resp.raise_for_status()
		data = resp.json()
	except Exception as e:
		return {"error": str(e)}

	# Traverse dot-notation path
	if json_path:
		for key in json_path.split("."):
			if isinstance(data, dict):
				data = data.get(key)
			elif isinstance(data, list) and key.isdigit():
				data = data[int(key)]
			else:
				data = None
			if data is None:
				return {"error": f"Path '{json_path}' not found in the response."}

	if not isinstance(data, list):
		data = [data] if isinstance(data, dict) else []
	if not data:
		return {"headers": [], "rows": []}

	first = data[0]
	col_keys: list = list(first.keys()) if isinstance(first, dict) else [f"col{i}" for i in range(len(first))]
	rows = []
	for item in data:
		if isinstance(item, dict):
			rows.append([item.get(k, "") for k in col_keys])
		elif isinstance(item, list):
			rows.append(item)
		else:
			rows.append([item])

	return {"headers": col_keys, "rows": rows}


@frappe.whitelist()
def extract_pdf_tables(pdf_b64: str):
	"""Extract all tables from a base64-encoded PDF using pdfplumber.

	Returns {"tables": [{"headers": [...], "rows": [[...], ...]}, ...]}.
	"""
	import base64, io

	try:
		import pdfplumber
	except ImportError:
		return {"error": "pdfplumber is not installed. Run: pip install pdfplumber"}

	try:
		pdf_bytes = base64.b64decode(pdf_b64)
		tables = []
		with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
			for page in pdf.pages:
				for tbl in (page.extract_tables() or []):
					if not tbl:
						continue
					headers = [str(c or f"Col{i + 1}") for i, c in enumerate(tbl[0])]
					rows = [[str(cell or "") for cell in row] for row in tbl[1:]]
					if rows:
						tables.append({"headers": headers, "rows": rows})
		return {"tables": tables}
	except Exception as e:
		return {"error": str(e)}




# ── Field-type compatibility helpers ─────────────────────────────────────────

_NUMERIC_FT: frozenset = frozenset({"Currency", "Float", "Int", "Percent"})
_TEXT_FT: frozenset    = frozenset({"Data", "Link", "Select", "Small Text", "Text", "Long Text"})
_DATE_FT: frozenset    = frozenset({"Date", "Datetime", "Time"})


def _field_type_compat(ft1: str, ft2: str) -> float:
	"""Confidence multiplier when fieldtypes differ.  1.0 = perfect, 0.65 = incompatible."""
	if not ft1 or not ft2:
		return 1.0
	if ft1 == ft2:
		return 1.0
	if ft1 in _NUMERIC_FT and ft2 in _NUMERIC_FT:
		return 1.0
	if ft1 in _TEXT_FT and ft2 in _TEXT_FT:
		return 0.95
	if ft1 in _DATE_FT and ft2 in _DATE_FT:
		return 0.95
	return 0.65  # incompatible types (e.g. Currency ↔ Link)


@frappe.whitelist()
def smart_lookup_suggest(
	source_doctype: str,
	target_doctype: str,
	source_headers: str,
	target_headers: str,
	source_sample: str = "[]",
	target_sample: str = "[]",
):
	"""AI-based 4-layer join column suggestion (no LLM).

	Layer 0: Primary Key Match — ≥50 % of source-col values are found as `name` IDs
	         in the target sample (foreign-key / primary-key detection).
	Layer 1: Frappe meta — Link fields on source DocType pointing to target DocType.
	Layer 2a: Exact fieldname match.
	Layer 2b: Fuzzy label / fieldname similarity (rapidfuzz token_sort_ratio).
	Layer 3: Data-content match — Polars-accelerated Jaccard similarity on sampled
	         unique values (Python-set fallback when Polars unavailable).

	Data-type guardrails: confidence is multiplied by a compatibility factor when
	source and target fieldtypes are semantically incompatible (e.g. Float ↔ Link).

	Returns: list of {source_col, target_col, strategy, confidence, reason}
	sorted by confidence descending, one card per (unclaimed) source column.
	"""
	# Permission check — user must be able to read both DocTypes
	if source_doctype:
		try:
			frappe.has_permission(source_doctype, "read", throw=True)
		except Exception:
			frappe.throw(_(f"You do not have read access to {source_doctype}"))
	if target_doctype:
		try:
			frappe.has_permission(target_doctype, "read", throw=True)
		except Exception:
			frappe.throw(_(f"You do not have read access to {target_doctype}"))

	import json
	from rapidfuzz import fuzz

	try:
		import polars as pl
		_USE_POLARS = True
	except ImportError:
		_USE_POLARS = False

	src_headers = json.loads(source_headers)   # [{fieldname, label, fieldtype, options}, …]
	tgt_headers = json.loads(target_headers)
	src_sample  = json.loads(source_sample)    # [[val, …], …]  ≤ 200 rows
	tgt_sample  = json.loads(target_sample)

	suggestions: list  = []
	claimed_src: set   = set()
	claimed_tgt: set   = set()

	# ── Layer 1: Frappe meta — Link fields pointing to target DocType ──────────
	if source_doctype and target_doctype:
		try:
			src_meta = frappe.get_meta(source_doctype)
			for df in src_meta.fields:
				if df.fieldtype == "Link" and df.options == target_doctype:
					if df.fieldname not in claimed_src:
						suggestions.append({
							"source_col": df.fieldname,
							"target_col": "name",
							"strategy":   "link_field",
							"confidence": 0.97,
							"reason":     (
								f"'{df.label or df.fieldname}' is a Link field to {target_doctype}"
							),
						})
						claimed_src.add(df.fieldname)
						claimed_tgt.add("name")
		except Exception:
			frappe.clear_messages()

	# ── Layer 2a: Exact fieldname match (runs BEFORE Primary Key Match) ────────
	# Structural equality trumps data-based heuristics.
	claimed_src_l2 = {s["source_col"] for s in suggestions}
	claimed_tgt_l2 = {s["target_col"] for s in suggestions}

	for sf in src_headers:
		if sf["fieldname"] in claimed_src_l2:
			continue
		for tf in tgt_headers:
			if tf["fieldname"] in claimed_tgt_l2:
				continue
			if sf["fieldname"] == tf["fieldname"]:
				compat = _field_type_compat(sf.get("fieldtype", ""), tf.get("fieldtype", ""))
				suggestions.append({
					"source_col": sf["fieldname"],
					"target_col": tf["fieldname"],
					"strategy":   "header_match",
					"confidence": round(0.98 * compat, 3),
					"reason":     f"Exact fieldname match: '{sf['fieldname']}'",
				})
				claimed_src_l2.add(sf["fieldname"])
				claimed_tgt_l2.add(tf["fieldname"])
				break

	# Merge back before Layer 0 so it respects exact-fieldname claims
	claimed_src = {s["source_col"] for s in suggestions}
	claimed_tgt = {s["target_col"] for s in suggestions}

	# ── Layer 0c: Doctype-name FK detection (structural, no data needed) ────────
	# Catches: IGA.customer + target_doctype="Customer" → JOIN IGA.customer→Customer.name
	# AND:    Customer.name + source_doctype="Customer" → JOIN Customer.name→report.customer
	#
	# Pure structural signal: column fieldname == snake_case(doctype) is a definitive FK.
	# Works even when the report is filtered (low sample overlap) or when there's no meta.

	def _doctype_fk_bonus(si_idx, ti_idx):
		"""Return a 0–0.05 data-overlap bonus to add to structural base confidence."""
		if not src_sample or not tgt_sample:
			return 0.0
		src_v = {str(r[si_idx]) for r in src_sample if si_idx < len(r) and str(r[si_idx]).strip()}
		tgt_v = {str(r[ti_idx]) for r in tgt_sample if ti_idx < len(r) and str(r[ti_idx]).strip()}
		if not src_v or not tgt_v:
			return 0.0
		ratio = len(src_v & tgt_v) / len(src_v)
		return round(ratio * 0.05, 3)

	# 0c-A: source column named like target_doctype → FK to target.name
	if target_doctype and "name" not in claimed_tgt:
		dt_snake = frappe.scrub(target_doctype)   # "Customer" → "customer"
		name_ti = next(
			(i for i, tf in enumerate(tgt_headers) if tf["fieldname"] == "name"), None
		)
		if name_ti is not None:
			for si, sf in enumerate(src_headers):
				if sf["fieldname"] in claimed_src:
					continue
				fn = sf["fieldname"]
				if fn == dt_snake or fn == dt_snake + "_id":
					bonus = _doctype_fk_bonus(si, name_ti)
					suggestions.append({
						"source_col": fn,
						"target_col": "name",
						"strategy":   "primary_key_match",
						"confidence": round(min(0.99, 0.94 + bonus), 3),
						"reason":     (
							f"'{sf.get('label') or fn}' column name matches DocType "
							f"'{target_doctype}' — foreign key on {target_doctype}.name"
						),
					})
					claimed_src.add(fn)
					claimed_tgt.add("name")
					break

	# 0c-B: source.name (primary key) → target column named like source_doctype
	if source_doctype and "name" not in claimed_src:
		dt_snake = frappe.scrub(source_doctype)
		src_name_si = next(
			(i for i, sf in enumerate(src_headers) if sf["fieldname"] == "name"), None
		)
		if src_name_si is not None:
			for ti, tf in enumerate(tgt_headers):
				if tf["fieldname"] in claimed_tgt:
					continue
				fn = tf["fieldname"]
				if fn == dt_snake or fn == dt_snake + "_id":
					bonus = _doctype_fk_bonus(src_name_si, ti)
					suggestions.append({
						"source_col": "name",
						"target_col": fn,
						"strategy":   "primary_key_match",
						"confidence": round(min(0.99, 0.94 + bonus), 3),
						"reason":     (
							f"'{tf.get('label') or fn}' column name matches source DocType "
							f"'{source_doctype}' — join on {source_doctype}.name → {fn}"
						),
					})
					claimed_src.add("name")
					claimed_tgt.add(fn)
					break

	# Refresh claims after Layer 0c
	claimed_src = {s["source_col"] for s in suggestions}
	claimed_tgt = {s["target_col"] for s in suggestions}

	# ── Layer 0a: Primary Key Match — source values → target `name` column ─────
	# Skip source columns that already matched via exact fieldname (Layer 2a).
	# Threshold lowered to 0.3: a filtered report may show only a subset of rows
	# but the join is still correct (e.g. 6/20 IGA customers appear in Customer sample).
	if src_sample and tgt_sample:
		name_ti = next(
			(i for i, tf in enumerate(tgt_headers) if tf["fieldname"] == "name"), None
		)
		if name_ti is not None and "name" not in claimed_tgt:
			tgt_names_raw = [
				str(r[name_ti])
				for r in tgt_sample
				if name_ti < len(r) and str(r[name_ti]).strip()
			]
			if tgt_names_raw:
				tgt_name_set = set(tgt_names_raw)
				if _USE_POLARS:
					tgt_name_pl = pl.Series(tgt_names_raw).unique()

				for si, sf in enumerate(src_headers):
					if sf["fieldname"] in claimed_src:
						continue
					src_raw = [
						str(r[si]) for r in src_sample if si < len(r) and str(r[si]).strip()
					]
					if not src_raw:
						continue

					if _USE_POLARS:
						src_pl  = pl.Series(src_raw).unique()
						overlap = int(src_pl.is_in(tgt_name_pl).sum())
						total   = len(src_pl)
					else:
						src_set = set(src_raw)
						overlap = len(src_set & tgt_name_set)
						total   = len(src_set)

					if total == 0:
						continue
					ratio = overlap / total
					if ratio >= 0.3:
						src_set_py = set(src_raw)
						union      = len(src_set_py | tgt_name_set)
						jaccard    = overlap / union if union else 0.0
						# Scale: 0.3 ratio→~0.82, 1.0 ratio→0.99
						confidence = round(min(0.99, 0.72 + ratio * 0.27), 3)
						suggestions.append({
							"source_col": sf["fieldname"],
							"target_col": "name",
							"strategy":   "primary_key_match",
							"confidence": confidence,
							"reason":     (
								f"{overlap}/{total} source values match target IDs "
								f"({int(ratio * 100)}% hit-rate)"
							),
						})
						claimed_src.add(sf["fieldname"])
						claimed_tgt.add("name")
						break

	# ── Layer 0b: Source `name` (ID) values → any unclaimed target column ──────
	# Covers doctype→report joins where the report stores IDs in a non-`name` col
	# (e.g. Customer.name = "CUST-001" appears in Report.customer_name column).
	if src_sample and tgt_sample and "name" not in claimed_src:
		src_name_si = next(
			(i for i, sf in enumerate(src_headers) if sf["fieldname"] == "name"), None
		)
		if src_name_si is not None:
			src_raw = [
				str(r[src_name_si])
				for r in src_sample
				if src_name_si < len(r) and str(r[src_name_si]).strip()
			]
			if src_raw:
				src_set = set(src_raw)
				best_j, best_tf, best_cnt = 0.0, None, 0
				for ti, tf in enumerate(tgt_headers):
					# Layer 0b intentionally ignores claimed_tgt:
					# `name → FK` is a distinct join pattern; multiple source columns
					# pointing to the same target is fine — user picks which to apply.
					if tf["fieldname"] == "name":
						continue
					tgt_raw = [
						str(r[ti])
						for r in tgt_sample
						if ti < len(r) and str(r[ti]).strip()
					]
					if not tgt_raw:
						continue
					tgt_set = set(tgt_raw)
					inter   = len(src_set & tgt_set)
					ratio   = inter / len(src_set) if src_set else 0.0
					if ratio >= 0.3 and ratio > best_j:
						best_j, best_tf, best_cnt = ratio, tf, inter

				if best_tf:
					best_ti_idx = next(i for i, tf in enumerate(tgt_headers) if tf is best_tf)
					best_tgt_set = set(
						str(r[best_ti_idx])
						for r in tgt_sample
						if best_ti_idx < len(r) and str(r[best_ti_idx]).strip()
					)
					union   = len(src_set | best_tgt_set)
					jaccard = best_cnt / union if union else 0.0
					suggestions.append({
						"source_col": "name",
						"target_col": best_tf["fieldname"],
						"strategy":   "primary_key_match",
						"confidence": round(min(0.96, 0.82 + best_j * 0.14), 3),
						"reason":     (
							f"{best_cnt}/{len(src_set)} source IDs match "
							f"'{best_tf.get('label') or best_tf['fieldname']}' values "
							f"({int(best_j * 100)}% hit-rate)"
						),
					})
					claimed_src.add("name")
					claimed_tgt.add(best_tf["fieldname"])

	# ── Layer 2b: Fuzzy label + fieldname similarity ───────────────────────────
	claimed_src_l2 = {s["source_col"] for s in suggestions}
	claimed_tgt_l2 = {s["target_col"] for s in suggestions}

	for sf in src_headers:
		if sf["fieldname"] in claimed_src_l2:
			continue
		best_score, best_tf = 0, None
		for tf in tgt_headers:
			if tf["fieldname"] in claimed_tgt_l2:
				continue
			src_label  = (sf.get("label") or sf["fieldname"]).lower()
			tgt_label  = (tf.get("label") or tf["fieldname"]).lower()
			lbl_score  = fuzz.token_sort_ratio(src_label, tgt_label)
			fn_score   = fuzz.ratio(
				sf["fieldname"].replace("_", " "),
				tf["fieldname"].replace("_", " "),
			)
			score = max(lbl_score, fn_score)
			if score > best_score:
				best_score, best_tf = score, tf
		if best_tf and best_score >= 75:
			compat = _field_type_compat(sf.get("fieldtype", ""), best_tf.get("fieldtype", ""))
			suggestions.append({
				"source_col": sf["fieldname"],
				"target_col": best_tf["fieldname"],
				"strategy":   "header_match",
				"confidence": round((best_score / 100) * compat, 3),
				"reason":     (
					f"'{sf.get('label') or sf['fieldname']}' ≈ "
					f"'{best_tf.get('label') or best_tf['fieldname']}' "
					f"({best_score}% similarity)"
				),
			})
			claimed_src_l2.add(sf["fieldname"])
			claimed_tgt_l2.add(best_tf["fieldname"])

	# Merge back
	claimed_src = {s["source_col"] for s in suggestions}
	claimed_tgt = {s["target_col"] for s in suggestions}

	# ── Layer 3: Data-content match (Polars Jaccard) ───────────────────────────
	if src_sample and tgt_sample:
		for si, sf in enumerate(src_headers):
			if sf["fieldname"] in claimed_src:
				continue
			src_raw = [
				str(r[si]) for r in src_sample if si < len(r) and str(r[si]).strip()
			]
			if not src_raw:
				continue

			best_j, best_tf, best_cnt = 0.0, None, 0
			for ti, tf in enumerate(tgt_headers):
				if tf["fieldname"] in claimed_tgt:
					continue
				tgt_raw = [
					str(r[ti]) for r in tgt_sample if ti < len(r) and str(r[ti]).strip()
				]
				if not tgt_raw:
					continue

				if _USE_POLARS:
					src_set = set(pl.Series(src_raw).unique().to_list())
					tgt_set = set(pl.Series(tgt_raw).unique().to_list())
				else:
					src_set = set(src_raw)
					tgt_set = set(tgt_raw)

				inter = len(src_set & tgt_set)
				union = len(src_set | tgt_set)
				j     = inter / union if union else 0.0
				if j > best_j:
					best_j, best_tf, best_cnt = j, tf, inter

			if best_tf and best_j >= 0.2:
				compat = _field_type_compat(sf.get("fieldtype", ""), best_tf.get("fieldtype", ""))
				suggestions.append({
					"source_col": sf["fieldname"],
					"target_col": best_tf["fieldname"],
					"strategy":   "data_content_match",
					"confidence": round(best_j * compat, 3),
					"reason":     (
						f"{best_cnt} shared unique values "
						f"({int(best_j * 100)}% Jaccard overlap)"
					),
				})
				claimed_src.add(sf["fieldname"])
				claimed_tgt.add(best_tf["fieldname"])

	suggestions.sort(key=lambda x: -x["confidence"])
	seen, result = set(), []
	for s in suggestions:
		if s["source_col"] not in seen:
			seen.add(s["source_col"])
			result.append(s)

	return result


# ── Schema graph & relational auto-expansion ──────────────────────────────────

@frappe.whitelist()
def build_schema_graph(force_refresh: bool = False) -> dict:
	"""Build a NetworkX DiGraph of all DocType → Link → DocType relationships.

	Traverses frappe.get_meta() for every non-table, non-single DocType and maps
	Link fields as directed edges: source_doctype → (fieldname) → target_doctype.

	Cached in Redis for 1 hour under key "excel_view_schema_graph".

	Returns:
	  {
	    nodes: [{id, module}],
	    edges: [{source, target, fieldname, label}]
	  }
	"""
	import networkx as nx

	_cache_key = "excel_view_schema_graph"
	if not frappe.parse_json(force_refresh):
		cached = frappe.cache().get_value(_cache_key)
		if cached:
			return cached

	G: nx.DiGraph = nx.DiGraph()

	doctypes = frappe.db.get_all(
		"DocType",
		filters={"istable": 0, "issingle": 0},
		fields=["name", "module"],
		limit=1000,
	)
	for dt in doctypes:
		G.add_node(dt.name, module=dt.module or "")

	for dt in doctypes:
		try:
			meta = frappe.get_meta(dt.name)
			for df in meta.fields:
				if df.fieldtype == "Link" and df.options and G.has_node(df.options):
					G.add_edge(
						dt.name,
						df.options,
						fieldname=df.fieldname,
						label=df.label or df.fieldname,
					)
		except Exception:
			frappe.clear_messages()
			continue

	result = {
		"nodes": [
			{"id": n, "module": data.get("module", "")}
			for n, data in G.nodes(data=True)
		],
		"edges": [
			{
				"source":    u,
				"target":    v,
				"fieldname": data.get("fieldname", ""),
				"label":     data.get("label", ""),
			}
			for u, v, data in G.edges(data=True)
		],
	}
	frappe.cache().set_value(_cache_key, result, expires_in_sec=3600)
	return result


@frappe.whitelist()
def find_related_doctypes(source_doctype: str, max_hops: int = 2) -> list:
	"""Return DocTypes reachable from *source_doctype* within *max_hops* in the schema graph.

	For each related DocType returns:
	  {doctype, cardinality, join_field, join_label, hops[, via]}
	  cardinality: "N:1" (source has Link to target) | "1:N" (target links back to source).

	Results capped at 30 entries, sorted by hop count.
	"""
	import networkx as nx

	if not source_doctype:
		return []

	graph_data = build_schema_graph()
	G: nx.DiGraph = nx.DiGraph()
	for node in graph_data.get("nodes", []):
		G.add_node(node["id"], module=node.get("module", ""))
	for edge in graph_data.get("edges", []):
		G.add_edge(
			edge["source"], edge["target"],
			fieldname=edge.get("fieldname", ""),
			label=edge.get("label", ""),
		)

	if source_doctype not in G:
		return []

	result  = []
	visited = {source_doctype}

	# 1-hop N:1: source has a Link field pointing to target
	for tgt in G.successors(source_doctype):
		ed = G.get_edge_data(source_doctype, tgt) or {}
		result.append({
			"doctype":     tgt,
			"cardinality": "N:1",
			"join_field":  ed.get("fieldname", ""),
			"join_label":  ed.get("label", ""),
			"hops":        1,
		})
		visited.add(tgt)

	# 1-hop 1:N: other doctypes that have a Link field pointing TO source
	for src_node in list(G.nodes()):
		if src_node == source_doctype or src_node in visited:
			continue
		if G.has_edge(src_node, source_doctype):
			ed = G.get_edge_data(src_node, source_doctype) or {}
			result.append({
				"doctype":     src_node,
				"cardinality": "1:N",
				"join_field":  ed.get("fieldname", ""),
				"join_label":  ed.get("label", ""),
				"hops":        1,
			})
			visited.add(src_node)

	# 2-hop (optional): neighbours of N:1 neighbours
	if int(max_hops) >= 2:
		one_hop_n1 = [r for r in result if r["hops"] == 1 and r["cardinality"] == "N:1"]
		for hop1 in one_hop_n1:
			inter = hop1["doctype"]
			for tgt2 in G.successors(inter):
				if tgt2 in visited:
					continue
				ed = G.get_edge_data(inter, tgt2) or {}
				result.append({
					"doctype":     tgt2,
					"cardinality": "N:1",
					"join_field":  hop1["join_field"],
					"join_label":  hop1["join_label"],
					"via":         inter,
					"hops":        2,
				})
				visited.add(tgt2)

	result.sort(key=lambda x: x["hops"])
	return result[:30]


@frappe.whitelist()
def expand_relationship(
	source_doctype: str,
	target_doctype: str,
	join_field: str,
	source_values: str,
	agg_preset: str = "latest",
	return_fields: str = "[]",
) -> dict:
	"""Fetch related rows from *target_doctype* for the given *source_values*.

	Handles two cardinalities automatically:
	  N:1 — join_field is on source side; target's `name` is the match key.
	  1:N — target has a Link field pointing back to source_doctype.

	agg_preset: "latest" | "sum" | "count" | "average"
	source_values: JSON list of join-key values from the source sheet (≤ 500).
	return_fields: JSON list of fieldnames to pull (auto-selected if empty).

	Uses Polars when available for sub-500 ms processing at 100k-row scale.

	Returns: {columns, rows, cardinality, agg_preset} | {error, columns, rows}
	"""
	import json

	_check_doctype_permission(source_doctype)
	_check_doctype_permission(target_doctype)

	values        = [str(v) for v in json.loads(source_values) if v]
	fields_wanted = json.loads(return_fields)
	if not values:
		return {"columns": [], "rows": [], "cardinality": "unknown"}

	try:
		import polars as pl
		_USE_POLARS = True
	except ImportError:
		_USE_POLARS = False

	tgt_meta = frappe.get_meta(target_doctype)
	col_label = {df.fieldname: (df.label or df.fieldname) for df in tgt_meta.fields}

	# Auto-detect cardinality: does target have a Link field back to source?
	reverse_field = next(
		(df.fieldname for df in tgt_meta.fields
		 if df.fieldtype == "Link" and df.options == source_doctype),
		None,
	)
	cardinality = "1:N" if reverse_field else "N:1"

	# Auto-select return fields when not specified
	if not fields_wanted:
		fields_wanted = [
			df.fieldname for df in tgt_meta.fields
			if df.fieldtype in ("Currency", "Float", "Int", "Data", "Link", "Select")
			and not df.hidden and getattr(df, "in_list_view", 0)
		][:6]
	if not fields_wanted:
		fields_wanted = [
			df.fieldname for df in tgt_meta.fields
			if df.fieldtype in ("Currency", "Float", "Int") and not df.hidden
		][:5]

	placeholders = ", ".join(["%s"] * len(values))

	try:
		# ── 1:N aggregation presets ────────────────────────────────────────────
		if cardinality == "1:N" and agg_preset in ("count", "sum", "average"):
			numeric_fields = [
				df.fieldname for df in tgt_meta.fields
				if df.fieldtype in ("Currency", "Float", "Int") and not df.hidden
				and (not fields_wanted or df.fieldname in fields_wanted)
			][:5]

			if agg_preset == "count":
				sql = f"""
					SELECT `{reverse_field}` AS _src_key, COUNT(name) AS `count`
					FROM `tab{target_doctype}`
					WHERE `{reverse_field}` IN ({placeholders}) AND docstatus < 2
					GROUP BY `{reverse_field}`
				"""
				rows = frappe.db.sql(sql, values, as_dict=True)
				return {
					"columns": [
						{"fieldname": "_src_key", "label": source_doctype},
						{"fieldname": "count",    "label": f"Count of {target_doctype}"},
					],
					"rows":        rows,
					"cardinality": cardinality,
					"agg_preset":  agg_preset,
				}

			if numeric_fields:
				pfx = "sum_" if agg_preset == "sum" else "avg_"
				fn  = "SUM" if agg_preset == "sum" else "AVG"
				agg_expr = ", ".join(f"{fn}(`{f}`) AS `{pfx}{f}`" for f in numeric_fields)
				sql = f"""
					SELECT `{reverse_field}` AS _src_key, {agg_expr}
					FROM `tab{target_doctype}`
					WHERE `{reverse_field}` IN ({placeholders}) AND docstatus < 2
					GROUP BY `{reverse_field}`
				"""
				rows = frappe.db.sql(sql, values, as_dict=True)
				return {
					"columns": [
						{"fieldname": "_src_key", "label": source_doctype},
					] + [
						{"fieldname": f"{pfx}{f}", "label": f"{agg_preset.title()} {col_label.get(f, f)}"}
						for f in numeric_fields
					],
					"rows":        rows,
					"cardinality": cardinality,
					"agg_preset":  agg_preset,
				}

		# ── N:1 or 1:N "latest" — row-level fetch ─────────────────────────────
		fld_sql  = ", ".join(f"`{f}`" for f in fields_wanted) if fields_wanted else "name"
		join_col = reverse_field if cardinality == "1:N" else "name"
		sql = f"""
			SELECT `{join_col}` AS _src_key, {fld_sql}
			FROM `tab{target_doctype}`
			WHERE `{join_col}` IN ({placeholders}) AND docstatus < 2
			ORDER BY modified DESC
		"""
		rows = frappe.db.sql(sql, values, as_dict=True)

		# For 1:N "latest": keep only the most-recent row per source key
		if agg_preset == "latest" and cardinality == "1:N":
			seen_keys: set = set()
			deduped = []
			for row in rows:
				k = row.get("_src_key")
				if k not in seen_keys:
					seen_keys.add(k)
					deduped.append(row)
			rows = deduped

		# Polars round-trip — validates types and normalises nulls
		if _USE_POLARS and rows:
			rows = pl.from_dicts(rows).to_dicts()

		return {
			"columns": [{"fieldname": "_src_key", "label": join_field}] + [
				{"fieldname": f, "label": col_label.get(f, f)}
				for f in fields_wanted
			],
			"rows":        rows,
			"cardinality": cardinality,
			"agg_preset":  agg_preset,
		}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "expand_relationship error")
		return {"error": str(e), "columns": [], "rows": []}


@frappe.whitelist()
def smart_lookup_fetch(
	lookup_value: str,
	target_doctype: str,
	return_field: str,
	source_doctype: str = "",
) -> str:
	"""Scalar lookup powering the SMART_LOOKUP() HyperFormula formula.

	Strategy 1: Direct name lookup — frappe.db.get_value(target_doctype, lookup_value, field).
	Strategy 2: Reverse Link — find a Link field on target pointing to source_doctype,
	            then filter by that field.

	Returns "" when no match is found.  Always returns a string.
	"""
	if not lookup_value or not target_doctype or not return_field:
		return ""

	_check_doctype_permission(target_doctype)
	_validate_fieldname(target_doctype, return_field)

	# Strategy 1: lookup_value is the `name` (ID) in target_doctype
	try:
		val = frappe.db.get_value(target_doctype, str(lookup_value), return_field)
		if val is not None:
			return str(val)
	except Exception:
		pass

	# Strategy 2: target has a Link field back to source_doctype
	if source_doctype:
		try:
			tgt_meta = frappe.get_meta(target_doctype)
			for df in tgt_meta.fields:
				if df.fieldtype == "Link" and df.options == source_doctype:
					val = frappe.db.get_value(
						target_doctype,
						{df.fieldname: str(lookup_value)},
						return_field,
						order_by="modified desc",
					)
					if val is not None:
						return str(val)
					break
		except Exception:
			pass

	return ""


# ── V3.3 — Activity column tag helpers ────────────────────────────────────────

@frappe.whitelist()
def get_doctype_tags(doctype):
	"""Return all tags used on this DocType (distinct, sorted)."""
	frappe.has_permission(doctype, "read", throw=True)
	rows = frappe.get_all(
		"Tag Link",
		filters={"document_type": doctype},
		fields=["tag"],
		distinct=True,
		order_by="tag asc",
		limit=200,
	)
	return [r.tag for r in rows if r.tag]


@frappe.whitelist()
def add_doc_tag(doctype, docname, tag):
	"""Add a tag to a document."""
	frappe.has_permission(doctype, "write", throw=True)
	from frappe.desk.doctype.tag.tag import add_tag
	return add_tag(tag, doctype, docname)


@frappe.whitelist()
def remove_doc_tag(doctype, docname, tag):
	"""Remove a tag from a document."""
	frappe.has_permission(doctype, "write", throw=True)
	from frappe.desk.doctype.tag.tag import remove_tag
	return remove_tag(tag, doctype, docname)


def _get_active_formula_configs():
	"""Return the list of active non-system Excel Formula configs (with preset filters).
	Shared by extend_bootinfo and the realtime broadcast."""
	if not frappe.db.table_exists("Excel Formula"):
		return []
	configs = frappe.get_all(
		"Excel Formula",
		filters={"is_active": 1, "is_system": 0},
		fields=["formula_name", "label", "category", "formula_type",
				"source_doctype", "target_fieldname", "description"],
		order_by="formula_name asc",
	)
	for cfg in configs:
		cfg["preset_filters"] = frappe.get_all(
			"Excel Formula Filter",
			filters={"parent": cfg["formula_name"]},
			fields=["filter_key", "filter_value"],
			order_by="idx asc",
		)
	return configs


def extend_bootinfo(bootinfo):
	"""Inject active Excel Formula configs into frappe.boot so the JS plugin
	can register dynamic HyperFormula functions before HOT initialises."""
	try:
		bootinfo.excel_formula_configs = _get_active_formula_configs()
	except Exception:
		bootinfo.excel_formula_configs = []


@frappe.whitelist()
def get_formula_configs():
	"""Return active non-system Excel Formula configs as JSON.
	Called client-side after a realtime excel_formula_updated event to
	refresh frappe.boot.excel_formula_configs without a page reload."""
	return _get_active_formula_configs()


def seed_example_formulas():
	"""Insert ready-to-use example formulas with preset filters.
	Run once after migrate: bench --site index.com execute excel_view.api.seed_example_formulas
	"""
	examples = [
		{
			"formula_name": "REVENUE_MTD",
			"label": "Revenue Month-to-Date",
			"category": "Financial",
			"formula_type": "sum",
			"source_doctype": "Sales Invoice",
			"target_fieldname": "grand_total",
			"description": "Total submitted Sales Invoice revenue for the current period.\n=REVENUE_MTD()",
			"is_system": 0,
			"filters": [
				{"filter_key": "docstatus", "filter_value": "1"},
				{"filter_key": "posting_date >=", "filter_value": "PERIOD_START()"},
				{"filter_key": "posting_date <=", "filter_value": "PERIOD_END()"},
			],
		},
		{
			"formula_name": "RECEIVABLES",
			"label": "Total Receivables",
			"category": "Financial",
			"formula_type": "sum",
			"source_doctype": "Sales Invoice",
			"target_fieldname": "outstanding_amount",
			"description": "Sum of all unpaid Sales Invoice outstanding amounts.\n=RECEIVABLES()",
			"is_system": 0,
			"filters": [
				{"filter_key": "docstatus", "filter_value": "1"},
				{"filter_key": "outstanding_amount >", "filter_value": "0"},
			],
		},
		{
			"formula_name": "PAYABLES",
			"label": "Total Payables",
			"category": "Financial",
			"formula_type": "sum",
			"source_doctype": "Purchase Invoice",
			"target_fieldname": "outstanding_amount",
			"description": "Sum of all unpaid Purchase Invoice outstanding amounts.\n=PAYABLES()",
			"is_system": 0,
			"filters": [
				{"filter_key": "docstatus", "filter_value": "1"},
				{"filter_key": "outstanding_amount >", "filter_value": "0"},
			],
		},
		{
			"formula_name": "HEADCOUNT",
			"label": "Active Employee Count",
			"category": "HR",
			"formula_type": "count",
			"source_doctype": "Employee",
			"target_fieldname": "name",
			"description": "Count of currently active employees.\n=HEADCOUNT()",
			"is_system": 0,
			"filters": [{"filter_key": "status", "filter_value": "Active"}],
		},
		{
			"formula_name": "OPEN_ORDERS",
			"label": "Open Sales Orders Value",
			"category": "Sales",
			"formula_type": "sum",
			"source_doctype": "Sales Order",
			"target_fieldname": "grand_total",
			"description": "Total value of open (not fully billed) Sales Orders.\n=OPEN_ORDERS()",
			"is_system": 0,
			"filters": [
				{"filter_key": "docstatus", "filter_value": "1"},
				{"filter_key": "status", "filter_value": "To Bill"},
			],
		},
		{
			"formula_name": "OVERDUE_COUNT",
			"label": "Overdue Invoice Count",
			"category": "Financial",
			"formula_type": "count",
			"source_doctype": "Sales Invoice",
			"target_fieldname": "name",
			"description": "Count of submitted invoices with outstanding amount past due date.\n=OVERDUE_COUNT()",
			"is_system": 0,
			"filters": [
				{"filter_key": "docstatus", "filter_value": "1"},
				{"filter_key": "outstanding_amount >", "filter_value": "0"},
				{"filter_key": "due_date <", "filter_value": "TODAY()"},
			],
		},
		{
			"formula_name": "AVG_INVOICE_VALUE",
			"label": "Average Invoice Value",
			"category": "Sales",
			"formula_type": "avg",
			"source_doctype": "Sales Invoice",
			"target_fieldname": "grand_total",
			"description": "Average Sales Invoice value for the current period.\n=AVG_INVOICE_VALUE()",
			"is_system": 0,
			"filters": [
				{"filter_key": "docstatus", "filter_value": "1"},
				{"filter_key": "posting_date >=", "filter_value": "PERIOD_START()"},
				{"filter_key": "posting_date <=", "filter_value": "PERIOD_END()"},
			],
		},
	]

	inserted = 0
	for ex in examples:
		if frappe.db.exists("Excel Formula", ex["formula_name"]):
			continue
		doc = frappe.new_doc("Excel Formula")
		doc.update({k: v for k, v in ex.items() if k != "filters"})
		doc.is_active = 1
		for f in ex.get("filters", []):
			doc.append("filters", f)
		doc.insert(ignore_permissions=True)
		inserted += 1

	frappe.db.commit()
	print(f"Seeded {inserted} example Excel Formula records.")


# ── V3 IntelliFlow: DuckDB bulk fetch + schema endpoints ──────────────────────

@frappe.whitelist()
def bulk_fetch_for_duckdb(doctype, filters="[]", limit=100000):
	"""
	Bulk-fetch all records of a DocType for client-side DuckDB ingestion.

	Returns Arrow IPC binary (base64) when pyarrow is available — 3-5x smaller
	than JSON and loads directly into DuckDB without CSV re-encoding.
	Falls back to JSON rows for compatibility.

	Filters: JSON-encoded list of [fieldname, operator, value] triples.
	Limit: max rows to fetch (default 100000).
	"""
	frappe.has_permission(doctype, throw=True)
	limit = min(int(limit or 100000), 100000)

	# Parse filters
	parsed_filters = []
	if filters:
		try:
			raw = frappe.parse_json(filters)
			if isinstance(raw, list):
				parsed_filters = raw
		except Exception:
			pass

	meta = frappe.get_meta(doctype)
	SKIP_TYPES = {"Column Break", "Section Break", "Tab Break", "Fold",
	              "Heading", "HTML", "Custom HTML", "Table", "Table MultiSelect", "Password"}
	fields = ["name", "creation", "modified", "owner"]
	for df in meta.fields:
		if df.fieldtype in SKIP_TYPES or df.is_virtual:
			continue
		fields.append(df.fieldname)

	# Deduplicate while preserving order
	seen = set()
	unique_fields = []
	for f in fields:
		if f not in seen:
			seen.add(f)
			unique_fields.append(f)

	rows = frappe.get_all(
		doctype,
		fields=unique_fields,
		filters=parsed_filters,
		limit=limit,
		ignore_permissions=False,
	)
	rows = [dict(r) for r in rows]

	# ── Arrow IPC binary transport (3-5x smaller + zero CSV re-encoding) ──
	try:
		import pyarrow as pa
		import base64

		if rows:
			# Build columnar arrays — cast everything to string to avoid type
			# inference issues across Frappe field types (dates, decimals, etc.)
			col_arrays = {}
			for f in unique_fields:
				col_arrays[f] = pa.array(
					[str(r[f]) if r[f] is not None else "" for r in rows],
					type=pa.string()
				)
			table = pa.table(col_arrays)
		else:
			schema = pa.schema([(f, pa.string()) for f in unique_fields])
			table  = pa.table({f: pa.array([], type=pa.string()) for f in unique_fields}, schema=schema)

		sink   = pa.BufferOutputStream()
		writer = pa.ipc.new_stream(sink, table.schema)
		writer.write_table(table)
		writer.close()
		arrow_b64 = base64.b64encode(sink.getvalue().to_pybytes()).decode("ascii")

		return {
			"doctype":    doctype,
			"fields":     unique_fields,
			"count":      len(rows),
			"arrow_ipc":  arrow_b64,   # base64 Arrow IPC stream
		}

	except Exception:
		# Fallback: plain JSON rows (always works)
		return {
			"doctype": doctype,
			"rows":    rows,
			"count":   len(rows),
			"fields":  unique_fields,
		}


@frappe.whitelist()
def get_doctype_schema(doctypes):
	"""
	Return field metadata for one or more DocTypes — used by QueryFlowPanel
	to render field checklists and EER badges without round-trips.

	Input:  doctypes — JSON list of DocType names, or a single name string.
	Output: {doctype_name: {module, fields: [{fieldname, label, fieldtype, options, reqd}]}}
	"""
	if isinstance(doctypes, str):
		try:
			doctypes = frappe.parse_json(doctypes)
		except Exception:
			doctypes = [doctypes]

	if not isinstance(doctypes, list):
		doctypes = [doctypes]

	SKIP_TYPES = {"Column Break", "Section Break", "Tab Break", "Fold",
	              "Heading", "HTML", "Custom HTML", "Password"}

	result = {}
	for doctype in doctypes:
		if not doctype:
			continue
		try:
			frappe.has_permission(doctype, throw=True)
		except frappe.PermissionError:
			continue

		meta = frappe.get_meta(doctype)
		fields = []

		# Always include name first
		fields.append({
			"fieldname": "name",
			"label":     "Name (ID)",
			"fieldtype": "Data",
			"options":   "",
			"reqd":      1,
		})

		for df in meta.fields:
			if df.fieldtype in SKIP_TYPES:
				continue
			if df.is_virtual:
				continue
			fields.append({
				"fieldname": df.fieldname,
				"label":     df.label or df.fieldname,
				"fieldtype": df.fieldtype,
				"options":   df.options or "",
				"reqd":      int(bool(df.reqd)),
			})

		result[doctype] = {
			"module": meta.module or "",
			"fields": fields,
		}

	return result
