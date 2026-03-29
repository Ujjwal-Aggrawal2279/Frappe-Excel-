/**
 * sql_generator.js — SQLGenerator: QueryAST → DuckDB SQL string.
 *
 * Handles: multi-table JOINs, nested AND/OR WHERE, GROUP BY + HAVING,
 * CASE/IF COMPUTE columns, WINDOW functions (SUM/AVG/RANK/DENSE_RANK/
 * ROW_NUMBER/LAG/LEAD/FIRST_VALUE/LAST_VALUE OVER PARTITION/ORDER),
 * ORDER BY, LIMIT/OFFSET, CTEs.
 *
 * Output SQL is readable (uses sql-formatter when available).
 * Zero LLM — pure deterministic template generation.
 *
 * V3 IntelliFlow.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.SQLGenerator = class SQLGenerator {

	constructor(ast) {
		/** @type {frappe.views.excel.QueryAST} */
		this.ast = ast;
	}

	/** Generate full SQL string. Throws if AST is invalid. */
	generate() {
		const errors = this.ast.validate();
		if (errors.length) throw new Error(errors.join("; "));

		// When window functions + compute columns coexist, compute can't reference
		// window aliases from the same SELECT — wrap in subquery.
		if (this.ast.windows.length > 0 && this.ast.compute.length > 0) {
			return this._format(this._generate_window_subquery());
		}

		const parts = [];

		// SELECT
		parts.push(`SELECT ${this._build_select()}`);

		// FROM
		parts.push(`FROM ${this._table_ref(this.ast.source.doctype, this.ast.source.alias)}`);

		// JOINs
		this.ast.joins.forEach(j => {
			parts.push(this._build_join(j));
		});

		// WHERE
		const where_sql = this._build_where(this.ast.where);
		if (where_sql) parts.push(`WHERE ${where_sql}`);

		// GROUP BY
		if (this.ast.aggregate.enabled && this.ast.aggregate.group_by.length) {
			const gb = this.ast.aggregate.group_by.map(g => this._col_ref(g.table_alias, g.fieldname));
			parts.push(`GROUP BY ${gb.join(", ")}`);

			// HAVING
			const having_sql = this._build_having();
			if (having_sql) parts.push(`HAVING ${having_sql}`);
		}

		// ORDER BY
		const valid_sorts = this.ast.sort.filter(s => s.fieldname_or_alias);
		if (valid_sorts.length) {
			const ob = valid_sorts.map(s =>
				`${s.table_alias ? this._col_ref(s.table_alias, s.fieldname_or_alias) : this._ident(s.fieldname_or_alias)} ${s.direction}`
			);
			parts.push(`ORDER BY ${ob.join(", ")}`);
		}

		// LIMIT / OFFSET
		if (this.ast.limit > 0) {
			parts.push(`LIMIT ${this.ast.limit}`);
		}
		if (this.ast.offset > 0) {
			parts.push(`OFFSET ${this.ast.offset}`);
		}

		const raw_sql = parts.join("\n");
		return this._format(raw_sql);
	}

	/**
	 * When both window functions AND compute columns exist:
	 * Inner subquery: base fields + window functions
	 * Outer SELECT: * + compute expressions + ORDER BY + LIMIT
	 */
	_generate_window_subquery() {
		// ── Inner query (base fields + window functions) ──
		const inner = [];
		inner.push(`SELECT ${this._build_select_no_compute()}`);
		inner.push(`FROM ${this._table_ref(this.ast.source.doctype, this.ast.source.alias)}`);
		this.ast.joins.forEach(j => inner.push(this._build_join(j)));
		const where_sql = this._build_where(this.ast.where);
		if (where_sql) inner.push(`WHERE ${where_sql}`);
		if (this.ast.aggregate.enabled && this.ast.aggregate.group_by.length) {
			const gb = this.ast.aggregate.group_by.map(g => this._col_ref(g.table_alias, g.fieldname));
			inner.push(`GROUP BY ${gb.join(", ")}`);
			const having = this._build_having();
			if (having) inner.push(`HAVING ${having}`);
		}

		// ── Outer query (compute + order + limit) ──
		const outer_cols = ["*"];
		this.ast.compute.forEach(cp => {
			outer_cols.push(`${this._build_compute_expr(cp)} AS ${this._ident(cp.alias)}`);
		});

		const outer = [];
		outer.push(`SELECT ${outer_cols.join(",\n       ")}`);
		outer.push(`FROM (\n  ${inner.join("\n  ")}\n) AS _win`);

		const outer_sorts = this.ast.sort.filter(s => s.fieldname_or_alias);
		if (outer_sorts.length) {
			// In outer query columns are referenced by their inner-SELECT alias (label),
			// not by raw fieldname — use _outer_col_alias() to resolve.
			const ob = outer_sorts.map(s => `${this._outer_col_alias(s.fieldname_or_alias)} ${s.direction}`);
			outer.push(`ORDER BY ${ob.join(", ")}`);
		}
		if (this.ast.limit > 0)  outer.push(`LIMIT ${this.ast.limit}`);
		if (this.ast.offset > 0) outer.push(`OFFSET ${this.ast.offset}`);

		return outer.join("\n");
	}

	// ── SELECT list ────────────────────────────────────────────────────────

	/** SELECT without compute columns — used in inner subquery of window+compute pattern. */
	_build_select_no_compute() {
		const cols = [];
		if (!this.ast.aggregate.enabled) {
			this.ast.source.fields.forEach(f => {
				const ref = this._col_ref(this.ast.source.alias, f.fieldname);
				const alias = f.alias ? ` AS ${this._ident(f.alias)}` : ` AS ${this._ident(f.label || f.fieldname)}`;
				cols.push(`${ref}${alias}`);
			});
			this.ast.joins.forEach(j => {
				j.fields.forEach(f => {
					const ref = this._col_ref(j.tgt_alias, f.fieldname);
					const alias = f.alias ? ` AS ${this._ident(f.alias)}` : ` AS ${this._ident(f.label || f.fieldname)}`;
					cols.push(`${ref}${alias}`);
				});
			});
		} else {
			this.ast.aggregate.group_by.forEach(g => {
				cols.push(`${this._col_ref(g.table_alias, g.fieldname)} AS ${this._ident(g.label || g.fieldname)}`);
			});
			this.ast.aggregate.aggregations.forEach(a => {
				const inner = a.fieldname === "*" ? "*" : this._col_ref(a.table_alias, a.fieldname);
				cols.push(`${a.fn}(${inner}) AS ${this._ident(a.alias)}`);
			});
		}
		// Window columns — these are the aliases compute will reference
		this.ast.windows.forEach(w => {
			cols.push(`${this._build_window_expr(w)} AS ${this._ident(w.alias)}`);
		});
		return cols.length ? cols.join(",\n       ") : "*";
	}

	_build_select() {
		const cols = [];

		if (!this.ast.aggregate.enabled) {
			// Non-aggregated: source fields + join fields + compute + window
			this.ast.source.fields.forEach(f => {
				const ref = this._col_ref(this.ast.source.alias, f.fieldname);
				const alias = f.alias ? ` AS ${this._ident(f.alias)}` : ` AS ${this._ident(f.label || f.fieldname)}`;
				cols.push(`${ref}${alias}`);
			});
			this.ast.joins.forEach(j => {
				j.fields.forEach(f => {
					const ref = this._col_ref(j.tgt_alias, f.fieldname);
					const alias = f.alias ? ` AS ${this._ident(f.alias)}` : ` AS ${this._ident(f.label || f.fieldname)}`;
					cols.push(`${ref}${alias}`);
				});
			});
		} else {
			// Aggregated: group_by cols + agg cols
			this.ast.aggregate.group_by.forEach(g => {
				cols.push(`${this._col_ref(g.table_alias, g.fieldname)} AS ${this._ident(g.label || g.fieldname)}`);
			});
			this.ast.aggregate.aggregations.forEach(a => {
				const inner = a.fieldname === "*" ? "*" : this._col_ref(a.table_alias, a.fieldname);
				cols.push(`${a.fn}(${inner}) AS ${this._ident(a.alias)}`);
			});
		}

		// COMPUTE columns
		this.ast.compute.forEach(cp => {
			cols.push(`${this._build_compute_expr(cp)} AS ${this._ident(cp.alias)}`);
		});

		// WINDOW columns (inline OVER clause — no CTE needed for simple ones)
		this.ast.windows.forEach(w => {
			cols.push(`${this._build_window_expr(w)} AS ${this._ident(w.alias)}`);
		});

		return cols.length ? cols.join(",\n       ") : "*";
	}

	// ── JOIN clause ────────────────────────────────────────────────────────

	_build_join(j) {
		const jt = j.join_type || "LEFT";
		const tbl = this._table_ref(j.tgt_doctype, j.tgt_alias);
		const cond = `${this._col_ref(j.src_alias, j.src_field)} = ${this._col_ref(j.tgt_alias, j.tgt_field)}`;
		return `${jt} JOIN ${tbl} ON ${cond}`;
	}

	// ── WHERE / HAVING ─────────────────────────────────────────────────────

	_build_where(where_node) {
		if (!where_node || !where_node.groups || !where_node.groups.length) return "";
		const group_sqls = where_node.groups
			.map(g => this._build_where_group(g))
			.filter(Boolean);
		return group_sqls.join(` ${where_node.logic || "AND"} `);
	}

	_build_where_group(grp) {
		if (!grp.conditions || !grp.conditions.length) return "";
		const cond_sqls = grp.conditions.map(c => this._build_condition(c)).filter(Boolean);
		if (!cond_sqls.length) return "";
		const inner = cond_sqls.join(` ${grp.logic || "AND"} `);
		return cond_sqls.length > 1 ? `(${inner})` : inner;
	}

	_build_condition(c) {
		const col = c.table_alias
			? this._col_ref(c.table_alias, c.fieldname)
			: this._ident(c.fieldname);

		switch (c.operator) {
			case "=":      return `${col} = ${this._val(c.value, c.fieldtype)}`;
			case "!=":     return `${col} != ${this._val(c.value, c.fieldtype)}`;
			case ">":      return `${col} > ${this._val(c.value, c.fieldtype)}`;
			case ">=":     return `${col} >= ${this._val(c.value, c.fieldtype)}`;
			case "<":      return `${col} < ${this._val(c.value, c.fieldtype)}`;
			case "<=":     return `${col} <= ${this._val(c.value, c.fieldtype)}`;
			case "like":   return `${col} LIKE ${this._val(c.value, "Data")}`;
			case "not like": return `${col} NOT LIKE ${this._val(c.value, "Data")}`;
			case "in":     return `${col} IN (${this._val_list(c.value)})`;
			case "not in": return `${col} NOT IN (${this._val_list(c.value)})`;
			case "between":
				return `${col} BETWEEN ${this._val(c.value, c.fieldtype)} AND ${this._val(c.value2, c.fieldtype)}`;
			case "is_set":     return `${col} IS NOT NULL AND ${col} != ''`;
			case "is_not_set": return `(${col} IS NULL OR ${col} = '')`;
			default:           return `${col} = ${this._val(c.value, c.fieldtype)}`;
		}
	}

	_build_having() {
		const hav = this.ast.aggregate.having;
		if (!hav || !hav.conditions || !hav.conditions.length) return "";
		const sqls = hav.conditions.map(c => this._build_condition(c)).filter(Boolean);
		return sqls.join(` ${hav.logic || "AND"} `);
	}

	// ── COMPUTE expressions ────────────────────────────────────────────────

	_build_compute_expr(cp) {
		switch (cp.expr_type) {
			case "case":   return this._build_case(cp);
			case "if":     return this._build_if(cp);
			case "arithmetic": return cp.expr || "NULL";
			case "expr":   return cp.expr || "NULL";
			default:       return "NULL";
		}
	}

	_build_case(cp) {
		const cases = (cp.cases || []).map(c =>
			`WHEN ${this._build_condition(c.condition)} THEN ${this._val(c.result, c.result_type || "Data")}`
		).join(" ");
		const else_part = cp.else_value !== undefined && cp.else_value !== null
			? ` ELSE ${this._val(cp.else_value, cp.result_type || "Data")}`
			: " ELSE NULL";
		return `CASE ${cases}${else_part} END`;
	}

	_build_if(cp) {
		if (!cp.cases || !cp.cases[0]) return "NULL";
		const cond = this._build_condition(cp.cases[0].condition);
		const t = this._val(cp.cases[0].result, cp.result_type || "Data");
		const f = cp.else_value !== undefined ? this._val(cp.else_value, cp.result_type || "Data") : "NULL";
		return `IIF(${cond}, ${t}, ${f})`;
	}

	// ── WINDOW expressions ─────────────────────────────────────────────────

	_build_window_expr(w) {
		const FNS_NO_ARG = ["ROW_NUMBER", "RANK", "DENSE_RANK"];
		const FNS_LAG_LEAD = ["LAG", "LEAD"];
		const FNS_FIRST_LAST = ["FIRST_VALUE", "LAST_VALUE"];

		let fn_call;
		if (FNS_NO_ARG.includes(w.fn)) {
			fn_call = `${w.fn}()`;
		} else if (FNS_LAG_LEAD.includes(w.fn)) {
			const col = this._col_ref(w.table_alias, w.fieldname);
			const offset = w.offset || 1;
			const def = w.default_value !== undefined ? `, ${this._val(w.default_value, "Float")}` : "";
			fn_call = `${w.fn}(${col}, ${offset}${def})`;
		} else if (FNS_FIRST_LAST.includes(w.fn)) {
			fn_call = `${w.fn}(${this._col_ref(w.table_alias, w.fieldname)})`;
		} else {
			// SUM, AVG, COUNT, MIN, MAX
			const col = w.fieldname === "*" ? "*" : this._col_ref(w.table_alias, w.fieldname);
			fn_call = `${w.fn}(${col})`;
		}

		const over = this._build_over(w);
		return `${fn_call} OVER (${over})`;
	}

	_build_over(w) {
		const parts = [];
		if (w.partition_by && w.partition_by.length) {
			const pb = w.partition_by.filter(p => p.fieldname).map(p => this._col_ref(p.table_alias, p.fieldname));
			if (pb.length) parts.push(`PARTITION BY ${pb.join(", ")}`);
		}
		if (w.order_by && w.order_by.length) {
			const ob = w.order_by.filter(o => o.fieldname).map(o => `${this._col_ref(o.table_alias, o.fieldname)} ${o.direction || "ASC"}`);
			if (ob.length) parts.push(`ORDER BY ${ob.join(", ")}`);
		}
		if (w.frame) {
			parts.push(w.frame);
		}
		return parts.join(" ");
	}

	/**
	 * Resolve a fieldname/alias to the column name as it appears in the inner
	 * subquery of _generate_window_subquery (i.e. the label-based alias).
	 * Source/join fields → label; window/compute aliases → themselves.
	 */
	_outer_col_alias(fieldname_or_alias) {
		// Source fields are aliased by label in inner SELECT
		const sf = this.ast.source.fields.find(f => f.fieldname === fieldname_or_alias);
		if (sf) return this._ident(sf.alias || sf.label || sf.fieldname);

		// Join fields
		for (const j of this.ast.joins) {
			const jf = (j.fields || []).find(f => f.fieldname === fieldname_or_alias);
			if (jf) return this._ident(jf.alias || jf.label || jf.fieldname);
		}

		// Window/compute aliases — used directly as aliases in inner SELECT
		return this._ident(fieldname_or_alias);
	}

	// ── CTEs ───────────────────────────────────────────────────────────────
	// Reserved for future use (recursive CTEs for self-referential trees).
	_build_ctes() {
		return [];
	}

	// ── Identifier / value helpers ─────────────────────────────────────────

	/** Escape and quote a DuckDB identifier. */
	_ident(name) {
		if (!name) return "NULL";
		// If already quoted, return as-is
		if (name.startsWith('"') && name.endsWith('"')) return name;
		// Quote identifiers with spaces or special chars
		return `"${name.replace(/"/g, '""')}"`;
	}

	/** Table ref with alias: "tabSales Invoice" AS t0 */
	_table_ref(doctype, alias) {
		const tbl = `tab${doctype}`;
		return `${this._ident(tbl)} AS ${alias}`;
	}

	/** Column reference: t0."grand_total" */
	_col_ref(alias, fieldname) {
		if (!alias) return this._ident(fieldname);
		return `${alias}.${this._ident(fieldname)}`;
	}

	/** Escape a scalar value for SQL. */
	_val(v, fieldtype) {
		if (v === null || v === undefined) return "NULL";
		const numeric_types = ["Currency", "Float", "Int", "Percent"];
		if (numeric_types.includes(fieldtype)) {
			const n = parseFloat(v);
			return isNaN(n) ? "NULL" : String(n);
		}
		if (fieldtype === "Check") {
			return v ? "1" : "0";
		}
		// String escape: replace ' with ''
		return `'${String(v).replace(/'/g, "''")}'`;
	}

	/** Comma-separated list of values. */
	_val_list(v) {
		const arr = Array.isArray(v) ? v : String(v).split(",").map(s => s.trim());
		return arr.map(x => `'${String(x).replace(/'/g, "''")}'`).join(", ");
	}

	// ── Formatter ──────────────────────────────────────────────────────────

	_format(sql) {
		// sql-formatter is loaded as a window global via the bundle
		if (window.sqlFormatter && window.sqlFormatter.format) {
			try {
				return window.sqlFormatter.format(sql, {
					language: "sql",
					tabWidth: 2,
					keywordCase: "upper",
				});
			} catch (_) {
				// Fall through to raw
			}
		}
		return sql;
	}
};
