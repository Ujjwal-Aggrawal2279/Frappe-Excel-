import frappe


def execute(filters=None):
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{
			"label": "Customer",
			"fieldname": "customer",
			"fieldtype": "Link",
			"options": "Customer",
			"width": 180,
		},
		{
			"label": "Customer Group",
			"fieldname": "customer_group",
			"fieldtype": "Link",
			"options": "Customer Group",
			"width": 140,
		},
		{
			"label": "Territory",
			"fieldname": "territory",
			"fieldtype": "Link",
			"options": "Territory",
			"width": 140,
		},
		{
			"label": "Item Code",
			"fieldname": "item_code",
			"fieldtype": "Link",
			"options": "Item",
			"width": 160,
		},
		{
			"label": "Item Group",
			"fieldname": "item_group",
			"fieldtype": "Link",
			"options": "Item Group",
			"width": 140,
		},
		{
			"label": "Qty",
			"fieldname": "qty",
			"fieldtype": "Float",
			"width": 90,
		},
		{
			"label": "Amount",
			"fieldname": "amount",
			"fieldtype": "Currency",
			"width": 140,
		},
		{
			"label": "Order Date",
			"fieldname": "transaction_date",
			"fieldtype": "Date",
			"width": 120,
		},
	]


def get_data(filters=None):
	conditions = ""
	if filters:
		if filters.get("customer_group"):
			conditions += " AND so.customer_group = %(customer_group)s"
		if filters.get("item_group"):
			conditions += " AND soi.item_group = %(item_group)s"
		if filters.get("territory"):
			conditions += " AND so.territory = %(territory)s"
		if filters.get("from_date"):
			conditions += " AND so.transaction_date >= %(from_date)s"
		if filters.get("to_date"):
			conditions += " AND so.transaction_date <= %(to_date)s"

	return frappe.db.sql(
		f"""
		SELECT
			so.customer          AS customer,
			so.customer_group    AS customer_group,
			so.territory         AS territory,
			soi.item_code        AS item_code,
			soi.item_group       AS item_group,
			SUM(soi.qty)         AS qty,
			SUM(soi.amount)      AS amount,
			so.transaction_date  AS transaction_date
		FROM
			`tabSales Order Item` soi
		JOIN
			`tabSales Order` so ON so.name = soi.parent
		WHERE
			so.docstatus = 1
			{conditions}
		GROUP BY
			so.customer, so.customer_group, so.territory,
			soi.item_code, soi.item_group, so.transaction_date
		ORDER BY
			amount DESC
		""",
		filters or {},
		as_dict=True,
	)
