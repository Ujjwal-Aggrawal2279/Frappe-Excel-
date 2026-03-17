"""
Scheduled background tasks for Excel View.
"""
import frappe


def hourly():
	"""Refresh cached schema graph and link-edge cache so first-user requests are fast."""
	try:
		# Bust link-edge cache so next call rebuilds it fresh
		frappe.cache().delete_value("ev_link_graph_edges_v3")
		# Rebuild immediately (warms the cache for this worker)
		from excel_view.api import _get_all_link_edges
		_get_all_link_edges()
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Excel View: hourly edge cache refresh failed")

	try:
		# Refresh schema graph (used by Smart Lookup, find_related_doctypes)
		from excel_view.api import build_schema_graph
		build_schema_graph(force_refresh=True)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Excel View: hourly graph refresh failed")
