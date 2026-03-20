import frappe


def execute(filters=None):
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{
			"label": "Customer",
			"fieldname": "customer_name",
			"fieldtype": "Link",
			"options": "Customer",
			"width": 220,
		},
		{
			"label": "No. of Orders",
			"fieldname": "order_count",
			"fieldtype": "Int",
			"width": 130,
		},
		{
			"label": "Total Amount",
			"fieldname": "total_amount",
			"fieldtype": "Currency",
			"width": 160,
		},
	]


def get_data(filters=None):
	conditions = ""
	if filters:
		if filters.get("customer"):
			conditions += " AND so.customer = %(customer)s"
		if filters.get("from_date"):
			conditions += " AND so.transaction_date >= %(from_date)s"
		if filters.get("to_date"):
			conditions += " AND so.transaction_date <= %(to_date)s"

	return frappe.db.sql(
		f"""
		SELECT
			so.customer_name,
			COUNT(so.name) AS order_count,
			SUM(so.grand_total) AS total_amount
		FROM
			`tabSales Order` so
		WHERE
			so.docstatus = 1
			{conditions}
		GROUP BY
			so.customer_name
		ORDER BY
			total_amount DESC
		""",
		filters or {},
		as_dict=True,
	)
