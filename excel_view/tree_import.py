# Copyright (c) 2026, Ujjwal Aggrawal and contributors
# For license information, please see license.txt

"""
excel_view.tree_import — hierarchical bulk import engine (server side).

Two tree patterns are supported, auto-detected from DocType meta:

  Pattern 1 — NSM Self-Referential Trees
    Detected by: meta.is_tree == 1 AND meta.nsm_parent_field set
    Examples:    Employee, Department, Territory, Customer Group, Item Group
    Record order: top-down (root first, children after)
    Frappe auto-rebuilds lft/rgt Nested Set Model indexes on insert.

  Pattern 2 — Cross-Document Reference Trees
    Detected by: Table field → child DocType → Link field → back to this DocType
    Examples:    BOM (items.bom_no references another BOM)
    Record order: bottom-up via topological sort from client
    (leaf/raw-material BOMs must exist before the finished-good BOM that uses them)

Endpoints:
  detect_tree_meta(doctype)       → {pattern, ...info}
  import_tree(doctype, ...)       → {status, created, errors}

Security:
  - Caller must have WRITE permission on the DocType.
  - Each insert respects Frappe's permission model (ignore_permissions=False).
  - On any error, all previously created documents are rolled back in reverse order.
"""

import frappe
from frappe import _


# ── Pattern Detection ──────────────────────────────────────────────────────────


@frappe.whitelist()
def detect_tree_meta(doctype):
	"""
	Inspect DocType meta to determine tree pattern.

	Returns one of:
	  {"pattern": 1, "parent_field": "<nsm_parent_field>"}
	  {"pattern": 2, "table_field": "...", "link_field": "...", "child_doctype": "..."}
	  {"pattern": None}
	"""
	frappe.has_permission(doctype, "read", throw=True)
	meta = frappe.get_meta(doctype)

	# ── Pattern 1: NSM self-referential tree ──────────────────────────────────
	if meta.is_tree and meta.nsm_parent_field:
		return {"pattern": 1, "parent_field": meta.nsm_parent_field}

	# ── Pattern 2: Cross-document reference tree ──────────────────────────────
	# Scan each Table field → load its child meta → check for a Link back to doctype.
	for df in meta.fields:
		if df.fieldtype != "Table" or not df.options:
			continue
		try:
			child_meta = frappe.get_meta(df.options)
		except Exception:
			continue
		for cdf in child_meta.fields:
			if cdf.fieldtype == "Link" and cdf.options == doctype:
				return {
					"pattern": 2,
					"table_field": df.fieldname,
					"link_field": cdf.fieldname,
					"child_doctype": df.options,
				}

	return {"pattern": None}


# ── Dependency Analysis ────────────────────────────────────────────────────────


@frappe.whitelist()
def analyze_import_deps(doctype, records_json):
	"""
	Analyse mapped records and return a dependency graph for the dep-review UI.

	Returns:
	  {
	    "nodes": [{id, label, type, total, existing, to_create}],
	    "edges": [{from, to, field, label}]
	  }

	Node types:
	  "main"       — the DocType being imported
	  "dep"        — directly referenced dep with known values
	  "structural" — mandatory dep of a dep (no values from data, just structure)
	"""
	frappe.has_permission(doctype, "read", throw=True)
	records      = frappe.parse_json(records_json)
	meta         = frappe.get_meta(doctype)

	edges      = []   # {from, to, field, label}
	ref_values = {}   # dep_doctype → set of string values (empty set = structural only)

	def _add_edge(dep_dt, src_dt, field, label):
		# Never add self-cycles or edges back to the main import DocType
		if dep_dt == src_dt or dep_dt == doctype:
			return
		if not any(e["from"] == dep_dt and e["to"] == src_dt for e in edges):
			edges.append({"from": dep_dt, "to": src_dt, "field": field, "label": label})

	def _add_ref(dep_dt, src_dt, field, label, vals):
		if dep_dt == doctype:
			return
		ref_values.setdefault(dep_dt, set()).update(vals)
		_add_edge(dep_dt, src_dt, field, label)

	# ── Level 1: parent Link fields ────────────────────────────────────────────
	for df in meta.fields:
		if df.fieldtype == "Link" and df.options:
			vals = {str(r[df.fieldname]) for r in records if r.get(df.fieldname)}
			if vals:
				_add_ref(df.options, doctype, df.fieldname, df.label or df.fieldname, vals)

		elif df.fieldtype == "Table" and df.options:
			try:
				child_meta = frappe.get_meta(df.options)
			except Exception:
				continue
			for cdf in child_meta.fields:
				if cdf.fieldtype != "Link" or not cdf.options:
					continue
				vals = set()
				for rec in records:
					for row in (rec.get(df.fieldname) or []):
						v = row.get(cdf.fieldname)
						if v:
							vals.add(str(v))
				if vals:
					_add_ref(
						cdf.options, doctype,
						f"{df.fieldname}.{cdf.fieldname}",
						cdf.label or cdf.fieldname, vals,
					)

	# ── Level 2: Link fields of each dep DocType (direct + child table) ────────
	# Skip system/global master-data doctypes that don't need user action.
	_SYSTEM_DT = frozenset({
		"Currency", "Country", "Language", "Module Def", "DocType",
		"Role", "User", "Workflow", "Report", "Page", "Print Format",
		"Letter Head", "Email Template", "Notification", "Custom Field",
	})
	for dep_dt in list(ref_values.keys()):
		if dep_dt in _SYSTEM_DT:
			continue
		try:
			dep_meta = frappe.get_meta(dep_dt)
		except Exception:
			continue
		for df in dep_meta.fields:
			if df.fieldtype == "Link" and df.options and df.reqd:
				if df.options in _SYSTEM_DT or df.options == doctype or df.options == dep_dt:
					continue
				ref_values.setdefault(df.options, set())
				_add_edge(df.options, dep_dt, df.fieldname, df.label or df.fieldname)
			elif df.fieldtype == "Table" and df.options:
				# Also scan child table Link fields of this dep DocType.
				# Example: Routing.operations (child table) → operation/workstation fields
				# → adds Operation → Routing and Workstation → Routing edges.
				try:
					child_meta = frappe.get_meta(df.options)
				except Exception:
					continue
				for cdf in child_meta.fields:
					if cdf.fieldtype != "Link" or not cdf.options:
						continue
					if cdf.options in _SYSTEM_DT or cdf.options == doctype or cdf.options == dep_dt:
						continue
					# Guard 1: only add if the target DocType is already in the dep graph
					# WITH actual values from Level 1.  This prevents phantom structural
					# nodes from optional child tables (e.g. Item.attributes → Item Attribute).
					if cdf.options not in ref_values or not ref_values[cdf.options]:
						continue
					# Guard 2: don't redirect X from main_dt to dep_dt when X already has
					# a DIRECT (non-child-table) field edge to main_dt.
					# e.g. Company → BOM via field "company" (no dot) should stay as-is;
					#      Operation → BOM via "operations.operation" (has dot) can be
					#      redirected to Routing (its semantic owner).
					if any(
						e["from"] == cdf.options and e["to"] == doctype
						and "." not in e.get("field", "")
						for e in edges
					):
						continue
					_add_edge(cdf.options, dep_dt,
					          f"{df.fieldname}.{cdf.fieldname}",
					          cdf.label or cdf.fieldname)

	# ── Enhance structural nodes with real values ──────────────────────────────
	# For each structural node (empty set), populate values from two sources:
	#   1. If the field lives on the main DocType: scan records directly.
	#   2. If the field lives on a dep DocType: query existing dep records from DB.
	# This turns "Structural requirement" into "✓ N exist • + M to create" where
	# possible (e.g. Item Group derived from existing Items in DB).
	for edge in list(edges):
		struct_dt = edge["from"]
		dep_dt    = edge["to"]
		field     = edge.get("field", "")

		# Only process structural nodes (empty set created by setdefault above)
		if not (struct_dt in ref_values and len(ref_values[struct_dt]) == 0):
			continue
		# Skip child-table-sourced edges (field contains a dot)
		if "." in field:
			continue

		if dep_dt == doctype:
			# Field is directly on the records being imported — scan them
			vals = {str(r[field]) for r in records if r.get(field)}
			if vals:
				ref_values[struct_dt].update(vals)
		else:
			# Field is on an intermediate dep — query existing dep records in DB
			dep_vals = list(ref_values.get(dep_dt, set()))
			if not dep_vals:
				continue
			try:
				rows = frappe.get_all(
					dep_dt,
					filters=[["name", "in", dep_vals]],
					fields=["name", field],
					ignore_permissions=True,
				)
				found = {str(r[field]) for r in rows if r.get(field)}
				if found:
					ref_values[struct_dt].update(found)
			except Exception:
				pass

	# ── Enhance dep nodes using field values present in the records ───────────
	# For each dep DocType (e.g. Item) scan its Link fields (e.g. item_group → Item Group).
	# If the records contain a field with that name (e.g. BOM records carry item_group),
	# use those values to populate the target dep node — fully data-driven, no unmapped
	# columns needed.
	node_incomplete = {}   # dep_dt → True: data coverage < 100% → Fix panel needed
	node_coverage   = {}   # dep_dt → (rows_with_value, parent_count) for UI stat
	node_source_col = {}   # dep_dt → fieldname that sourced its values (for "via X" label)

	for dep_dt in list(ref_values.keys()):
		if dep_dt in _SYSTEM_DT:
			continue
		try:
			dep_meta = frappe.get_meta(dep_dt)
		except Exception:
			continue
		for df in dep_meta.fields:
			if df.fieldtype != "Link" or not df.options or not df.fieldname:
				continue
			if df.options in _SYSTEM_DT:
				continue
			fn        = df.fieldname
			target_dt = df.options
			# Collect values for this field from the main import records
			recs_with_val = [r for r in records if str(r.get(fn) or "").strip()]
			found_vals    = {str(r[fn]) for r in recs_with_val}
			if not found_vals:
				continue
			if target_dt not in ref_values:
				ref_values[target_dt] = set()
			ref_values[target_dt].update(found_vals)
			_add_edge(target_dt, dep_dt, fn, df.label or fn)
			node_source_col[target_dt] = fn
			# Coverage: records-with-value vs total dep records; drives Fix-panel incomplete flag
			parent_count = len(ref_values.get(dep_dt, set()))
			node_coverage[target_dt] = (len(recs_with_val), parent_count)
			if parent_count > 0 and len(recs_with_val) < parent_count:
				node_incomplete[target_dt] = True

	# ── Transitive reduction ─────────────────────────────────────────────────
	# Remove edge (A → BOM) when A can already reach BOM through an intermediate
	# dep node — keeps the graph clean and semantically correct.
	# e.g. Operation → Routing → BOM makes Operation → BOM redundant.
	edges = _reduce_edges(edges, doctype)

	# ── Check DB existence ────────────────────────────────────────────────────
	nodes = [{"id": doctype, "label": doctype, "type": "main",
	          "total": len(records), "existing": 0, "to_create": len(records),
	          "incomplete": False}]

	for dt, vals in ref_values.items():
		vals_list = list(vals)
		existing  = 0
		if vals_list:
			try:
				existing = len(set(
					frappe.get_all(dt, filters=[["name", "in", vals_list]],
					               pluck="name", ignore_permissions=True)
				))
			except Exception:
				pass
		cov = node_coverage.get(dt)
		nodes.append({
			"id"            : dt,
			"label"         : dt,
			"type"          : "dep" if vals_list else "structural",
			"total"         : len(vals_list),
			"existing"      : existing,
			"to_create"     : max(0, len(vals_list) - existing),
			"incomplete"    : node_incomplete.get(dt, False),
			"coverage_have" : cov[0] if cov else None,
			"coverage_total": cov[1] if cov else None,
			"source_col"    : node_source_col.get(dt),
			"values"        : sorted(vals_list),
		})

	return {"nodes": nodes, "edges": edges}



def _reduce_edges(edges, main_dt):
	"""
	Remove direct edges (A → main_dt) when A can reach main_dt through
	at least one intermediate dep — avoids cluttering the graph with
	redundant shortcuts that are already covered by deeper dep chains.
	e.g. if Operation → Routing → BOM exists, drop Operation → BOM.
	"""
	adj = {}
	for e in edges:
		adj.setdefault(e["from"], []).append(e["to"])

	def _reachable_via_intermediate(start, target):
		"""BFS: can `start` reach `target` without the direct A→target edge?"""
		visited = {start}
		queue   = [nb for nb in adj.get(start, []) if nb != target]
		while queue:
			node = queue.pop()
			if node == target:
				return True
			if node not in visited:
				visited.add(node)
				queue.extend(nb for nb in adj.get(node, []) if nb not in visited)
		return False

	return [
		e for e in edges
		if not (e["to"] == main_dt and _reachable_via_intermediate(e["from"], main_dt))
	]


# ── Dependency Pre-Creation ────────────────────────────────────────────────────


@frappe.whitelist()
def pre_create_deps(doctype, nodes_json, edges_json, user_edits_json=None, dep_attrs_json=None, job_id=None):
	"""
	Create all missing dependency records in topological order before main import.

	nodes_json      : the nodes array from analyze_import_deps (with "values" field)
	edges_json      : the edges array from analyze_import_deps
	user_edits_json : {fieldname: {record_name: value}} from the Fix panel
	dep_attrs_json  : {DocType: {record_name: {fieldname: value}}} — per-record attributes
	                  from client CSV analysis (e.g. per-item stock_uom from child table)
	job_id          : realtime channel id; publishes ev_dep_progress events
	"""
	frappe.has_permission(doctype, "write", throw=True)

	nodes      = frappe.parse_json(nodes_json)
	edges      = frappe.parse_json(edges_json)
	user_edits = frappe.parse_json(user_edits_json or "{}")
	dep_attrs  = frappe.parse_json(dep_attrs_json  or "{}")

	# Index dep nodes (exclude main)
	dep_nodes = {n["id"]: n for n in nodes if n.get("type") != "main"}

	# ── Topological sort (leaves first, consumers after) ────────────────────
	# Edge direction: from=dep (must exist first) → to=consumer
	in_deg = {dt: 0 for dt in dep_nodes}
	adj    = {dt: [] for dt in dep_nodes}
	for e in edges:
		frm, to = e.get("from"), e.get("to")
		if frm in dep_nodes and to in dep_nodes:
			in_deg[to] = in_deg.get(to, 0) + 1
			adj[frm].append(to)

	queue = [dt for dt in dep_nodes if in_deg[dt] == 0]
	order = []
	while queue:
		cur = queue.pop(0)
		order.append(cur)
		for nxt in adj.get(cur, []):
			in_deg[nxt] -= 1
			if in_deg[nxt] == 0:
				queue.append(nxt)
	for dt in dep_nodes:  # catch any disconnected nodes
		if dt not in order:
			order.append(dt)

	created, errors = [], []

	for dt in order:
		node = dep_nodes[dt]
		vals = node.get("values") or []
		if not vals:
			continue

		# Only create records that don't already exist
		try:
			existing = set(frappe.get_all(
				dt, filters=[["name", "in", vals]], pluck="name", ignore_permissions=True,
			))
		except Exception:
			existing = set()

		to_create = [v for v in vals if v not in existing]

		# For already-existing records: patch stale attrs from dep_attrs (e.g. wrong stock_uom)
		dt_attrs = (dep_attrs or {}).get(dt, {})
		for val in existing:
			rec_attrs = dt_attrs.get(val, {})
			for key, new_val in rec_attrs.items():
				if not key or key in ("name", "doctype") or not new_val:
					continue
				try:
					cur = frappe.db.get_value(dt, val, key)
					if cur != new_val:
						frappe.db.set_value(dt, val, key, new_val, update_modified=False)
				except Exception:
					pass
		if existing and dt_attrs:
			frappe.db.commit()

		total = len(to_create)
		for idx, val in enumerate(to_create):
			try:
				doc_dict = _build_dep_doc(dt, val, user_edits, dep_attrs)
				doc = frappe.get_doc(doc_dict)
				doc.flags.ignore_permissions = True
				doc.insert(ignore_if_duplicate=True)
				frappe.db.commit()
				created.append({"doctype": dt, "name": doc.name})
				if job_id:
					frappe.publish_realtime("ev_dep_progress", {
						"job_id": job_id, "status": "ok",
						"doctype": dt, "name": doc.name,
						"idx": idx, "total": total,
					}, user=frappe.session.user, after_commit=False)
			except Exception as exc:
				err = _clean_exc(exc)
				errors.append({"doctype": dt, "name": val, "error": err})
				if job_id:
					frappe.publish_realtime("ev_dep_progress", {
						"job_id": job_id, "status": "error",
						"doctype": dt, "name": val, "error": err,
						"idx": idx, "total": total,
					}, user=frappe.session.user, after_commit=False)

	return {
		"status" : "ok" if not errors else "partial",
		"created": created,
		"errors" : errors,
	}


# ── Non-layout field types that can carry a value ───────────────────────────
_VALUE_FIELDTYPES = {
	"Data", "Small Text", "Text", "Long Text", "Text Editor",
	"Link", "Dynamic Link",
	"Int", "Float", "Currency", "Percent",
	"Check",
	"Select",
	"Date", "Datetime", "Time",
	"Phone", "Email",
	"Read Only",
}
_SKIP_FIELDTYPES = {
	"Section Break", "Column Break", "Tab Break",
	"HTML", "Button", "Image", "Fold", "Heading",
	"Table", "Table MultiSelect",
}


def _build_dep_doc(dt, val, user_edits, dep_attrs=None):
	"""
	Return a complete doc dict satisfying all mandatory fields for dep record creation.

	Fully dynamic — reads autoname rule and mandatory fields from Frappe meta.
	DocType-specific overrides are kept ONLY for cases that require domain logic
	beyond what meta can provide (Link resolution, derived fields, uniqueness checks).

	Priority for field values:
	  1. dep_attrs[dt][val] — CSV-derived hints (e.g. stock_uom per item)
	  2. user_edits — Fix-panel mappings (e.g. item_group per item)
	  3. Meta-driven defaults — autoname field, mandatory Links queried from DB
	"""
	attrs = (dep_attrs or {}).get(dt, {}).get(val, {})

	# ── Read autoname rule from meta to determine how to set the record name ──
	try:
		meta      = frappe.get_meta(dt)
		autoname  = (meta.autoname or "").strip()
	except Exception:
		autoname  = ""

	# autoname = "field:<fieldname>" → set that field; name is auto-derived
	# autoname = "Prompt" or ""      → must set doc["name"] explicitly
	name_field = None
	if autoname.lower().startswith("field:"):
		name_field = autoname[6:].strip()  # e.g. "uom_name", "item_code"

	# ── DocType-specific overrides (domain logic only) ────────────────────────

	if dt == "Item Group":
		root = (
			frappe.db.get_value(
				"Item Group",
				{"is_group": 1, "parent_item_group": ["in", ["", None]]},
				"name",
			) or "All Item Groups"
		)
		return {"doctype": dt, name_field or "item_group_name": val,
		        "parent_item_group": root}

	if dt == "Routing":
		doc = {"doctype": dt, name_field or "routing_name": val}
		ops = attrs.get("operations") or []
		if ops:
			try:
				ops_field = next(
					(f for f in meta.fields
					 if f.fieldname == "operations" and f.fieldtype == "Table"),
					None,
				)
				child_dt = ops_field.options if ops_field else "BOM Operation"
			except Exception:
				child_dt = "BOM Operation"
			seen, rows_out = set(), []
			for row in ops:
				op = (row.get("operation") or "").strip()
				ws = (row.get("workstation") or "").strip()
				if not op or (op, ws) in seen:
					continue
				seen.add((op, ws))
				child_row = {"doctype": child_dt, "operation": op}
				if ws:
					child_row["workstation"] = ws
				try:
					child_row["time_in_mins"] = float(row.get("time_in_mins") or 0)
				except (TypeError, ValueError):
					child_row["time_in_mins"] = 0
				rows_out.append(child_row)
			doc["operations"] = rows_out
		return doc

	if dt == "Item":
		ig = (
			attrs.get("item_group")
			or (user_edits.get("item_group") or {}).get(val)
			or frappe.db.get_value("Item Group", {"is_group": 0}, "name")
			or frappe.db.get_value("Item Group", {}, "name")
			or "All Item Groups"
		)
		stock_uom = (
			attrs.get("stock_uom")
			or frappe.db.get_value("UOM", {"uom_name": "Nos"}, "name")
			or frappe.db.get_value("UOM", {}, "name")
			or "Nos"
		)
		return {
			"doctype"      : dt,
			name_field or "item_code": val,
			"item_name"    : val,
			"item_group"   : ig,
			"stock_uom"    : stock_uom,
			"is_stock_item": 1,
		}

	if dt == "Company":
		abbr = "".join(w[0].upper() for w in val.split() if w)[:4] or val[:4].upper()
		n, base = 2, abbr
		while frappe.db.exists("Company", {"abbr": abbr}):
			abbr = f"{base}{n}"; n += 1
		currency = frappe.db.get_value("Currency", {"enabled": 1}, "name") or "INR"
		country  = frappe.db.get_value("Country", {}, "name") or "India"
		return {
			"doctype"         : dt,
			name_field or "company_name": val,
			"abbr"            : abbr,
			"default_currency": currency,
			"country"         : country,
		}

	# ── Fully generic: meta-driven mandatory field population ─────────────────
	# Passes name_field so _build_generic_dep_doc can set it correctly.
	return _build_generic_dep_doc(dt, val, attrs, name_field=name_field)


def _fill_mandatory_value(df, val, attrs):
	"""
	Return the value to use for a single mandatory field, given its meta descriptor.
	Priority: explicit attrs → fieldtype-driven default → DB query (for Links).
	"""
	fn = df.fieldname
	if fn in attrs:
		return attrs[fn]
	ft = df.fieldtype
	if ft in ("Data", "Small Text", "Text", "Long Text", "Text Editor", "Phone", "Email"):
		return val
	if ft == "Link":
		existing = frappe.db.get_value(df.options, {}, "name")
		return existing if existing else val
	if ft == "Dynamic Link":
		return val
	if ft in ("Int", "Float", "Currency", "Percent"):
		try:
			return type(1 if ft == "Int" else 1.0)(df.default or 0)
		except (TypeError, ValueError):
			return 0
	if ft == "Check":
		return int(df.default or 0)
	if ft == "Select":
		opts = [o for o in (df.options or "").split("\n") if o]
		return opts[0] if opts else ""
	if ft == "Date":
		return frappe.utils.nowdate()
	if ft == "Datetime":
		return frappe.utils.now()
	if ft == "Time":
		return "00:00:00"
	return val


def _build_generic_dep_doc(dt, val, attrs, name_field=None):
	"""
	Build a doc dict satisfying ALL mandatory fields for an arbitrary DocType.

	Scans TWO levels of the DocType meta:
	  1. Parent-level mandatory fields (reqd=1, non-Table)
	     Data/Text → val | Link → first DB record | Int/Float → 0 | Select → first opt
	  2. Child table fields where the TABLE ITSELF is mandatory (df.reqd=1 on the Table
	     field) — creates one minimal row with the child table's own mandatory fields.

	name_field: if provided, sets doc[name_field]=val (autoname='field:X' case).
	            if None or empty, sets doc["name"]=val (autoname='Prompt' or empty).

	attrs: per-record hints from client CSV analysis (highest priority).
	"""
	doc = {"doctype": dt}
	if name_field:
		doc[name_field] = val
	else:
		# autoname='Prompt' or unknown — must set name explicitly
		doc["name"] = val
	try:
		meta = frappe.get_meta(dt)
		for df in meta.fields:
			if not df.reqd:
				continue
			fn = df.fieldname

			# ── Level 1: parent-level mandatory non-Table fields ────────────
			if df.fieldtype not in ("Table", "Table MultiSelect") and 			   df.fieldtype not in _SKIP_FIELDTYPES:
				doc[fn] = _fill_mandatory_value(df, val, attrs)

			# ── Level 2: mandatory Table fields (at-least-one-row required) ─
			elif df.fieldtype == "Table" and df.options:
				# attrs may supply pre-built rows (e.g. Routing.operations from CSV)
				if fn in attrs:
					doc[fn] = attrs[fn]
					continue
				# Build one minimal row satisfying the child table's mandatory fields
				try:
					child_meta = frappe.get_meta(df.options)
				except Exception:
					continue
				child_row   = {"doctype": df.options}
				has_content = False
				for cdf in child_meta.fields:
					if not cdf.reqd or cdf.fieldtype in _SKIP_FIELDTYPES:
						continue
					child_row[cdf.fieldname] = _fill_mandatory_value(cdf, val, {})
					has_content = True
				if has_content:
					doc[fn] = [child_row]

	except Exception:
		pass
	return doc

# ── Import ─────────────────────────────────────────────────────────────────────


@frappe.whitelist()
def import_tree(doctype, records_json, pattern, pattern_info_json, job_id):
	"""
	Create hierarchical records in the correct dependency order.

	Args:
	  doctype          : target DocType name
	  records_json     : JSON array of dicts, pre-sorted by client
	                     (top-down for Pattern 1, topo-order for Pattern 2)
	  pattern          : "1" or "2"
	  pattern_info_json: serialised tree_info from client (for context/logging)
	  job_id           : unique string for frappe.realtime progress channel

	Pattern 2 — dynamic link resolution:
	  Child-table link fields (e.g. items.bom_no) may contain item codes instead
	  of actual document names.  The server resolves them via a 4-tier fallback:
	    1. identity_value → name of a doc created earlier in this same batch
	    2. identity_value → default/active doc already in the DB
	    3. identity_value is already a valid doc name  → use verbatim
	    4. Fall through to Frappe validation (error surfaced naturally)

	Publishes "ev_tree_progress" realtime events per record:
	  {job_id, status: "ok"|"error"|"rolled_back", name, idx, total, error?}

	Returns:
	  {"status": "ok",          "created": <n>,  "errors": []}
	  {"status": "rolled_back", "created": 0,    "errors": [{name, error}]}
	"""
	frappe.has_permission(doctype, "write", throw=True)

	records      = frappe.parse_json(records_json)
	pattern_info = frappe.parse_json(pattern_info_json)
	total        = len(records)
	created      = []   # names of successfully inserted docs (for rollback)
	errors       = []

	# Pattern 2: track identity_value → created_doc_name so later records can
	# resolve cross-references to docs created earlier in this batch.
	# e.g. {"EV-STATOR-ASSY": "BOM-00001"}
	identity_to_created: dict[str, str] = {}
	p2_table_field    = pattern_info.get("table_field")    if int(pattern) == 2 else None
	p2_link_field     = pattern_info.get("link_field")     if int(pattern) == 2 else None
	p2_identity_field = pattern_info.get("identity_field") if int(pattern) == 2 else None

	for i, rec in enumerate(records):
		try:
			# ── Pattern 2: resolve item-code aliases in child table link fields ──
			if p2_table_field and p2_link_field and rec.get(p2_table_field):
				rec = _resolve_child_link_refs(
					rec, doctype, p2_table_field, p2_link_field, identity_to_created
				)

			# Strip extra fields folded in for dep-graph analysis (e.g. item_group on BOM)
			# Keep child table lists (isinstance list) and known meta fields only.
			_dt_meta    = frappe.get_meta(doctype)
			_meta_fields = {df.fieldname for df in _dt_meta.fields}
			_meta_fields.update({"name", "doctype", "naming_series", "owner", "modified_by"})
			doc_data = {"doctype": doctype}
			doc_data.update({k: v for k, v in rec.items() if k in _meta_fields or isinstance(v, list)})
			# Coerce string numeric values — CSV delivers everything as strings but
			# ERPNext BOM validation multiplies qty/rate before Frappe can cast them.
			_coerce_doc_values(doc_data, _dt_meta)
			doc = frappe.get_doc(doc_data)
			doc.insert(ignore_permissions=False)
			# Submit immediately if DocType is submittable — cross-doc tree refs
			# (e.g. BOM.items.bom_no) require the referenced doc to be submitted.
			if frappe.get_meta(doctype).is_submittable:
				doc.submit()
			frappe.db.commit()
			created.append(doc.name)

			# ── Pattern 2: register identity_value → doc.name for future refs ───
			if p2_identity_field:
				identity_val = getattr(doc, p2_identity_field, None) or rec.get(p2_identity_field)
				if identity_val:
					identity_to_created[str(identity_val)] = doc.name

			frappe.publish_realtime(
				"ev_tree_progress",
				{
					"job_id": job_id,
					"status": "ok",
					"name": doc.name,
					"idx": i,
					"total": total,
				},
				user=frappe.session.user,
				after_commit=False,
			)

		except Exception as exc:
			err_msg = _clean_exc(exc)
			errors.append({"name": rec.get("name", f"Row {i + 1}"), "error": err_msg})

			frappe.publish_realtime(
				"ev_tree_progress",
				{
					"job_id": job_id,
					"status": "error",
					"name": rec.get("name", f"Row {i + 1}"),
					"error": err_msg,
					"idx": i,
					"total": total,
				},
				user=frappe.session.user,
				after_commit=False,
			)

			# Atomic: roll back every doc created so far
			_rollback_tree(created, doctype)

			frappe.publish_realtime(
				"ev_tree_progress",
				{
					"job_id": job_id,
					"status": "rolled_back",
					"name": rec.get("name", f"Row {i + 1}"),
					"error": err_msg,
					"idx": i,
					"total": total,
				},
				user=frappe.session.user,
				after_commit=False,
			)

			return {"status": "rolled_back", "created": 0, "errors": errors}

	return {"status": "ok", "created": len(created), "errors": []}


# ── Helpers ───────────────────────────────────────────────────────────────────

_NUMERIC_FIELDTYPES = frozenset(("Float", "Currency", "Percent"))
_INT_FIELDTYPES     = frozenset(("Int", "Check"))


def _coerce_doc_values(doc_data: dict, meta) -> None:
	"""
	Convert string numeric values in doc_data to Python float/int in-place,
	including child table rows. CSV data arrives entirely as strings; ERPNext
	validators (e.g. BOM.set_bom_material_details) multiply qty/rate before
	Frappe's own type-cast pass runs, causing 'can't multiply sequence by
	non-int of type float' errors.
	"""
	child_table_meta: dict = {}  # fieldname → child Meta (lazy)

	for df in meta.fields:
		fn = df.fieldname
		val = doc_data.get(fn)
		if val is None:
			continue
		if df.fieldtype in _NUMERIC_FIELDTYPES:
			if isinstance(val, str):
				try: doc_data[fn] = float(val) if val.strip() else 0.0
				except (ValueError, TypeError): pass
		elif df.fieldtype in _INT_FIELDTYPES:
			if isinstance(val, str):
				try: doc_data[fn] = int(float(val)) if val.strip() else 0
				except (ValueError, TypeError): pass
		elif df.fieldtype == "Table" and df.options:
			rows = doc_data.get(fn)
			if not rows:
				continue
			if fn not in child_table_meta:
				try:
					child_table_meta[fn] = frappe.get_meta(df.options)
				except Exception:
					continue
			cmeta = child_table_meta[fn]
			ctype: dict = {cf.fieldname: cf.fieldtype for cf in cmeta.fields}
			for row in rows:
				for cfn, cft in ctype.items():
					cv = row.get(cfn)
					if not isinstance(cv, str):
						continue
					if cft in _NUMERIC_FIELDTYPES:
						try: row[cfn] = float(cv) if cv.strip() else 0.0
						except (ValueError, TypeError): pass
					elif cft in _INT_FIELDTYPES:
						try: row[cfn] = int(float(cv)) if cv.strip() else 0
						except (ValueError, TypeError): pass


def _resolve_child_link_refs(
	rec: dict,
	doctype: str,
	table_field: str,
	link_field: str,
	identity_to_created: dict,
) -> dict:
	"""
	Resolve item-code aliases in a child-table link field before doc insertion.

	The user writes items.bom_no = "EV-STATOR-ASSY" (the item being manufactured).
	We resolve this to the actual BOM name via a 4-tier fallback:

	  Tier 1 — Batch: identity_to_created["EV-STATOR-ASSY"] was populated when
	            we created the sub-assembly BOM a moment ago → use that name.
	  Tier 2 — DB default: query BOM WHERE item="EV-STATOR-ASSY" AND is_default=1.
	  Tier 3 — DB any active: query BOM WHERE item="EV-STATOR-ASSY" AND is_active=1.
	  Tier 4 — Verbatim: frappe.db.exists(doctype, value) → value IS a BOM name.
	  Fallthrough: leave unchanged (Frappe will validate and surface the error).

	Works for any Pattern 2 DocType — not just BOM — as long as identity_field
	is detected correctly by the client.

	Returns a shallow copy of rec with resolved child rows.
	"""
	child_rows = rec.get(table_field)
	if not child_rows:
		return rec

	resolved_rows = []
	for row in child_rows:
		value = (row.get(link_field) or "").strip()
		if not value:
			resolved_rows.append(row)
			continue

		resolved = _resolve_link_value(value, doctype, identity_to_created)
		if resolved != value:
			row = dict(row)  # shallow copy — never mutate the caller's data
			row[link_field] = resolved
		resolved_rows.append(row)

	return {**rec, table_field: resolved_rows}


def _resolve_link_value(value: str, doctype: str, identity_to_created: dict) -> str:
	"""
	Resolve a single link field value.

	Tier 1 — Batch-created doc (identity_to_created populated during this import).
	Tier 2 — Default doc in DB for this identity value.
	Tier 3 — Any active doc in DB for this identity value.
	Tier 4 — Already a valid doc name (verbatim).
	Fallthrough — return unchanged.
	"""
	# Tier 1: resolved within this import batch
	if value in identity_to_created:
		return identity_to_created[value]

	# Tier 4: already a real doc name — skip DB identity search
	if frappe.db.exists(doctype, value):
		return value

	# Tiers 2 & 3: search by identity field value
	# Find the first non-system Link/Data field on the DocType that is mandatory.
	# This mirrors the client-side identity_field detection.
	meta = frappe.get_meta(doctype)
	identity_field = _detect_identity_field(meta)
	if not identity_field:
		return value  # cannot resolve — fall through

	# Tier 2: default doc
	name = frappe.db.get_value(
		doctype,
		{identity_field: value, "is_default": 1, "is_active": 1},
		"name",
	)
	if name:
		return name

	# Tier 3: any active doc
	name = frappe.db.get_value(
		doctype,
		{identity_field: value, "is_active": 1},
		"name",
	)
	if name:
		return name

	return value  # fall through — Frappe will validate


def _detect_identity_field(meta) -> str | None:
	"""
	Find the primary content field of a DocType — the first mandatory Link or Data
	field that appears before the first Table field.  For BOM this returns "item".
	Mirrors the client-side detection in _bi_detect_tree_pattern().
	"""
	identity = None
	for df in meta.fields:
		if df.fieldtype == "Table":
			break  # stop at first table — identity must precede it
		if df.reqd and df.fieldname not in ("name", "naming_series") and \
				df.fieldtype in ("Link", "Data", "Dynamic Link"):
			identity = df.fieldname
			break
	return identity


def _rollback_tree(created_names, doctype):
	"""Delete created docs in reverse order (children before parents, leaves before roots)."""
	is_submittable = frappe.get_meta(doctype).is_submittable
	for name in reversed(created_names):
		try:
			if is_submittable:
				doc = frappe.get_doc(doctype, name)
				if doc.docstatus == 1:
					doc.cancel()
					frappe.db.commit()
			frappe.delete_doc(doctype, name, ignore_permissions=True, force=True)
			frappe.db.commit()
		except Exception:
			pass  # best-effort rollback


def _clean_exc(exc):
	"""Extract the last meaningful line from an exception for display."""
	msg = str(exc)
	lines = [l.strip() for l in msg.splitlines() if l.strip()]
	return lines[-1] if lines else msg
