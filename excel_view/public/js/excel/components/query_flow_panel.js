/**
 * query_flow_panel.js — QueryFlowPanel: Left-side flowchart pipeline panel.
 *
 * Renders a visual flowchart pipeline:
 *   ╔═══════════╗
 *   ║  SOURCE   ║  ← oval (start)
 *   ╚═══╤═══════╝
 *       │
 *   ┌───▼───────┐
 *   │   JOIN    │  ← rectangle (process)
 *   └───┬───────┘
 *       │
 *   ◇ WHERE ◇     ← diamond (decision)
 *       │
 *   ┌───▼───────┐
 *   │ AGGREGATE │
 *   └───┬───────┘
 *       │
 *   ┌───▼───────┐
 *   │  COMPUTE  │
 *   └───┬───────┘
 *       │
 *   ┌───▼───────┐
 *   │  WINDOW   │
 *   └───┬───────┘
 *       │
 *   ┌───▼───────┐
 *   │   SORT    │
 *   └───┬───────┘
 *       │
 *   ╔═══▼═══════╗
 *   ║  OUTPUT   ║  ← oval (end)
 *   ╚═══════════╝
 *
 * Each step expands into an inline editor when clicked.
 * Syncs bidirectionally with QueryAST and the canvas.
 *
 * V3 IntelliFlow — Zero LLM.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.QueryFlowPanel = class QueryFlowPanel {

	/** @param {Object} opts */
	constructor(opts) {
		this.ast = opts.ast;                 // QueryAST instance
		this.canvas = opts.canvas;           // JoinCanvas instance (for schema info)
		this.on_ast_change = opts.on_ast_change || (() => {});  // callback when AST mutates
		this.$container = null;
		this._active_step = null;
		this._schema_cache = {};             // doctype → fields[]
	}

	// ── Render ──────────────────────────────────────────────────────────────

	render($parent) {
		this.$container = $(`
			<div class="ev-qfp">
				<div class="ev-qfp-header">
					<span class="ev-qfp-title">Query Flow</span>
					<button class="ev-qfp-run-btn" title="Run Query">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
							<path d="M8 5v14l11-7z"/>
						</svg>
						Run
					</button>
				</div>
				<div class="ev-qfp-pipeline"></div>
			</div>
		`).appendTo($parent);

		this._render_pipeline();
		this._bind_run();
	}

	_render_pipeline() {
		const $pipe = this.$container.find(".ev-qfp-pipeline").empty();
		const summary = this.ast.summary();

		// ── SOURCE card — always rendered ──────────────────────────────────────
		const src_dt = frappe.utils.escape_html(this.ast.source.doctype || "");
		const src_open = this._active_step !== "source_closed";
		const $src = $(`
			<div class="ev-qfp-src-card" data-step="source">
				<div class="ev-qfp-src-card-hd">
					<span class="ev-qfp-src-card-icon"></span>
					<div class="ev-qfp-src-card-titles">
						<span class="ev-qfp-src-card-label">SOURCE</span>
						${src_dt ? `<span class="ev-qfp-src-card-sub">${src_dt}</span>` : ""}
					</div>
					<span class="ev-qfp-src-chev">${src_open ? "⌄" : "›"}</span>
				</div>
				<div class="ev-qfp-src-card-body" style="${src_open ? "" : "display:none;"}"></div>
			</div>
		`).appendTo($pipe);

		this._render_source_editor($src.find(".ev-qfp-src-card-body"));

		$src.find(".ev-qfp-src-card-hd").on("click", () => {
			const $body = $src.find(".ev-qfp-src-card-body");
			const $chev = $src.find(".ev-qfp-src-chev");
			if ($body.is(":visible")) {
				$body.slideUp(120);
				$chev.text("›");
				this._active_step = "source_closed";
			} else {
				$body.slideDown(150);
				$chev.text("⌄");
				this._active_step = null;
			}
		});

		// ── Track — sections with vertical pipeline line ───────────────────────
		const $track = $(`<div class="ev-qfp-track"></div>`).appendTo($pipe);

		const sections = [
			{ id: "join",      label: "Joins",     icon: "◇", count: this.ast.joins.length,     add: true  },
			{ id: "where",     label: "Filters",   icon: "▽", count: summary.where_count,        add: true  },
			{ id: "aggregate", label: "Aggregate", icon: "⊕", count: summary.agg_count,          add: true  },
			{ id: "compute",   label: "Compute",   icon: "✕", count: summary.compute_count,      add: true  },
			{ id: "window",    label: "Window",    icon: "⊞", count: summary.window_count,       add: true  },
			{ id: "sort",      label: "Sort",      icon: "⇅", count: summary.sort_count,         add: true  },
			{ id: "output",    label: "Output",    icon: "●", count: null,                        add: false },
		];

		sections.forEach(sec => {
			const is_open = this._active_step === sec.id;
			const count_html = sec.count > 0
				? `<span class="ev-qfp-sec-count">${sec.count}</span>` : "";
			const add_html = sec.add
				? `<button class="ev-qfp-sec-plus" title="Add">+</button>` : "";

			const $sec = $(`
				<div class="ev-qfp-sec${is_open ? " ev-qfp-sec--open" : ""}" data-step="${sec.id}">
					<div class="ev-qfp-sec-hd">
						<span class="ev-qfp-sec-icon">${sec.icon}</span>
						<span class="ev-qfp-sec-label">${sec.label}</span>
						${count_html}
						${add_html}
					</div>
					<div class="ev-qfp-sec-body" style="${is_open ? "" : "display:none;"}"></div>
				</div>
			`).appendTo($track);

			if (is_open) {
				this._render_step_editor(sec.id, $sec.find(".ev-qfp-sec-body"));
			}

			$sec.find(".ev-qfp-sec-hd").on("click", (e) => {
				if ($(e.target).closest(".ev-qfp-sec-plus").length) return;
				this._toggle_section(sec.id, $sec);
			});

			$sec.find(".ev-qfp-sec-plus").on("click", () => {
				if (!$sec.hasClass("ev-qfp-sec--open")) {
					this._toggle_section(sec.id, $sec);
					// defer so body is rendered first
					setTimeout(() => this._section_quick_add(sec.id, $sec.find(".ev-qfp-sec-body")), 200);
				} else {
					this._section_quick_add(sec.id, $sec.find(".ev-qfp-sec-body"));
				}
			});
		});
	}

	_toggle_section(step_id, $sec) {
		const $body = $sec.find(".ev-qfp-sec-body");
		const is_open = $sec.hasClass("ev-qfp-sec--open");
		if (is_open) {
			$sec.removeClass("ev-qfp-sec--open");
			$body.slideUp(120);
			this._active_step = null;
		} else {
			$sec.addClass("ev-qfp-sec--open");
			$body.slideDown(150);
			this._active_step = step_id;
			if (!$body.children().length) {
				this._render_step_editor(step_id, $body);
			}
		}
	}

	_section_quick_add(step_id, $body) {
		const map = {
			join:      ".ev-qfp-add-join-btn",
			where:     ".ev-qfp-add-group",
			aggregate: ".ev-qfp-add-agg",
			compute:   ".ev-qfp-add-compute",
			window:    ".ev-qfp-add-window",
			sort:      ".ev-qfp-add-sort",
		};
		const sel = map[step_id];
		if (sel) $body.find(sel).trigger("click");
	}

	_render_step_editor(step_id, $body) {
		$body.empty();
		switch (step_id) {
			case "source":    return this._render_source_editor($body);
			case "join":      return this._render_join_editor($body);
			case "where":     return this._render_where_editor($body);
			case "aggregate": return this._render_aggregate_editor($body);
			case "compute":   return this._render_compute_editor($body);
			case "window":    return this._render_window_editor($body);
			case "sort":      return this._render_sort_editor($body);
			case "output":    return this._render_output_editor($body);
		}
	}

	// ── SOURCE editor ───────────────────────────────────────────────────────

	_render_source_editor($body) {
		const doctype = this.ast.source.doctype || "";
		$body.append(`
			<div class="ev-qfp-src-editor">
				<div class="ev-qfp-src-dt-section">
					<div class="ev-qfp-src-dt-label">DocType</div>
					<div class="ev-qfp-src-dt-ctrl"></div>
				</div>
				${!doctype ? `<div class="ev-qfp-src-placeholder">Search a DocType to begin building your query</div>` : ""}
				<div class="ev-qfp-src-fl-section" style="display:none;"></div>
			</div>
		`);

		const $dt_ctrl = $body.find(".ev-qfp-src-dt-ctrl");
		const $fl_section = $body.find(".ev-qfp-src-fl-section");

		// Frappe Link control for DocType
		const ctrl = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				options: "DocType",
				label: "",
				fieldname: "source_doctype",
				placeholder: "Search DocType…",
			},
			parent: $dt_ctrl[0],
			render_input: true,
		});
		ctrl.refresh();
		// remove frappe's own label (we have our own)
		$dt_ctrl.find(".control-label, .help-box").remove();

		const load_fields = (dt) => {
			if (!dt) { $fl_section.hide().empty(); return; }
			this._load_schema(dt).then(fields => {
				this.ast.set_source(dt, this.ast.source.fields.length ? this.ast.source.fields : []);
				$fl_section.show();
				this._render_source_field_list($fl_section, dt, fields);
				// Update SOURCE header sub-label in-place (no pipeline rebuild = no DOM destroy)
				const $titles = this.$container.find(".ev-qfp-src-card-titles");
				const esc = frappe.utils.escape_html(dt);
				const $sub = $titles.find(".ev-qfp-src-card-sub");
				if ($sub.length) $sub.text(dt);
				else $titles.append(`<span class="ev-qfp-src-card-sub">${esc}</span>`);
				this.on_ast_change(this.ast, "update");
			});
		};

		// React on Link control value change
		$(ctrl.input).on("change", frappe.utils.debounce(() => {
			const val = ctrl.get_value();
			if (val) load_fields(val);
		}, 150));

		// If already set, load immediately
		if (doctype) {
			setTimeout(() => ctrl.set_value(doctype), 40);
			this._load_schema(doctype).then(fields => {
				$fl_section.show();
				this._render_source_field_list($fl_section, doctype, fields);
			});
		}
	}

	_render_source_field_list($section, doctype, fields) {
		const selected_set = new Set(this.ast.source.fields.map(f => f.fieldname));
		const visible_fields = fields.filter(f => !["Column Break","Section Break","HTML"].includes(f.fieldtype));
		const total = visible_fields.length;

		const count_selected = () => $section.find("input:checked").length;

		$section.empty().append(`
			<div class="ev-qfp-src-fl-header">
				<span class="ev-qfp-src-fl-count">${selected_set.size} / ${total}</span>
				<input class="ev-qfp-src-fl-search" type="text" placeholder="Filter fields…" />
			</div>
			<div class="ev-qfp-checklist ev-qfp-src-checklist"></div>
		`);

		const $list = $section.find(".ev-qfp-src-checklist");
		const $count = $section.find(".ev-qfp-src-fl-count");

		const render_rows = (filter) => {
			$list.empty();
			visible_fields.forEach(f => {
				if (filter && !f.label?.toLowerCase().includes(filter) && !f.fieldname.toLowerCase().includes(filter)) return;
				const checked = selected_set.has(f.fieldname) ? "checked" : "";
				const badge_cls = this._fieldtype_badge_cls(f.fieldtype);
				$list.append(`
					<label class="ev-qfp-check-row" data-fieldname="${f.fieldname}">
						<input type="checkbox" ${checked}
							data-fieldname="${f.fieldname}"
							data-label="${frappe.utils.escape_html(f.label || f.fieldname)}"
							data-fieldtype="${f.fieldtype}" />
						<span class="ev-qfp-ft-badge ${badge_cls}">${f.fieldtype.substring(0,3)}</span>
						<span class="ev-qfp-field-label">${frappe.utils.escape_html(f.label || f.fieldname)}</span>
						<span class="ev-qfp-field-name">${frappe.utils.escape_html(f.fieldname)}</span>
					</label>
				`);
			});
		};
		render_rows("");

		const sync = () => {
			this.ast.source.fields.length = 0;
			$list.find("input:checked").each((_, el) => {
				this.ast.source.fields.push({
					fieldname: el.dataset.fieldname,
					label: el.dataset.label,
					fieldtype: el.dataset.fieldtype,
					alias: null,
				});
			});
			$count.text(`${count_selected()} / ${total}`);
			// Notify SQL preview without destroying SOURCE card DOM
			this.on_ast_change(this.ast, "update");
		};

		$list.on("change", "input[type=checkbox]", sync);

		$section.find(".ev-qfp-src-fl-search").on("input", frappe.utils.debounce(function() {
			render_rows(this.value.toLowerCase().trim());
		}, 120));
	}

	_render_field_checklist($container, alias, doctype, fields, selected_arr) {
		$container.empty();
		$container.append(`<div class="ev-qfp-field-header">
			<span>Select fields from <b>${frappe.utils.escape_html(doctype)}</b></span>
			<span class="ev-qfp-link ev-qfp-toggle-all" data-alias="${alias}">All / None</span>
		</div>`);

		const $list = $('<div class="ev-qfp-checklist"></div>').appendTo($container);

		const selected_names = new Set(selected_arr.map(f => f.fieldname));

		fields.forEach(f => {
			if (["Column Break", "Section Break", "HTML"].includes(f.fieldtype)) return;
			const checked = selected_names.has(f.fieldname) ? "checked" : "";
			const badge_cls = this._fieldtype_badge_cls(f.fieldtype);
			$list.append(`
				<label class="ev-qfp-check-row" data-alias="${alias}" data-fieldname="${f.fieldname}">
					<input type="checkbox" ${checked} data-alias="${alias}" data-fieldname="${f.fieldname}" data-label="${frappe.utils.escape_html(f.label || f.fieldname)}" data-fieldtype="${f.fieldtype}" />
					<span class="ev-qfp-ft-badge ${badge_cls}">${f.fieldtype.substring(0, 3)}</span>
					<span class="ev-qfp-field-label">${frappe.utils.escape_html(f.label || f.fieldname)}</span>
					<span class="ev-qfp-field-name">${frappe.utils.escape_html(f.fieldname)}</span>
				</label>
			`);
		});

		// Toggle all
		$container.find(".ev-qfp-toggle-all").on("click", (e) => {
			const $checks = $list.find("input[type=checkbox]");
			const all_checked = $checks.filter(":checked").length === $checks.length;
			$checks.prop("checked", !all_checked);
			this._sync_fields_from_checklist($container, alias, doctype, selected_arr);
			this.on_ast_change(this.ast, "update");
		});

		// Individual check
		$list.on("change", "input[type=checkbox]", () => {
			this._sync_fields_from_checklist($container, alias, doctype, selected_arr);
			this.on_ast_change(this.ast, "update");
		});
	}

	_sync_fields_from_checklist($container, alias, doctype, target_arr) {
		target_arr.length = 0;
		$container.find("input:checked").each((_, el) => {
			target_arr.push({
				fieldname: el.dataset.fieldname,
				label: el.dataset.label,
				fieldtype: el.dataset.fieldtype,
				alias: null,
			});
		});
	}

	// ── JOIN editor ─────────────────────────────────────────────────────────

	_render_join_editor($body) {
		$body.append(`
			<div class="ev-qfp-editor">
				<div class="ev-qfp-join-list"></div>
				<button class="ev-qfp-add-btn ev-qfp-add-join-btn">+ Add Join</button>
			</div>
		`);
		const $jl = $body.find(".ev-qfp-join-list");

		this.ast.joins.forEach((j, i) => this._render_join_row($jl, j, i));

		$body.find(".ev-qfp-add-join-btn").on("click", () => {
			const src_dt = this.ast.source.doctype;
			if (!src_dt) { frappe.show_alert({ message: "Set source DocType first", indicator: "orange" }); return; }
			// Get next join index
			const idx = this.ast.joins.length;
			this.ast.add_join({
				src_doctype: src_dt,
				src_alias: "t0",
				src_field: "name",
				tgt_doctype: "",
				tgt_field: "name",
			});
			this._render_join_row($jl, this.ast.joins[idx], idx);
			this._refresh_badge("join");
			this.on_ast_change(this.ast, "update");
		});
	}

	_render_join_row($container, j, idx) {
		const join_type = j.join_type || "LEFT";
		const tgt_display = frappe.utils.escape_html(j.tgt_doctype || "Select table…");

		const type_btns = ["LEFT","INNER","RIGHT","FULL"].map(t =>
			`<button class="ev-qfp-jt-btn${t===join_type?" ev-qfp-jt-btn--on":""}" data-jt="${t}">${t}</button>`
		).join("");

		const $row = $(`
			<div class="ev-qfp-join-row" data-join-id="${j.id}">
				<div class="ev-qfp-join-hd">
					<span class="ev-qfp-join-badge ev-qfp-join-badge--${join_type.toLowerCase()}">${join_type}</span>
					<span class="ev-qfp-join-arrow">→</span>
					<span class="ev-qfp-join-tgt-lbl">${tgt_display}</span>
					<button class="ev-qfp-icon-btn ev-qfp-remove-join" title="Remove">✕</button>
				</div>
				<div class="ev-qfp-join-body">
					<div class="ev-qfp-join-sec">
						<div class="ev-qfp-join-slabel">Target Table</div>
						<div class="ev-qfp-join-dt-ctrl"></div>
					</div>
					<div class="ev-qfp-join-sec">
						<div class="ev-qfp-join-slabel">Join Type</div>
						<div class="ev-qfp-jt-group">${type_btns}</div>
					</div>
					<div class="ev-qfp-join-sec">
						<div class="ev-qfp-join-slabel">Join On</div>
						<div class="ev-qfp-join-on">
							<input type="text" class="ev-qfp-input ev-qfp-src-field" value="${frappe.utils.escape_html(j.src_field||"name")}" placeholder="source field" />
							<span class="ev-qfp-join-eq">=</span>
							<input type="text" class="ev-qfp-input ev-qfp-tgt-field" value="${frappe.utils.escape_html(j.tgt_field||"name")}" placeholder="target field" />
						</div>
					</div>
					<div class="ev-qfp-join-field-list" style="display:none;"></div>
				</div>
			</div>
		`).appendTo($container);

		// Remove
		$row.find(".ev-qfp-remove-join").on("click", () => {
			const jidx = this.ast.joins.findIndex(x => x.id === j.id);
			if (jidx !== -1) this.ast.joins.splice(jidx, 1);
			$row.remove();
			this.on_ast_change(this.ast, "update");
		});

		// Join type toggle buttons
		$row.find(".ev-qfp-jt-btn").on("click", function() {
			const jt = $(this).data("jt");
			j.join_type = jt;
			$row.find(".ev-qfp-jt-btn").removeClass("ev-qfp-jt-btn--on");
			$(this).addClass("ev-qfp-jt-btn--on");
			$row.find(".ev-qfp-join-badge")
				.text(jt)
				.attr("class", `ev-qfp-join-badge ev-qfp-join-badge--${jt.toLowerCase()}`);
		});

		$row.find(".ev-qfp-src-field").on("change", (e) => { j.src_field = e.target.value.trim(); });
		$row.find(".ev-qfp-tgt-field").on("change", (e) => { j.tgt_field = e.target.value.trim(); });

		// Frappe Link control for Target DocType
		const $dt_ctrl = $row.find(".ev-qfp-join-dt-ctrl");
		const join_ctrl = frappe.ui.form.make_control({
			df: {
				fieldtype: "Link",
				options: "DocType",
				label: "",
				fieldname: `join_dt_${j.id}`,
				placeholder: "Search DocType…",
			},
			parent: $dt_ctrl[0],
			render_input: true,
		});
		join_ctrl.refresh();
		$dt_ctrl.find(".control-label, .help-box").remove();

		const load_join_fields = (dt) => {
			j.tgt_doctype = dt;
			$row.find(".ev-qfp-join-tgt-lbl").text(dt);
			this._load_schema(dt).then(fields => {
				const $fl = $row.find(".ev-qfp-join-field-list");
				$fl.show();
				this._render_source_field_list($fl, dt, fields.filter(f => !["Column Break","Section Break","HTML"].includes(f.fieldtype)));
			});
		};

		$(join_ctrl.input).on("change", frappe.utils.debounce(() => {
			const val = join_ctrl.get_value();
			if (val) load_join_fields(val);
		}, 150));

		if (j.tgt_doctype) {
			setTimeout(() => join_ctrl.set_value(j.tgt_doctype), 40);
			this._load_schema(j.tgt_doctype).then(fields => {
				const $fl = $row.find(".ev-qfp-join-field-list");
				$fl.show();
				this._render_source_field_list($fl, j.tgt_doctype, fields.filter(f => !["Column Break","Section Break","HTML"].includes(f.fieldtype)));
			});
		}
	}

	// ── WHERE editor ────────────────────────────────────────────────────────

	_render_where_editor($body) {
		$body.append(`
			<div class="ev-qfp-editor ev-qfp-where-editor">
				<div class="ev-qfp-where-top">
					<span>Top-level logic:</span>
					<select class="ev-qfp-select ev-qfp-top-logic">
						<option ${this.ast.where.logic === "AND" ? "selected" : ""}>AND</option>
						<option ${this.ast.where.logic === "OR" ? "selected" : ""}>OR</option>
					</select>
				</div>
				<div class="ev-qfp-group-list"></div>
				<button class="ev-qfp-add-btn ev-qfp-add-group">+ Add Filter Group</button>
			</div>
		`);

		$body.find(".ev-qfp-top-logic").on("change", (e) => { this.ast.where.logic = e.target.value; this.on_ast_change(this.ast, "update"); });

		const $gl = $body.find(".ev-qfp-group-list");
		this.ast.where.groups.forEach(g => this._render_where_group($gl, g));

		$body.find(".ev-qfp-add-group").on("click", () => {
			const grp = this.ast.add_where_group("AND");
			this._render_where_group($gl, grp);
		});
	}

	_render_where_group($container, grp) {
		const $grp = $(`
			<div class="ev-qfp-where-group ev-qfp-flowchart-decision" data-grp-id="${grp.id}">
				<div class="ev-qfp-where-group-header">
					<span class="ev-qfp-diamond-icon">◇</span>
					<span>Group — </span>
					<select class="ev-qfp-select ev-qfp-grp-logic" style="width:60px;">
						<option ${grp.logic === "AND" ? "selected" : ""}>AND</option>
						<option ${grp.logic === "OR" ? "selected" : ""}>OR</option>
					</select>
					<button class="ev-qfp-icon-btn ev-qfp-remove-group" title="Remove group">✕</button>
				</div>
				<div class="ev-qfp-cond-list"></div>
				<button class="ev-qfp-add-btn ev-qfp-add-cond" style="margin-top:4px;">+ Add Condition</button>
			</div>
		`).appendTo($container);

		$grp.find(".ev-qfp-grp-logic").on("change", (e) => { grp.logic = e.target.value; this.on_ast_change(this.ast, "update"); });
		$grp.find(".ev-qfp-remove-group").on("click", () => {
			const i = this.ast.where.groups.findIndex(g => g.id === grp.id);
			if (i !== -1) this.ast.where.groups.splice(i, 1);
			$grp.remove();
			this.on_ast_change(this.ast, "update");
		});

		const $cl = $grp.find(".ev-qfp-cond-list");
		grp.conditions.forEach(c => this._render_condition_row($cl, grp, c));

		$grp.find(".ev-qfp-add-cond").on("click", () => {
			this.ast.add_condition(grp.id, {
				table_alias: this.ast.source.alias,
				fieldname: "",
				fieldtype: "Data",
				operator: "=",
				value: "",
			});
			const c = grp.conditions[grp.conditions.length - 1];
			this._render_condition_row($cl, grp, c);
			this._refresh_badge("where");
			this.on_ast_change(this.ast, "update");
		});
	}

	_render_condition_row($container, grp, cond) {
		const all_cols = this.ast.all_output_columns();
		const col_opts = all_cols.map(c =>
			`<option value="${c.ref}" ${cond.table_alias && `${cond.table_alias}.${cond.fieldname}` === c.ref ? "selected" : ""}>${frappe.utils.escape_html(c.label)}</option>`
		).join("");

		const operators = ["=", "!=", ">", ">=", "<", "<=", "like", "not like", "in", "not in", "between", "is_set", "is_not_set"];
		const op_opts = operators.map(op => `<option ${cond.operator === op ? "selected" : ""}>${op}</option>`).join("");

		const $row = $(`
			<div class="ev-qfp-cond-row" data-cond-id="${cond.id}">
				<select class="ev-qfp-select ev-qfp-cond-field" style="flex:2;">${col_opts}</select>
				<select class="ev-qfp-select ev-qfp-cond-op" style="flex:1.2;">${op_opts}</select>
				<input type="text" class="ev-qfp-input ev-qfp-cond-val" value="${frappe.utils.escape_html(String(cond.value || ""))}" placeholder="value" style="flex:2;" />
				<button class="ev-qfp-icon-btn ev-qfp-remove-cond" title="Remove">✕</button>
			</div>
		`).appendTo($container);

		// Sync changes
		const sync = () => {
			const ref = $row.find(".ev-qfp-cond-field").val();
			const parts = (ref || "").split(".");
			if (parts.length === 2) { cond.table_alias = parts[0]; cond.fieldname = parts[1]; }
			else { cond.table_alias = null; cond.fieldname = ref; }
			cond.operator = $row.find(".ev-qfp-cond-op").val();
			cond.value = $row.find(".ev-qfp-cond-val").val();
			this.on_ast_change(this.ast, "update");
		};

		$row.find(".ev-qfp-cond-field, .ev-qfp-cond-op").on("change", sync);
		$row.find(".ev-qfp-cond-val").on("change", sync);

		$row.find(".ev-qfp-remove-cond").on("click", () => {
			const i = grp.conditions.findIndex(c => c.id === cond.id);
			if (i !== -1) grp.conditions.splice(i, 1);
			$row.remove();
			this.on_ast_change(this.ast, "update");
		});

		// Show/hide value input for is_set / is_not_set
		$row.find(".ev-qfp-cond-op").on("change", (e) => {
			const hide = ["is_set", "is_not_set"].includes(e.target.value);
			$row.find(".ev-qfp-cond-val").toggle(!hide);
		});
	}

	// ── AGGREGATE editor ────────────────────────────────────────────────────

	_render_aggregate_editor($body) {
		$body.append(`
			<div class="ev-qfp-editor">
				<div class="ev-qfp-field-row">
					<label>Enable Aggregation</label>
					<input type="checkbox" class="ev-qfp-agg-enabled" ${this.ast.aggregate.enabled ? "checked" : ""} />
				</div>
				<div class="ev-qfp-agg-body" style="${this.ast.aggregate.enabled ? "" : "display:none;"}">
					<div class="ev-qfp-section-label">Group By</div>
					<div class="ev-qfp-gb-list"></div>
					<button class="ev-qfp-add-btn ev-qfp-add-gb">+ Add Group By</button>
					<div class="ev-qfp-section-label" style="margin-top:8px;">Aggregations</div>
					<div class="ev-qfp-agg-list"></div>
					<button class="ev-qfp-add-btn ev-qfp-add-agg">+ Add Aggregation</button>
				</div>
			</div>
		`);

		$body.find(".ev-qfp-agg-enabled").on("change", (e) => {
			this.ast.aggregate.enabled = e.target.checked;
			$body.find(".ev-qfp-agg-body").toggle(e.target.checked);
			this.on_ast_change(this.ast, "update");
		});

		const $gbl = $body.find(".ev-qfp-gb-list");
		const $al = $body.find(".ev-qfp-agg-list");
		const all_cols = this.ast.all_output_columns();

		this.ast.aggregate.group_by.forEach(g => this._render_gb_row($gbl, g, all_cols));
		this.ast.aggregate.aggregations.forEach(a => this._render_agg_row($al, a, all_cols));

		$body.find(".ev-qfp-add-gb").on("click", () => {
			const grp = { fieldname: "", table_alias: this.ast.source.alias, label: "" };
			this.ast.aggregate.group_by.push(grp);
			this._render_gb_row($gbl, grp, all_cols);
			this._refresh_badge("aggregate");
			this.on_ast_change(this.ast, "update");
		});

		$body.find(".ev-qfp-add-agg").on("click", () => {
			const id = `agg_${Date.now()}`;
			const agg = { id, fn: "SUM", table_alias: this.ast.source.alias, fieldname: "", alias: "" };
			this.ast.aggregate.aggregations.push(agg);
			this._render_agg_row($al, agg, all_cols);
			this._refresh_badge("aggregate");
			this.on_ast_change(this.ast, "update");
		});
	}

	_render_gb_row($container, g, all_cols) {
		const opts = all_cols.map(c =>
			`<option value="${c.ref}" ${`${g.table_alias}.${g.fieldname}` === c.ref ? "selected" : ""}>${frappe.utils.escape_html(c.label)}</option>`
		).join("");
		const $row = $(`
			<div class="ev-qfp-cond-row">
				<select class="ev-qfp-select" style="flex:3;">${opts}</select>
				<button class="ev-qfp-icon-btn">✕</button>
			</div>
		`).appendTo($container);
		$row.find("select").on("change", (e) => {
			const parts = e.target.value.split(".");
			g.table_alias = parts[0]; g.fieldname = parts[1];
			this.on_ast_change(this.ast, "update");
		});
		$row.find("button").on("click", () => {
			const i = this.ast.aggregate.group_by.indexOf(g);
			if (i !== -1) this.ast.aggregate.group_by.splice(i, 1);
			$row.remove(); this._emit_change();
		});
	}

	_render_agg_row($container, a, all_cols) {
		const fn_opts = ["SUM", "AVG", "COUNT", "MIN", "MAX", "COUNT_DISTINCT"].map(fn =>
			`<option ${a.fn === fn ? "selected" : ""}>${fn}</option>`
		).join("");
		const col_opts = [{ ref: "*", label: "* (all)" }, ...all_cols].map(c =>
			`<option value="${c.ref}" ${`${a.table_alias}.${a.fieldname}` === c.ref ? "selected" : ""}>${frappe.utils.escape_html(c.label)}</option>`
		).join("");
		const $row = $(`
			<div class="ev-qfp-cond-row">
				<select class="ev-qfp-select ev-agg-fn" style="flex:1.5;">${fn_opts}</select>
				<select class="ev-qfp-select ev-agg-col" style="flex:2;">${col_opts}</select>
				<input type="text" class="ev-qfp-input ev-agg-alias" value="${frappe.utils.escape_html(a.alias)}" placeholder="alias" style="flex:1.5;" />
				<button class="ev-qfp-icon-btn">✕</button>
			</div>
		`).appendTo($container);
		const sync = () => {
			a.fn = $row.find(".ev-agg-fn").val();
			const ref = $row.find(".ev-agg-col").val();
			if (ref === "*") { a.fieldname = "*"; a.table_alias = null; }
			else { const p = ref.split("."); a.table_alias = p[0]; a.fieldname = p[1]; }
			a.alias = $row.find(".ev-agg-alias").val().trim() || `${a.fn}_${a.fieldname}`;
			this.on_ast_change(this.ast, "update");
		};
		$row.find("select, input").on("change", sync);
		$row.find("button").on("click", () => {
			const i = this.ast.aggregate.aggregations.indexOf(a);
			if (i !== -1) this.ast.aggregate.aggregations.splice(i, 1);
			$row.remove(); this._emit_change();
		});
	}

	// ── COMPUTE editor ──────────────────────────────────────────────────────

	_render_compute_editor($body) {
		$body.append(`
			<div class="ev-qfp-editor">
				<div class="ev-qfp-compute-list"></div>
				<button class="ev-qfp-add-btn ev-qfp-add-compute">+ Add Computed Column</button>
			</div>
		`);
		const $cl = $body.find(".ev-qfp-compute-list");
		this.ast.compute.forEach(cp => this._render_compute_row($cl, cp));
		$body.find(".ev-qfp-add-compute").on("click", () => {
			const cp = { id: `cp_${Date.now()}`, alias: "", expr_type: "arithmetic", expr: "", cases: [], else_value: null };
			this.ast.compute.push(cp);
			this._render_compute_row($cl, cp);
			this._refresh_badge("compute");
			this.on_ast_change(this.ast, "update");
		});
	}

	_render_compute_row($container, cp) {
		const type_opts = [
			{ v: "arithmetic", l: "Arithmetic" },
			{ v: "case", l: "CASE/WHEN" },
			{ v: "if", l: "IF/THEN" },
			{ v: "expr", l: "Expert SQL" },
		].map(o => `<option value="${o.v}" ${cp.expr_type === o.v ? "selected" : ""}>${o.l}</option>`).join("");

		const $row = $(`
			<div class="ev-qfp-compute-row ev-qfp-flowchart-process" data-cp-id="${cp.id}">
				<div class="ev-qfp-compute-header">
					<span class="ev-qfp-process-icon">▭</span>
					<input type="text" class="ev-qfp-input ev-cp-alias" value="${frappe.utils.escape_html(cp.alias)}" placeholder="Column alias" style="flex:1;" />
					<select class="ev-qfp-select ev-cp-type" style="width:110px;">${type_opts}</select>
					<button class="ev-qfp-icon-btn">✕</button>
				</div>
				<div class="ev-qfp-compute-expr"></div>
			</div>
		`).appendTo($container);

		$row.find(".ev-cp-alias").on("change", (e) => { cp.alias = e.target.value.trim(); this.on_ast_change(this.ast, "update"); });
		$row.find(".ev-cp-type").on("change", (e) => {
			cp.expr_type = e.target.value;
			this._render_compute_expr_editor($row.find(".ev-qfp-compute-expr"), cp);
			this.on_ast_change(this.ast, "update");
		});
		$row.find("button").on("click", () => {
			const i = this.ast.compute.indexOf(cp);
			if (i !== -1) this.ast.compute.splice(i, 1);
			$row.remove(); this._emit_change();
		});

		this._render_compute_expr_editor($row.find(".ev-qfp-compute-expr"), cp);
	}

	_render_compute_expr_editor($container, cp) {
		$container.empty();
		switch (cp.expr_type) {
			case "arithmetic":
			case "expr": {
				const $ta = $(`<textarea class="ev-qfp-textarea" rows="2" placeholder="e.g. t0.grand_total * 0.18 or CONCAT(t0.first_name, ' ', t0.last_name)">${frappe.utils.escape_html(cp.expr || "")}</textarea>`);
				$container.append($ta);
				$ta.on("change", () => { cp.expr = $ta.val(); this.on_ast_change(this.ast, "update"); });
				break;
			}
			case "case": {
				$container.append(`<div class="ev-qfp-case-hint">CASE WHEN … THEN … ELSE … END</div>`);
				const $cases = $('<div class="ev-qfp-case-list"></div>').appendTo($container);
				(cp.cases || []).forEach(c => this._render_case_when_row($cases, c, cp));
				$container.append($(`<button class="ev-qfp-add-btn" style="margin-top:4px;">+ WHEN</button>`)
					.on("click", () => {
						const wc = { condition: { operator: "=", fieldname: "", value: "" }, result: "" };
						cp.cases = cp.cases || [];
						cp.cases.push(wc);
						this._render_case_when_row($cases, wc, cp);
					}));
				const $else = $(`<input type="text" class="ev-qfp-input" value="${frappe.utils.escape_html(cp.else_value || "")}" placeholder="ELSE value" style="margin-top:4px;" />`);
				$container.append($else);
				$else.on("change", () => { cp.else_value = $else.val(); this.on_ast_change(this.ast, "update"); });
				break;
			}
			case "if": {
				const $ifcont = $('<div class="ev-qfp-if-form"></div>').appendTo($container);
				cp.cases = cp.cases || [{ condition: { operator: "=", fieldname: "", value: "" }, result: "" }];
				const c = cp.cases[0];
				const all_cols = this.ast.all_output_columns();
				const opts = all_cols.map(col => `<option value="${col.ref}">${frappe.utils.escape_html(col.label)}</option>`).join("");
				$ifcont.append(`
					<div class="ev-qfp-if-row">
						<span>IF</span>
						<select class="ev-qfp-select ev-if-field">${opts}</select>
						<select class="ev-qfp-select ev-if-op" style="width:70px;">
							${["=","!=",">","<",">=","<="].map(op => `<option>${op}</option>`).join("")}
						</select>
						<input type="text" class="ev-qfp-input ev-if-val" value="${frappe.utils.escape_html(c.condition?.value || "")}" placeholder="value" />
						<span>THEN</span>
						<input type="text" class="ev-qfp-input ev-if-then" value="${frappe.utils.escape_html(c.result || "")}" placeholder="result" />
						<span>ELSE</span>
						<input type="text" class="ev-qfp-input ev-if-else" value="${frappe.utils.escape_html(cp.else_value || "")}" placeholder="else" />
					</div>
				`);
				$ifcont.find("select, input").on("change", () => {
					const ref = $ifcont.find(".ev-if-field").val() || "";
					const parts = ref.split(".");
					c.condition = {
						table_alias: parts[0], fieldname: parts[1] || ref,
						operator: $ifcont.find(".ev-if-op").val(),
						value: $ifcont.find(".ev-if-val").val(),
					};
					c.result = $ifcont.find(".ev-if-then").val();
					cp.else_value = $ifcont.find(".ev-if-else").val();
					this.on_ast_change(this.ast, "update");
				});
				break;
			}
		}
	}

	_render_case_when_row($container, c, cp) {
		const $row = $(`
			<div class="ev-qfp-cond-row ev-qfp-case-when">
				<span>WHEN</span>
				<input type="text" class="ev-qfp-input ev-cw-cond" value="${frappe.utils.escape_html(c.condition?.fieldname || "")}" placeholder="field" style="flex:1.5;" />
				<select class="ev-qfp-select ev-cw-op" style="width:50px;">
					${["=","!=",">","<"].map(op => `<option ${c.condition?.operator === op ? "selected" : ""}>${op}</option>`).join("")}
				</select>
				<input type="text" class="ev-qfp-input ev-cw-val" value="${frappe.utils.escape_html(c.condition?.value || "")}" placeholder="value" style="flex:1;" />
				<span>THEN</span>
				<input type="text" class="ev-qfp-input ev-cw-res" value="${frappe.utils.escape_html(c.result || "")}" placeholder="result" style="flex:1;" />
				<button class="ev-qfp-icon-btn">✕</button>
			</div>
		`).appendTo($container);

		$row.find("input, select").on("change", () => {
			c.condition = { fieldname: $row.find(".ev-cw-cond").val(), operator: $row.find(".ev-cw-op").val(), value: $row.find(".ev-cw-val").val() };
			c.result = $row.find(".ev-cw-res").val();
			this.on_ast_change(this.ast, "update");
		});
		$row.find("button").on("click", () => {
			const i = (cp.cases || []).indexOf(c);
			if (i !== -1) cp.cases.splice(i, 1);
			$row.remove(); this._emit_change();
		});
	}

	// ── WINDOW editor ───────────────────────────────────────────────────────

	_render_window_editor($body) {
		$body.append(`
			<div class="ev-qfp-editor">
				<div class="ev-qfp-window-list"></div>
				<button class="ev-qfp-add-btn ev-qfp-add-win">+ Add Window Function</button>
			</div>
		`);
		const $wl = $body.find(".ev-qfp-window-list");
		this.ast.windows.forEach(w => this._render_window_row($wl, w));
		$body.find(".ev-qfp-add-win").on("click", () => {
			const w = { id: `win_${Date.now()}`, fn: "SUM", table_alias: this.ast.source.alias, fieldname: "", alias: "", partition_by: [], order_by: [] };
			this.ast.windows.push(w);
			this._render_window_row($wl, w);
			this._refresh_badge("window");
			this.on_ast_change(this.ast, "update");
		});
	}

	_render_window_row($container, w) {
		const fn_opts = ["SUM","AVG","COUNT","MIN","MAX","ROW_NUMBER","RANK","DENSE_RANK","LAG","LEAD","FIRST_VALUE","LAST_VALUE"]
			.map(fn => `<option ${w.fn === fn ? "selected" : ""}>${fn}</option>`).join("");
		const all_cols = this.ast.all_output_columns();
		const col_opts = all_cols.map(c => `<option value="${c.ref}" ${`${w.table_alias}.${w.fieldname}` === c.ref ? "selected" : ""}>${frappe.utils.escape_html(c.label)}</option>`).join("");

		// PARTITION BY — checkboxes (far more usable than select[multiple])
		const pb_set = new Set((w.partition_by || []).map(p => `${p.table_alias}.${p.fieldname}`));
		const pb_checks = all_cols.map(c => `
			<label class="ev-win-pb-chk">
				<input type="checkbox" value="${c.ref}" ${pb_set.has(c.ref) ? "checked" : ""} />
				${frappe.utils.escape_html(c.label)}
			</label>`).join("");

		// ORDER BY — rows list (add/remove keys)
		const ob_cols_opts = all_cols.map(c => `<option value="${c.ref}">${frappe.utils.escape_html(c.label)}</option>`).join("");

		const $row = $(`
			<div class="ev-qfp-window-row" data-win-id="${w.id}">
				<div class="ev-qfp-cond-row">
					<select class="ev-qfp-select ev-win-fn" style="flex:1.5;">${fn_opts}</select>
					<select class="ev-qfp-select ev-win-col" style="flex:2;">${col_opts}</select>
					<input type="text" class="ev-qfp-input ev-win-alias" value="${frappe.utils.escape_html(w.alias)}" placeholder="alias" style="flex:1.5;" />
					<button class="ev-qfp-icon-btn ev-win-del">✕</button>
				</div>
				<div class="ev-win-section">
					<div class="ev-win-section-label">PARTITION BY</div>
					<div class="ev-win-pb-list">${pb_checks}</div>
				</div>
				<div class="ev-win-section">
					<div class="ev-win-section-label">ORDER BY</div>
					<div class="ev-win-ob-rows"></div>
					<button class="ev-qfp-add-btn ev-win-add-ob" style="margin-top:4px;font-size:11px;">+ Add Key</button>
				</div>
			</div>
		`).appendTo($container);

		// Render existing ORDER BY rows
		const $ob_rows = $row.find(".ev-win-ob-rows");
		const render_ob_row = (ob) => {
			const $ob = $(`
				<div class="ev-win-ob-row ev-qfp-cond-row" style="margin-bottom:4px;">
					<select class="ev-qfp-select ev-win-ob-field" style="flex:3;">${ob_cols_opts}</select>
					<select class="ev-qfp-select ev-win-ob-dir" style="width:64px;">
						<option ${ob.direction === "ASC" ? "selected" : ""}>ASC</option>
						<option ${ob.direction === "DESC" ? "selected" : ""}>DESC</option>
					</select>
					<button class="ev-qfp-icon-btn ev-win-ob-del">✕</button>
				</div>
			`).appendTo($ob_rows);
			// Pre-select field
			$ob.find(".ev-win-ob-field").val(`${ob.table_alias}.${ob.fieldname}`);
			$ob.find("select").on("change", sync);
			$ob.find(".ev-win-ob-del").on("click", () => { $ob.remove(); sync(); });
		};
		(w.order_by || []).forEach(ob => render_ob_row(ob));

		$row.find(".ev-win-add-ob").on("click", () => {
			const first = all_cols[0];
			if (!first) return;
			const p = first.ref.split(".");
			const new_ob = { table_alias: p[0], fieldname: p[1], direction: "ASC" };
			w.order_by.push(new_ob);
			render_ob_row(new_ob);
		});

		const sync = () => {
			w.fn = $row.find(".ev-win-fn").val();
			const ref = $row.find(".ev-win-col").val();
			if (ref) { const p = ref.split("."); w.table_alias = p[0]; w.fieldname = p[1]; }
			const alias_val = $row.find(".ev-win-alias").val().trim();
			w.alias = alias_val || `${w.fn}_${w.fieldname}`;
			// Partition by — from checkboxes
			w.partition_by = [];
			$row.find(".ev-win-pb-list input:checked").each((_, el) => {
				const p = el.value.split(".");
				w.partition_by.push({ table_alias: p[0], fieldname: p[1] });
			});
			// Order by — from rows
			w.order_by = [];
			$ob_rows.find(".ev-win-ob-row").each((_, el) => {
				const ref = $(el).find(".ev-win-ob-field").val();
				const dir = $(el).find(".ev-win-ob-dir").val();
				if (ref) { const p = ref.split("."); w.order_by.push({ table_alias: p[0], fieldname: p[1], direction: dir }); }
			});
			this.on_ast_change(this.ast, "update");
		};
		$row.find("select, input[type=text]").on("change", sync);
		$row.find(".ev-win-pb-list").on("change", "input[type=checkbox]", sync);
		$row.find(".ev-win-del").on("click", () => {
			const i = this.ast.windows.indexOf(w);
			if (i !== -1) this.ast.windows.splice(i, 1);
			$row.remove();
			this.on_ast_change(this.ast, "update");
		});
	}

	// ── SORT editor ─────────────────────────────────────────────────────────

	_render_sort_editor($body) {
		$body.append(`
			<div class="ev-qfp-editor">
				<div class="ev-qfp-sort-list"></div>
				<button class="ev-qfp-add-btn ev-qfp-add-sort">+ Add Sort Key</button>
			</div>
		`);
		const $sl = $body.find(".ev-qfp-sort-list");
		this.ast.sort.forEach(s => this._render_sort_row($sl, s));
		$body.find(".ev-qfp-add-sort").on("click", () => {
			const s = { table_alias: this.ast.source.alias, fieldname_or_alias: "", direction: "ASC" };
			this.ast.sort.push(s);
			this._render_sort_row($sl, s);
			this._refresh_badge("sort");
			this.on_ast_change(this.ast, "update");
		});
	}

	_render_sort_row($container, s) {
		const all_cols = this.ast.all_output_columns();
		const opts = all_cols.map(c => `<option value="${c.ref}" ${`${s.table_alias}.${s.fieldname_or_alias}` === c.ref ? "selected" : ""}>${frappe.utils.escape_html(c.label)}</option>`).join("");
		const $row = $(`
			<div class="ev-qfp-cond-row">
				<select class="ev-qfp-select" style="flex:3;">${opts}</select>
				<select class="ev-qfp-select" style="width:65px;">
					<option ${s.direction === "ASC" ? "selected" : ""}>ASC</option>
					<option ${s.direction === "DESC" ? "selected" : ""}>DESC</option>
				</select>
				<button class="ev-qfp-icon-btn">✕</button>
			</div>
		`).appendTo($container);
		$row.find("select").on("change", () => {
			const ref = $row.find("select:first").val(); const p = (ref || "").split(".");
			s.table_alias = p[0]; s.fieldname_or_alias = p[1] || ref;
			s.direction = $row.find("select:last").val();
			this.on_ast_change(this.ast, "update");
		});
		$row.find("button").on("click", () => {
			const i = this.ast.sort.indexOf(s); if (i !== -1) this.ast.sort.splice(i, 1);
			$row.remove(); this._emit_change();
		});
	}

	// ── OUTPUT editor ───────────────────────────────────────────────────────

	_render_output_editor($body) {
		$body.append(`
			<div class="ev-qfp-editor">
				<div class="ev-qfp-field-row">
					<label>Sheet Name</label>
					<input type="text" class="ev-qfp-input" value="${frappe.utils.escape_html(this.ast.output.sheet_name || "Query Result")}" placeholder="Sheet name" />
				</div>
				<div class="ev-qfp-field-row">
					<label>Row Limit</label>
					<input type="number" class="ev-qfp-input" value="${this.ast.limit}" min="1" max="100000" style="width:100px;" />
				</div>
				<div class="ev-qfp-field-row">
					<label>Mode</label>
					<select class="ev-qfp-select ev-out-mode">
						<option value="new_sheet" ${this.ast.output.mode === "new_sheet" ? "selected" : ""}>New Sheet</option>
						<option value="current_sheet" ${this.ast.output.mode === "current_sheet" ? "selected" : ""}>Current Sheet</option>
					</select>
				</div>
			</div>
		`);
		$body.find("input:first").on("change", (e) => { this.ast.output.sheet_name = e.target.value.trim(); this.on_ast_change(this.ast, "update"); });
		$body.find("input[type=number]").on("change", (e) => { this.ast.limit = parseInt(e.target.value) || 10000; this.on_ast_change(this.ast, "update"); });
		$body.find(".ev-out-mode").on("change", (e) => { this.ast.output.mode = e.target.value; this.on_ast_change(this.ast, "update"); });
	}

	// ── Run button ──────────────────────────────────────────────────────────

	_bind_run() {
		this.$container.find(".ev-qfp-run-btn").on("click", () => {
			this.on_ast_change(this.ast, "run");
		});
	}

	// ── Refresh / sync ──────────────────────────────────────────────────────

	/** Called when canvas edges/nodes change — re-sync source/joins from canvas. */
	sync_from_canvas(join_config) {
		if (!join_config) return;

		// Sync source
		if (join_config.base_doctype) {
			this.ast.source.doctype = join_config.base_doctype;
		}

		// Sync joins from canvas edges
		if (join_config.edges && join_config.edges.length) {
			// Only add joins not already in AST
			join_config.edges.forEach(edge => {
				const exists = this.ast.joins.find(j => j.tgt_doctype === edge.target_doctype);
				if (!exists) {
					this.ast.add_join({
						src_doctype: edge.source_doctype,
						src_alias: "t0",
						src_field: edge.source_field,
						tgt_doctype: edge.target_doctype,
						tgt_field: edge.target_field,
						join_type: "LEFT",
					});
				}
			});
		}

		this._render_pipeline();
	}

	refresh() {
		this._render_pipeline();
		// Re-render active step editor
		if (this._active_step) {
			const $el = this.$container.find(`.ev-qfp-step[data-step="${this._active_step}"]`);
			const $body = $el.find(".ev-qfp-step-body");
			if ($body.is(":visible")) {
				this._render_step_editor(this._active_step, $body);
			}
		}
	}

	// ── Schema loading ──────────────────────────────────────────────────────

	async _load_schema(doctype) {
		if (this._schema_cache[doctype]) return this._schema_cache[doctype];

		// Standard Frappe system fields — NOT returned by frappe.get_meta().fields
		// but exist on every DocType as base Document class attributes
		const SYSTEM_FIELDS = [
			{ fieldname: "name",        label: "Name (ID)",      fieldtype: "Data" },
			{ fieldname: "creation",    label: "Created On",     fieldtype: "Datetime" },
			{ fieldname: "modified",    label: "Last Modified",  fieldtype: "Datetime" },
			{ fieldname: "modified_by", label: "Modified By",    fieldtype: "Data" },
			{ fieldname: "owner",       label: "Owner",          fieldtype: "Data" },
			{ fieldname: "docstatus",   label: "Doc Status",     fieldtype: "Int" },
			{ fieldname: "idx",         label: "Index",          fieldtype: "Int" },
		];

		return new Promise((resolve) => {
			frappe.call({
				method: "excel_view.api.get_doctype_schema",
				args: { doctypes: [doctype] },
				callback: (r) => {
					let fields;
					if (r.message && r.message[doctype]) {
						fields = r.message[doctype].fields;
					} else {
						// Fallback: frappe.get_meta
						const meta = frappe.get_meta(doctype);
						fields = meta ? meta.fields.map(f => ({ fieldname: f.fieldname, label: f.label, fieldtype: f.fieldtype })) : [];
					}
					// Prepend system fields not already present
					const existing = new Set(fields.map(f => f.fieldname));
					const to_add = SYSTEM_FIELDS.filter(f => !existing.has(f.fieldname));
					const all_fields = [...to_add, ...fields];
					this._schema_cache[doctype] = all_fields;
					resolve(all_fields);
				},
			});
		});
	}

	// ── Helpers ─────────────────────────────────────────────────────────────

	_refresh_badge(step_id) {
		const summary = this.ast.summary();
		const count_map = {
			join:      this.ast.joins.length,
			where:     summary.where_count,
			aggregate: summary.agg_count,
			compute:   summary.compute_count,
			window:    summary.window_count,
			sort:      summary.sort_count,
		};
		const count = count_map[step_id] || 0;
		const $hd = this.$container.find(`.ev-qfp-sec[data-step="${step_id}"] .ev-qfp-sec-hd`);
		const $badge = $hd.find(".ev-qfp-sec-count");
		if (count > 0) {
			if ($badge.length) $badge.text(count);
			else $hd.find(".ev-qfp-sec-plus").before(`<span class="ev-qfp-sec-count">${count}</span>`);
		} else {
			$badge.remove();
		}
	}

	_emit_change(mode = "update") {
		const active = this._active_step;
		this._render_pipeline();
		// Re-open the active section after pipeline rebuild
		if (active && active !== "source_closed") {
			const $sec = this.$container.find(`.ev-qfp-sec[data-step="${active}"]`);
			if ($sec.length) {
				$sec.addClass("ev-qfp-sec--open");
				const $body = $sec.find(".ev-qfp-sec-body");
				$body.show();
				this._render_step_editor(active, $body);
			}
		}
		this.on_ast_change(this.ast, mode);
	}

	_fieldtype_badge_cls(fieldtype) {
		const map = {
			"Link": "ev-ftb-link",
			"Currency": "ev-ftb-num",
			"Float": "ev-ftb-num",
			"Int": "ev-ftb-num",
			"Date": "ev-ftb-date",
			"Datetime": "ev-ftb-date",
			"Check": "ev-ftb-check",
			"Select": "ev-ftb-select",
			"Table": "ev-ftb-table",
		};
		return map[fieldtype] || "ev-ftb-data";
	}
};
