import frappe
from frappe.model.document import Document


class ExcelFormula(Document):
	def validate(self):
		self.formula_name = self.formula_name.upper().replace(" ", "_")

	def before_save(self):
		if self.is_system and not frappe.flags.in_import:
			# Prevent users from modifying system formula type/doctype
			old = self.get_doc_before_save()
			if old:
				self.formula_type    = old.formula_type
				self.source_doctype  = old.source_doctype
				self.target_fieldname = old.target_fieldname

	# No custom realtime hooks needed.
	# Frappe core automatically broadcasts a "list_update" event (room = site,
	# after_commit = True) for every DocType save/delete. The JS side listens
	# to that event and fetches fresh configs via excel_view.api.get_formula_configs.
