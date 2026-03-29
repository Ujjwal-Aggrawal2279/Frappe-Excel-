/**
 * tree_import.js — TreeImportEngine
 *
 * Handles hierarchical bulk import for two DocType patterns:
 *
 *   Pattern 1 — NSM Self-Referential Trees
 *     Detected by: meta.is_tree + meta.nsm_parent_field
 *     Examples:    Employee, Department, Territory, Customer Group, Item Group
 *     CSV formats:
 *       Format A: rows have a "Level" / "Depth" column (0 = root)
 *       Format B: rows have a "Parent" or nsm_parent_field column
 *     Creation order: top-down (root first)
 *
 *   Pattern 2 — Cross-Document Reference Trees
 *     Detected by: Table field → child DocType → Link back to parent DocType
 *     Examples:    BOM (BOM Item.bom_no references another BOM)
 *     Creation order: bottom-up via topological sort (leaf docs first)
 *
 * Called by Toolbar._bi_commit() when a tree pattern is detected.
 * Zero changes to the existing flat import path.
 */

frappe.provide("frappe.views");

frappe.views.TreeImportEngine = class TreeImportEngine {
	constructor({ doctype, meta, mapped_rows, tree_info, $modal, on_done }) {
		this.doctype  = doctype;
		this.meta     = meta;
		this.rows     = mapped_rows;   // [{fieldname: value, ...}, ...] from _bi_do_import
		this.info     = tree_info;     // {pattern, parent_field} | {pattern, table_field, link_field, ...}
		this.$modal   = $modal;        // mapper modal — removed when tree dialog opens
		this.on_done  = on_done || (() => {});
		this.$dlg     = null;
		this._job_id  = `ev_tree_${Date.now()}`;
	}

	// ── Entry point ──────────────────────────────────────────────────────────

	run() {
		const parse = this._parse();
		if (parse.error) {
			frappe.show_alert({ message: parse.error, indicator: "red" }, 6);
			return;
		}

		const validation = this._validate(parse.nodes);
		this._open_dialog(parse.nodes, validation);
	}

	// ── Layer 2: Parse input rows into tree nodes ─────────────────────────────

	_parse() {
		const { rows, info } = this;
		if (!rows.length) return { error: __("No records to import.") };

		let nodes;

		if (info.pattern === 1) {
			// Detect which format the user's mapped data uses
			const sample_keys = Object.keys(rows[0] || {});
			const level_key   = sample_keys.find(k =>
				["level", "depth", "indent"].includes(k.toLowerCase().trim())
			);
			const parent_key  = sample_keys.find(k =>
				k === info.parent_field || k.toLowerCase() === "parent"
			);

			if (!level_key && !parent_key) {
				return {
					error: __("No hierarchy column found. Map a '{0}' (parent name) or 'Level' column.", [info.parent_field])
				};
			}

			nodes = level_key
				? this._parse_format_a(rows, level_key)
				: this._parse_format_b(rows, parent_key);

		} else if (info.pattern === 2) {
			// Each row is a parent doc; refs are resolved via item-code aliasing.
			//
			// User writes items.bom_no = "EV-STATOR-ASSY" (item code, not BOM name).
			// identity_field (e.g. "item" for BOM) is what the user referenced.
			// Node key = identity_field value so the topo sort can match cross-refs.
			// Server resolves item_code → actual BOM name during sequential creation.
			const id_field = info.identity_field;
			const _node_key = (r) => (
				(id_field && r[id_field]) || r.name || Object.values(r).find(v => v && typeof v === "string") || ""
			).toString().trim();

			// Build key set first so _refs can filter to only intra-batch deps
			const key_set = new Set(rows.map(r => _node_key(r)));

			nodes = rows.map(r => ({
				name  : _node_key(r),                            // item code or BOM name
				_row  : r,
				// Refs: link_field values (item codes) that match other nodes in batch.
				// External refs (pre-existing BOMs not in this batch) are excluded here —
				// the server resolves them via DB lookup.
				_refs : (r[info.table_field] || [])
					.map(item => (item[info.link_field] || "").trim())
					.filter(ref => ref && key_set.has(ref)),
				_depth: 0,
			}));

		} else {
			return { error: __("Unknown tree pattern.") };
		}

		return { nodes };
	}

	/** Format A — Level/Depth column (0 = root, 1 = first child, …) */
	_parse_format_a(rows, level_key) {
		const depth_stack = {};  // depth → last node name
		return rows.map((row, i) => {
			const depth  = parseInt(row[level_key] ?? 0) || 0;
			const name   = (row.name || Object.values(row).find(v => v) || `Row ${i + 1}`).toString().trim();
			const parent = depth === 0 ? null : (depth_stack[depth - 1] || null);
			depth_stack[depth] = name;
			// Clear deeper slots on a new sibling
			Object.keys(depth_stack).forEach(d => { if (parseInt(d) > depth) delete depth_stack[d]; });
			const node = { ...row, name, _parent: parent, _depth: depth };
			delete node[level_key];  // not a real Frappe field
			return node;
		});
	}

	/** Format B — Parent column (blank = root) */
	_parse_format_b(rows, parent_key) {
		return rows.map((row, i) => {
			const name   = (row.name || Object.values(row).find(v => v) || `Row ${i + 1}`).toString().trim();
			const parent = (row[parent_key] || "").toString().trim() || null;
			return { ...row, name, _parent: parent, _depth: 0 };
		});
	}

	// ── Layer 3: Validation (client-side, no server call) ─────────────────────

	_validate(nodes) {
		const errors   = [];
		const names    = nodes.map(n => n.name);
		const name_set = new Set(names);

		// Duplicate names
		const seen_dup = new Set();
		names.forEach((name, i) => {
			if (names.indexOf(name) !== i && !seen_dup.has(name)) {
				errors.push(__("Duplicate name: '{0}'", [name]));
				seen_dup.add(name);
			}
		});

		if (this.info.pattern === 1) {
			// Orphan check (parent must be in dataset unless root)
			nodes.forEach(n => {
				if (n._parent && !name_set.has(n._parent)) {
					errors.push(__("'{0}': parent '{1}' not found in import data", [n.name, n._parent]));
				}
			});
			// Assign depths for Format B after orphan pass
			if (!errors.length) this._assign_depths(nodes);
			// Cycle detection
			if (!errors.length && this._has_cycle_p1(nodes)) {
				errors.push(__("Circular parent reference detected. Check your Level / Parent column."));
			}
		} else if (this.info.pattern === 2) {
			// Cycle detection on cross-doc references
			if (this._has_cycle_p2(nodes)) {
				errors.push(__("Circular dependency detected (e.g. BOM A uses BOM B which uses BOM A)."));
			}
		}

		const depth_max = Math.max(0, ...nodes.map(n => n._depth || 0));
		return { errors, node_count: nodes.length, depth_max };
	}

	/** Fill in _depth for Format B nodes by traversing parent links. */
	_assign_depths(nodes) {
		const by_name = {};
		nodes.forEach(n => { by_name[n.name] = n; });
		const assign = (node, d) => {
			node._depth = d;
			nodes.filter(c => c._parent === node.name).forEach(c => assign(c, d + 1));
		};
		nodes.filter(n => !n._parent).forEach(r => assign(r, 0));
	}

	_has_cycle_p1(nodes) {
		const children = {};
		nodes.forEach(n => {
			if (n._parent) {
				children[n._parent] = children[n._parent] || [];
				children[n._parent].push(n.name);
			}
		});
		const visited = new Set(), stack = new Set();
		const dfs = (name) => {
			if (stack.has(name)) return true;
			if (visited.has(name)) return false;
			visited.add(name); stack.add(name);
			for (const c of (children[name] || [])) {
				if (dfs(c)) return true;
			}
			stack.delete(name);
			return false;
		};
		return nodes.filter(n => !n._parent).some(r => dfs(r.name));
	}

	_has_cycle_p2(nodes) {
		const name_set = new Set(nodes.map(n => n.name));
		const adj = {};  // dependency graph: dep → [nodes that depend on dep]
		nodes.forEach(n => { adj[n.name] = []; });
		nodes.forEach(n => {
			(n._refs || []).filter(r => name_set.has(r)).forEach(dep => {
				adj[dep] = adj[dep] || [];
				adj[dep].push(n.name);
			});
		});
		const visited = new Set(), stack = new Set();
		const dfs = (name) => {
			if (stack.has(name)) return true;
			if (visited.has(name)) return false;
			visited.add(name); stack.add(name);
			for (const nxt of (adj[name] || [])) {
				if (dfs(nxt)) return true;
			}
			stack.delete(name);
			return false;
		};
		return nodes.some(n => dfs(n.name));
	}

	// ── Sort for creation order ───────────────────────────────────────────────

	_sort_for_creation(nodes) {
		if (this.info.pattern === 1) {
			// Top-down: root (depth 0) first, then ascending depth
			return [...nodes].sort((a, b) => (a._depth || 0) - (b._depth || 0));
		}
		// Pattern 2: Kahn's topological sort — leaves (no deps) first
		return this._topo_sort(nodes);
	}

	_topo_sort(nodes) {
		const name_set = new Set(nodes.map(n => n.name));
		const by_name  = {};
		const indegree = {};
		const adj      = {};  // dep → [nodes that depend on dep]

		nodes.forEach(n => {
			by_name[n.name]  = n;
			indegree[n.name] = 0;
			adj[n.name]      = [];
		});

		nodes.forEach(n => {
			(n._refs || []).filter(r => name_set.has(r)).forEach(dep => {
				adj[dep].push(n.name);
				indegree[n.name]++;
			});
		});

		const queue = nodes.filter(n => indegree[n.name] === 0).map(n => n.name);
		const order = [];

		while (queue.length) {
			const cur = queue.shift();
			order.push(by_name[cur]);
			(adj[cur] || []).forEach(nxt => { if (--indegree[nxt] === 0) queue.push(nxt); });
		}

		// Safety: append any remaining nodes (shouldn't happen after cycle check)
		nodes.forEach(n => { if (!order.includes(n)) order.push(n); });
		return order;
	}

	// ── Layer 6: Tree Preview Dialog ──────────────────────────────────────────

	_open_dialog(nodes, validation) {
		const esc        = frappe.utils.escape_html;
		const has_errors = validation.errors.length > 0;
		const sorted     = has_errors ? nodes : this._sort_for_creation(nodes);

		const error_html = has_errors ? `
			<div class="ev-ti-errors">
				<div class="ev-ti-errors-title">
					<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>
					${__("Validation Errors")} (${validation.errors.length})
				</div>
				<ul class="ev-ti-error-list">
					${validation.errors.map(e => `<li>${esc(e)}</li>`).join("")}
				</ul>
			</div>` : "";

		const pattern_lbl = this.info.pattern === 1
			? __("NSM Tree — parent field: {0}", [esc(this.info.parent_field || "parent")])
			: __("Cross-doc tree — {0}.{1}", [esc(this.info.table_field || ""), esc(this.info.link_field || "")]);

		this.$dlg = $(`
			<div class="ev-gd-backdrop ev-ti-backdrop">
				<div class="ev-ti-modal">
					<div class="ev-ti-header">
						<div class="ev-ti-title-group">
							<svg class="ev-ti-title-icon" viewBox="0 0 20 20" fill="currentColor" width="17" height="17"><path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/></svg>
							<span class="ev-ti-title">${__("Tree Import")} — ${esc(this.doctype)}</span>
						</div>
						<button class="ev-gd-close-btn ev-ti-x-btn" aria-label="${__("Close")}">
							<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
						</button>
					</div>
					<div class="ev-ti-body">
						<div class="ev-ti-meta-bar">
							<span class="ev-ti-chip ev-ti-chip--pat">P${this.info.pattern}</span>
							<span class="ev-ti-chip">${pattern_lbl}</span>
							<span class="ev-ti-chip ev-ti-chip--cnt">${nodes.length} ${__("records")}</span>
							${!has_errors
								? `<span class="ev-ti-chip ev-ti-chip--ok">${__("Valid ✓")}</span>
								   <span class="ev-ti-chip ev-ti-chip--depth">${__("Depth")} ${validation.depth_max}</span>`
								: `<span class="ev-ti-chip ev-ti-chip--err">${__("Errors")}</span>`}
						</div>
						${error_html}
						<div class="ev-ti-tree-section">
							<div class="ev-ti-sec-hdr ev-ti-collapsible" data-target="ev-ti-tree-body">
								<svg class="ev-ti-chevron" width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 5.5l6.5 6 6.5-6"/></svg>
								${__("Tree Preview")}
							</div>
							<div class="ev-ti-tree-body" id="ev-ti-tree-body">
								<div class="ev-ti-tree">${this._render_tree_html(nodes)}</div>
							</div>
						</div>
						<div class="ev-ti-progress-section" style="display:none" id="ev-ti-progress-section">
							<div class="ev-ti-prog-bar-wrap">
								<div class="ev-ti-prog-bar-fill" id="ev-ti-prog-bar"></div>
							</div>
							<div class="ev-bi-prog-list" id="ev-ti-prog-list"></div>
						</div>
						<div class="ev-ti-result-section" style="display:none" id="ev-ti-result-section"></div>
					</div>
					<div class="ev-ti-footer" id="ev-ti-footer">
						<button class="ev-gd-btn ev-gd-btn--secondary ev-ti-cancel-btn">${__("Cancel")}</button>
						<button class="ev-gd-btn ev-gd-btn--primary ev-ti-import-btn"${has_errors ? " disabled" : ""}>
							${has_errors ? __("Fix Errors to Import") : __("Import {0} Records", [nodes.length])}
						</button>
					</div>
				</div>
			</div>
		`).appendTo(document.body);

		// Remove mapper modal immediately
		this.$modal?.remove();

		// Collapse toggle
		this.$dlg.on("click", ".ev-ti-collapsible", function () {
			const target = $(this).data("target");
			$(`#${target}`).toggleClass("ev-ti-collapsed");
			$(this).find(".ev-ti-chevron").toggleClass("ev-ti-chevron--up");
		});

		this.$dlg.on("click", ".ev-ti-x-btn, .ev-ti-cancel-btn", () => this._close());

		this.$dlg.on("click", ".ev-ti-import-btn:not([disabled])", () => {
			this._start_import(sorted);
		});
	}

	// ── Tree rendering ────────────────────────────────────────────────────────

	_render_tree_html(nodes) {
		return this.info.pattern === 1
			? this._render_p1_tree(nodes)
			: this._render_p2_tree(nodes);
	}

	_render_p1_tree(nodes) {
		const esc = frappe.utils.escape_html;
		const children = {};  // parent_name → [child_nodes]
		nodes.forEach(n => {
			const p = n._parent || "__root__";
			children[p] = children[p] || [];
			children[p].push(n);
		});

		const render = (node) => {
			const kids = children[node.name] || [];
			const icon = kids.length
				? `<svg class="ev-ti-nd-icon" viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M9.828 3h3.982a2 2 0 0 1 1.992 2.181l-.637 7A2 2 0 0 1 13.174 14H2.825a2 2 0 0 1-1.991-1.819l-.637-7a1.99 1.99 0 0 1 .342-1.31L.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3zm-8.322.12C1.72 3.042 1.95 3 2.19 3h5.396l-.707-.707A1 1 0 0 0 6.172 2H2.5a1 1 0 0 0-1 .981l.006.139z"/></svg>`
				: `<svg class="ev-ti-nd-icon ev-ti-nd-icon--leaf" viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M4 0h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/></svg>`;
			return `
				<div class="ev-ti-node">
					<div class="ev-ti-node-row">
						${icon}
						<span class="ev-ti-node-name">${esc(node.name)}</span>
						${kids.length ? `<span class="ev-ti-node-count">${kids.length}</span>` : ""}
					</div>
					${kids.length ? `<div class="ev-ti-node-children">${kids.map(c => render(c)).join("")}</div>` : ""}
				</div>`;
		};

		const roots = children["__root__"] || [];
		if (!roots.length) return `<div class="ev-ti-empty">${__("(no root nodes found)")}</div>`;
		return roots.map(r => render(r)).join("");
	}

	_render_p2_tree(nodes) {
		const esc      = frappe.utils.escape_html;
		const name_set = new Set(nodes.map(n => n.name));
		return nodes.map(n => {
			const internal_deps = (n._refs || []).filter(r => name_set.has(r));
			return `
				<div class="ev-ti-node ev-ti-node--flat">
					<div class="ev-ti-node-row">
						<svg class="ev-ti-nd-icon" viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path d="M4 0h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/></svg>
						<span class="ev-ti-node-name">${esc(n.name)}</span>
						${internal_deps.length
							? `<span class="ev-ti-node-deps">${__("uses:")} ${internal_deps.map(d => esc(d)).join(", ")}</span>`
							: ""}
					</div>
				</div>`;
		}).join("");
	}

	// ── Layer 4+5: Import + Realtime Progress ─────────────────────────────────

	_start_import(sorted_nodes) {
		this.$dlg.find(".ev-ti-import-btn").prop("disabled", true).text(__("Importing…"));
		this.$dlg.find(".ev-ti-cancel-btn").prop("disabled", true);
		this.$dlg.find(".ev-ti-tree-section, .ev-ti-errors").hide();
		this.$dlg.find("#ev-ti-progress-section").show();

		const esc    = frappe.utils.escape_html;
		const IC_WAIT = `<svg class="ev-bi-prog-svg ev-bi-prog-svg--wait" width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
		const IC_RUN  = `<svg class="ev-bi-prog-svg ev-bi-prog-svg--run"  width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="10 30" stroke-linecap="round"/></svg>`;
		const IC_OK   = `<svg class="ev-bi-prog-svg ev-bi-prog-svg--ok"   width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.5 8l2.5 2.5 4.5-4.5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
		const IC_ERR  = `<svg class="ev-bi-prog-svg ev-bi-prog-svg--err"  width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;

		this.$dlg.find("#ev-ti-prog-list").html(
			sorted_nodes.map((n, i) => `
				<div class="ev-bi-prog-item" data-ti-idx="${i}">
					${IC_WAIT}
					<span class="ev-bi-prog-val">${esc(n.name || `Row ${i + 1}`)}</span>
					<span class="ev-bi-prog-result"></span>
				</div>`).join("")
		);

		// Listen for realtime progress events
		const job_id = this._job_id;
		frappe.realtime.on("ev_tree_progress", (data) => {
			if (data.job_id !== job_id) return;

			const $item = this.$dlg?.find(`[data-ti-idx="${data.idx}"]`);
			if ($item?.length) {
				if (data.status === "ok") {
					$item.find(".ev-bi-prog-svg").replaceWith(IC_OK);
					$item.find(".ev-bi-prog-result").text(data.name || "");
				} else if (data.status === "error" || data.status === "rolled_back") {
					$item.find(".ev-bi-prog-svg").replaceWith(IC_ERR);
					$item.find(".ev-bi-prog-result").text(data.error || __("Error"));
				}
				$item[0]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
			}

			const pct = Math.round((data.idx + 1) / data.total * 100);
			this.$dlg?.find("#ev-ti-prog-bar").css("width", pct + "%");

			if (data.status === "rolled_back" || (data.idx + 1 >= data.total && data.status !== "ok")) {
				frappe.realtime.off("ev_tree_progress");
				setTimeout(() => this._show_result({ status: "rolled_back", error: data.error }), 400);
			} else if (data.idx + 1 >= data.total && data.status === "ok") {
				frappe.realtime.off("ev_tree_progress");
				setTimeout(() => this._show_result({ status: "ok", created: data.total }), 400);
			}
		});

		// Build records for server (strip internal _ keys)
		const records_for_server = sorted_nodes.map(n => {
			const src = n._row || n;
			return Object.fromEntries(Object.entries(src).filter(([k]) => !k.startsWith("_")));
		});

		frappe.call({
			method: "excel_view.tree_import.import_tree",
			args: {
				doctype          : this.doctype,
				records_json     : JSON.stringify(records_for_server),
				pattern          : this.info.pattern,
				pattern_info_json: JSON.stringify(this.info),
				job_id,
			},
			callback: (r) => {
				if (!r?.message) return;
				// If realtime events already resolved, _show_result was already called.
				// If not (e.g. very small import with no realtime), handle here.
				const msg = r.message;
				if (msg.status === "ok" && this.$dlg?.find("#ev-ti-result-section").is(":hidden")) {
					frappe.realtime.off("ev_tree_progress");
					this._show_result(msg);
				} else if (msg.status === "rolled_back" && this.$dlg?.find("#ev-ti-result-section").is(":hidden")) {
					frappe.realtime.off("ev_tree_progress");
					this._show_result(msg);
				}
			},
			error: (err) => {
				frappe.realtime.off("ev_tree_progress");
				const msg = err?.responseJSON?.exception || err?.message || __("Unexpected error");
				this._show_result({ status: "rolled_back", error: msg });
			},
		});
	}

	// ── Layer 6: Result panel ─────────────────────────────────────────────────

	_show_result(data) {
		const esc  = frappe.utils.escape_html;
		const $res = this.$dlg?.find("#ev-ti-result-section");
		if (!$res?.length) return;

		$res.show();
		this.$dlg.find("#ev-ti-progress-section").hide();
		this.$dlg.find("#ev-ti-footer").hide();

		if (data.status === "ok") {
			$res.html(`
				<div class="ev-ti-result ev-ti-result--ok">
					<svg width="40" height="40" viewBox="0 0 16 16" fill="currentColor">
						<circle cx="8" cy="8" r="8" fill="var(--green-500,#28a745)"/>
						<path d="M4 8l3 3 5-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
					<div class="ev-ti-result-title">${__("Import Complete")}</div>
					<div class="ev-ti-result-sub">${__("{0} {1} records created successfully.", [data.created || "", esc(this.doctype)])}</div>
					<button class="ev-gd-btn ev-gd-btn--primary ev-ti-done-btn">${__("Done")}</button>
				</div>
			`);
			$res.on("click", ".ev-ti-done-btn", () => {
				this._close();
				this.on_done({ status: "ok", created: data.created });
			});
		} else {
			const err_detail = data.errors?.map(e => `<li>${esc(e.name)}: ${esc(e.error)}</li>`).join("") || "";
			$res.html(`
				<div class="ev-ti-result ev-ti-result--err">
					<svg width="40" height="40" viewBox="0 0 16 16" fill="currentColor">
						<circle cx="8" cy="8" r="8" fill="var(--red-500,#dc3545)"/>
						<path d="M5 5l6 6M11 5l-6 6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
					</svg>
					<div class="ev-ti-result-title">${__("Import Failed — Rolled Back")}</div>
					<div class="ev-ti-result-sub">${esc(data.error || __("An error occurred. Any created records have been deleted."))}</div>
					${err_detail ? `<ul class="ev-ti-err-detail">${err_detail}</ul>` : ""}
					<button class="ev-gd-btn ev-gd-btn--secondary ev-ti-done-btn">${__("Close")}</button>
				</div>
			`);
			$res.on("click", ".ev-ti-done-btn", () => this._close());
		}
	}

	// ── Cleanup ───────────────────────────────────────────────────────────────

	_close() {
		frappe.realtime.off("ev_tree_progress");
		this.$dlg?.remove();
		this.$dlg = null;
	}
};
