/**
 * query_ast.js — QueryAST: Canonical in-memory representation of a visual query.
 *
 * All IntelliFlow query-building operations (JOIN, WHERE, AGGREGATE, COMPUTE,
 * WINDOW, SORT, LIMIT) produce and consume this AST. SQLGenerator converts it
 * to DuckDB SQL. QueryFlowPanel renders it visually.
 *
 * V3 IntelliFlow — Zero LLM, 100% deterministic.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.QueryAST = class QueryAST {
	constructor() {
		this.reset();
	}

	reset() {
		/** SOURCE — base DocType table */
		this.source = {
			doctype: null,     // e.g. "Sales Invoice"
			alias: "t0",
			fields: [],        // [{ fieldname, label, fieldtype, alias? }]
		};

		/** JOINs — array of join nodes in order */
		this.joins = [];
		// Each join: { id, src_doctype, src_alias, tgt_doctype, tgt_alias,
		//              join_type, src_field, tgt_field, fields: [] }

		/** WHERE — nested AND/OR groups */
		this.where = {
			logic: "AND",          // top-level connector
			groups: [],
			// Each group: { id, logic: "AND"|"OR", conditions: [] }
			// Each condition: { id, table_alias, fieldname, fieldtype, operator, value, value2? }
		};

		/** AGGREGATE */
		this.aggregate = {
			enabled: false,
			group_by: [],        // [{ table_alias, fieldname, label }]
			aggregations: [],    // [{ id, fn: "SUM"|"AVG"|"COUNT"|"MIN"|"MAX", table_alias, fieldname, alias }]
			having: {
				logic: "AND",
				conditions: [],  // same structure as where conditions but ref agg aliases
			},
		};

		/** COMPUTE — calculated columns (CASE/IF/arithmetic/expression) */
		this.compute = [];
		// Each: { id, alias, expr_type: "case"|"if"|"arithmetic"|"expr",
		//         cases: [], else_value, expr: "" }

		/** WINDOW functions */
		this.windows = [];
		// Each: { id, fn, table_alias, fieldname, alias,
		//         partition_by: [], order_by: [], frame: null }

		/** SORT */
		this.sort = [];
		// Each: { table_alias, fieldname_or_alias, direction: "ASC"|"DESC" }

		/** LIMIT / OFFSET */
		this.limit = 10000;
		this.offset = 0;

		/** OUTPUT sheet config */
		this.output = {
			sheet_name: "Query Result",
			mode: "new_sheet",   // "new_sheet" | "current_sheet"
		};
	}

	/** Serialise to plain JSON (safe to store/transmit). */
	to_json() {
		return JSON.parse(JSON.stringify({
			source: this.source,
			joins: this.joins,
			where: this.where,
			aggregate: this.aggregate,
			compute: this.compute,
			windows: this.windows,
			sort: this.sort,
			limit: this.limit,
			offset: this.offset,
			output: this.output,
		}));
	}

	/** Restore from plain JSON. */
	static from_json(obj) {
		const ast = new frappe.views.excel.QueryAST();
		Object.assign(ast, JSON.parse(JSON.stringify(obj)));
		return ast;
	}

	// ── Mutation helpers ────────────────────────────────────────────────────

	set_source(doctype, fields = []) {
		this.source.doctype = doctype;
		this.source.alias = "t0";
		this.source.fields = fields;
	}

	add_join(opts) {
		const idx = this.joins.length;
		this.joins.push({
			id: `j${idx}_${Date.now()}`,
			join_type: "LEFT",
			fields: [],
			...opts,
			tgt_alias: `t${idx + 1}`,
		});
	}

	add_where_group(logic = "AND") {
		const grp = {
			id: `wg_${Date.now()}`,
			logic,
			conditions: [],
		};
		this.where.groups.push(grp);
		return grp;
	}

	add_condition(group_id, cond) {
		const grp = this.where.groups.find(g => g.id === group_id);
		if (!grp) return;
		grp.conditions.push({ id: `c_${Date.now()}`, ...cond });
	}

	add_aggregation(fn, table_alias, fieldname, alias) {
		this.aggregate.aggregations.push({
			id: `agg_${Date.now()}`,
			fn,
			table_alias,
			fieldname,
			alias: alias || `${fn.toLowerCase()}_${fieldname}`,
		});
		this.aggregate.enabled = true;
	}

	add_compute(opts) {
		this.compute.push({ id: `cp_${Date.now()}`, ...opts });
	}

	add_window(opts) {
		this.windows.push({ id: `win_${Date.now()}`, ...opts });
	}

	add_sort(table_alias, fieldname_or_alias, direction = "ASC") {
		this.sort.push({ table_alias, fieldname_or_alias, direction });
	}

	// ── Validation ─────────────────────────────────────────────────────────

	validate() {
		const errors = [];
		if (!this.source.doctype) errors.push("No source DocType selected");
		if (this.source.fields.length === 0 && this.joins.length === 0) {
			errors.push("Select at least one field from the source table");
		}
		this.joins.forEach((j, i) => {
			if (!j.src_field || !j.tgt_field) {
				errors.push(`Join #${i + 1}: missing join condition fields`);
			}
		});
		this.where.groups.forEach(g => {
			g.conditions.forEach(c => {
				if (!c.fieldname) errors.push(`WHERE: condition missing field`);
				if (c.value === undefined || c.value === null || c.value === "") {
					if (!["is_set", "is_not_set"].includes(c.operator)) {
						errors.push(`WHERE: condition on '${c.fieldname}' missing value`);
					}
				}
			});
		});
		this.compute.forEach(cp => {
			if (!cp.alias) errors.push(`COMPUTE: computed column missing alias`);
		});
		this.windows.forEach(w => {
			if (!w.alias) errors.push(`WINDOW: window column missing alias`);
		});
		return errors;
	}

	// ── Introspection ───────────────────────────────────────────────────────

	/** Returns all output columns (for SORT / downstream reference). */
	all_output_columns() {
		const cols = [];
		// source fields
		this.source.fields.forEach(f => {
			cols.push({ ref: `${this.source.alias}.${f.fieldname}`, label: f.label || f.fieldname, type: f.fieldtype });
		});
		// join fields
		this.joins.forEach(j => {
			j.fields.forEach(f => {
				cols.push({ ref: `${j.tgt_alias}.${f.fieldname}`, label: f.label || f.fieldname, type: f.fieldtype });
			});
		});
		// aggregations
		this.aggregate.aggregations.forEach(a => {
			cols.push({ ref: a.alias, label: a.alias, type: "Float" });
		});
		// computed
		this.compute.forEach(cp => {
			cols.push({ ref: cp.alias, label: cp.alias, type: "Data" });
		});
		// windows
		this.windows.forEach(w => {
			cols.push({ ref: w.alias, label: w.alias, type: "Float" });
		});
		return cols;
	}

	/** Quick summary for the QueryFlowPanel header. */
	summary() {
		return {
			tables: [this.source.doctype, ...this.joins.map(j => j.tgt_doctype)].filter(Boolean),
			where_count: this.where.groups.reduce((s, g) => s + g.conditions.length, 0),
			agg_count: this.aggregate.aggregations.length,
			compute_count: this.compute.length,
			window_count: this.windows.length,
			sort_count: this.sort.length,
			limit: this.limit,
		};
	}
};
