/**
 * excel_view/components/join_canvas.js
 *
 * IntelliFlow — Visual Join Canvas (V2.4 — bug-fix r2)
 *
 * Full-screen overlay canvas for building SQL JOINs visually:
 *   - HTML div "nodes" (one per DocType) are draggable on a dotted-grid stage
 *   - SVG bezier "edges" connect field ports between nodes
 *   - Each connection is validated in real-time via 2-layer AI:
 *       Layer 1: Frappe meta Link field detection (instant)
 *       Layer 2: Data value overlap sampling (async, 200 rows per side)
 *   - "Apply" executes a dynamic LEFT JOIN on the backend and injects
 *     the result as read-only virtual columns into the HOT grid
 *
 * Bug fixes (r2):
 *   F1 — Header title stays on one line (CSS overflow + nowrap)
 *   F2 — Field checkboxes appear immediately on non-base nodes (no wire needed first)
 *        Checkboxes are tracked per-node; only applied to edges with valid connections
 *   F3 — frappe.prompt dialog appears above canvas overlay:
 *        body.ev-jc-open class → CSS bumps .modal z-index to 1700 (> canvas 1500)
 *   F4 — Wire drawing uses document-level mousemove/mouseup (robust across all child els)
 *   F5 — Escape key guard: canvas doesn't close when a frappe modal is open
 *   F6 — Field rows placed inside .ev-jc-node-fields div → proper scrolling
 *
 * Usage (called from ExcelBoard._open_join_canvas):
 *   this.join_canvas = new frappe.views.excel.JoinCanvas({ board: this });
 *   this.join_canvas.open(board._last_join_config || null);
 *   // Pass board._last_join_config so canvas reopens with existing connections.
 */

frappe.provide("frappe.views.excel");

// ── V3: EER node module color — Office palette, fully dynamic ─────────────────
// Maps any module name → one of 9 Microsoft Office-inspired colors via djb2 hash.
// No hardcoded module names — works for any Frappe/ERPNext/custom app module.
// Colors match Excel View's brand: Excel green, Word blue, Office corporate palette.
function _eer_module_color(module_name) {
	if (!module_name) return { bg: "#505967", bg_dark: "#3a4150" };
	// djb2 hash → index into Office palette
	let h = 5381;
	for (let i = 0; i < module_name.length; i++) {
		h = ((h << 5) + h) ^ module_name.charCodeAt(i);
		h = h >>> 0;
	}
	// Microsoft Office application color palette — professional, Excel-adjacent
	const OFFICE_LIGHT = [
		"#1a6b40",  // Excel deep green
		"#2b579a",  // Word blue
		"#b7472a",  // PowerPoint red-orange
		"#4b5892",  // Teams indigo
		"#0067b8",  // Outlook blue
		"#36654e",  // dark teal
		"#6b3fa0",  // purple (OneNote-adjacent)
		"#7b5a2a",  // warm brown (SharePoint-adjacent)
		"#1e5878",  // dark cyan
	];
	const OFFICE_DARK = [
		"#1e7d4a",  // Excel green (brighter on dark)
		"#3366b8",  // Word blue (lighter)
		"#cc5535",  // PPT orange
		"#5b68a8",  // Teams indigo lighter
		"#1589d8",  // Outlook blue lighter
		"#3d7560",  // teal lighter
		"#8050b8",  // purple lighter
		"#9a7040",  // brown lighter
		"#226890",  // cyan lighter
	];
	const is_dark = document.documentElement.getAttribute("data-theme") === "dark";
	const palette = is_dark ? OFFICE_DARK : OFFICE_LIGHT;
	return {
		bg: palette[h % palette.length],
		text: "#ffffff",
	};
}

// ── V3: Field type badge meta ─────────────────────────────────────────────────
// ── V3: Field type badge — semantic grouping, fully dynamic fallback ──────────
// Known fieldtypes get semantic CSS class + 3-char abbreviation.
// Any unknown fieldtype (custom fields, future Frappe types) auto-gets
// a hash-derived color badge (first 3 chars of the type name, lower-cased).
const EER_FT_GROUP = {
	// Group → css class
	link:    { cls: "ev-ftb-link",   types: ["Link", "Dynamic Link"] },
	numeric: { cls: "ev-ftb-num",    types: ["Currency", "Float", "Int", "Percent", "Rating"] },
	date:    { cls: "ev-ftb-date",   types: ["Date", "Datetime", "Time", "Duration"] },
	check:   { cls: "ev-ftb-check",  types: ["Check"] },
	select:  { cls: "ev-ftb-select", types: ["Select"] },
	table:   { cls: "ev-ftb-table",  types: ["Table", "Table MultiSelect"] },
	text:    { cls: "ev-ftb-text",   types: ["Small Text", "Text", "Long Text", "Text Editor", "Markdown Editor"] },
	attach:  { cls: "ev-ftb-attach", types: ["Attach", "Attach Image"] },
	geo:     { cls: "ev-ftb-geo",    types: ["Geolocation"] },
	code:    { cls: "ev-ftb-code",   types: ["Code", "JSON", "Barcode"] },
};
// Build lookup map from the groups
const EER_FIELD_TYPE_BADGE = (() => {
	const map = {};
	for (const [, group] of Object.entries(EER_FT_GROUP)) {
		group.types.forEach(t => {
			map[t] = { cls: group.cls, abbr: t.substring(0, 3).toUpperCase() };
		});
	}
	return map;
})();
// For unknown fieldtypes: deterministic color from type name hash
function _eer_ft_badge(fieldtype) {
	if (!fieldtype) return { cls: "ev-ftb-data", abbr: "DAT", inline: null };
	if (EER_FIELD_TYPE_BADGE[fieldtype]) return { ...EER_FIELD_TYPE_BADGE[fieldtype], inline: null };
	// Unknown type — hash name to a hue, render inline color
	let h = 5381;
	for (let i = 0; i < fieldtype.length; i++) { h = ((h << 5) + h) ^ fieldtype.charCodeAt(i); h = h >>> 0; }
	const hue = h % 360;
	return {
		cls: "ev-ftb-custom",
		abbr: fieldtype.substring(0, 3).toUpperCase(),
		inline: `background:hsl(${hue},35%,42%);color:#fff;`,  // muted professional, Office-adjacent
	};
}
const EER_DEFAULT_BADGE = { cls: "ev-ftb-data", abbr: "DAT", inline: null };

frappe.views.excel.JoinCanvas = class JoinCanvas {
	// ── Constructor ───────────────────────────────────────────────────────────

	constructor({ board }) {
		this.board = board;
		// Map<node_id, {id, doctype, el, selected_fields: Set<string>}>
		this.nodes = new Map();
		// [{id, src_node_id, src_field, tgt_node_id, tgt_field,
		//   valid, confidence, method, path_el, badge_el}]
		this.edges = [];
		// Active wire state while user drags a connection
		this._wire = null; // {src_node_id, src_field, path_el}
		this._node_ctr = 0;
		this._edge_ctr = 0;
		// Tracks which node the ✨ AI drawer fetches suggestions FOR.
		// null = use board.doctype (base node).  Set by clicking the ✨ icon on any node.
		this._ai_target_node_id = null;
		// Bound handlers kept for later removal
		this._on_key           = this._on_key.bind(this);
		this._doc_mousemove    = this._on_doc_mousemove.bind(this);
		this._doc_mouseup      = this._on_doc_mouseup.bind(this);

		// Figma-style Zoom & Pan state
		this._zoom = 1.0;           // Current zoom level (1.0 = 100%)
		this._pan_x = 0;            // Pan offset X
		this._pan_y = 0;            // Pan offset Y
		this._is_panning = false;   // Space or middle-mouse panning
		this._space_pressed = false; // Track space key state

		// Collaboration state
		this.active_session_id = null;
		this.collab_sidebar = null;
		this.online_users = [];
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────

	/**
	 * Open the canvas overlay.
	 *
	 * @param {Object|null} initial_config - Optional join_config to restore immediately.
	 *   When provided (e.g. from board._last_join_config after a workbook was loaded),
	 *   this config is used instead of reading from user_settings.  This allows the
	 *   canvas to show existing connections when the user clicks "Link Sheets" while
	 *   a join-based workbook is already active.
	 */
	open(initial_config = null) {
		this._build_overlay();
		// Initialize collaboration features
		this._init_collaboration();
		// Mark body so CSS can bump frappe modal z-index above canvas (F3)
		document.body.classList.add("ev-jc-open");
		// Remember that the canvas is open — survives page refresh
		frappe.model.user_settings.save(this.board.doctype, "excel_join_canvas_open", true);
		// Seed the base node from the current DocType, then restore any saved state
		frappe.model.with_doctype(this.board.doctype, () => {
			this._add_node(this.board.doctype, { base: true });
			// Priority: active join config (workbook loaded) > user_settings (last Apply)
			const has_content = cfg =>
				cfg?.nodes?.some(n => n.doctype !== this.board.doctype) ||
				cfg?.edges?.length > 0;

			if (has_content(initial_config)) {
				this._restore_from_config(initial_config);
				// V2.4.5 — show Patterns button if a join is already applied
				if (initial_config?.edges?.filter(e => e.valid !== false).length) {
					this.$overlay.find(".ev-jc-patterns-btn").show();
					this.$overlay.find(".ev-jc-analyze-btn").show();
				}
			} else {
				this._restore_from_user_settings();
			}
		});
		$(document).on("keydown.ev-jc", this._on_key);
	}

	close() {
		// Leave collaboration session if active
		if (this.active_session_id) {
			this._leave_session();
		}
		// Remove all frappe.realtime listeners (prevents duplicate handlers on reopen)
		this._cleanup_realtime_events();
		$(document).off("keydown.ev-jc");
		$(document).off("keydown.ev-jc-space");
		$(document).off("keyup.ev-jc-space");
		document.body.classList.remove("ev-jc-open");
		this.$overlay?.remove();
		this.$overlay = null;
		// Clear the "canvas is open" flag so it doesn't reopen after the next refresh
		frappe.model.user_settings.save(this.board.doctype, "excel_join_canvas_open", false);
		// Clean up any lingering document listeners from an interrupted wire drag
		document.removeEventListener("mousemove", this._doc_mousemove);
		document.removeEventListener("mouseup",   this._doc_mouseup);
	}

	// F5 — guard: don't close canvas when a frappe dialog is open
	_on_key(e) {
		if (e.key === "Escape") {
			if ($(".modal.show, .modal.in").length) return; // a dialog is open
			this.close();
		}
	}

	// ── Overlay DOM ───────────────────────────────────────────────────────────

	_build_overlay() {
		this.$overlay = $(`
			<div class="ev-canvas-overlay">
				<div class="ev-jc-header">
					<!-- Left: brand + context -->
					<div class="ev-jc-header-left">
						<svg class="ev-jc-header-icon" width="18" height="18" viewBox="0 0 24 24" fill="none">
							<rect x="2" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
							<rect x="14" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
							<rect x="2" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.8"/>
							<path d="M10 7h4M10 17h4m0-10v14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
						</svg>
						<span class="ev-jc-header-title">${frappe.utils.escape_html(__("Link Sheets"))}</span>
						<span class="ev-jc-header-sep">›</span>
						<span class="ev-jc-header-dt">${frappe.utils.escape_html(this.board.doctype)}</span>
					</div>

					<!-- Center: grouped action pills -->
					<div class="ev-jc-header-center">
						<!-- Group 1: Discover -->
						<div class="ev-jc-btn-group" data-label="${__("Discover")}">
							<button class="ev-jc-hbtn ev-jc-ai-btn" title="${__("AI Discover — suggest joins from schema analysis")}">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74L12 2z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
								${__("AI")}
							</button>
							<button class="ev-jc-hbtn ev-jc-path-btn" title="${__("Find Path — auto-chain via shortest link path")}">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="2.5" stroke="currentColor" stroke-width="1.8"/><circle cx="19" cy="12" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M7.5 12h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
								${__("Path")}
							</button>
							<button class="ev-jc-hbtn ev-jc-hbtn--generate ev-jc-generate-btn" title="${__("Generative BI — describe what you want, AI builds the canvas")}">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
								${__("Generate")}
							</button>
						</div>

						<div class="ev-jc-header-divider"></div>

						<!-- Group 2: Build -->
						<div class="ev-jc-btn-group" data-label="${__("Build")}">
							<button class="ev-jc-hbtn ev-jc-add-btn" title="${__("Add a DocType node to the canvas")}">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
								${__("Add DocType")}
							</button>
							<button class="ev-jc-hbtn ev-jc-layout-btn" title="${__("Auto-arrange nodes (dagre layout)")}">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.8"/><rect x="10" y="4" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="16" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.8"/><rect x="10" y="16" width="4" height="4" rx="1" stroke="currentColor" stroke-width="1.8"/><path d="M17 6h3M17 18h3M7 8v8M14 8v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
								${__("Layout")}
							</button>
							<button class="ev-jc-hbtn ev-jc-sql-btn" title="${__("View generated SQL")}">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h10M4 17h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
								SQL
							</button>
							<button class="ev-jc-hbtn ev-jc-flow-btn" title="${__("Toggle Query Flow panel")}">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="10" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.8"/><rect x="3" y="17" width="6" height="4" rx="1" stroke="currentColor" stroke-width="1.8"/><path d="M9 5h3l3 3v3m0 0v4m0-4h3m-3 4h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
								${__("Flow")}
							</button>
							<button class="ev-jc-hbtn ev-jc-collaborate-btn" title="${__("Start or join a collaborative canvas session")}">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="7" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="9" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M17 16c1.7 0 3 1.3 3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
								${__("Collaborate")}
							</button>
						</div>

						<div class="ev-jc-header-divider"></div>

						<!-- Group 3: Output -->
						<div class="ev-jc-btn-group" data-label="${__("Output")}">
							<button class="ev-jc-hbtn ev-jc-preview-btn" title="${__("Preview joined data (5 rows)")}">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/></svg>
								${__("Preview")}
							</button>
							<button class="ev-jc-hbtn ev-jc-hbtn--apply ev-jc-apply-btn" title="${__("Apply join to grid")}">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
								${__("Apply")}
							</button>
						</div>
					</div>

					<!-- Right: close -->
					<div class="ev-jc-header-right">
						<button class="ev-jc-hbtn ev-jc-hbtn--close ev-jc-close-btn" title="${__("Close")} (Esc)">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
						</button>
					</div>

					<!-- Hidden legacy buttons (feature-flagged) -->
					<button class="btn btn-sm btn-default ev-jc-patterns-btn" style="display:none">${__("Patterns")}</button>
					<button class="btn btn-sm btn-default ev-jc-analyze-btn"  style="display:none">${__("Analyze")}</button>
				</div>
				<!-- V3: canvas body wraps flow panel + stage -->
				<div class="ev-canvas-body">
					<!-- Query Flow Panel slot (collapsed by default) -->
					<div class="ev-qfp-slot" style="display:none;"></div>
					<!-- Main stage: SVG wire layer + node cards -->
					<div class="ev-jc-stage">
						<svg class="ev-jc-svg" xmlns="http://www.w3.org/2000/svg"></svg>
						<div class="ev-jc-nodes"></div>
						<div class="ev-jc-hint">
							<b>${__("How to use:")}</b>
							${__("1. Click Flow → configure pipeline. &nbsp; 2. Add DocType nodes + drag ○ to join. &nbsp; 3. Click Apply.")}
						</div>
						<!-- Figma-style zoom controls (bottom-right corner) -->
						<div class="ev-jc-zoom-controls">
							<button class="ev-jc-zoom-btn ev-jc-zoom-out" title="${__("Zoom Out")} (Ctrl + Scroll)">−</button>
							<span class="ev-jc-zoom-level">100%</span>
							<button class="ev-jc-zoom-btn ev-jc-zoom-in" title="${__("Zoom In")} (Ctrl + Scroll)">+</button>
							<button class="ev-jc-zoom-btn ev-jc-zoom-fit" title="${__("Fit to Screen")} (Shift+1)">
								<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
									<path d="M1 1h6v2H3v4H1V1zm14 0h-6v2h4v4h2V1zM1 15h6v-2H3v-4H1v6zm14 0h-6v-2h4v-4h2v6z"/>
								</svg>
							</button>
						</div>
					</div>
				</div>
				<!-- SQL preview panel (bottom slide-up, hidden by default) -->
				<div class="ev-jc-sql-panel" style="display:none;">
					<div class="ev-jc-sql-header">
						<span class="ev-jc-sql-title">Generated SQL</span>
						<button class="ev-jc-sql-copy" title="${__("Copy SQL")}">Copy</button>
						<button class="ev-jc-sql-close">✕</button>
					</div>
					<pre class="ev-jc-sql-code"></pre>
				</div>
			</div>
		`).appendTo(document.body);

		this.$stage = this.$overlay.find(".ev-jc-stage");
		this.$svg   = this.$overlay.find(".ev-jc-svg");
		this.$nodes = this.$overlay.find(".ev-jc-nodes");

		// Header button events
		this.$overlay.find(".ev-jc-close-btn").on("click",    () => this.close());
		this.$overlay.find(".ev-jc-add-btn").on("click",      () => this._prompt_add_node());
		this.$overlay.find(".ev-jc-preview-btn").on("click",  () => this._show_preview());
		this.$overlay.find(".ev-jc-apply-btn").on("click",    () => this._apply());
		// V2.4.5 AI buttons
		this.$overlay.find(".ev-jc-ai-btn").on("click",       () => this._toggle_ai_discover());
		this.$overlay.find(".ev-jc-path-btn").on("click",     () => this._run_find_path());
		this.$overlay.find(".ev-jc-patterns-btn").on("click", () => this._run_pattern_mining());
		// V2.5 AI Analysis button
		this.$overlay.find(".ev-jc-analyze-btn").on("click",  () => this._open_analyze_panel());
		// V2.5+ Generative BI button
		this.$overlay.find(".ev-jc-generate-btn").on("click", () => this._prompt_generative_query());
		// Collaboration button
		this.$overlay.find(".ev-jc-collaborate-btn").on("click", () => this._toggle_collaboration());
		// V3 new buttons
		this.$overlay.find(".ev-jc-layout-btn").on("click", () => this._auto_layout());
		this.$overlay.find(".ev-jc-sql-btn").on("click", () => this._toggle_sql_panel());
		this.$overlay.find(".ev-jc-sql-close").on("click", () => {
			this.$overlay.find(".ev-jc-sql-panel").hide();
			this.$overlay.find(".ev-jc-sql-btn").removeClass("ev-jc-hbtn--active");
		});
		this.$overlay.find(".ev-jc-sql-copy").on("click", () => {
			const sql = this.$overlay.find(".ev-jc-sql-code").text();
			frappe.utils.copy_to_clipboard(sql);
			frappe.show_alert({ message: __("SQL copied to clipboard"), indicator: "green" }, 2);
		});
		this.$overlay.find(".ev-jc-flow-btn").on("click", () => {
			const $slot = this.$overlay.find(".ev-qfp-slot");
			const visible = $slot.is(":visible");
			const opening = !visible;
			$slot.toggle(opening);
			this.$nodes.toggle(!opening);
			this.$svg.toggle(!opening);
			this.$overlay.find(".ev-jc-flow-btn").toggleClass("ev-jc-hbtn--active", opening);
			if (opening) {
				if (!this._flow_panel) this._init_flow_panel();
				this._show_flowchart();
			} else {
				this._hide_flowchart();
			}
		});

		// ── Figma-style Zoom & Pan Controls ────────────────────────────────

		// Zoom button controls
		this.$overlay.find(".ev-jc-zoom-in").on("click", () => this._zoom_in());
		this.$overlay.find(".ev-jc-zoom-out").on("click", () => this._zoom_out());
		this.$overlay.find(".ev-jc-zoom-fit").on("click", () => this._zoom_fit());

		// Mouse wheel: Ctrl+wheel = zoom, Space+wheel = pan (Figma style)
		this.$stage[0].addEventListener("wheel", (e) => {
			// Ctrl/Cmd + wheel = zoom (centered on cursor)
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();

				// Get mouse position relative to stage
				const rect = this.$stage[0].getBoundingClientRect();
				const mouseX = e.clientX - rect.left;
				const mouseY = e.clientY - rect.top;

				// Zoom centered on mouse cursor
				const delta = e.deltaY > 0 ? -0.1 : 0.1;
				this._zoom_at_point(mouseX, mouseY, this._zoom + delta);
			}
			// Space + wheel/trackpad scroll = pan (like Figma)
			else if (this._space_pressed) {
				e.preventDefault();

				// Pan based on scroll delta
				this._pan_x -= e.deltaX;
				this._pan_y -= e.deltaY;
				this._apply_transform();
			}
		}, { passive: false });

		// Space + Drag to pan (Figma style)
		$(document).on("keydown.ev-jc-space", (e) => {
			// Only handle if canvas is open and not typing in input/textarea
			if (e.key === " " && !this._space_pressed && !$(e.target).is("input, textarea") && this.$overlay) {
				e.preventDefault();  // Prevent page scroll
				this._space_pressed = true;
				this.$overlay.css("cursor", "grab");
			}
		});

		$(document).on("keyup.ev-jc-space", (e) => {
			if (e.key === " ") {
				this._space_pressed = false;
				if (!this._is_panning) {
					this.$overlay.css("cursor", "");
				}
			}
		});

		// Middle mouse or Space+drag to pan
		// Listen on overlay (not just stage) to catch all clicks
		this.$overlay.on("mousedown", (e) => {
			// Middle mouse button (button 1) or Space+left click
			if (e.button === 1 || (e.button === 0 && this._space_pressed)) {
				e.preventDefault();
				e.stopPropagation();
				this._start_pan(e);
			}
		});

	}

	// ── Node management ───────────────────────────────────────────────────────

	_prompt_add_node() {
		// frappe.prompt z-index is bumped above canvas via body.ev-jc-open CSS (F3)
		frappe.prompt(
			[{
				fieldtype: "Link",
				fieldname: "doctype",
				label:     __("DocType"),
				options:   "DocType",
				reqd:      1,
			}],
			({ doctype }) => {
				if ([...this.nodes.values()].find(n => n.doctype === doctype)) {
					frappe.show_alert(
						{ message: __("{0} is already added", [doctype]), indicator: "orange" },
						3
					);
					return;
				}
				frappe.model.with_doctype(doctype, () => this._add_node(doctype, { base: false }));
			},
			__("Add DocType"),
			__("Add"),
		);
	}

	_add_node(doctype, { base = false } = {}) {
		const id   = `node_${this._node_ctr++}`;
		const meta = frappe.get_meta(doctype);

		// Detect child table (istable=1 in Frappe meta)
		const is_child = !!meta?.istable;

		const SKIP_TYPES = new Set([
			"Column Break", "Section Break", "Tab Break", "Fold",
			"Heading", "HTML", "Custom HTML", "Table", "Table MultiSelect", "Password",
		]);
		// Child table system fields — only filter truly useless ones
		// Note: parent & parenttype are kept selectable (useful for joins and polymorphic relationships)
		const CHILD_SYS_FIELDS = new Set(["parentfield", "idx"]);

		const fields = (meta?.fields || []).filter(
			df => !SKIP_TYPES.has(df.fieldtype) && !df.is_virtual && df.fieldname !== "name"
				&& !(is_child && CHILD_SYS_FIELDS.has(df.fieldname))
		);

		// Auto-layout: constant 60px gap after the rightmost existing node
		const NODE_WIDTH = 268;
		const NODE_GAP   = 60;
		let left = 40;
		this.nodes.forEach(n => {
			const right_edge = (n.el.offsetLeft || 0) + NODE_WIDTH + NODE_GAP;
			if (right_edge > left) left = right_edge;
		});
		const top = 60;

		const node_el = document.createElement("div");
		node_el.className = "ev-jc-node"
			+ (base ? " ev-jc-node--base" : "")
			+ (is_child && !base ? " ev-jc-node--child" : "");
		node_el.dataset.id = id;
		node_el.style.left = left + "px";
		node_el.style.top  = top  + "px";

		// ── Header — EER style, dynamic module color ──
		// Base node always uses Excel green gradient (brand identity).
		// Joined nodes use Office palette color for the module.
		const is_dark_now = document.documentElement.getAttribute("data-theme") === "dark";
		const _eer_clr = base
			? { bg: is_dark_now ? "linear-gradient(135deg,#1a5c36 0%,#217346 100%)" : "linear-gradient(135deg,#1d6f42 0%,#2d9e5f 100%)" }
			: _eer_module_color(meta?.module || "");
		const hdr = document.createElement("div");
		hdr.className = "ev-jc-node-header";
		hdr.style.background = _eer_clr.bg;
		hdr.style.color = "#ffffff";
		const _module_label = meta?.module ? frappe.utils.escape_html(meta.module) : "";
		hdr.innerHTML = `
			<div class="ev-jc-node-header-top">
				<span class="ev-jc-node-title">${frappe.utils.escape_html(doctype)}</span>
				${is_child && !base ? `<span class="ev-jc-ct-badge" title="${__("Child Table")}">CT</span>` : ""}
				<button class="ev-jc-node-ai-target" title="${__("AI suggest from this node")}">✨</button>
				${!base
					? `<button class="ev-jc-node-remove" title="${__("Remove")}">✕</button>`
					: ""}
			</div>
			<div class="ev-jc-node-header-sub">
				${_module_label ? `<span class="ev-jc-node-module">${_module_label}</span>` : ""}
				<span class="ev-jc-node-count${base ? " ev-jc-node-count--base" : ""}"
				      title="${__("Fields selected for grid")}">0 ${__("selected")}</span>
			</div>
		`;
		node_el.appendChild(hdr);

		// ── Scrollable field list (F6) ──
		const fields_div = document.createElement("div");
		fields_div.className = "ev-jc-node-fields";

		// "name" field row (always shown)
		fields_div.appendChild(this._make_field_row({ fieldname: "name", label: "Name (ID)" }, id, base));

		// Child table system fields — add parent field for wiring (parenttype optional for future)
		// These are NOT in meta.fields but needed for intelligent AI auto-wire to work
		if (is_child) {
			const parent_row = this._make_field_row({
				fieldname: "parent",
				label: "Parent (System)",
				is_system: true
			}, id, base);
			parent_row.classList.add("ev-jc-field--system");
			fields_div.appendChild(parent_row);
		}

		// All other fields
		fields.forEach(df => {
			fields_div.appendChild(this._make_field_row(df, id, base));
		});

		node_el.appendChild(fields_div);
		this.$nodes[0].appendChild(node_el);

		// Re-render edges when field list is scrolled (ports move vertically)
		fields_div.addEventListener("scroll", () => this._render_edges());

		// Store node — selected_fields Set tracked per-node (F2)
		this.nodes.set(id, { id, doctype, el: node_el, selected_fields: new Set() });

		// Bind drag on header
		this._bind_node_drag(hdr, node_el);

		// ✨ AI-target button — sets this node as the active suggestion source
		hdr.querySelector(".ev-jc-node-ai-target").addEventListener("click", (e) => {
			e.stopPropagation();
			this._set_ai_target(id);
		});

		if (base) {
			// Base node: show checkboxes pre-checked for currently visible HOT columns
			const pre_check = new Set(this.board.columns.map(c => c.data));
			this._add_field_checkboxes(id, fields_div, pre_check);
		} else {
			// Non-base: wire remove button
			hdr.querySelector(".ev-jc-node-remove")
				?.addEventListener("click", (e) => {
					e.stopPropagation();
					this._remove_node(id);
				});

			if (is_child) {
				// ── CT node: no per-row checkboxes; field rows kept for port dots ──
				// Aggregate panel replaces Transform panel for CT nodes.
				// _make_field_row already added port dots — checkboxes hidden via CSS.
				this._add_aggregate_panel(node_el, id, doctype, fields);
			} else {
				// ── Regular non-base node: checkboxes + Transform panel ─────────
				this._add_field_checkboxes(id, fields_div, null);

				// ── Transform Panel (V2.5) ──────────────────────────────────────
				this._add_transform_panel(node_el, id, doctype, fields);
			}
		}

		return id;
	}

	/**
	 * Append a collapsible Transform panel to a non-base node.
	 * Panel contains: Row Filter rows + Computed Column rows.
	 *
	 * @param {HTMLElement} node_el   - the node container div
	 * @param {string}      node_id   - stable node id
	 * @param {string}      doctype   - node doctype
	 * @param {Object[]}    meta_fields - frappe meta fields (for field dropdown)
	 */
	_add_transform_panel(node_el, node_id, doctype, meta_fields) {
		const tf = document.createElement("div");
		tf.className = "ev-jc-node-transform";
		tf.dataset.nodeId = node_id;
		tf.innerHTML = `
			<div class="ev-jc-transform-header" tabindex="0">
				<span class="ev-tf-title">🔧 ${__("Transform")}</span>
				<span class="ev-jc-transform-badge ev-jc-transform-badge--hidden">0 ${__("rules")}</span>
				<span class="ev-jc-transform-toggle">▸</span>
			</div>
			<div class="ev-jc-transform-body" style="display:none">
				<div class="ev-tf-section-label">${__("Row Filter")}</div>
				<div class="ev-tf-filters"></div>
				<button class="ev-tf-add-filter btn btn-xs btn-default">+ ${__("Add Filter")}</button>
				<div class="ev-tf-section-label" style="margin-top:8px">${__("Computed Column")}</div>
				<div class="ev-tf-computed"></div>
				<button class="ev-tf-add-computed btn btn-xs btn-default">+ ${__("Add Column")}</button>
			</div>
		`;
		node_el.appendChild(tf);

		// Toggle body on header click
		const header_el = tf.querySelector(".ev-jc-transform-header");
		const body_el   = tf.querySelector(".ev-jc-transform-body");
		const toggle_el = tf.querySelector(".ev-jc-transform-toggle");
		header_el.addEventListener("click", () => {
			const open = body_el.style.display !== "none";
			body_el.style.display = open ? "none" : "block";
			toggle_el.textContent = open ? "▸" : "▾";
		});

		// "+ Add Filter" row
		const filters_container   = tf.querySelector(".ev-tf-filters");
		const computed_container  = tf.querySelector(".ev-tf-computed");
		const badge_el            = tf.querySelector(".ev-jc-transform-badge");

		const _update_badge = () => {
			const f_count = filters_container.querySelectorAll(".ev-tf-filter-row").length;
			const c_count = computed_container.querySelectorAll(".ev-tf-computed-row").length;
			const total   = f_count + c_count;
			badge_el.textContent = `${total} ${__("rules")}`;
			badge_el.classList.toggle("ev-jc-transform-badge--hidden", total === 0);
		};

		tf.querySelector(".ev-tf-add-filter").addEventListener("click", (e) => {
			e.stopPropagation();
			this._add_filter_row(filters_container, meta_fields, _update_badge);
		});
		tf.querySelector(".ev-tf-add-computed").addEventListener("click", (e) => {
			e.stopPropagation();
			this._add_computed_row(computed_container, _update_badge);
		});
	}

	/** Append one Row Filter row to the filters container. */
	_add_filter_row(container, meta_fields, on_change, saved = null) {
		const row = document.createElement("div");
		row.className = "ev-tf-filter-row";

		const field_opts = meta_fields.map(df =>
			`<option value="${frappe.utils.escape_html(df.fieldname)}"
			         ${saved?.field === df.fieldname ? "selected" : ""}>${frappe.utils.escape_html(df.label || df.fieldname)}</option>`
		).join("");

		const ops = ["=", "!=", ">", "<", ">=", "<=", "like", "in"];
		const op_opts = ops.map(op =>
			`<option value="${op}" ${saved?.op === op ? "selected" : ""}>${op}</option>`
		).join("");

		row.innerHTML = `
			<select class="ev-tf-field form-control form-control-sm">${field_opts}</select>
			<select class="ev-tf-op    form-control form-control-sm">${op_opts}</select>
			<input  class="ev-tf-val   form-control form-control-sm"
			        placeholder="${__("value")}" value="${frappe.utils.escape_html(saved?.value || "")}">
			<button class="ev-tf-row-del btn btn-xs" title="${__("Remove")}">×</button>
		`;
		row.querySelector(".ev-tf-row-del").addEventListener("click", () => {
			row.remove();
			on_change?.();
		});
		container.appendChild(row);
		on_change?.();
	}

	/** Append one Computed Column row to the computed container. */
	_add_computed_row(container, on_change, saved = null) {
		const key = saved?.key || `_computed_${Date.now()}`;
		const row = document.createElement("div");
		row.className = "ev-tf-computed-row";
		row.dataset.key = key;
		row.innerHTML = `
			<input class="ev-tf-col-label form-control form-control-sm"
			       placeholder="${__("Column label")}" value="${frappe.utils.escape_html(saved?.label || "")}">
			<textarea class="ev-tf-col-expr form-control form-control-sm" rows="2"
			          placeholder="${__('e.g. "Senior" if years_of_experience > 5 else "Junior"')}">${frappe.utils.escape_html(saved?.expr || "")}</textarea>
			<button class="ev-tf-row-del btn btn-xs" title="${__("Remove")}">×</button>
		`;
		row.querySelector(".ev-tf-row-del").addEventListener("click", () => {
			row.remove();
			on_change?.();
		});
		container.appendChild(row);
		on_change?.();
	}

	/** Read Transform panel state for a node → {row_filter, computed_cols}. */
	_get_node_transform_config(node_id) {
		const node_el = this.nodes.get(node_id)?.el;
		if (!node_el) return { row_filter: [], computed_cols: [] };

		const tf = node_el.querySelector(".ev-jc-node-transform");
		if (!tf) return { row_filter: [], computed_cols: [] };

		const row_filter = [...tf.querySelectorAll(".ev-tf-filter-row")].map(r => ({
			field: r.querySelector(".ev-tf-field")?.value || "",
			op:    r.querySelector(".ev-tf-op")?.value    || "=",
			value: r.querySelector(".ev-tf-val")?.value   || "",
		})).filter(f => f.field);

		const computed_cols = [...tf.querySelectorAll(".ev-tf-computed-row")].map(r => ({
			key:   r.dataset.key || `_col_${Math.random().toString(36).slice(2)}`,
			label: r.querySelector(".ev-tf-col-label")?.value || "",
			expr:  r.querySelector(".ev-tf-col-expr")?.value  || "",
		})).filter(c => c.label && c.expr);

		return { row_filter, computed_cols };
	}

	/** Restore Transform panel UI from saved config (called in _restore_from_config). */
	_restore_transform_panel(node_id, transform_cfg, meta_fields) {
		const node_el = this.nodes.get(node_id)?.el;
		if (!node_el || !transform_cfg) return;

		const tf = node_el.querySelector(".ev-jc-node-transform");
		if (!tf) return;

		const filters_container  = tf.querySelector(".ev-tf-filters");
		const computed_container = tf.querySelector(".ev-tf-computed");
		const badge_el           = tf.querySelector(".ev-jc-transform-badge");

		const _update_badge = () => {
			const total = filters_container.querySelectorAll(".ev-tf-filter-row").length
			            + computed_container.querySelectorAll(".ev-tf-computed-row").length;
			badge_el.textContent = `${total} ${__("rules")}`;
			badge_el.classList.toggle("ev-jc-transform-badge--hidden", total === 0);
		};

		(transform_cfg.row_filter || []).forEach(f =>
			this._add_filter_row(filters_container, meta_fields, _update_badge, f)
		);
		(transform_cfg.computed_cols || []).forEach(c =>
			this._add_computed_row(computed_container, _update_badge, c)
		);

		// Auto-expand panel if there are rules
		const total = (transform_cfg.row_filter?.length || 0) + (transform_cfg.computed_cols?.length || 0);
		if (total > 0) {
			tf.querySelector(".ev-jc-transform-body").style.display = "block";
			tf.querySelector(".ev-jc-transform-toggle").textContent = "▾";
		}
	}

	// ── CT Aggregate Panel ────────────────────────────────────────────────────
	// Replaces Transform panel on child-table nodes.
	// Each row = one aggregated output column: func(field) → 1 row per parent record.

	/**
	 * Append the Aggregate panel to a CT node.
	 * @param {HTMLElement} node_el    - node container div
	 * @param {string}      node_id    - stable node id
	 * @param {string}      doctype    - CT doctype name
	 * @param {Object[]}    meta_fields - filtered Frappe meta fields
	 */
	_add_aggregate_panel(node_el, node_id, doctype, meta_fields) {
		const ag = document.createElement("div");
		ag.className  = "ev-jc-node-aggregate";
		ag.dataset.nodeId = node_id;
		ag.innerHTML = `
			<div class="ev-jc-agg-header">
				<span class="ev-jc-agg-title">📊 ${__("Aggregate")}</span>
				<span class="ev-jc-agg-badge ev-jc-agg-badge--hidden">0 ${__("cols")}</span>
			</div>
			<div class="ev-jc-agg-body">
				<div class="ev-jc-agg-rows"></div>
				<button class="ev-jc-agg-add btn btn-xs btn-default">+ ${__("Add Column")}</button>
				<div class="ev-jc-agg-hint">
					${__("Each row becomes one aggregated column (1 result row per parent record).")}
				</div>
			</div>
		`;
		node_el.appendChild(ag);

		const rows_container = ag.querySelector(".ev-jc-agg-rows");
		const badge_el       = ag.querySelector(".ev-jc-agg-badge");
		const count_el       = node_el.querySelector(".ev-jc-node-count");

		const _update = () => {
			const n = rows_container.querySelectorAll(".ev-jc-agg-row").length;
			badge_el.textContent = `${n} ${__("cols")}`;
			badge_el.classList.toggle("ev-jc-agg-badge--hidden", n === 0);
			if (count_el) {
				count_el.textContent = n + " " + __("agg.");
				count_el.classList.toggle("ev-jc-node-count--active", n > 0);
			}
		};

		ag.querySelector(".ev-jc-agg-add").addEventListener("click", (e) => {
			e.stopPropagation();
			this._add_aggregate_row(rows_container, meta_fields, _update);
		});

		_update(); // init badge
	}

	/** Append one Aggregate row to the rows container. */
	_add_aggregate_row(container, meta_fields, on_change, saved = null) {
		const row = document.createElement("div");
		row.className = "ev-jc-agg-row";

		// Include "name" as a COUNT candidate + all meta fields
		const all_fields = [{ fieldname: "name", label: "Name (ID)" }, ...meta_fields];
		const field_opts = all_fields.map(df =>
			`<option value="${frappe.utils.escape_html(df.fieldname)}"
			         ${saved?.field === df.fieldname ? "selected" : ""}>
				${frappe.utils.escape_html(df.label || df.fieldname)}
			</option>`
		).join("");

		const FUNCS    = ["SUM", "COUNT", "AVG", "MIN", "MAX"];
		const func_opts = FUNCS.map(f =>
			`<option value="${f}" ${saved?.func === f ? "selected" : ""}>${f}</option>`
		).join("");

		row.innerHTML = `
			<select class="ev-jc-agg-field form-control form-control-sm">${field_opts}</select>
			<select class="ev-jc-agg-func  form-control form-control-sm">${func_opts}</select>
			<button class="ev-jc-agg-del btn btn-xs" title="${__("Remove")}">×</button>
		`;
		row.querySelector(".ev-jc-agg-del").addEventListener("click", () => {
			row.remove();
			on_change?.();
		});
		container.appendChild(row);
		on_change?.();
	}

	/** Read Aggregate panel state → [{field, func}] or null if no rows. */
	_get_node_aggregate_config(node_id) {
		const ag = this.nodes.get(node_id)?.el?.querySelector(".ev-jc-node-aggregate");
		if (!ag) return null;

		const cols = [...ag.querySelectorAll(".ev-jc-agg-row")].map(r => ({
			field: r.querySelector(".ev-jc-agg-field")?.value || "",
			func:  r.querySelector(".ev-jc-agg-func")?.value  || "SUM",
		})).filter(c => c.field);

		return cols.length ? cols : null;
	}

	/** Restore Aggregate panel from saved config. */
	_restore_aggregate_panel(node_id, agg_cols, meta_fields) {
		if (!agg_cols?.length) return;
		const node_el = this.nodes.get(node_id)?.el;
		if (!node_el) return;
		const ag = node_el.querySelector(".ev-jc-node-aggregate");
		if (!ag) return;

		const rows_container = ag.querySelector(".ev-jc-agg-rows");
		const badge_el       = ag.querySelector(".ev-jc-agg-badge");
		const count_el       = node_el.querySelector(".ev-jc-node-count");

		const _update = () => {
			const n = rows_container.querySelectorAll(".ev-jc-agg-row").length;
			badge_el.textContent = `${n} ${__("cols")}`;
			badge_el.classList.toggle("ev-jc-agg-badge--hidden", n === 0);
			if (count_el) {
				count_el.textContent = n + " " + __("agg.");
				count_el.classList.toggle("ev-jc-node-count--active", n > 0);
			}
		};

		agg_cols.forEach(c => this._add_aggregate_row(rows_container, meta_fields, _update, c));
	}

	/** Set a node as the AI suggestion target — highlights it and refreshes open drawer. */
	_set_ai_target(node_id) {
		this._ai_target_node_id = node_id;
		// Update highlight on all nodes
		this.nodes.forEach((n, nid) => {
			n.el.classList.toggle("ev-jc-node--ai-target", nid === node_id);
		});
		// If the drawer is already open, re-fetch for the new target
		if (this.$stage.find(".ev-jc-ai-drawer").length) {
			this.$stage.find(".ev-jc-ai-drawer").remove();
			this._fetch_and_render_suggestions(false);
		}
	}

	/** Returns the DocType that AI suggestions should be fetched for. */
	_get_ai_doctype() {
		return this.nodes.get(this._ai_target_node_id)?.doctype || this.board.doctype;
	}

	_make_field_row(df, node_id, is_base) {
		const row = document.createElement("div");
		row.className = "ev-jc-field";
		row.dataset.field = df.fieldname;

		// In-port (left) — only on non-base nodes
		if (!is_base) {
			const port_in = document.createElement("span");
			port_in.className = "ev-port ev-port--in";
			port_in.dataset.portDir = "in";
			port_in.dataset.nodeId  = node_id;
			port_in.title = __("Drop connection here");
			row.appendChild(port_in);
		}

		// V3: Field type badge — fully dynamic, handles any fieldtype including custom ones
		if (df.fieldtype) {
			const bm = _eer_ft_badge(df.fieldtype);
			const badge = document.createElement("span");
			badge.className = `ev-jc-ft-badge ${bm.cls}`;
			badge.textContent = bm.abbr;
			badge.title = df.fieldtype;
			if (bm.inline) badge.setAttribute("style", bm.inline);
			row.appendChild(badge);
		}

		// Label
		const label = document.createElement("span");
		label.className = "ev-jc-field-label";
		label.textContent = df.label || df.fieldname;
		label.title = `${df.fieldname}${df.fieldtype ? ` (${df.fieldtype})` : ""}`;
		row.appendChild(label);

		// Out-port (right) — on all nodes
		const port_out = document.createElement("span");
		port_out.className = "ev-port ev-port--out";
		port_out.dataset.portDir = "out";
		port_out.dataset.nodeId  = node_id;
		port_out.title = __("Drag to connect");
		port_out.addEventListener("mousedown", (e) => {
			e.stopPropagation();
			e.preventDefault();
			this._start_wire(e, node_id, df.fieldname);
		});
		row.appendChild(port_out);

		return row;
	}

	// F2 — Add field-select checkboxes to all field rows.
	// @param {Set<string>|null} pre_check — fieldnames to pre-tick (base node use-case)
	_add_field_checkboxes(node_id, container, pre_check = null) {
		const node_el  = this.nodes.get(node_id)?.el || container.closest(".ev-jc-node");
		const count_el = node_el?.querySelector(".ev-jc-node-count");

		const _update_count = () => {
			const node = this.nodes.get(node_id);
			if (!count_el || !node) return;
			const n = node.selected_fields.size;
			count_el.textContent = n + " " + __("selected");
			count_el.classList.toggle("ev-jc-node-count--active", n > 0);
		};

		container.querySelectorAll(".ev-jc-field").forEach(row => {
			if (row.querySelector(".ev-field-select")) return; // idempotent
			const cb = document.createElement("input");
			cb.type      = "checkbox";
			cb.className = "ev-field-select";
			cb.title     = __("Include this field in the grid");

			// Pre-check for base node (currently visible columns)
			if (pre_check?.has(row.dataset.field)) {
				cb.checked = true;
				this.nodes.get(node_id)?.selected_fields.add(row.dataset.field);
				row.classList.add("ev-jc-field--selected");
			}

			cb.addEventListener("change", () => {
				const node  = this.nodes.get(node_id);
				const field = row.dataset.field;
				if (!node) return;
				if (cb.checked) {
					node.selected_fields.add(field);
					row.classList.add("ev-jc-field--selected");
				} else {
					node.selected_fields.delete(field);
					row.classList.remove("ev-jc-field--selected");
				}
				_update_count();
			});

			// Layout: [in-port] [label] [checkbox] [out-port]
			const port_out = row.querySelector(".ev-port--out");
			row.insertBefore(cb, port_out);
		});

		// Init count badge after all rows processed
		_update_count();
	}

	_remove_node(node_id) {
		const removed_dt = this.nodes.get(node_id)?.doctype;

		// Remove all edges connected to this node
		const to_remove = this.edges.filter(
			e => e.src_node_id === node_id || e.tgt_node_id === node_id
		);
		to_remove.forEach(e => this._delete_edge(e));
		this.edges = this.edges.filter(
			e => e.src_node_id !== node_id && e.tgt_node_id !== node_id
		);
		this.nodes.get(node_id)?.el.remove();
		this.nodes.delete(node_id);

		// Update AI drawer card back to "+ Add" if the drawer is open
		if (removed_dt) {
			const $card = this.$stage.find(`.ev-jc-ai-card[data-doctype="${CSS.escape(removed_dt)}"]`);
			if ($card.length) {
				$card.removeClass("ev-jc-card--added");
				$card.find(".ev-jc-card-check").replaceWith(
					`<button class="btn btn-xs btn-primary ev-jc-card-add">${__("+ Add")}</button>`
				);
			}
		}

		// Persist updated layout (node removed)
		this._auto_save_layout();
	}

	_delete_edge(edge) {
		edge.path_el?.remove();
		edge._hitbox_el?.remove();
		edge.badge_el?.remove();
		clearTimeout(edge._remove_timer);
	}

	// ── Node dragging ─────────────────────────────────────────────────────────

	_bind_node_drag(handle_el, node_el) {
		// Phase 4: Throttling for real-time position broadcasts
		let last_broadcast_time = 0;
		const BROADCAST_THROTTLE = 100; // ms - max 10 updates/sec

		handle_el.addEventListener("pointerdown", (e) => {
			// Figma-style: Disable node drag when Space is pressed (for canvas panning)
			if (this._space_pressed) return;
			if (e.target.closest(".ev-jc-node-remove") || e.target.closest(".ev-jc-node-ai-target")) return;
			e.preventDefault();
			node_el.setPointerCapture(e.pointerId);
			const origin = {
				mx: e.clientX, my: e.clientY,
				px: node_el.offsetLeft, py: node_el.offsetTop,
			};
			node_el.onpointermove = (e) => {
				// Update position locally (immediate, no lag)
				const new_left = origin.px + e.clientX - origin.mx;
				const new_top = origin.py + e.clientY - origin.my;
				node_el.style.left = new_left + "px";
				node_el.style.top = new_top + "px";
				this._render_edges();

				// Phase 4: Throttled broadcast to other users
				const now = Date.now();
				if (this.active_session_id && (now - last_broadcast_time) > BROADCAST_THROTTLE) {
					this._broadcast_node_position(node_el.dataset.id, {
						left: Math.round(new_left),
						top: Math.round(new_top)
					});
					last_broadcast_time = now;
				}
			};
			node_el.onpointerup = () => {
				node_el.onpointermove = null;
				node_el.onpointerup   = null;
				// Save updated node positions after drag (full state with DB save)
				this._auto_save_layout();
			};
		});
	}

	// ── Wire drawing (F4 — document-level events for robustness) ─────────────

	_start_wire(e, node_id, field) {
		const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
		this._wire = { src_node_id: node_id, src_field: field, path_el };
		// Use document-level events so the wire tracks the cursor even over child elements
		document.addEventListener("mousemove", this._doc_mousemove);
		document.addEventListener("mouseup",   this._doc_mouseup);

		// V2.4.5 — AI port highlighting: score every visible target node's fields
		const src_dt = this.nodes.get(node_id)?.doctype;
		if (src_dt) {
			[...this.nodes.values()]
				.filter(n => n.id !== node_id)
				.forEach(tgt_node => {
					frappe.call({
						method: "excel_view.api.rank_field_matches",
						args:   { src_doctype: src_dt, src_field: field,
						          tgt_doctype: tgt_node.doctype },
						callback: (r) => {
							if (!this._wire) return; // wire was cancelled
							const scores = r.message || {};
							tgt_node.el.querySelectorAll(".ev-port--in").forEach(port => {
								const fname = port.closest("[data-field]")?.dataset.field;
								if (!fname) return;
								const s = scores[fname] || 0;
								port.dataset.aiScore = s >= 0.75 ? "high" : s >= 0.45 ? "mid" : "";
							});
						},
					});
				});
		}
	}

	_on_doc_mousemove(e) {
		if (!this._wire) return;
		const src    = this._get_port_pos(this._wire.src_node_id, this._wire.src_field, "out");
		const rect   = this.$stage[0].getBoundingClientRect();
		// Convert screen cursor to local (pre-transform) coords to match src
		const screen_x = e.clientX - rect.left;
		const screen_y = e.clientY - rect.top;
		const cursor = {
			x: (screen_x - this._pan_x) / this._zoom,
			y: (screen_y - this._pan_y) / this._zoom,
		};
		if (src) this._wire.path_el.setAttribute("d", this._bezier(src, cursor));
	}

	_on_doc_mouseup(e) {
		document.removeEventListener("mousemove", this._doc_mousemove);
		document.removeEventListener("mouseup",   this._doc_mouseup);

		// V2.4.5 — clear AI port highlights
		this.$nodes[0]?.querySelectorAll("[data-ai-score]")
			.forEach(el => { el.dataset.aiScore = ""; });

		if (!this._wire) return;

		// Walk the element stack at the drop point — find an in-port
		const els      = document.elementsFromPoint(e.clientX, e.clientY);
		const tgt_port = els.find(el => el.dataset?.portDir === "in");

		if (tgt_port) {
			const tgt_node_el = tgt_port.closest(".ev-jc-node");
			const tgt_node_id = tgt_node_el?.dataset?.id;
			const tgt_field   = tgt_port.closest(".ev-jc-field")?.dataset?.field;

			if (tgt_node_id && tgt_node_id !== this._wire.src_node_id && tgt_field) {
				this._complete_wire(
					this._wire.src_node_id, this._wire.src_field,
					tgt_node_id, tgt_field
				);
				return;
			}
		}

		// Dropped on nothing — cancel wire
		this._wire.path_el.remove();
		this._wire = null;
	}

	_complete_wire(src_node_id, src_field, tgt_node_id, tgt_field) {
		const edge = {
			id:            `edge_${this._edge_ctr++}`,
			src_node_id,
			src_field,
			tgt_node_id,
			tgt_field,
			valid:         null,
			confidence:    null,
			method:        null,
			path_el:       this._wire.path_el,
			badge_el:      null,
			_remove_timer: null,
		};
		this._wire = null;
		this.edges.push(edge);
		this._render_edges();
		this._validate_edge(edge);
	}

	// ── Validation ────────────────────────────────────────────────────────────

	_validate_edge(edge) {
		const src_dt = this.nodes.get(edge.src_node_id)?.doctype;
		const tgt_dt = this.nodes.get(edge.tgt_node_id)?.doctype;
		if (!src_dt || !tgt_dt) return;

		frappe.call({
			method: "excel_view.api.validate_join",
			args: {
				src_doctype: src_dt, src_field: edge.src_field,
				tgt_doctype: tgt_dt, tgt_field: edge.tgt_field,
			},
			freeze: false,
			callback: (r) => {
				const res = r.message;
				// Edge may have been deleted while request was in-flight
				if (!this.edges.find(e => e.id === edge.id)) return;

				edge.valid      = res.valid;
				edge.confidence = res.confidence;
				edge.method     = res.method;
				this._render_edges();

				if (res.valid) {
					// Mark connected ports as green first (moves fields to top of containers)
					this._mark_ports_connected(edge);
					// Re-render edges AFTER field pinning so SVG paths reflect new port positions
					this._render_edges();
					this._show_edge_badge(edge, res);
					// V3: Sync QueryFlowPanel with the new valid join
					this._sync_flow_panel();
					// Persist layout so refresh restores this canvas state
					// But skip if edge was restored from saved config (prevents infinite broadcast loop)
					if (!edge._restored) this._auto_save_layout();
				} else if (res.method === "type_mismatch") {
					// V2.4.5 — type incompatibility: instant red alert + immediate removal
					frappe.show_alert({ message: res.message, indicator: "red" }, 5);
					this.edges = this.edges.filter(e => e.id !== edge.id);
					this._delete_edge(edge);
				} else {
					this._show_edge_error(edge, res.message);
					edge._remove_timer = setTimeout(() => {
						this.edges = this.edges.filter(e => e.id !== edge.id);
						this._delete_edge(edge);
					}, 3000);
				}
			},
		});
	}

	_mark_ports_connected(edge) {
		const src_node = this.nodes.get(edge.src_node_id);
		const tgt_node = this.nodes.get(edge.tgt_node_id);
		const src_field_el = src_node?.el.querySelector(`[data-field="${edge.src_field}"]`);
		const tgt_field_el = tgt_node?.el.querySelector(`[data-field="${edge.tgt_field}"]`);
		src_field_el?.querySelector('.ev-port--out')?.classList.add("ev-port--connected");
		tgt_field_el?.querySelector('.ev-port--in')?.classList.add("ev-port--connected");
		// Move connected fields to the top of their scroll container
		src_field_el?.classList.add("ev-jc-field--pinned");
		tgt_field_el?.classList.add("ev-jc-field--pinned");
		if (src_field_el) {
			const container = src_field_el.closest(".ev-jc-node-fields");
			if (container) container.prepend(src_field_el);
		}
		if (tgt_field_el) {
			const container = tgt_field_el.closest(".ev-jc-node-fields");
			if (container) container.prepend(tgt_field_el);
		}
	}

	_unmark_ports_connected(edge) {
		const src_node = this.nodes.get(edge.src_node_id);
		const tgt_node = this.nodes.get(edge.tgt_node_id);
		const src_field_el = src_node?.el.querySelector(`[data-field="${edge.src_field}"]`);
		const tgt_field_el = tgt_node?.el.querySelector(`[data-field="${edge.tgt_field}"]`);
		src_field_el?.querySelector('.ev-port--out')?.classList.remove("ev-port--connected");
		tgt_field_el?.querySelector('.ev-port--in')?.classList.remove("ev-port--connected");
		src_field_el?.classList.remove("ev-jc-field--pinned");
		tgt_field_el?.classList.remove("ev-jc-field--pinned");
	}

	_show_edge_badge(edge, res) {
		if (edge.badge_el) edge.badge_el.remove();

		const src = this._get_port_pos(edge.src_node_id, edge.src_field, "out");
		const tgt = this._get_port_pos(edge.tgt_node_id, edge.tgt_field, "in");
		if (!src || !tgt) return;

		// Use local coords directly — badge lives in $nodes (transformed container)
		const mid_x = (src.x + tgt.x) / 2;
		const mid_y = (src.y + tgt.y) / 2;

		const label = res.method === "meta"
			? __("Link field ✓")
			: __("{0}% match ✓", [Math.round(res.confidence * 100)]);

		const badge = document.createElement("div");
		badge.className = "ev-jc-badge";

		// V2.4.5 — grade chip (S / A / B / C / D / F)
		if (res.grade) {
			const gc = document.createElement("span");
			gc.className = `ev-jc-grade ev-jc-grade--${res.grade}`;
			gc.textContent = res.grade;
			badge.appendChild(gc);
		}

		const label_span = document.createElement("span");
		// Enhanced label: "Link ✓ | 1:N | 87% cov"
		const cov_text = (res.coverage != null)
			? ` | ${res.cardinality || ""} | ${Math.round(res.coverage * 100)}% cov`
			: "";
		label_span.textContent = label + cov_text;
		badge.appendChild(label_span);

		// ✕ delink button — remove this edge on click
		const del_btn = document.createElement("button");
		del_btn.className = "ev-jc-badge-remove";
		del_btn.title = __("Remove this connection");
		del_btn.textContent = "✕";
		del_btn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.edges = this.edges.filter(ed => ed.id !== edge.id);
			this._delete_edge(edge);
			this._unmark_ports_connected(edge);
		});
		badge.appendChild(del_btn);

		badge.style.left = mid_x + "px";
		badge.style.top  = (mid_y - 10) + "px";
		this.$nodes[0].appendChild(badge);
		edge.badge_el = badge;

		// ── Hover-only visibility ─────────────────────────────────────────
		// Badge hidden by default; fat transparent hitbox on SVG edge path
		// (20px wide) makes hover easy without pixel-perfect aim.
		if (edge._hitbox_el) edge._hitbox_el.remove();
		const hitbox = document.createElementNS("http://www.w3.org/2000/svg", "path");
		hitbox.style.fill        = "none";
		hitbox.style.stroke      = "transparent";
		hitbox.style.strokeWidth = "20";
		hitbox.style.cursor      = "pointer";
		hitbox.setAttribute("d", edge.path_el.getAttribute("d") || "");
		this.$svg[0].appendChild(hitbox);
		edge._hitbox_el = hitbox;

		const _show = () => badge.classList.add("ev-jc-badge--vis");
		const _hide = () => badge.classList.remove("ev-jc-badge--vis");
		hitbox.addEventListener("mouseenter", _show);
		hitbox.addEventListener("mouseleave", _hide);
		badge.addEventListener("mouseenter",  _show);
		badge.addEventListener("mouseleave",  _hide);
	}

	_show_edge_error(edge, message) {
		if (edge.badge_el) edge.badge_el.remove();

		const src = this._get_port_pos(edge.src_node_id, edge.src_field, "out");
		const tgt = this._get_port_pos(edge.tgt_node_id, edge.tgt_field, "in");
		if (!src || !tgt) return;

		// Use local coords directly — badge lives in $nodes (transformed container)
		const mid_x = (src.x + tgt.x) / 2;
		const mid_y = (src.y + tgt.y) / 2;

		const badge = document.createElement("div");
		badge.className = "ev-jc-badge ev-jc-badge--error";
		badge.textContent = message || __("No match found");
		badge.style.left = mid_x + "px";
		badge.style.top  = (mid_y - 10) + "px";
		this.$nodes[0].appendChild(badge);
		edge.badge_el = badge;
	}

	// ── Edge rendering ────────────────────────────────────────────────────────

	_render_edges() {
		this.edges.forEach(edge => {
			const src = this._get_port_pos(edge.src_node_id, edge.src_field, "out");
			const tgt = this._get_port_pos(edge.tgt_node_id, edge.tgt_field, "in");
			if (!src || !tgt) return;

			const d = this._bezier(src, tgt);
			edge.path_el.setAttribute("d", d);
			// Keep hitbox path in sync so hover area follows the edge
			if (edge._hitbox_el) edge._hitbox_el.setAttribute("d", d);

			if (edge.valid === true) {
				edge.path_el.style.stroke          = "#1d6f42";
				edge.path_el.style.strokeDasharray = "none";
			} else if (edge.valid === false) {
				edge.path_el.style.stroke          = "#e03e3e";
				edge.path_el.style.strokeDasharray = "5,4";
			} else {
				// Pending validation
				edge.path_el.style.stroke          = "#aaa";
				edge.path_el.style.strokeDasharray = "5,4";
			}

			// Reposition badge — badge is in $nodes (transformed container), use local coords
			if (edge.badge_el) {
				const mid_x = (src.x + tgt.x) / 2;
				const mid_y = (src.y + tgt.y) / 2;
				edge.badge_el.style.left = mid_x + "px";
				edge.badge_el.style.top  = (mid_y - 10) + "px";
			}
		});
	}

	_create_svg_path(class_name) {
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("class", class_name);
		path.style.fill        = "none";
		path.style.strokeWidth = "2";
		this.$svg[0].appendChild(path);
		return path;
	}

	_get_port_pos(node_id, field, dir) {
		const node = this.nodes.get(node_id);
		if (!node) return null;
		const cls      = dir === "out" ? ".ev-port--out" : ".ev-port--in";
		const field_el = node.el.querySelector(`[data-field="${field}"]`);
		const port_el  = field_el?.querySelector(cls);
		if (!port_el) return null;

		const stage_rect = this.$stage[0].getBoundingClientRect();
		const r          = port_el.getBoundingClientRect();
		// Screen coords relative to stage
		const screen_x = r.left + r.width  / 2 - stage_rect.left;
		const screen_y = r.top  + r.height / 2 - stage_rect.top;
		// Convert to local (pre-transform) coords for SVG paths
		return {
			x: (screen_x - this._pan_x) / this._zoom,
			y: (screen_y - this._pan_y) / this._zoom,
		};
	}

	_bezier(p1, p2) {
		const cx = (p1.x + p2.x) / 2;
		return `M ${p1.x} ${p1.y} C ${cx} ${p1.y}, ${cx} ${p2.y}, ${p2.x} ${p2.y}`;
	}

	// ── Preview ───────────────────────────────────────────────────────────────

	_show_preview() {
		const cfg = this.get_join_config();
		if (!cfg.edges.length) {
			frappe.show_alert({
				message: __("Draw a connection first: drag ○ from one field to ○ on another DocType's field"),
				indicator: "orange",
			}, 5);
			return;
		}
		// Auto-include all non-system meta fields when user hasn't checked any yet
		cfg.edges.forEach(edge => {
			if (!edge.selected_fields?.length) {
				edge.selected_fields = this._get_default_fields(
					cfg.nodes.find(n => n.id === edge.tgt_node_id)?.doctype
				);
			}
		});
		const valid_edges = cfg.edges.filter(e => e.selected_fields?.length);
		if (!valid_edges.length) {
			frappe.show_alert({
				message: __("Could not resolve fields — check the join connection"),
				indicator: "orange",
			}, 4);
			return;
		}

		// For preview: include base_names so we find 5 rows with actual join data
		const preview_cfg = {
			...cfg,
			base_names: (this.board.list_view.data || []).map(d => d.name),
		};
		frappe.call({
			method: "excel_view.api.get_joined_data",
			args: {
				base_doctype: this.board.doctype,
				join_config:  JSON.stringify(preview_cfg),
				limit:        5,
			},
			freeze: false,
			callback: (r) => this._render_preview_table(r.message || [], cfg),
		});
	}

	// Helper: get human-readable label for a field from Frappe meta
	_field_label(doctype, fieldname) {
		if (fieldname === "name") return __("ID");
		const df = frappe.get_meta(doctype)?.fields?.find(f => f.fieldname === fieldname);
		return df?.label || fieldname;
	}

	_render_preview_table(rows, cfg) {
		// Build column list — base fields first, then joined fields per edge
		const cols = [{ key: "name", label: __("ID"), doctype: this.board.doctype, group: this.board.doctype }];

		// Base node selected fields (returned as plain fieldnames from API)
		(cfg.base_selected_fields || []).forEach(f => {
			if (f === "name") return;
			cols.push({
				key:     f,
				label:   this._field_label(this.board.doctype, f),
				doctype: this.board.doctype,
				group:   this.board.doctype,
			});
		});

		// Joined node fields (returned as DocType__fieldname from API)
		cfg.edges.forEach(edge => {
			const tgt_node = cfg.nodes.find(n => n.id === edge.tgt_node_id);
			if (!tgt_node) return;
			(edge.selected_fields || []).forEach(f => {
				cols.push({
					key:     `${tgt_node.doctype}__${f}`,
					label:   this._field_label(tgt_node.doctype, f),
					doctype: tgt_node.doctype,
					group:   tgt_node.doctype,
				});
			});
		});

		// Count columns per group for spanning group headers
		const groups = {};
		cols.forEach(c => { groups[c.group] = (groups[c.group] || 0) + 1; });

		// Group header row
		const group_header_html = Object.entries(groups).map(([dt, count]) =>
			`<th colspan="${count}" class="ev-prev-th ev-prev-th--group${dt === this.board.doctype ? " ev-prev-th--base" : ""}">${frappe.utils.escape_html(dt)}</th>`
		).join("");

		// Field label row
		const field_header_html = cols.map(c =>
			`<th class="ev-prev-th ev-prev-th--field${c.key === "name" ? " ev-prev-th--id" : ""}">${frappe.utils.escape_html(c.label)}</th>`
		).join("");

		// Data rows
		const rows_html = rows.map((row, i) => {
			const has_join = cols.slice(1).some(c => row[c.key] !== null && row[c.key] !== undefined && row[c.key] !== "");
			const row_cls = has_join
				? (i % 2 === 0 ? "ev-prev-row" : "ev-prev-row ev-prev-row--alt")
				: "ev-prev-row ev-prev-row--empty";
			return `<tr class="${row_cls}">${cols.map(c => {
				const val = row[c.key];
				const display = (val !== null && val !== undefined && val !== "") ? String(val) : "";
				return `<td class="ev-prev-td${display ? "" : " ev-prev-td--null"}">${
					display ? frappe.utils.escape_html(display) : `<span class="ev-prev-null">—</span>`
				}</td>`;
			}).join("")}</tr>`;
		}).join("");

		// Render as in-canvas panel (above canvas z-index, below nothing)
		this.$overlay.find(".ev-jc-preview-panel").remove();
		const $panel = $(`
			<div class="ev-jc-preview-panel">
				<div class="ev-jc-preview-panel-hdr">
					<span class="ev-jc-preview-panel-title">
						<svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:6px"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M4 5h8M4 8h8M4 11h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
						${__("Preview")} <span class="ev-prev-badge">${rows.length} ${__("rows")}</span>
					</span>
					<button class="ev-jc-preview-panel-close" title="${__("Close")}">✕</button>
				</div>
				<div class="ev-jc-preview-panel-body">
					<div class="ev-preview-wrap">
						<table class="ev-prev-table">
							<thead>
								<tr>${group_header_html}</tr>
								<tr>${field_header_html}</tr>
							</thead>
							<tbody>${rows_html || `<tr><td colspan="${cols.length}" class="ev-prev-empty">${__("No rows returned")}</td></tr>`}</tbody>
						</table>
					</div>
				</div>
			</div>
		`);
		$panel.find(".ev-jc-preview-panel-close").on("click", () => $panel.remove());
		this.$overlay.append($panel);
	}

	// ── Apply ─────────────────────────────────────────────────────────────────

	_apply() {
		const cfg = this.get_join_config();

		if (!cfg.edges.length) {
			frappe.show_alert({
				message: __("No connection yet. Drag ○ from one field to ○ on another DocType to join."),
				indicator: "orange",
			}, 5);
			return;
		}
		// Auto-include all non-system meta fields when user hasn't checked any yet
		cfg.edges.forEach(edge => {
			if (!edge.selected_fields?.length) {
				edge.selected_fields = this._get_default_fields(
					cfg.nodes.find(n => n.id === edge.tgt_node_id)?.doctype
				);
			}
		});
		const valid_edges = cfg.edges.filter(e => e.selected_fields?.length);
		if (!valid_edges.length) {
			frappe.show_alert({
				message: __("Could not resolve fields — check the join connection"),
				indicator: "orange",
			}, 4);
			return;
		}

		// Pass all currently-loaded doc names so the SQL filters to exactly what's
		// in the grid (root-node data drives the result — not DB order / LIMIT drift)
		const loaded_data  = this.board.list_view.data || [];
		const apply_cfg    = {
			...cfg,
			base_names: loaded_data.map(d => d.name),
		};
		frappe.call({
			method:         "excel_view.api.get_joined_data",
			args: {
				base_doctype: this.board.doctype,
				join_config:  JSON.stringify(apply_cfg),
				limit:        loaded_data.length + 100, // generous buffer
			},
			freeze:         true,
			freeze_message: __("Joining data…"),
			callback: (r) => {
				this.board._apply_join_result(r.message || [], cfg);
				// Persist canvas layout to user_settings so it's restored on next open
				this._save_to_user_settings(cfg);
				this.close();
				// Prompt to save this join as a named View so it appears in "Views"
				this._prompt_save_view(cfg);
			},
		});
	}

	/**
	 * After a successful Apply, prompt the user to name and save this join
	 * as an Excel Workbook entry visible in the "Views" list.
	 * Cancelling skips the save — the join is still applied in the grid.
	 *
	 * @param {Object} cfg - join_config (without base_names)
	 */
	_prompt_save_view(cfg) {
		// Build a sensible default name: "User + Employee" etc.
		const joined = cfg.nodes
			.filter(n => n.doctype !== this.board.doctype)
			.map(n => n.doctype)
			.join(", ");
		const default_title = joined
			? `${this.board.doctype} + ${joined}`
			: this.board.doctype;

		frappe.prompt(
			[
				{
					fieldtype: "Data",
					fieldname: "title",
					label:     __("View Name"),
					default:   default_title,
					reqd:      1,
				},
				{
					fieldtype: "Check",
					fieldname: "is_public",
					label:     __("Share with everyone"),
					default:   0,
				},
			],
			({ title, is_public }) => {
				this.board.workbook_manager.save_titled(title, is_public);
			},
			__("Save as View"),
			__("Save"),
		);
	}

	// ── V3: QueryFlowPanel init ────────────────────────────────────────────────

	_init_flow_panel() {
		const { QueryAST, QueryFlowPanel } = frappe.views.excel;
		if (!QueryAST || !QueryFlowPanel) return;  // not loaded yet
		// Start with a completely blank AST — user configures from scratch
		this._query_ast = new QueryAST();
		this._flow_panel = new QueryFlowPanel({
			ast: this._query_ast,
			canvas: this,
			on_ast_change: (ast, mode) => {
				this._refresh_sql_panel();
				this._render_flowchart(ast);
				if (mode === "run") this._run_ast_query(ast);
			},
		});
		const $slot = this.$overlay.find(".ev-qfp-slot");
		this._flow_panel.render($slot);
	}

	// ── V3: Real-time Query Flowchart (DAG canvas) ────────────────────────────

	_show_flowchart() {
		if (!this._$fc) {
			this._$fc       = $('<div class="ev-qfp-fc"></div>');
			this._$fc_inner = $('<div class="ev-fc-canvas-inner"></div>');
			this._$fc_svg   = $('<svg class="ev-fc-svg" xmlns="http://www.w3.org/2000/svg"><defs></defs></svg>');
			this._$fc_nl    = $('<div class="ev-fc-nodes-layer"></div>');
			// Empty state lives directly in _$fc so position:absolute;inset:0 fills the whole canvas
			this._$fc_empty = $(`<div class="ev-fc-empty" style="display:none">
				<svg width="44" height="44" viewBox="0 0 44 44" fill="none">
					<rect x="2" y="2" width="40" height="40" rx="8" stroke="#cbd5e1" stroke-width="1.5"/>
					<path d="M10 15h24M10 22h16M10 29h10" stroke="#cbd5e1" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
				<p>Select a DocType to see<br>the visual query plan</p>
			</div>`);
			this._$fc_inner.append(this._$fc_svg).append(this._$fc_nl);
			this._$fc.append(this._$fc_inner).append(this._$fc_empty);
			this.$stage.append(this._$fc);
			this._init_fc_pan();
		}
		this._fc_prev_struct = null;
		this._fc_prev_fps    = {};
		this._$fc.show();
		this._render_flowchart(this._query_ast);
	}

	_hide_flowchart() {
		this._$fc?.hide();
	}

	// Figma-style grab-to-pan on the DAG canvas container
	_init_fc_pan() {
		const el = this._$fc[0];
		let down = false, sx = 0, sy = 0, sl = 0, st = 0;

		el.addEventListener("mousedown", e => {
			if (e.button !== 0) return;
			// Let clicks on node cards pass through (no pan when interacting with cards)
			if (e.target.closest(".ev-fc-card")) return;
			down = true;
			sx = e.pageX; sy = e.pageY;
			sl = el.scrollLeft; st = el.scrollTop;
			el.classList.add("ev-qfp-fc--panning");
			e.preventDefault();
		});

		el.addEventListener("mousemove", e => {
			if (!down) return;
			el.scrollLeft = sl - (e.pageX - sx);
			el.scrollTop  = st - (e.pageY - sy);
		});

		const stop = () => {
			down = false;
			el.classList.remove("ev-qfp-fc--panning");
		};
		el.addEventListener("mouseup", stop);
		el.addEventListener("mouseleave", stop);
	}

	/**
	 * DAG canvas renderer — dagre LR layout, SVG bezier edges, absolute node cards.
	 *
	 * Diff strategy:
	 *   struct changed  → full dagre re-layout + card rebuild (new nodes animate in)
	 *   same struct     → patch body HTML in-place + brief pulse ring (zero blink)
	 */
	_render_flowchart(ast) {
		if (!this._$fc || !this._$fc.is(":visible") || !ast) return;
		if (!window.dagre) return;

		// Empty state — no doctype selected yet
		if (!ast.source.doctype) {
			this._$fc_empty.show();
			this._$fc_inner.hide();
			this._fc_prev_struct = null;
			return;
		}
		this._$fc_empty.hide();
		this._$fc_inner.show();

		const { nodes, edges } = this._fc_build_graph(ast);
		const struct_key = nodes.map(n => n.key).join(",") + "|" +
			edges.map(e => `${e.from}->${e.to}`).join(",");

		if (struct_key !== this._fc_prev_struct) {
			this._fc_full_rebuild(nodes, edges);
			this._fc_prev_struct = struct_key;
			this._fc_prev_fps = {};
			nodes.forEach(n => { this._fc_prev_fps[n.key] = n.fp; });
		} else {
			// Same structure — patch changed nodes only (no layout re-run, no blink)
			nodes.forEach(n => {
				if (n.fp === this._fc_prev_fps[n.key]) return;
				const $card = this._$fc_nl.find(`[data-key="${n.key}"]`);
				if (!$card.length) return;
				$card.find(".ev-fc-card-name").text(n.name);
				$card.find(".ev-fc-card-body").html(this._fc_sections_html(n.sections));
				$card.removeClass("ev-fc-card--pulse");
				void $card[0].offsetWidth;  // force reflow to restart animation
				$card.addClass("ev-fc-card--pulse");
				this._fc_prev_fps[n.key] = n.fp;
			});
		}
	}

	// ── DAG graph builder ─────────────────────────────────────────────────────

	_fc_build_graph(ast) {
		const nodes = [], edges = [];
		const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		let tail = null;  // current last node key; array = fan-in pending

		// Helper: push node + wire edge from tail
		const push = (n) => {
			n.h = this._fc_estimate_h(n.sections);
			n.w = 220;
			nodes.push(n);
			if (Array.isArray(tail)) {
				tail.forEach(t => edges.push({ from: t, to: n.key }));
			} else if (tail) {
				edges.push({ from: tail, to: n.key });
			}
			tail = n.key;
		};

		// SOURCE
		const sf = ast.source.fields.length;
		const src_items = sf
			? ast.source.fields.slice(0, 4).map(f => esc(f.label || f.fieldname))
				.concat(sf > 4 ? [`+${sf - 4} more`] : [])
			: ["(all fields)"];
		push({
			key: "source", type: "source", label: "Source",
			name: ast.source.doctype ? esc(ast.source.doctype) : "—",
			active: true,
			sections: [{ title: "Fields", items: src_items }],
			fp: `source|${ast.source.doctype}|${sf}`,
		});

		// JOINS
		ast.joins.forEach((j, ji) => {
			const items = j.src_field && j.tgt_field
				? [`${esc(j.src_field)} = ${esc(j.tgt_field)}`]
				: ["Condition not set"];
			push({
				key: `join_${ji}`, type: "join",
				label: `${j.join_type || "LEFT"} JOIN`,
				name: j.tgt_doctype ? esc(j.tgt_doctype) : "—",
				active: !!(j.tgt_doctype && j.src_field && j.tgt_field),
				sections: [{ title: "On", items }],
				fp: `join_${ji}|${j.tgt_doctype}|${j.src_field}|${j.tgt_field}`,
			});
		});

		// FILTER
		const cond_count = ast.where.groups.reduce((s, g) => s + g.conditions.length, 0);
		if (cond_count > 0) {
			const items = [];
			let shown = 0;
			outer: for (const g of ast.where.groups) {
				for (const c of g.conditions) {
					if (shown >= 3) { items.push(`+${cond_count - 3} more…`); break outer; }
					items.push(`${esc(c.fieldname)} ${c.operator} ${esc(c.value ?? "")}`);
					shown++;
				}
			}
			push({
				key: "filter", type: "filter", label: "Filter",
				name: `${cond_count} condition${cond_count !== 1 ? "s" : ""} · ${ast.where.logic}`,
				active: true,
				sections: [{ title: "Conditions", items }],
				fp: `filter|${cond_count}|${items.join("|")}`,
			});
		}

		// AGGREGATE
		if (ast.aggregate.enabled) {
			const gb = ast.aggregate.group_by.map(g => esc(g.label || g.fieldname));
			const aggs = ast.aggregate.aggregations.slice(0, 4)
				.map(a => `${a.fn}(${esc(a.fieldname)}) → ${esc(a.alias)}`);
			if (ast.aggregate.aggregations.length > 4)
				aggs.push(`+${ast.aggregate.aggregations.length - 4} more…`);
			push({
				key: "aggregate", type: "aggregate", label: "Aggregate",
				name: `GROUP BY ${gb.slice(0, 2).join(", ") || "—"}`,
				active: true,
				sections: [
					gb.length ? { title: "Group By", items: gb.slice(0, 3).concat(gb.length > 3 ? [`+${gb.length - 3} more`] : []) } : null,
					aggs.length ? { title: "Aggregations", items: aggs } : null,
				].filter(Boolean),
				fp: `agg|${gb.join()}|${aggs.join()}`,
			});
		}

		// WINDOW FUNCTIONS — one node per function → fan-out then fan-in
		if (ast.windows.length) {
			const fan_from = Array.isArray(tail) ? tail[tail.length - 1] : tail;
			const window_keys = [];

			ast.windows.forEach((w, wi) => {
				const _str = v => typeof v === "string" ? v : (v?.fieldname || v?.label || v?.alias || String(v));
				const pb = (w.partition_by || []).filter(Boolean).map(v => esc(_str(v)));
				const ob = (w.order_by || []).filter(Boolean).map(v => esc(_str(v)));
				const sections = [
					{ title: "Result", items: [`${w.fn || "FN"}(${esc(w.fieldname || "")}) → ${esc(w.alias || "")}`] },
				];
				if (pb.length) sections.push({ title: "Partition By", items: pb });
				if (ob.length) sections.push({ title: "Order By", items: ob });
				if (w.frame) sections.push({ title: "Frame", items: [esc(w.frame)] });

				const wk = `window_${wi}`;
				window_keys.push(wk);
				nodes.push({
					key: wk, type: "window",
					label: `WINDOW · ${esc(w.alias || w.fn || "FN")}`,
					name: `${w.fn || ""}(${esc(w.fieldname || "")})`,
					active: true, sections,
					w: 220, h: this._fc_estimate_h(sections),
					fp: `win_${wi}|${w.fn}|${w.fieldname}|${w.alias}|${pb.join()}|${ob.join()}`,
				});
				edges.push({ from: fan_from, to: wk });
			});

			tail = window_keys;  // fan-in: next push() connects from all window nodes
		}

		// COMPUTE
		if (ast.compute.length) {
			const items = ast.compute.slice(0, 4).map(cp => esc(cp.alias || "—"));
			if (ast.compute.length > 4) items.push(`+${ast.compute.length - 4} more…`);
			push({
				key: "compute", type: "compute", label: "Compute",
				name: `${ast.compute.length} derived column${ast.compute.length !== 1 ? "s" : ""}`,
				active: true,
				sections: [{ title: "Expressions", items }],
				fp: `compute|${ast.compute.length}|${items.join("|")}`,
			});
		} else if (Array.isArray(tail)) {
			tail = tail[tail.length - 1];  // collapse window fan-in if no compute
		}

		// SORT
		const real_sorts = ast.sort.filter(s => s.fieldname_or_alias);
		if (real_sorts.length) {
			const items = real_sorts.slice(0, 4)
				.map(s => `${esc(s.fieldname_or_alias)} ${s.direction}`);
			if (real_sorts.length > 4) items.push(`+${real_sorts.length - 4} more…`);
			push({
				key: "sort", type: "sort", label: "Sort",
				name: `${real_sorts.length} field${real_sorts.length !== 1 ? "s" : ""}`,
				active: true,
				sections: [{ title: "Order By", items }],
				fp: `sort|${items.join("|")}`,
			});
		}

		// OUTPUT (always)
		push({
			key: "output", type: "output", label: "Output",
			name: esc(ast.output?.sheet_name || "Query Result"),
			active: !!ast.source.doctype,
			sections: [{ title: "Limit", items: [`${(ast.limit || 10000).toLocaleString()} rows`] }],
			fp: `output|${ast.output?.sheet_name}|${ast.limit}`,
		});

		return { nodes, edges };
	}

	_fc_estimate_h(sections) {
		let h = 52;  // header
		(sections || []).forEach(s => {
			h += 22;  // section title
			h += (s.items || []).length * 20;
		});
		return Math.max(h + 12, 72);
	}

	// ── Full dagre-based rebuild ──────────────────────────────────────────────

	_fc_full_rebuild(nodes, edges) {
		const g = new window.dagre.graphlib.Graph();
		g.setGraph({ rankdir: "LR", nodesep: 56, ranksep: 110, marginx: 56, marginy: 56 });
		g.setDefaultEdgeLabel(() => ({}));
		nodes.forEach(n => g.setNode(n.key, { width: n.w, height: n.h }));
		edges.forEach(e => g.setEdge(e.from, e.to));
		window.dagre.layout(g);

		const gw = g.graph().width + 80;
		const gh = g.graph().height + 80;

		this._$fc_inner.css({ width: gw, height: gh });
		this._$fc_svg.attr({ width: gw, height: gh }).css({ width: gw, height: gh });
		this._$fc_nl.css({ width: gw, height: gh });

		// ── Render node cards ────────────────────────────────────────────────
		this._$fc_nl.empty();
		nodes.forEach(n => {
			const pos = g.node(n.key);
			const left = Math.round(pos.x - n.w / 2);
			const top  = Math.round(pos.y - n.h / 2);
			const $card = $(this._fc_node_html(n));
			$card.css({ left, top, width: n.w });
			this._$fc_nl.append($card);
		});

		// ── Draw SVG bezier edges ────────────────────────────────────────────
		const is_dark = document.documentElement.getAttribute("data-theme") === "dark";
		const arw_fill = is_dark ? "#484f58" : "#94a3b8";
		this._$fc_svg.find("defs").html(`
			<marker id="ev-fc-arw" viewBox="0 0 8 8" refX="7" refY="4"
			        markerWidth="6" markerHeight="6" orient="auto-start-reverse">
				<path d="M0,1 L7,4 L0,7 Z" fill="${arw_fill}"/>
			</marker>`);
		this._$fc_svg.find("path.ev-fc-edge").remove();

		const node_map = new Map(nodes.map(n => [n.key, n]));
		edges.forEach(e => {
			const s = g.node(e.from), t = g.node(e.to);
			if (!s || !t) return;
			const sw = (node_map.get(e.from)?.w || 220);
			const tw = (node_map.get(e.to)?.w || 220);
			const x1 = s.x + sw / 2, y1 = s.y;
			const x2 = t.x - tw / 2, y2 = t.y;
			const cp = Math.abs(x2 - x1) * 0.45;
			const d = `M${x1},${y1} C${x1 + cp},${y1} ${x2 - cp},${y2} ${x2},${y2}`;
			const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
			path.setAttribute("d", d);
			path.setAttribute("class", "ev-fc-edge");
			path.setAttribute("fill", "none");
			path.setAttribute("marker-end", "url(#ev-fc-arw)");
			this._$fc_svg[0].appendChild(path);
		});
	}

	// ── Node card HTML ────────────────────────────────────────────────────────

	_fc_sections_html(sections) {
		if (!sections?.length) return "";
		return sections.map(s => `
			<div class="ev-fc-section">
				${s.title ? `<div class="ev-fc-section-title">${s.title}<span class="ev-fc-section-count">${s.items.length}</span></div>` : ""}
				<div class="ev-fc-section-items">${(s.items || []).map(item => `<span class="ev-fc-chip">${item}</span>`).join("")}</div>
			</div>`).join("");
	}

	_fc_node_html(node) {
		const ICONS = {
			source:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="14" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="M4 5h8M4 8h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`,
			join:      `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="5.5" cy="8" r="4" stroke="currentColor" stroke-width="1.4"/><circle cx="10.5" cy="8" r="4" stroke="currentColor" stroke-width="1.4"/></svg>`,
			filter:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4.5 8h7M7 12h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
			aggregate: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 13V8M6 13V5M9 13V7M12 13V3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
			window:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M1 7h14" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 7v6" stroke="currentColor" stroke-width="1.3"/></svg>`,
			compute:   `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M8 3v10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="3" cy="4" r="1" fill="currentColor"/><circle cx="13" cy="12" r="1" fill="currentColor"/></svg>`,
			sort:      `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 4h7M3 8h5M3 12h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M12 3v10M9 10l3 3 3-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
			output:    `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 10l4-4 3 3 4-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/></svg>`,
		};
		const inactive_cls = node.active ? "" : " ev-fc-card--inactive";
		return `
			<div class="ev-fc-card ev-fc-card--${node.type}${inactive_cls}" data-key="${node.key}">
				<div class="ev-fc-card-header">
					<span class="ev-fc-card-hicon">${ICONS[node.type] || ""}</span>
					<div class="ev-fc-card-head-text">
						<div class="ev-fc-card-type">${node.label}</div>
						<div class="ev-fc-card-name">${node.name}</div>
					</div>
				</div>
				<div class="ev-fc-card-body">${this._fc_sections_html(node.sections)}</div>
			</div>`;
	}

	/**
	 * Execute a QueryAST via DuckDB — bulk-fetch required tables,
	 * run SQL, push results to a new sheet tab.
	 */
	async _run_ast_query(ast) {
		const errors = ast.validate();
		if (errors.length) {
			frappe.msgprint({ title: __("Query Errors"), message: errors.join("<br>"), indicator: "red" });
			return;
		}
		frappe.show_alert({ message: __("Running query…"), indicator: "blue" }, 3);
		try {
			const engine = frappe.views.excel.duckdb_v2;
			const { headers, rows, query_ms } = await engine.run_ast(ast);
			this._show_query_preview(headers, rows, query_ms, ast);
		} catch (e) {
			frappe.msgprint({ title: __("Query Failed"), message: e.message, indicator: "red" });
		}
	}

	/**
	 * Show an inline query result preview inside the canvas overlay.
	 * User can inspect the data, then click "Apply to Sheet" to create a new tab,
	 * or "Dismiss" to discard.
	 */
	_show_query_preview(headers, rows, query_ms, ast) {
		this.$overlay.find(".ev-qfp-result-panel").remove();

		const PREVIEW_LIMIT = 500;
		const preview_rows = rows.slice(0, PREVIEW_LIMIT);
		const truncated = rows.length > PREVIEW_LIMIT;

		// Value formatter — null/undefined → empty, numbers right-aligned
		const fmt_val = v => {
			if (v === null || v === undefined || v === "") return "";
			return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
		};
		const is_numeric = v => v !== null && v !== undefined && v !== "" && !isNaN(Number(v));

		// Column header row
		const th_html = [
			`<th class="ev-qr-th ev-qr-th--rownum">#</th>`,
			...headers.map(h => `<th class="ev-qr-th">${fmt_val(h)}</th>`),
		].join("");

		// Data rows
		const tbody_html = preview_rows.length
			? preview_rows.map((r, ri) => {
				const row_cls = `ev-qr-row${ri % 2 ? " ev-qr-row--alt" : ""}`;
				const tds = [
					`<td class="ev-qr-td ev-qr-td--rownum">${ri + 1}</td>`,
					...headers.map((_, ci) => {
						const v = r[ci];
						const num = is_numeric(v);
						return `<td class="ev-qr-td${num ? " ev-qr-td--num" : ""}">${fmt_val(v)}</td>`;
					}),
				].join("");
				return `<tr class="${row_cls}">${tds}</tr>`;
			}).join("")
			: `<tr><td colspan="${headers.length + 1}" class="ev-prev-empty">${__("No rows returned")}</td></tr>`;

		const sheet_name = ast.output?.sheet_name || "Query Result";
		const total_label = rows.length.toLocaleString();
		const col_label = headers.length;

		const $panel = $(`
			<div class="ev-qfp-result-panel">
				<div class="ev-qfp-result-hdr">
					<div class="ev-qfp-result-title">
						<svg width="13" height="13" viewBox="0 0 16 16" fill="none" style="flex-shrink:0"><rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M4 5h8M4 8h8M4 11h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
						<span>${__("Query Result")}</span>
					</div>
					<div class="ev-qfp-result-pills">
						<span class="ev-qfp-result-pill">${total_label} ${__("rows")}</span>
						<span class="ev-qfp-result-pill">${col_label} ${__("cols")}</span>
						<span class="ev-qfp-result-pill ev-qfp-result-pill--time">${query_ms}ms</span>
					</div>
					<button class="ev-qfp-result-close" title="${__("Dismiss")}">
						<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
					</button>
				</div>
				<div class="ev-qfp-result-body">
					<div class="ev-qr-scroll">
						<table class="ev-qr-table">
							<thead><tr>${th_html}</tr></thead>
							<tbody>${tbody_html}</tbody>
						</table>
					</div>
				</div>
				<div class="ev-qfp-result-footer">
					<span class="ev-qfp-result-hint">
						${truncated ? `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-2px;margin-right:4px"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 3.5a.75.75 0 110 1.5.75.75 0 010-1.5zm0 2.75a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0V8a.75.75 0 01.75-.75z"/></svg>Showing first ${PREVIEW_LIMIT.toLocaleString()} of ${total_label} rows` : `All ${total_label} rows shown`}
					</span>
					<div class="ev-qfp-result-actions">
						<button class="ev-qfp-result-btn ev-qfp-result-btn--ghost ev-qfp-result-dismiss">${__("Dismiss")}</button>
						<button class="ev-qfp-result-btn ev-qfp-result-btn--primary ev-qfp-result-apply">
							<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-2px;margin-right:5px"><path d="M2 3.75C2 2.784 2.784 2 3.75 2h8.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0112.25 14h-8.5A1.75 1.75 0 012 12.25zm1.75-.25a.25.25 0 00-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25v-8.5a.25.25 0 00-.25-.25zM7 10.5a.75.75 0 011.5 0v2h2a.75.75 0 010 1.5H6.25a.75.75 0 010-1.5H7z"/></svg>
							${__("Apply to Sheet")}
						</button>
					</div>
				</div>
			</div>
		`);

		const dismiss = () => $panel.remove();
		$panel.find(".ev-qfp-result-close").on("click", dismiss);
		$panel.find(".ev-qfp-result-dismiss").on("click", dismiss);

		$panel.find(".ev-qfp-result-apply").on("click", () => {
			const sm = this.board?.sheet_manager;
			const col_configs = headers.map(h => ({
				data:  h,
				title: h,
				type:  "text",
				width: Math.min(200, Math.max(80, h.length * 9)),
			}));
			const row_objects = rows.map(r => {
				const obj = {};
				headers.forEach((h, i) => { obj[h] = r[i] ?? ""; });
				return obj;
			});
			if (sm) {
				// Pass serialized AST so sheet re-runs against fresh data on page restore
				// instead of persisting the entire row set in user_settings.
				const serialized_ast = JSON.stringify(ast);
				sm.add_blank_sheet_with_data(sheet_name, col_configs, row_objects, null, serialized_ast);
				frappe.show_alert({ message: __(`Created "${sheet_name}" — ${rows.length} rows`), indicator: "green" }, 4);
				this.close();
			} else {
				frappe.msgprint({ title: __("No Sheet"), message: __("Open a workbook to receive the data."), indicator: "orange" });
			}
		});

		this.$overlay.append($panel);
	}

	// ── V3: Helper / Layout / SQL / FlowPanel ─────────────────────────────────

	/**
	 * Returns up to 8 non-system, non-structural fields from a DocType's meta.
	 * Used for auto-inclusion when user hasn't checked any fields yet.
	 */
	_get_default_fields(doctype) {
		if (!doctype) return [];
		const meta = frappe.get_meta(doctype);
		if (!meta) return [];
		const SKIP = new Set(["Column Break", "Section Break", "Tab Break", "HTML",
			"Table", "Table MultiSelect", "Password", "Fold", "Heading", "Custom HTML"]);
		const SYS = new Set(["name", "owner", "creation", "modified", "modified_by",
			"docstatus", "idx", "parentfield", "parenttype"]);
		return (meta.fields || [])
			.filter(f => !SKIP.has(f.fieldtype) && !f.is_virtual && !SYS.has(f.fieldname))
			.slice(0, 8)
			.map(f => f.fieldname);
	}

	/**
	 * Auto-layout canvas nodes using dagre graph layout algorithm.
	 * Arranges nodes left-to-right in a clean DAG matching edge topology.
	 */
	_auto_layout() {
		// Lazy-load dagre (imported via bundle)
		if (!window.dagre) {
			frappe.show_alert({ message: __("Layout engine loading…"), indicator: "blue" }, 2);
			return;
		}
		const g = new window.dagre.graphlib.Graph();
		g.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 30, marginx: 40, marginy: 40 });
		g.setDefaultEdgeLabel(() => ({}));

		const NODE_W = 270, NODE_H = 360;
		this.nodes.forEach((node, id) => {
			g.setNode(id, { width: NODE_W, height: NODE_H });
		});
		this.edges.forEach(e => {
			if (e.valid !== false) g.setEdge(e.src_node_id, e.tgt_node_id);
		});

		window.dagre.layout(g);

		this.nodes.forEach((node, id) => {
			const pos = g.node(id);
			if (!pos) return;
			node.el.style.left = (pos.x - NODE_W / 2) + "px";
			node.el.style.top  = (pos.y - NODE_H / 2) + "px";
		});
		this._render_edges();
		frappe.show_alert({ message: __("Layout applied"), indicator: "green" }, 2);
	}

	/**
	 * Toggle the SQL preview panel at the bottom of the canvas.
	 */
	_toggle_sql_panel() {
		const $panel = this.$overlay.find(".ev-jc-sql-panel");
		if ($panel.is(":visible")) {
			$panel.hide();
			this.$overlay.find(".ev-jc-sql-btn").removeClass("ev-jc-hbtn--active");
		} else {
			this._refresh_sql_panel();
			$panel.show();
			this.$overlay.find(".ev-jc-sql-btn").addClass("ev-jc-hbtn--active");
		}
	}

	/**
	 * Rebuild SQL panel content from current AST.
	 */
	_refresh_sql_panel() {
		const $panel = this.$overlay.find(".ev-jc-sql-panel");
		if (!$panel.length || !$panel.is(":visible")) return;

		let sql = "-- Configure source and joins in the Query Flow panel →";
		if (this._query_ast?.source?.doctype) {
			try {
				const gen = new frappe.views.excel.SQLGenerator(this._query_ast);
				sql = gen.generate();
			} catch (e) {
				sql = `-- ${e.message}`;
			}
		}
		$panel.find(".ev-jc-sql-code").text(sql);
	}

	/**
	 * Sync QueryFlowPanel from current canvas edge/node state.
	 */
	_sync_flow_panel() {
		if (!this._flow_panel) return;
		const cfg = this.get_join_config();
		this._flow_panel.sync_from_canvas({
			base_doctype: this.board.doctype,
			edges: (cfg.edges || []).map(e => {
				const tgt = cfg.nodes.find(n => n.id === e.tgt_node_id);
				const src = cfg.nodes.find(n => n.id === e.src_node_id);
				return {
					source_doctype: src?.doctype || this.board.doctype,
					source_field:   e.src_field,
					target_doctype: tgt?.doctype,
					target_field:   e.tgt_field,
				};
			}).filter(e => e.target_doctype),
		});
		this._refresh_sql_panel();
	}

	// ── Serialisation ─────────────────────────────────────────────────────────

	/**
	 * Serialise canvas to join_config.
	 * selected_fields is now read from the target node (per-node, F2).
	 * Only edges where valid===true AND target node has ≥1 selected field are included.
	 * node_positions is included for visual restoration when canvas is reopened.
	 */
	get_join_config() {
		// Base node selected_fields → controls which base columns to show after Apply
		const base_node = [...this.nodes.values()].find(n => n.doctype === this.board.doctype);
		const base_selected = base_node?.selected_fields.size
			? [...base_node.selected_fields]
			: null; // null = keep current HOT columns unchanged

		// Capture current node positions for layout restoration
		const node_positions = {};
		this.nodes.forEach((node, id) => {
			node_positions[id] = {
				x: node.el.offsetLeft,
				y: node.el.offsetTop,
			};
		});

		return {
			base_doctype:         this.board.doctype,
			base_selected_fields: base_selected,
			node_positions,
			nodes: [...this.nodes.values()].map(n => {
				const base_node_cfg = { id: n.id, doctype: n.doctype };
				if (n.doctype !== this.board.doctype) {
					// CT nodes carry aggregate_cols; regular nodes carry transform config
					const agg = this._get_node_aggregate_config(n.id);
					if (agg) {
						base_node_cfg.aggregate_cols = agg;
					} else {
						const tf = this._get_node_transform_config(n.id);
						if (tf.row_filter.length || tf.computed_cols.length) {
							base_node_cfg.row_filter    = tf.row_filter;
							base_node_cfg.computed_cols = tf.computed_cols;
						}
					}
				}
				return base_node_cfg;
			}),
			edges: this.edges
				.filter(e => e.valid === true)
				.map(e => {
					const tgt_node = this.nodes.get(e.tgt_node_id);
					// CT aggregate nodes: selected_fields = agg field names
					// (used by preview check and workbook serialisation; SQL ignores it)
					const agg = this._get_node_aggregate_config(e.tgt_node_id);
					const selected_fields = agg
						? agg.map(c => c.field)
						: [...(tgt_node?.selected_fields || [])];
					return {
						id:              e.id,
						src_node_id:     e.src_node_id,
						src_field:       e.src_field,
						tgt_node_id:     e.tgt_node_id,
						tgt_field:       e.tgt_field,
						selected_fields,
						confidence:      e.confidence,
						method:          e.method,
					};
				}),
		};
	}

	// ── Persistence — user_settings ───────────────────────────────────────────

	/**
	 * Save current canvas layout to user_settings for this DocType.
	 * Called automatically after every successful "Apply".
	 * Stored without base_names (those are dynamic, rebuilt on each apply).
	 *
	 * @param {Object} cfg - join_config from get_join_config()
	 */
	_save_to_user_settings(cfg) {
		// Omit base_names (if present) — they change every session
		const { base_names: _, ...save_cfg } = cfg;
		frappe.model.user_settings.save(
			this.board.doctype,
			"excel_join_config",
			save_cfg,
		);
	}

	/**
	 * Phase 4: Save canvas state to Canvas Session (collaborative).
	 * Broadcasts changes to all users in the session in real-time.
	 */
	_save_to_session() {
		// CRITICAL FIX: Prevent infinite loop
		// Don't save/broadcast if we're currently applying remote state
		if (this._applying_remote_state) {
			return;
		}

		if (!this.active_session_id) {
			console.warn('⚠️ No active session - cannot save to session');
			return;
		}

		// Get current canvas state (nodes, edges, positions)
		const canvas_state = this._get_canvas_state();
		const timestamp = Date.now();

		// Save to backend + broadcast to other users
		frappe.call({
			method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.update_canvas_state',
			args: {
				session_id: this.active_session_id,
				canvas_state: canvas_state,
				timestamp: timestamp
			},
			callback: (r) => {
				if (r.message && r.message.success) {
					// Update local timestamp for conflict resolution
					this._last_save_timestamp = r.message.timestamp || timestamp;
				}
			},
			error: (err) => {
				console.error('❌ Failed to save canvas state:', err);
				frappe.show_alert({
					message: __('Failed to save canvas changes'),
					indicator: 'red'
				});
			}
		});
	}

	/**
	 * Auto-save canvas layout to user_settings without requiring Apply.
	 * Called after every structural change (valid edge, node remove, node drag).
	 * Preserves nodes + positions + aggregate/transform config so refresh
	 * restores the exact canvas the user last worked on.
	 */
	_auto_save_layout() {
		// CRITICAL FIX: Prevent auto-save during remote state application
		// This prevents infinite loop when restoring edges triggers save
		if (this._applying_remote_state) {
			return;
		}

		const has_non_base = [...this.nodes.values()]
			.some(n => n.doctype !== this.board.doctype);

		if (has_non_base) {
			// Phase 4: If in a canvas session, save to session (collaborative)
			// Otherwise, save to user_settings (personal, backwards compatible)
			if (this.active_session_id) {
				this._save_to_session();
			} else {
				this._save_to_user_settings(this.get_join_config());
			}
		} else {
			// All non-base nodes removed — explicitly clear
			if (this.active_session_id) {
				// Clear session canvas state
				this._save_to_session();
			} else {
				// Clear user_settings
				frappe.model.user_settings.save(
					this.board.doctype,
					"excel_join_config",
					null,
				);
			}
		}
	}

	/**
	 * Check user_settings for a previously saved canvas layout and restore it.
	 * Called from open() after the base node is rendered.
	 */
	_restore_from_user_settings() {
		const saved = frappe.get_user_settings(this.board.doctype)?.excel_join_config;
		if (!saved?.nodes?.length) return;

		// Only restore if there are non-base nodes or edges to show
		const has_non_base = saved.nodes.some(n => n.doctype !== this.board.doctype);
		const has_edges    = saved.edges?.length > 0;
		if (!has_non_base && !has_edges) return;

		this._restore_from_config(saved);
	}

	/**
	 * Restore a saved canvas state (nodes, positions, edges, selected fields).
	 * Edges are re-validated so stale connections are auto-removed if data changed.
	 *
	 * @param {Object} cfg - join_config (with node_positions)
	 */
	_restore_from_config(cfg) {
		// Maps cfg node_id → newly created canvas node_id
		const node_id_map = {};

		// ── Restore base node mapping + position ──────────────────────────
		const base_canvas = [...this.nodes.values()].find(n => n.doctype === this.board.doctype);
		const cfg_base    = (cfg.nodes || []).find(n => n.doctype === this.board.doctype);
		if (base_canvas && cfg_base) {
			node_id_map[cfg_base.id] = base_canvas.id;
			// Restore saved position (support both formats: node_positions map and inline position)
			const pos = cfg.node_positions?.[cfg_base.id] || cfg_base.position;
			if (pos) {
				base_canvas.el.style.left = (pos.x ?? pos.left ?? 0) + "px";
				base_canvas.el.style.top  = (pos.y ?? pos.top ?? 0) + "px";
			}
			// Restore base node selected_fields (checkboxes)
			if (cfg.base_selected_fields?.length) {
				const fields_div = base_canvas.el.querySelector(".ev-jc-node-fields");
				cfg.base_selected_fields.forEach(f => {
					const cb = fields_div?.querySelector(`[data-field="${f}"] .ev-field-select`);
					if (cb && !cb.checked) {
						cb.checked = true;
						cb.dispatchEvent(new Event("change"));
					}
				});
			}
		}

		// ── Restore non-base nodes ────────────────────────────────────────
		const non_base = (cfg.nodes || []).filter(n => n.doctype !== this.board.doctype);
		if (!non_base.length) return;

		let loaded_count = 0;

		const _maybe_restore_edges = () => {
			if (loaded_count < non_base.length) return;
			// All nodes rendered — now restore edges
			(cfg.edges || []).forEach(edge => {
				const src_id = node_id_map[edge.src_node_id];
				const tgt_id = node_id_map[edge.tgt_node_id];
				if (!src_id || !tgt_id) return;

				const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
				const new_edge = {
					id:          `edge_${this._edge_ctr++}`,
					src_node_id: src_id,
					src_field:   edge.src_field,
					tgt_node_id: tgt_id,
					tgt_field:   edge.tgt_field,
					valid:       null,
					confidence:  null,
					method:      null,
					path_el,
					badge_el:    null,
					_remove_timer: null,
					_restored:   true,  // Flag: restored from config, skip auto-save on validate
				};
				this.edges.push(new_edge);
				// Re-validate: data may have changed since last session
				this._validate_edge(new_edge);
			});
			this._render_edges();
		};

		non_base.forEach(cfg_node => {
			frappe.model.with_doctype(cfg_node.doctype, () => {
				const new_id = this._add_node(cfg_node.doctype, { base: false });
				node_id_map[cfg_node.id] = new_id;

				// Restore position (support both formats: node_positions map and inline position)
				const pos = cfg.node_positions?.[cfg_node.id] || cfg_node.position;
				if (pos) {
					const node_el = this.nodes.get(new_id)?.el;
					if (node_el) {
						node_el.style.left = (pos.x ?? pos.left ?? 0) + "px";
						node_el.style.top  = (pos.y ?? pos.top ?? 0) + "px";
					}
				}

				// Restore selected_fields for this node (from edges targeting it)
				const canvas_node = this.nodes.get(new_id);
				if (canvas_node) {
					const fields_div = canvas_node.el.querySelector(".ev-jc-node-fields");
					(cfg.edges || [])
						.filter(e => e.tgt_node_id === cfg_node.id)
						.forEach(edge => {
							(edge.selected_fields || []).forEach(f => {
								const cb = fields_div?.querySelector(
									`[data-field="${f}"] .ev-field-select`
								);
								if (cb && !cb.checked) {
									cb.checked = true;
									cb.dispatchEvent(new Event("change"));
								}
							});
						});

					// Restore Aggregate panel (CT) or Transform panel (regular) — V2.5+
					if (cfg_node.aggregate_cols?.length || cfg_node.row_filter?.length || cfg_node.computed_cols?.length) {
						const meta    = frappe.get_meta(cfg_node.doctype);
						const is_ct   = !!meta?.istable;
						const SKIP    = new Set([
							"Column Break", "Section Break", "Tab Break", "Fold",
							"Heading", "HTML", "Custom HTML", "Table", "Table MultiSelect", "Password",
						]);
						const CHILD_SYS = new Set(["parent", "parenttype", "parentfield", "idx"]);
						const mfs = (meta?.fields || []).filter(
							df => !SKIP.has(df.fieldtype) && !df.is_virtual && df.fieldname !== "name"
								&& !(is_ct && CHILD_SYS.has(df.fieldname))
						);
						if (cfg_node.aggregate_cols?.length) {
							this._restore_aggregate_panel(new_id, cfg_node.aggregate_cols, mfs);
						} else {
							this._restore_transform_panel(new_id, {
								row_filter:    cfg_node.row_filter    || [],
								computed_cols: cfg_node.computed_cols || [],
							}, mfs);
						}
					}
				}


				loaded_count++;
				_maybe_restore_edges();
			});
		});
	}

	// ── V2.4.5 AI features ────────────────────────────────────────────────────

	/**
	 * Toggle the AI Discover suggestion panel.
	 * First click → spinner → API call → chips panel below header.
	 * Second click → panel collapses.
	 */
	_toggle_ai_discover() {
		// Toggle: close if already open
		if (this.$stage.find(".ev-jc-ai-drawer").length) {
			this.$stage.find(".ev-jc-ai-drawer").remove();
			this.$overlay.find(".ev-jc-ai-btn").removeClass("ev-jc-btn--active");
			return;
		}

		// Sidebar management: Close other sidebars/drawers when opening AI drawer
		this.$stage.find(".ev-jc-genbi-chat").remove();
		if (this.collab_sidebar_vue) {
			this.collab_sidebar_vue.hide();
		}

		this._fetch_and_render_suggestions(false);
	}

	/** Shared fetch helper used by toggle + refresh button + node target change. */
	_fetch_and_render_suggestions(force_refresh) {
		const $btn = this.$overlay.find(".ev-jc-ai-btn");
		$btn.prop("disabled", true).html(`⏳ ${__("Analyzing\u2026")}`);
		frappe.call({
			method: "excel_view.api.suggest_joins",
			args:   { base_doctype: this._get_ai_doctype(), force_refresh: force_refresh ? 1 : 0 },
			callback: (r) => {
				$btn.prop("disabled", false).html(`✨ ${__("AI")}`).addClass("ev-jc-btn--active");
				const suggestions = r.message || [];
				if (!suggestions.length) {
					frappe.show_alert({ message: __("No join candidates found"), indicator: "orange" });
					return;
				}
				this._render_suggest_panel(suggestions);
			},
		});
	}

	/**
	 * Render a right-side drawer with one card per suggestion.
	 * Drawer appends inside .ev-jc-stage (position:relative) so it overlays
	 * the canvas without pushing the header.
	 */
	_render_suggest_panel(suggestions) {
		this.$stage.find(".ev-jc-ai-drawer").remove();

		// Which DocTypes are already on the canvas?
		const added = new Set([...this.nodes.values()].map(n => n.doctype));

		const make_card = (s) => {
			const pct              = Math.round(s.score * 100);
			const is_child_parent  = s.method === "child_parent";
			const is_meta          = s.method === "meta";
			const is_ct            = s.method === "child_table";
			const is_added         = added.has(s.doctype);
			const via              = s.src_field !== "name"
				? `${s.src_field} → ${s.tgt_field}`
				: `via ${s.tgt_field}`;
			// child_parent uses same color as meta (both are high-confidence relationships)
			const stripe_cls  = is_ct ? "child_table" : ((is_meta || is_child_parent) ? "meta" : "ml");
			return `
				<div class="ev-jc-ai-card${is_added ? " ev-jc-card--added" : ""}"
				     data-doctype="${frappe.utils.escape_html(s.doctype)}">
					<div class="ev-jc-card-stripe ev-jc-card-stripe--${stripe_cls}"></div>
					<div class="ev-jc-card-body">
						<div class="ev-jc-card-name"
						     title="${frappe.utils.escape_html(s.doctype)}">
							${frappe.utils.escape_html(s.doctype)}
							${is_ct ? `<span class="ev-jc-ct-badge ev-jc-ct-badge--card" title="${__("Child Table")}">CT</span>` : ""}
						</div>
						<div class="ev-jc-card-via"
						     title="${frappe.utils.escape_html(s.reason)}">
							${frappe.utils.escape_html(via)}
						</div>
						<div class="ev-jc-card-bar-wrap">
							<div class="ev-jc-card-bar${is_meta || is_child_parent || is_ct ? "" : " ev-jc-card-bar--ml"}"
							     style="width:${pct}%"></div>
						</div>
					</div>
					<div class="ev-jc-card-actions">
						<span class="ev-jc-card-pct">${pct}%</span>
						${is_added
							? `<span class="ev-jc-card-check" title="${__("Already on canvas")}">✓</span>`
							: `<button class="btn btn-xs btn-primary ev-jc-card-add">${__("+ Add")}</button>`}
					</div>
				</div>`;
		};

		const child_parent_count = suggestions.filter(s => s.method === "child_parent").length;
		const meta_count         = suggestions.filter(s => s.method === "meta").length;
		const ct_count           = suggestions.filter(s => s.method === "child_table").length;
		const ml_count           = suggestions.filter(s => s.method === "ml").length;
		const count_label = [
			child_parent_count ? `${child_parent_count} Parent` : "",
			meta_count         ? `${meta_count} Link`           : "",
			ct_count           ? `${ct_count} CT`               : "",
			ml_count           ? `${ml_count} ML`               : "",
		].filter(Boolean).join(" · ") || "0";
		const for_dt      = this._get_ai_doctype();

		const $drawer = $(`
			<div class="ev-jc-ai-drawer">
				<div class="ev-jc-ai-drawer-head">
					<div class="ev-jc-ai-drawer-title">
						<span>✨ ${__("AI Suggestions")}</span>
						<span class="ev-jc-ai-drawer-sub">${frappe.utils.escape_html(count_label)}</span>
					</div>
					<div class="ev-jc-ai-drawer-head-actions">
						<button class="btn btn-xs btn-default ev-jc-ai-drawer-refresh"
						        title="${__("Refresh — bust 5-min schema cache")}">↻</button>
						<button class="btn btn-xs btn-default ev-jc-ai-drawer-close"
						        title="${__("Close")}">✕</button>
					</div>
				</div>
				<div class="ev-jc-ai-drawer-for">
					${__("for")}:
					<strong>${frappe.utils.escape_html(for_dt)}</strong>
					<span class="ev-jc-ai-drawer-for-hint">
						${__("(click ✨ on any node to change)")}
					</span>
				</div>
				<div class="ev-jc-ai-drawer-search-wrap">
					<input class="ev-jc-ai-drawer-search form-control form-control-sm"
					       type="text" placeholder="${__("Filter…")}">
				</div>
				<div class="ev-jc-ai-drawer-body">
					${suggestions.map(make_card).join("")}
				</div>
			</div>
		`);

		// Close button
		$drawer.find(".ev-jc-ai-drawer-close").on("click", () => {
			$drawer.remove();
			this.$overlay.find(".ev-jc-ai-btn").removeClass("ev-jc-btn--active");
		});

		// Refresh button — bust Redis cache + re-fetch
		$drawer.find(".ev-jc-ai-drawer-refresh").on("click", () => {
			$drawer.remove();
			this._fetch_and_render_suggestions(true);
		});

		// Real-time filter
		$drawer.find(".ev-jc-ai-drawer-search").on("input", function () {
			const q = this.value.toLowerCase();
			$drawer.find(".ev-jc-ai-card").each(function () {
				$(this).toggle(!q || $(this).data("doctype").toLowerCase().includes(q));
			});
		});

		// "+ Add" button on each card
		$drawer.on("click", ".ev-jc-card-add", (e) => {
			const $card = $(e.currentTarget).closest(".ev-jc-ai-card");
			const dt    = $card.data("doctype");
			const s     = suggestions.find(x => x.doctype === dt);
			if (!s) return;
			// Mark card as added inline — drawer stays open so user can add more
			$card.addClass("ev-jc-card--added");
			$(e.currentTarget).replaceWith(
				`<span class="ev-jc-card-check" title="${__("Added")}">✓</span>`
			);
			added.add(dt);
			this._add_suggested_node(s);
		});

		this.$stage.append($drawer);
	}

	/**
	 * Auto-add a DocType node and draw a validated edge from an AI suggestion.
	 * @param {Object} s - {doctype, src_field, tgt_field}
	 */
	_add_suggested_node(s) {
		frappe.model.with_doctype(s.doctype, () => {
			const new_id   = this._add_node(s.doctype, { base: false });
			// Use the AI-target node as source; fall back to base node
			const src_node = this.nodes.get(this._ai_target_node_id)
				|| [...this.nodes.values()].find(n => n.doctype === this.board.doctype);
			if (!src_node) return;
			// Defer one tick so the node DOM is fully painted before port positioning
			setTimeout(() => {
				const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
				const edge = {
					id:            `edge_${this._edge_ctr++}`,
					src_node_id:   src_node.id,
					src_field:     s.src_field,
					tgt_node_id:   new_id,
					tgt_field:     s.tgt_field,
					valid:         null,
					confidence:    null,
					method:        null,
					path_el,
					badge_el:      null,
					_remove_timer: null,
				};
				this.edges.push(edge);
				this._validate_edge(edge);
			}, 50);
		});
	}

	/**
	 * Prompt for a target DocType, then call find_join_path and auto-build
	 * all intermediate nodes + edges on the canvas.
	 */
	_run_find_path() {
		frappe.prompt(
			[{
				label:     __("Target DocType"),
				fieldname: "target",
				fieldtype: "Link",
				options:   "DocType",
				reqd:      1,
			}],
			(vals) => {
				if (vals.target === this.board.doctype) {
					frappe.show_alert({ message: __("Target must differ from base DocType"), indicator: "orange" });
					return;
				}
				frappe.call({
					method: "excel_view.api.find_join_path",
					args:   { src_doctype: this.board.doctype, tgt_doctype: vals.target },
					callback: (r) => {
						const hops = r.message || [];
						if (!hops.length) {
							frappe.show_alert({
								message:   __("No link path found between {0} and {1}", [this.board.doctype, vals.target]),
								indicator: "red",
							}, 4);
							return;
						}
						this._build_path_chain(hops);
					},
				});
			},
			__("Find Join Path"),
			__("Find Path")
		);
	}

	/**
	 * Add missing nodes and wire all hops from find_join_path.
	 * @param {Array} hops - [{from_doctype, to_doctype, src_field, tgt_field}]
	 */
	_build_path_chain(hops) {
		const node_id_by_dt = Object.fromEntries(
			[...this.nodes.values()].map(n => [n.doctype, n.id])
		);
		const to_add = hops.map(h => h.to_doctype).filter(dt => !node_id_by_dt[dt]);
		let loaded = 0;

		const _try_wire = () => {
			if (loaded < to_add.length) return;
			hops.forEach(hop => {
				const src_id = node_id_by_dt[hop.from_doctype];
				const tgt_id = node_id_by_dt[hop.to_doctype];
				if (!src_id || !tgt_id) return;
				// Skip duplicate edges
				const dup = this.edges.some(e =>
					e.src_node_id === src_id && e.src_field === hop.src_field &&
					e.tgt_node_id === tgt_id && e.tgt_field === hop.tgt_field
				);
				if (dup) return;
				const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
				const edge = {
					id:            `edge_${this._edge_ctr++}`,
					src_node_id:   src_id, src_field: hop.src_field,
					tgt_node_id:   tgt_id, tgt_field: hop.tgt_field,
					valid: null, confidence: null, method: null,
					path_el, badge_el: null, _remove_timer: null,
				};
				this.edges.push(edge);
				this._validate_edge(edge);
			});
		};

		if (!to_add.length) { _try_wire(); return; }
		to_add.forEach(dt => {
			frappe.model.with_doctype(dt, () => {
				const new_id = this._add_node(dt, { base: false });
				node_id_by_dt[dt] = new_id;
				loaded++;
				_try_wire();
			});
		});
	}

	/** Call mine_join_patterns API and show rules in a dialog. */
	_run_pattern_mining() {
		const cfg = this.get_join_config();
		if (!cfg.edges.filter(e => e.valid).length) {
			frappe.show_alert({ message: __("Apply a join first before discovering patterns"), indicator: "orange" });
			return;
		}
		const $btn = this.$overlay.find(".ev-jc-patterns-btn");
		$btn.prop("disabled", true).html(`⏳ ${__("Mining\u2026")}`);

		frappe.call({
			method: "excel_view.api.mine_join_patterns",
			args: {
				base_doctype:   this.board.doctype,
				join_config:    JSON.stringify(cfg),
				min_support:    0.1,
				min_confidence: 0.5,
			},
			callback: (r) => {
				$btn.prop("disabled", false).html(`📊 ${__("Patterns")}`);
				const rules = r.message || [];
				if (!rules.length) {
					frappe.show_alert({
						message:   __("No strong patterns found — add more records or check field selection"),
						indicator: "blue",
					}, 4);
					return;
				}
				this._show_patterns_dialog(rules);
			},
		});
	}

	// ── V2.5 AI Analysis Panel ────────────────────────────────────────────────

	/**
	 * Open the AI Analysis panel (Anomaly Detection + Clustering).
	 * Right-side drawer appended to this.$stage, same pattern as AI Discover drawer.
	 * Uses current board.list_view.data (post-Apply joined rows).
	 */
	_open_analyze_panel() {
		const data = this.board.list_view.data || [];
		if (!data.length) {
			frappe.show_alert({ message: __("Apply a join first to populate data for analysis"), indicator: "orange" }, 4);
			return;
		}

		// Remove any existing panel
		this.$stage.find(".ev-jc-analyze-drawer").remove();

		// Detect numeric fields from the first row
		const sample = data[0] || {};
		const numeric_fields = Object.keys(sample).filter(k => {
			if (k.startsWith("_")) return false;
			const v = sample[k];
			return typeof v === "number" || (typeof v === "string" && v !== "" && !isNaN(Number(v)));
		});

		if (!numeric_fields.length) {
			frappe.show_alert({ message: __("No numeric columns found in joined data for analysis"), indicator: "orange" }, 4);
			return;
		}

		const field_opts = numeric_fields.map(f =>
			`<label class="ev-ai-field-cb">
				<input type="checkbox" value="${frappe.utils.escape_html(f)}" checked>
				${frappe.utils.escape_html(f)}
			</label>`
		).join("");

		const drawer = document.createElement("div");
		drawer.className = "ev-jc-analyze-drawer";
		drawer.innerHTML = `
			<div class="ev-jc-analyze-header">
				<span>🤖 ${__("AI Analysis")}</span>
				<button class="ev-jc-analyze-close btn btn-xs">✕</button>
			</div>
			<div class="ev-jc-analyze-tabs">
				<button class="ev-jc-atab active" data-tab="anomaly">${__("Anomaly Detection")}</button>
				<button class="ev-jc-atab"         data-tab="cluster">${__("Clustering")}</button>
			</div>

			<div class="ev-jc-atab-body" data-tab="anomaly">
				<div class="ev-ai-label">${__("Numeric columns to analyze:")}</div>
				<div class="ev-ai-fields">${field_opts}</div>
				<div class="ev-ai-label">${__("Contamination (anomaly fraction):")}</div>
				<input type="range" class="ev-ai-contamination" min="5" max="30" value="10" step="1">
				<span class="ev-ai-contam-val">10%</span>
				<button class="btn btn-sm btn-primary ev-ai-run-anomaly" style="margin-top:8px;width:100%">
					${__("Run Anomaly Detection")}
				</button>
				<div class="ev-ai-result-anomaly"></div>
			</div>

			<div class="ev-jc-atab-body" data-tab="cluster" style="display:none">
				<div class="ev-ai-label">${__("Numeric columns to analyze:")}</div>
				<div class="ev-ai-fields">${field_opts.replace(/ checked/g, "")}</div>
				<div class="ev-ai-label">${__("Number of clusters:")}</div>
				<select class="ev-ai-k-select form-control form-control-sm" style="width:auto">
					<option value="0">${__("Auto (silhouette)")}</option>
					${[2,3,4,5,6].map(k => `<option value="${k}">${k}</option>`).join("")}
				</select>
				<button class="btn btn-sm btn-primary ev-ai-run-cluster" style="margin-top:8px;width:100%">
					${__("Run Clustering")}
				</button>
				<div class="ev-ai-result-cluster"></div>
			</div>
		`;
		this.$stage[0].appendChild(drawer);

		// Close button
		drawer.querySelector(".ev-jc-analyze-close").addEventListener("click", () => {
			drawer.remove();
		});

		// Tab switching
		drawer.querySelectorAll(".ev-jc-atab").forEach(btn => {
			btn.addEventListener("click", () => {
				drawer.querySelectorAll(".ev-jc-atab").forEach(b => b.classList.remove("active"));
				btn.classList.add("active");
				const tab = btn.dataset.tab;
				drawer.querySelectorAll(".ev-jc-atab-body").forEach(body => {
					body.style.display = body.dataset.tab === tab ? "block" : "none";
				});
			});
		});

		// Contamination slider label
		const slider = drawer.querySelector(".ev-ai-contamination");
		const label  = drawer.querySelector(".ev-ai-contam-val");
		slider.addEventListener("input", () => { label.textContent = `${slider.value}%`; });

		// ── Run Anomaly Detection ──────────────────────────────────────────
		drawer.querySelector(".ev-ai-run-anomaly").addEventListener("click", () => {
			const selected = [...drawer.querySelectorAll(".ev-jc-atab-body[data-tab=anomaly] .ev-ai-field-cb input:checked")]
				.map(cb => cb.value);
			if (!selected.length) {
				frappe.show_alert({ message: __("Select at least one numeric column"), indicator: "orange" }, 3);
				return;
			}
			const contamination = parseInt(slider.value) / 100;
			const result_el = drawer.querySelector(".ev-ai-result-anomaly");
			result_el.innerHTML = `<div class="ev-ai-spinner">⏳ ${__("Running…")}</div>`;

			frappe.call({
				method: "excel_view.api.detect_anomalies",
				args: {
					rows:             JSON.stringify(data),
					numeric_fields:   JSON.stringify(selected),
					contamination,
				},
				callback: (r) => {
					const enriched = r.message || [];
					if (!enriched.length) {
						result_el.innerHTML = `<div class="ev-ai-info">${__("Not enough data (min 5 rows)")}</div>`;
						return;
					}
					// Inject anomaly columns into board data
					enriched.forEach((row, i) => {
						if (data[i]) {
							data[i]._anomaly_score = row._anomaly_score;
							data[i]._is_anomaly    = row._is_anomaly;
						}
					});
					this.board.hot?.render();

					const anomaly_count = enriched.filter(r => r._is_anomaly).length;
					result_el.innerHTML = `
						<div class="ev-ai-info ev-ai-info--success">
							${__("Found {0} anomalous rows ({1}% threshold)", [
								anomaly_count,
								Math.round(contamination * 100),
							])}
						</div>
						<div class="ev-ai-info" style="font-size:11px;color:var(--text-muted)">
							${__("Rows highlighted in red in the grid.")}
						</div>
					`;
				},
				error: () => {
					result_el.innerHTML = `<div class="ev-ai-info ev-ai-info--error">${__("Analysis failed — check that scikit-learn is installed")}</div>`;
				},
			});
		});

		// ── Run Clustering ─────────────────────────────────────────────────
		drawer.querySelector(".ev-ai-run-cluster").addEventListener("click", () => {
			const selected = [...drawer.querySelectorAll(".ev-jc-atab-body[data-tab=cluster] .ev-ai-field-cb input:checked")]
				.map(cb => cb.value);
			if (!selected.length) {
				frappe.show_alert({ message: __("Select at least one numeric column"), indicator: "orange" }, 3);
				return;
			}
			const k = parseInt(drawer.querySelector(".ev-ai-k-select").value);
			const result_el = drawer.querySelector(".ev-ai-result-cluster");
			result_el.innerHTML = `<div class="ev-ai-spinner">⏳ ${__("Running…")}</div>`;

			frappe.call({
				method: "excel_view.api.cluster_data",
				args: {
					rows:           JSON.stringify(data),
					numeric_fields: JSON.stringify(selected),
					n_clusters:     k,
				},
				callback: (r) => {
					const result = r.message || {};
					const enriched = result.rows || [];
					if (!enriched.length) {
						result_el.innerHTML = `<div class="ev-ai-info">${__("Not enough data (min 6 rows)")}</div>`;
						return;
					}
					// Inject cluster column into board data
					enriched.forEach((row, i) => {
						if (data[i]) data[i]._cluster = row._cluster;
					});
					this.board.hot?.render();

					const k_used = result.n_clusters;
					const summary = result.summary || [];
					const summary_html = summary.map(s => {
						const centroid_vals = selected.map(f => `${f}: <b>${s[f]?.toFixed(2) ?? "–"}</b>`).join(", ");
						return `<li>Cluster ${s.cluster}: ${centroid_vals}</li>`;
					}).join("");

					result_el.innerHTML = `
						<div class="ev-ai-info ev-ai-info--success">
							${__("Grouped into {0} clusters. Column _cluster added to grid.", [k_used])}
						</div>
						<ul class="ev-ai-summary" style="font-size:11px;margin-top:6px">${summary_html}</ul>
					`;
				},
				error: () => {
					result_el.innerHTML = `<div class="ev-ai-info ev-ai-info--error">${__("Clustering failed — check that scikit-learn is installed")}</div>`;
				},
			});
		});
	}

	/** Render the association rules dialog table. */
	_show_patterns_dialog(rules) {
		const rows_html = rules.map(r => `
			<tr>
				<td>${r.antecedents.map(a => `<code>${frappe.utils.escape_html(a)}</code>`).join(" AND ")}</td>
				<td>${r.consequents.map(c => `<code>${frappe.utils.escape_html(c)}</code>`).join(", ")}</td>
				<td>${Math.round(r.support * 100)}%</td>
				<td><strong>${Math.round(r.confidence * 100)}%</strong></td>
				<td class="${r.lift >= 2 ? "ev-lift-high" : ""}">${r.lift}×</td>
			</tr>
		`).join("");

		const d = new frappe.ui.Dialog({
			title: __("📊 Discovered Patterns — {0}", [this.board.doctype]),
			size:  "large",
		});
		d.$body.html(`
			<p class="text-muted" style="font-size:12px;margin-bottom:10px">
				${__("Association rules in joined data (min support 10%, min confidence 50%, lift ≥ 1.2×)")}
			</p>
			<table class="table table-condensed ev-jc-patterns-table">
				<thead>
					<tr>
						<th>${__("IF")}</th>
						<th>${__("THEN")}</th>
						<th>${__("Support")}</th>
						<th>${__("Confidence")}</th>
						<th>${__("Lift")}</th>
					</tr>
				</thead>
				<tbody>${rows_html}</tbody>
			</table>
		`);
		d.show();
	}

	// ── V2.5+ — Generative BI: Chat UI (NL Query → Options → Auto-Canvas) ────

	/**
	 * Open chat-style drawer for Generative BI.
	 * Modern chat interface:
	 *   1. User types query → appears as user bubble
	 *   2. Options appear as clickable cards (shortest → longest)
	 *   3. Click card → auto-build canvas
	 *   4. Chat history preserved
	 */
	_prompt_generative_query() {
		// Remove existing chat drawer if open
		this.$stage.find(".ev-jc-genbi-chat").remove();

		// Sidebar management: Close other sidebars/drawers when opening Generate drawer
		this.$stage.find(".ev-jc-ai-drawer").remove();
		this.$overlay.find(".ev-jc-ai-btn").removeClass("ev-jc-btn--active");
		if (this.collab_sidebar_vue) {
			this.collab_sidebar_vue.hide();
		}

		const drawer = document.createElement("div");
		drawer.className = "ev-jc-genbi-chat";
		drawer.innerHTML = `
			<div class="ev-jc-chat-header">
				<div class="ev-jc-chat-header-content">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="margin-right:8px">
						<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
						<circle cx="9" cy="10" r="1" fill="currentColor"/>
						<circle cx="12" cy="10" r="1" fill="currentColor"/>
						<circle cx="15" cy="10" r="1" fill="currentColor"/>
					</svg>
					<span class="ev-jc-chat-title">${__("Generative BI")}</span>
				</div>
				<button class="ev-jc-chat-close">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
						<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
					</svg>
				</button>
			</div>
			<div class="ev-jc-chat-messages">
				<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system">
					<div class="ev-jc-chat-welcome">
						${__("From <strong>{0}</strong>, where do you want to connect?", [frappe.utils.escape_html(this.board.doctype)])}
					</div>
					<div class="ev-jc-chat-examples">
						<div class="ev-jc-example-label">${__("Try asking:")}</div>
						<div class="ev-jc-example-chips">
							<button class="ev-jc-example-chip" data-query="to projects">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
									<path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
									<path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
								</svg>
								"to projects"
							</button>
							<button class="ev-jc-example-chip" data-query="to timesheet">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
									<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
									<path d="M12 6v6l4 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
								</svg>
								"to timesheet"
							</button>
							<button class="ev-jc-example-chip" data-query="to salary slip">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none">
									<path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
								</svg>
								"to salary slip"
							</button>
						</div>
					</div>
				</div>
			</div>
			<div class="ev-jc-chat-input-wrapper">
				<input type="text" class="ev-jc-chat-input form-control"
				       placeholder="${__('Describe what you want to connect...')}"
				       autocomplete="off">
				<button class="btn btn-primary btn-sm ev-jc-chat-send">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
						<path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
					<span>${__("Send")}</span>
				</button>
			</div>
		`;
		this.$stage[0].appendChild(drawer);

		const $messages = $(drawer).find(".ev-jc-chat-messages");
		const $input = $(drawer).find(".ev-jc-chat-input");
		const $send = $(drawer).find(".ev-jc-chat-send");

		// Close button
		$(drawer).find(".ev-jc-chat-close").on("click", () => drawer.remove());

		// Example chip click handlers
		$(drawer).find(".ev-jc-example-chip").on("click", function() {
			const query = $(this).data("query");
			$input.val(query);
			send_query();
		});

		// Get or create session ID for conversation continuity
		let session_id = localStorage.getItem("genbi_session_id");
		if (!session_id) {
			session_id = `genbi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
			localStorage.setItem("genbi_session_id", session_id);
		}

		// Send query handler
		const send_query = () => {
			const query = $input.val().trim();
			if (query.length < 2) {
				frappe.show_alert({
					message:   __("Query too short — try asking something like 'to customer'"),
					indicator: "orange",
				});
				return;
			}

			// Add user message bubble
			$messages.append(`
				<div class="ev-jc-chat-bubble ev-jc-chat-bubble--user">
					${frappe.utils.escape_html(query)}
				</div>
			`);

			// Add animated thinking indicator in chat
			$messages.append(`
				<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-thinking">
					<div class="ev-jc-thinking-dots">
						<div class="ev-jc-dot"></div>
						<div class="ev-jc-dot"></div>
						<div class="ev-jc-dot"></div>
					</div>
					<span class="ev-jc-thinking-text">${__("Understanding your query...")}</span>
				</div>
			`);

			this._last_genbi_query = query;  // stored for feedback recording on path confirm
			$input.val("").prop("disabled", true);
			$send.prop("disabled", true);

			// Scroll to bottom
			$messages[0].scrollTop = $messages[0].scrollHeight;

			// Call new GenBI chat endpoint
			frappe.call({
				method: "excel_view.api.genbi_chat",
				args:   {
					query: query,
					session_id: session_id,
					base_doctype: this.board.doctype
				},
				callback: (r) => {
					// Remove thinking indicator
					$messages.find(".ev-jc-thinking").remove();

					$input.prop("disabled", false);
					$send.prop("disabled", false);

					if (!r.message) {
						$messages.append(`
							<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-chat-bubble--error">
								${__("Failed to analyze query. Try rephrasing!")}
							</div>
						`);
						$messages[0].scrollTop = $messages[0].scrollHeight;
						return;
					}

					const result = r.message;
					const response = result.response;
					const intent = result.intent;

					// Handle disambiguation
					if (result.needs_disambiguation && result.disambiguation_options) {
						this._show_disambiguation($messages, result.disambiguation_options, $input);
						$messages[0].scrollTop = $messages[0].scrollHeight;
						return;
					}

					// Route by response type
					switch (response.type) {
						case "text":
							this._render_text_response($messages, response);
							break;

						case "paths":
							this._render_paths_response($messages, response, drawer);
							break;

						case "explanation":
							this._render_explanation_response($messages, response);
							break;

						case "data_insight":
							this._render_data_insight_response($messages, response);
							break;

						case "canvas_config":
							this._render_canvas_config_response($messages, response, drawer);
							break;

						default:
							$messages.append(`
								<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system">
									${frappe.utils.escape_html(JSON.stringify(response.content))}
								</div>
							`);
					}

					// Add follow-up suggestion pills
					if (response.followup_suggestions && response.followup_suggestions.length > 0) {
						this._add_followup_pills($messages, response.followup_suggestions, $input);
					}

					$messages[0].scrollTop = $messages[0].scrollHeight;
				},
				error: () => {
					// Remove thinking indicator
					$messages.find(".ev-jc-thinking").remove();

					$input.prop("disabled", false);
					$send.prop("disabled", false);
					$messages.append(`
						<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-chat-bubble--error">
							${__("Generation failed. Check console for details.")}
						</div>
					`);
					$messages[0].scrollTop = $messages[0].scrollHeight;
				},
			});
		};

		$send.on("click", send_query);
		$input.on("keypress", (e) => {
			if (e.key === "Enter") send_query();
		});

		// Auto-focus input
		setTimeout(() => $input.focus(), 100);
	}

	/**
	 * Show disambiguation options when multiple entities match
	 */
	_show_disambiguation($messages, options, $input) {
		const $bubble = $(`
			<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system">
				<div style="margin-bottom:12px">
					<strong>${__("Which DocType did you mean?")}</strong>
				</div>
				<div class="ev-jc-disambig-buttons"></div>
			</div>
		`);

		const $buttons = $bubble.find(".ev-jc-disambig-buttons");

		options.forEach(doctype => {
			const $btn = $(`
				<button class="btn btn-sm btn-default ev-jc-disambig-btn">
					${frappe.utils.escape_html(doctype)}
				</button>
			`);
			$btn.on("click", () => {
				$input.val(`to ${doctype}`).trigger("keypress");
			});
			$buttons.append($btn);
		});

		$messages.append($bubble);
	}

	/**
	 * Render simple text response
	 */
	_render_text_response($messages, response) {
		// Parse basic markdown: **bold**, \n → <br>
		const html = String(response.content || "")
			.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
			.replace(/\n\n/g, "<br><br>")
			.replace(/\n/g, "<br>");
		$messages.append(`
			<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system">
				${html}
			</div>
		`);
	}

	/**
	 * Render paths response with data insights
	 */
	_render_paths_response($messages, response, drawer) {
		const content = response.content;
		const paths = content.paths || [];

		if (paths.length === 0) {
			$messages.append(`
				<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-chat-bubble--error">
					${__("No paths found from {0} to {1}", [content.base_doctype, content.target_doctype])}
				</div>
			`);
			return;
		}

		// Journey banner (shown instead of generic header for multi-leg journeys)
		if (content.is_journey && content.journey_pivot) {
			const pivot = frappe.utils.escape_html(content.journey_pivot);
			const src = frappe.utils.escape_html(content.base_doctype);
			const tgt = frappe.utils.escape_html(content.target_doctype);
			$messages.append(`
				<div class="ev-jc-journey-banner">
					<div class="ev-jc-journey-banner-route">
						<span class="ev-jc-journey-node">${src}</span>
						<span class="ev-jc-journey-arrow">→</span>
						<span class="ev-jc-journey-node ev-jc-journey-node--pivot">${pivot}</span>
						<span class="ev-jc-journey-arrow">→</span>
						<span class="ev-jc-journey-node">${tgt}</span>
					</div>
					<div class="ev-jc-journey-banner-sub">
						${__("{0} journey paths found — click any card to build the canvas", [content.paths.length])}
					</div>
				</div>
			`);
		} else {
			// Show results header
			const _sort_label = content.sort_label ? ` · ${content.sort_label}` : "";
			const header_msg = content.total > content.showing
				? __("Found {0} paths, showing top {1} with data insights", [content.total, content.showing])
				: __("Found {0} connection paths", [content.total]);

			$messages.append(`
				<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-results-header">
					<div class="ev-jc-results-icon">${content.sort_label ? "🔀" : "✨"}</div>
					<div>
						<strong>${header_msg}</strong>
						<div style="font-size:11px;opacity:0.8;margin-top:2px">
							${frappe.utils.escape_html(content.base_doctype)} → ${frappe.utils.escape_html(content.target_doctype)}${frappe.utils.escape_html(_sort_label)}
						</div>
					</div>
				</div>
			`);
		}

		// --- Recommendation pills (server-provided or client-computed) ---
		const _server_recs = content.recommendations || [];
		const _direct = paths.find(p => p.path.length === 2);
		const _top_path_len = paths[0]?.path.length || 99;
		const _client_pills = [];
		if (!_server_recs.length) {
			if (_direct) {
				_client_pills.push({ type: "direct", label: "⚡ Direct: " + _direct.path.join(" → "), path_idx: paths.indexOf(_direct), hops: 1 });
			}
			paths.forEach((p, i) => {
				if (p.path.length < _top_path_len - 1 && p !== _direct) {
					_client_pills.push({ type: "shorter", label: "🔀 Shorter: " + p.path.join(" → ") + ` (${p.path.length - 1} hops)`, path_idx: i, hops: p.path.length - 1 });
				}
			});
		}
		const _pills = _server_recs.length ? _server_recs : _client_pills;

		if (_pills.length) {
			const $pills_wrap = $(`
				<div class="ev-jc-rec-pills-wrap">
					<div class="ev-jc-rec-pills-label">Quick picks</div>
					<div class="ev-jc-rec-pills"></div>
				</div>
			`);
			const $pills_row = $pills_wrap.find(".ev-jc-rec-pills");
			_pills.forEach(pill => {
				const $pill = $(`<button class="ev-jc-rec-pill ev-jc-rec-pill--${pill.type}">${frappe.utils.escape_html(pill.label)}</button>`);
				$pill.on("click", () => {
					const target_opt = paths[pill.path_idx];
					if (!target_opt) return;
					$pills_wrap.remove();
					$messages.find(".ev-jc-chat-option-card").css("opacity", "0.5").css("pointer-events", "none");
					$messages.append(`<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system">⏳ ${__("Building canvas...")}</div>`);
					$messages[0].scrollTop = $messages[0].scrollHeight;
					this._build_canvas_from_selected_option_chat(target_opt, $messages, drawer);
				});
				$pills_row.append($pill);
			});
			$messages.append($pills_wrap);
		}

		// Smart Insights (data / hub info only — not duplicating pills)
		const _insights = [];
		const _with_data = paths.filter(p => p.data_insights?.has_data);
		if (_with_data.length) {
			const _sd = _with_data.reduce((a, b) => a.path.length <= b.path.length ? a : b);
			const _hops = _sd.path.length - 1;
			_insights.push(`✅ <strong>${_with_data.length} path${_with_data.length > 1 ? "s" : ""} have live data</strong> — shortest with data: ${_hops} hop${_hops > 1 ? "s" : ""} via <em>${frappe.utils.escape_html(_sd.path.slice(1, -1).join(" → ") || "direct link")}</em>.`);
		}
		const _hub_map = {};
		paths.forEach(p => p.path.slice(1, -1).forEach(dt => { _hub_map[dt] = (_hub_map[dt] || 0) + 1; }));
		const _top_hub = Object.entries(_hub_map).sort((a, b) => b[1] - a[1])[0];
		if (_top_hub && _top_hub[1] >= 3) {
			_insights.push(`🔗 <strong>${frappe.utils.escape_html(_top_hub[0])}</strong> is a hub — appears in ${_top_hub[1]} paths.`);
		}
		const _top = paths[0];
		if (_top && _direct && _top !== _direct && _top.estimated_fields > (_direct.estimated_fields || 0) * 1.5) {
			_insights.push(`📊 Top-ranked path has <strong>${_top.estimated_fields} fields</strong> vs ${_direct.estimated_fields || "few"} direct — more depth through ${frappe.utils.escape_html(_top.path.slice(1, -1).join(" → "))}.`);
		}
		if (_insights.length) {
			$messages.append(`
				<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-recommendations">
					<div style="font-size:11px;font-weight:600;opacity:0.65;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">💡 Smart Insights</div>
					${_insights.map(i => `<div class="ev-jc-rec-item">${i}</div>`).join("")}
				</div>
			`);
		}
		// Show paths (top 10)
		const BATCH_SIZE = 5;
		let displayed_count = 0;

		const show_more_options = () => {
			const next_batch = paths.slice(displayed_count, displayed_count + BATCH_SIZE);

			next_batch.forEach((opt, batch_idx) => {
				const idx = displayed_count + batch_idx;
				const conf_pct = Math.round(opt.confidence * 100);
				const conf_color = conf_pct >= 80 ? "#4CAF50" : conf_pct >= 60 ? "#FF9800" : "#757575";
				const path_str = opt.path.join(" → ");
				const hop_count = opt.path.length - 1;
				const hop_label = hop_count === 1 ? __("Direct") : __("{0} hops", [hop_count]);

				// Data insights badge
				const data_insights = opt.data_insights || {};
				const has_data = data_insights.has_data;
				const data_badge = has_data
					? `<span class="ev-jc-data-badge ev-jc-data-badge--good">✓ Has data</span>`
					: `<span class="ev-jc-data-badge ev-jc-data-badge--warn">⚠ Empty tables</span>`;

				const path_icon = hop_count === 1
					? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
					: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M5 12h4m6 0h4M9 5l3 7-3 7M15 5l3 7-3 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

				const card = $(`
					<div class="ev-jc-chat-option-card" data-option-idx="${idx}" style="opacity: 0">
						<div class="ev-jc-card-header">
							<div class="ev-jc-card-icon">${path_icon}</div>
							<div class="ev-jc-card-content">
								<div class="ev-jc-card-title">${frappe.utils.escape_html(path_str)}</div>
								<div class="ev-jc-card-meta">
									<span class="ev-jc-meta-item">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
											<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
										</svg>
										${hop_label}
									</span>
									<span class="ev-jc-meta-item">
										<svg width="12" height="12" viewBox="0 0 24 24" fill="none">
											<rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/>
											<path d="M8 10h8M8 14h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
										</svg>
										${opt.estimated_fields} fields
									</span>
									${data_badge}
								</div>
							</div>
							<span class="ev-jc-confidence-badge" style="background:${conf_color}">${conf_pct}%</span>
						</div>
					</div>
				`);

				// Click to build
				card.on("click", () => {
					$messages.find(".ev-jc-chat-option-card").css("opacity", "0.5").css("pointer-events", "none");
					$messages.append(`
						<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system">
							⏳ ${__("Building canvas...")}
						</div>
					`);
					$messages[0].scrollTop = $messages[0].scrollHeight;
					this._build_canvas_from_selected_option_chat(opt, $messages, drawer);
				});

				$messages.append(card);

				setTimeout(() => {
					card.css({ opacity: 1, transform: "translateY(0)", transition: "all 0.4s ease" });
				}, batch_idx * 80);
			});

			displayed_count += next_batch.length;

			if (displayed_count < paths.length) {
				const remaining = paths.length - displayed_count;
				const show_more_btn = $(`
					<div class="ev-jc-chat-show-more" style="text-align:center;margin:12px 0">
						<button class="btn btn-sm btn-default">
							${__("Show More")} (${remaining} ${__("remaining")})
						</button>
					</div>
				`);
				show_more_btn.on("click", () => {
					show_more_btn.remove();
					show_more_options();
					setTimeout(() => {
						$messages[0].scrollTop = $messages[0].scrollHeight;
					}, 50);
				});
				$messages.append(show_more_btn);
			}

			$messages[0].scrollTop = $messages[0].scrollHeight;
		};

		show_more_options();
	}

	/**
	 * Render relationship explanation
	 */
	_render_explanation_response($messages, response) {
		const content = response.content;
		const explanation = content.explanation;
		const path_str = content.path.join(" → ");

		const $bubble = $(`
			<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-explanation">
				<div class="ev-jc-explanation-header">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
						<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
						<path d="M12 16v-4M12 8h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
					</svg>
					<strong>${__("Relationship Explanation")}</strong>
				</div>
				<div class="ev-jc-explanation-path">
					${frappe.utils.escape_html(path_str)}
				</div>
				<div class="ev-jc-explanation-summary">
					${explanation.summary}
				</div>
				<div class="ev-jc-explanation-steps">
					<strong>${__("How they connect:")}</strong>
					<ol>
						${explanation.steps.map(step => `<li>${step}</li>`).join("")}
					</ol>
				</div>
				${explanation.business_context ? `
					<div class="ev-jc-explanation-context">
						<strong>💡 Business Context:</strong> ${explanation.business_context}
					</div>
				` : ""}
				<div class="ev-jc-explanation-confidence">
					<small><strong>${__("Confidence:")}</strong> ${explanation.confidence_reasoning}</small>
				</div>
				${content.comparison ? `
					<div class="ev-jc-explanation-comparison">
						<small>${content.comparison}</small>
					</div>
				` : ""}
			</div>
		`);

		$messages.append($bubble);
	}

	/**
	 * Render data insight
	 */
	_render_data_insight_response($messages, response) {
		const content = response.content;
		const doctype = content.doctype;
		const row_count = content.row_count;
		const filters = content.suggested_filters || [];

		$messages.append(`
			<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-data-insight">
				<div class="ev-jc-insight-header">
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
						<path d="M3 3v18h18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M18 17l-5-5-4 4-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
					<strong>${__("Data Insights")}</strong>
				</div>
				<div class="ev-jc-insight-content">
					<div class="ev-jc-insight-row-count">
						<strong>${frappe.utils.escape_html(doctype)}</strong> has <strong>${row_count.toLocaleString()}</strong> rows
					</div>
					${filters.length > 0 ? `
						<div class="ev-jc-insight-filters">
							<small><strong>${__("Suggested filters:")}</strong></small>
							<div>${filters.map(f => f.label).join(", ")}</div>
						</div>
					` : ""}
				</div>
			</div>
		`);
	}

	/**
	 * Render auto-built canvas config
	 */
	_render_canvas_config_response($messages, response, drawer) {
		const content = response.content;
		const canvas = content.canvas;

		$messages.append(`
			<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system">
				✅ ${__("Canvas auto-built! Building now...")}
			</div>
		`);

		// Close drawer and build canvas
		setTimeout(() => {
			drawer.remove();
			this._apply_auto_built_canvas(canvas);
		}, 500);
	}

	/**
	 * Add follow-up suggestion pills
	 */
	_add_followup_pills($messages, suggestions, $input) {
		if (suggestions.length === 0) return;

		const $pills = $(`
			<div class="ev-jc-followup-pills">
				<div class="ev-jc-pills-label">${__("Try:")}</div>
				<div class="ev-jc-pills-container"></div>
			</div>
		`);

		const $container = $pills.find(".ev-jc-pills-container");

		suggestions.forEach(suggestion => {
			const $pill = $(`
				<button class="ev-jc-followup-pill">
					${frappe.utils.escape_html(suggestion)}
				</button>
			`);
			$pill.on("click", () => {
				$input.val(suggestion);
				$input.focus();
				// Auto-submit
				setTimeout(() => {
					$input.trigger($.Event("keypress", { key: "Enter" }));
				}, 100);
			});
			$container.append($pill);
		});

		$messages.append($pills);
	}

	/**
	 * Apply auto-built canvas from query parser
	 */
	_apply_auto_built_canvas(canvas_config) {
		const nodes   = canvas_config.nodes || [];
		const edges   = canvas_config.edges || [];
		const id_map  = {}; // config_id → actual node id
		let loaded    = 0;

		if (!nodes.length) { this._auto_save_layout(); return; }

		nodes.forEach((nc, i) => {
			frappe.model.with_doctype(nc.doctype, () => {
				const before_ctr = this._node_ctr;
				this._add_node(nc.doctype, { base: i === 0 });
				const actual_id = `node_${before_ctr}`;
				if (nc.id) id_map[nc.id] = actual_id;

				// Override auto-layout position if AI specified one
				if (nc.x != null || nc.y != null) {
					const node = this.nodes.get(actual_id);
					if (node?.el) {
						if (nc.x != null) node.el.style.left = nc.x + "px";
						if (nc.y != null) node.el.style.top  = nc.y + "px";
					}
				}

				if (++loaded < nodes.length) return;

				// All nodes ready — create edges
				edges.forEach(ec => {
					const src_id = id_map[ec.src_node_id] ?? ec.src_node_id;
					const tgt_id = id_map[ec.tgt_node_id] ?? ec.tgt_node_id;
					if (!this.nodes.has(src_id) || !this.nodes.has(tgt_id)) return;
					const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
					const edge = {
						id:            `edge_${this._edge_ctr++}`,
						src_node_id:   src_id,
						src_field:     ec.src_field,
						tgt_node_id:   tgt_id,
						tgt_field:     ec.tgt_field,
						valid:         null,
						confidence:    null,
						method:        null,
						path_el,
						badge_el:      null,
						_remove_timer: null,
					};
					this.edges.push(edge);
					this._validate_edge(edge);
				});

				this._render_edges();
				this._auto_save_layout();
			});
		});
	}

	/**
	 * Build canvas from selected option (chat UI version).
	 * @param {Object} option - Selected option from generate_canvas_options
	 * @param {jQuery} $messages - Chat messages container
	 * @param {HTMLElement} drawer - Chat drawer element
	 */
	_build_canvas_from_selected_option_chat(option, $messages, drawer) {
		frappe.call({
			method: "excel_view.api.build_canvas_from_option",
			args: {
				option:        JSON.stringify(option),
				base_doctype:  this.board.doctype,
			},
			callback: (r) => {
				if (!r.message) {
					$messages.append(`
						<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-chat-bubble--error">
							${__("Failed to build canvas. Try another option!")}
						</div>
					`);
					$messages[0].scrollTop = $messages[0].scrollHeight;
					// Re-enable cards
					$messages.find(".ev-jc-chat-option-card").css("opacity", "1").css("pointer-events", "auto");
					return;
				}

				const config = r.message;

				// Record alias feedback: target DocType confirmed by user clicking the path
				const _target_dt = config.nodes?.find(n => n.doctype !== config.base_doctype)?.doctype;
				if (_target_dt && this._last_genbi_query) {
					frappe.call({
						method: "excel_view.api.genbi_record_alias_feedback",
						args: { query_term: this._last_genbi_query, resolved_doctype: _target_dt },
						callback: () => {}  // fire-and-forget
					});
				}

				// Clear existing non-base nodes and edges
				const base_node = [...this.nodes.values()].find(n => n.doctype === this.board.doctype);
				this.nodes.forEach((node, id) => {
					if (id !== base_node?.id) {
						node.el?.remove();
						this.nodes.delete(id);
					}
				});
				this.edges.forEach(edge => {
					edge.path_el?.remove();
					edge.badge_el?.remove();
				});
				this.edges = [];

				// Rebuild from config
				const node_id_map = new Map();
				node_id_map.set(config.base_doctype, base_node.id);

				// Create all nodes first (skip base which already exists)
				let loaded = 0;
				const non_base_nodes = config.nodes.filter(n => n.doctype !== config.base_doctype);

				const _wire_all = () => {
					if (loaded < non_base_nodes.length) return;

					// Position all nodes
					config.nodes.forEach(node_cfg => {
						const node_id = node_id_map.get(node_cfg.doctype);
						if (!node_id) return;
						const node = this.nodes.get(node_id);
						if (node) {
							node.el.style.left = `${node_cfg.x}px`;
							node.el.style.top  = `${node_cfg.y}px`;
						}
					});

					// Create edges
					config.edges.forEach(edge_cfg => {
						const src_node = config.nodes.find(n => n.id === edge_cfg.src_node_id);
						const tgt_node = config.nodes.find(n => n.id === edge_cfg.tgt_node_id);
						if (!src_node || !tgt_node) return;

						const src_id = node_id_map.get(src_node.doctype);
						const tgt_id = node_id_map.get(tgt_node.doctype);
						if (!src_id || !tgt_id) return;

						// Auto-check selected fields on target node
						const tgt = this.nodes.get(tgt_id);
						if (tgt && edge_cfg.selected_fields) {
							edge_cfg.selected_fields.forEach(f => tgt.selected_fields.add(f));
							// Refresh checkboxes to show selection
							const fields_div = tgt.el.querySelector(".ev-jc-node-fields");
							if (fields_div) {
								this._add_field_checkboxes(tgt_id, fields_div, new Set(edge_cfg.selected_fields));
							}
						}

						// Create edge
						const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
						const edge = {
							id:            `edge_${this._edge_ctr++}`,
							src_node_id:   src_id,
							src_field:     edge_cfg.src_field,
							tgt_node_id:   tgt_id,
							tgt_field:     edge_cfg.tgt_field,
							valid:         null,
							confidence:    null,
							method:        null,
							path_el,
							badge_el:      null,
							_remove_timer: null,
						};
						this.edges.push(edge);
						this._validate_edge(edge);
					});

					// Redraw all edges
					this._render_edges();

					// Force-save new canvas state immediately — overwrites any stale persisted state
					// (e.g. wrong nodes from a previous broken GenBI query)
					this._auto_save_layout();

					// Success message in chat
					$messages.append(`
						<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-chat-bubble--success">
							✨ ${__("Canvas built successfully!")}
							<br><span style="font-size:10px;opacity:0.8">${config.nodes.length} ${__("nodes")}, ${config.edges.length} ${__("joins")}</span>
						</div>
					`);
					$messages[0].scrollTop = $messages[0].scrollHeight;

					// Close drawer after 2 seconds
					setTimeout(() => {
						drawer.remove();
						frappe.show_alert({
							message:   __("✨ Canvas ready! Click Apply to load data."),
							indicator: "green",
						}, 5);
					}, 2000);
				};

				if (!non_base_nodes.length) {
					_wire_all();
					return;
				}

				// Load non-base nodes
				non_base_nodes.forEach(node_cfg => {
					frappe.model.with_doctype(node_cfg.doctype, () => {
						const new_id = this._add_node(node_cfg.doctype, { base: false });
						node_id_map.set(node_cfg.doctype, new_id);
						loaded++;
						_wire_all();
					});
				});
			},
			error: () => {
				$messages.append(`
					<div class="ev-jc-chat-bubble ev-jc-chat-bubble--system ev-jc-chat-bubble--error">
						${__("Canvas build failed. Check console for details.")}
					</div>
				`);
				$messages[0].scrollTop = $messages[0].scrollHeight;
				// Re-enable cards
				$messages.find(".ev-jc-chat-option-card").css("opacity", "1").css("pointer-events", "auto");
			},
		});
	}

	// ══════════════════════════════════════════════════════════════════════════
	// Figma-Style Zoom & Pan Methods
	// ══════════════════════════════════════════════════════════════════════════

	_zoom_in() {
		const center_x = this.$stage.width() / 2;
		const center_y = this.$stage.height() / 2;
		this._zoom_at_point(center_x, center_y, Math.min(this._zoom + 0.2, 5.0));
	}

	_zoom_out() {
		const center_x = this.$stage.width() / 2;
		const center_y = this.$stage.height() / 2;
		this._zoom_at_point(center_x, center_y, Math.max(this._zoom - 0.2, 0.1));
	}

	_zoom_fit() {
		// Calculate bounds of all nodes
		if (!this.nodes.size) {
			this._zoom = 1.0;
			this._pan_x = 0;
			this._pan_y = 0;
			this._apply_transform();
			return;
		}

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

		this.nodes.forEach(node => {
			const x = parseFloat(node.el.style.left) || 0;
			const y = parseFloat(node.el.style.top) || 0;
			const w = node.el.offsetWidth;
			const h = node.el.offsetHeight;

			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x + w);
			maxY = Math.max(maxY, y + h);
		});

		const contentWidth = maxX - minX + 100;  // +100 for padding
		const contentHeight = maxY - minY + 100;
		const stageWidth = this.$stage.width();
		const stageHeight = this.$stage.height();

		const zoomX = stageWidth / contentWidth;
		const zoomY = stageHeight / contentHeight;
		const zoom = Math.min(zoomX, zoomY, 1.0);  // Don't zoom in beyond 100%

		// Center the content
		const offsetX = (stageWidth - contentWidth * zoom) / 2;
		const offsetY = (stageHeight - contentHeight * zoom) / 2;

		this._zoom = zoom;
		this._pan_x = offsetX - (minX - 50) * zoom;
		this._pan_y = offsetY - (minY - 50) * zoom;
		this._apply_transform();
	}

	/**
	 * Zoom centered on a specific point (Figma-style)
	 * @param {number} x - Mouse X position relative to stage
	 * @param {number} y - Mouse Y position relative to stage
	 * @param {number} new_zoom - Target zoom level
	 */
	_zoom_at_point(x, y, new_zoom) {
		// Clamp zoom level
		new_zoom = Math.max(0.1, Math.min(5.0, new_zoom));

		// Calculate world coordinates of the point before zoom
		const world_x = (x - this._pan_x) / this._zoom;
		const world_y = (y - this._pan_y) / this._zoom;

		// Update zoom
		this._zoom = new_zoom;

		// Adjust pan to keep the same world point under the cursor
		this._pan_x = x - world_x * this._zoom;
		this._pan_y = y - world_y * this._zoom;

		this._apply_transform();
	}

	_apply_transform() {
		// Apply CSS transform to nodes container and SVG
		const transform = `translate(${this._pan_x}px, ${this._pan_y}px) scale(${this._zoom})`;
		this.$nodes.css("transform", transform);
		this.$svg.css("transform", transform);

		// Update zoom level display
		const percent = Math.round(this._zoom * 100);
		this.$overlay.find(".ev-jc-zoom-level").text(`${percent}%`);

		// Update transform origin for smooth scaling
		this.$nodes.css("transform-origin", "0 0");
		this.$svg.css("transform-origin", "0 0");
	}

	_start_pan(e) {
		this._is_panning = true;
		const start_x = e.clientX;
		const start_y = e.clientY;
		const initial_pan_x = this._pan_x;
		const initial_pan_y = this._pan_y;

		this.$overlay.css("cursor", "grabbing");

		const onMouseMove = (e) => {
			if (!this._is_panning) return;

			const dx = e.clientX - start_x;
			const dy = e.clientY - start_y;

			this._pan_x = initial_pan_x + dx;
			this._pan_y = initial_pan_y + dy;
			this._apply_transform();
		};

		const onMouseUp = () => {
			this._is_panning = false;
			this.$overlay.css("cursor", this._space_pressed ? "grab" : "");
			$(document).off("mousemove", onMouseMove);
			$(document).off("mouseup", onMouseUp);
		};

		$(document).on("mousemove", onMouseMove);
		$(document).on("mouseup", onMouseUp);
	}

	// ── Collaboration Methods ─────────────────────────────────────────────────

	_init_collaboration() {
		// Initialize Vanilla JS collaboration sidebar
		if (!this.collab_sidebar_vue) {
			this.collab_sidebar_vue = new frappe.canvas.CollaborationSidebarVanilla({
				parent: this.$overlay,
				canvas: this
			});
		}

		// Initialize modern collaboration dialog
		if (!this.collab_dialog) {
			this.collab_dialog = new frappe.canvas.CollaborationDialog({
				canvas: this
			});
		}

		// Check if current workbook has an existing session
		this._check_existing_session();

		// Setup Socket.IO event listeners
		this._setup_realtime_events();
	}

	async _check_existing_session() {
		// PRIORITY 1: Check URL hash for canvas session (for direct links/bookmarks)
		// Using hash (#) instead of query param (?) to avoid Frappe filter conflicts
		const hash = window.location.hash;
		let session_id_from_url = hash.startsWith('#canvas:') ? hash.substring(8) : null;

		// Strip any query parameters that might have been appended (e.g., ?status=Active)
		if (session_id_from_url) {
			session_id_from_url = session_id_from_url.split('?')[0].split('#')[0].trim();
		}

		if (session_id_from_url) {
			// Validate session exists before joining
			try {
				const session_check = await frappe.call({
					method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.get_session',
					args: { session_id: session_id_from_url }
				});

				if (session_check.message) {
					// Session exists, auto-join after small delay
					setTimeout(() => {
						this._join_session(session_id_from_url);
					}, 500);
				}
			} catch (e) {
				console.error('❌ Session not found or no access:', e);
				// Remove invalid session from URL hash
				const clean_url = window.location.pathname + window.location.search;
				history.replaceState(null, '', clean_url);

				frappe.show_alert({
					message: __('Canvas session not found or you don\'t have access'),
					indicator: 'orange'
				});
			}
			return;
		}

		// PRIORITY 2: Check if the current workbook has a linked canvas session
		const workbook_name = this.board.workbook?.name;
		if (!workbook_name) return;

		try {
			const workbook = await frappe.db.get_doc('Excel Workbook', workbook_name);
			if (workbook.canvas_session_id) {
				// Show resume banner
				this._show_resume_banner(workbook.canvas_session_id, workbook.canvas_session_title);
			}
		} catch (e) {
			console.error('Failed to check existing session:', e);
		}
	}

	_show_resume_banner(session_id, session_title) {
		// Show banner to resume the existing session
		const banner = $(`
			<div class="ev-jc-resume-banner">
				<span>${__('Resume collaboration: {0}', [session_title || session_id])}</span>
				<button class="btn btn-xs btn-primary resume-session-btn">
					${__('Resume')}
				</button>
				<button class="btn btn-xs btn-default dismiss-banner-btn">
					${__('Dismiss')}
				</button>
			</div>
		`).prependTo(this.$stage);

		banner.find('.resume-session-btn').on('click', () => {
			this._join_session(session_id);
			banner.remove();
		});

		banner.find('.dismiss-banner-btn').on('click', () => {
			banner.remove();
		});
	}

	_toggle_collaboration() {
		if (this.active_session_id) {
			// Already in a session, toggle sidebar visibility
			if (this.collab_sidebar_vue) {
				const isVisible = this.collab_sidebar_vue.$sidebar?.is(':visible');
				if (isVisible) {
					this.collab_sidebar_vue.hide();
				} else {
					// Sidebar management: Close other sidebars when showing collaborate sidebar
					this.$stage.find(".ev-jc-ai-drawer").remove();
					this.$stage.find(".ev-jc-genbi-chat").remove();
					this.$overlay.find(".ev-jc-ai-btn").removeClass("ev-jc-btn--active");

					this.collab_sidebar_vue.show();
				}
			}
		} else {
			// Not in a session, show modern collaboration dialog
			if (this.collab_dialog) {
				this.collab_dialog.show();
			}
		}
	}

	async _start_session(title) {
		try {
			// Create a new Canvas Session
			const result = await frappe.call({
				method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.create_session',
				args: {
					title: title,
					base_doctype: this.board.doctype,
					canvas_state: this._get_canvas_state()
				}
			});

			const session_id = result.message.session_id;
			await this._join_session(session_id);

			// Link to workbook if exists
			if (this.board.workbook?.name) {
				await frappe.db.set_value('Excel Workbook', this.board.workbook.name, {
					canvas_session_id: session_id,
					canvas_session_title: title
				});
			}

			frappe.show_alert({
				message: __('Collaboration session started'),
				indicator: 'green'
			});
		} catch (e) {
			frappe.show_alert({
				message: __('Failed to start session: {0}', [e.message]),
				indicator: 'red'
			});
			console.error('Failed to start session:', e);
		}
	}

	async _join_session(session_id) {
		try {
			// Set active session FIRST
			this.active_session_id = session_id;

			// Join canvas session room using Frappe's built-in doc_subscribe
			const doctype = 'Canvas Session';
			const docname = session_id;
			frappe.realtime.socket.emit('doc_subscribe', doctype, docname);

			// Verify subscription by listening for ack
			frappe.realtime.socket.once('doc_subscribe_ack', (data) => {
				console.log('✅ Doc subscription confirmed:', data);
			});

			// Call Python to broadcast join event AND get online users list
			const join_result = await frappe.call({
				method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.join_canvas_session',
				args: { session_id: session_id }
			});

			// Extract online_users from join response
			const online_users = join_result.message.online_users || [];

			// Load session data
			const result = await frappe.call({
				method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.get_session',
				args: { session_id: session_id }
			});

			const session_data = result.message;

			// CRITICAL: Clear existing canvas state before loading session
			// Remove all non-base nodes and edges to prevent duplicates
			const base_doctype = this.board.doctype;
			const non_base_nodes = [...this.nodes.entries()]
				.filter(([_, n]) => n.doctype !== base_doctype);

			// Remove all edges first
			this.edges.forEach(e => this._delete_edge(e));
			this.edges = [];

			// Remove all non-base nodes
			for (const [node_id, node] of non_base_nodes) {
				node.el.remove();
				this.nodes.delete(node_id);
			}

			// Restore canvas state from session
			// CRITICAL: Protect initial restore to prevent auto-save loop
			if (session_data.canvas_state) {
				this._applying_remote_state = true;
				try {
					this._restore_from_config(session_data.canvas_state);
				} finally {
					this._applying_remote_state = false;
				}
			}

			// Show Vue sidebar with session data AND online users from join response
			if (this.collab_sidebar_vue) {
				// Sidebar management: Close other sidebars when opening collaborate sidebar
				this.$stage.find(".ev-jc-ai-drawer").remove();
				this.$stage.find(".ev-jc-genbi-chat").remove();
				this.$overlay.find(".ev-jc-ai-btn").removeClass("ev-jc-btn--active");

				this.collab_sidebar_vue.refresh(session_data, online_users);
				this.collab_sidebar_vue.show();
			}

			// Update collaborate button appearance
			this.$overlay.find('.ev-jc-collaborate-btn')
				.removeClass('btn-default')
				.addClass('btn-success')
				.attr('title', __('Collaboration active - click to toggle sidebar'));

			// Setup automatic leave detection
			this._setup_leave_detection();

			// Add session_id to URL hash for persistence and sharing
			// Use replaceState to avoid Frappe router query parameter pollution
			const clean_url = window.location.pathname + window.location.search + `#canvas:${session_id}`;
			history.replaceState(null, '', clean_url);

			frappe.show_alert({
				message: __('Joined collaboration session'),
				indicator: 'green'
			});
		} catch (e) {
			frappe.show_alert({
				message: __('Failed to join session: {0}', [e.message]),
				indicator: 'red'
			});
			console.error('Failed to join session:', e);
		}
	}

	_leave_session() {
		if (!this.active_session_id) return;

		const session_id = this.active_session_id;

		// Leave canvas session room using Frappe's built-in doc_unsubscribe
		frappe.realtime.socket.emit('doc_unsubscribe', 'Canvas Session', session_id);

		// Call Python to broadcast leave event AND remove from cache
		frappe.call({
			method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.leave_canvas_session',
			args: { session_id: session_id },
			async: false  // Synchronous for beforeunload
		});

		// Clear active session
		this.active_session_id = null;
		this.online_users = [];

		// Remove session_id from URL hash
		window.location.hash = '';

		// Hide Vue sidebar
		if (this.collab_sidebar_vue) {
			this.collab_sidebar_vue.hide();
		}

		// Reset collaborate button
		this.$overlay.find('.ev-jc-collaborate-btn')
			.removeClass('btn-success')
			.addClass('btn-default')
			.attr('title', __('Start or join a collaborative canvas session'));

		// Cleanup leave detection
		this._cleanup_leave_detection();

		frappe.show_alert({
			message: __('Left collaboration session'),
			indicator: 'orange'
		});
	}

	_setup_leave_detection() {
		if (!this.active_session_id) return;

		// 1. Detect tab/window close
		this._beforeunload_handler = () => {
			if (this.active_session_id) {
				// Use sendBeacon with FormData (works with Frappe API and not blocked by browsers)
				const formData = new FormData();
				formData.append('session_id', this.active_session_id);
				formData.append('csrf_token', frappe.csrf_token);

				navigator.sendBeacon(
					'/api/method/excel_view.excel_view.doctype.canvas_session.canvas_session.leave_canvas_session',
					formData
				);
			}
		};
		window.addEventListener('beforeunload', this._beforeunload_handler);

		// 2. Detect socket disconnection
		this._disconnect_handler = () => {
			if (this.active_session_id) {
				// Try to call leave (might not work if truly disconnected)
				frappe.call({
					method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.leave_canvas_session',
					args: { session_id: this.active_session_id }
				});
			}
		};
		frappe.realtime.socket.on('disconnect', this._disconnect_handler);

		// 3. Detect page visibility change (tab switch)
		this._visibility_handler = () => {
			if (document.hidden && this.active_session_id) {
				// User switched away - don't leave yet, just mark as inactive
				// Could add a timeout here to leave after 5 minutes of inactivity
			}
		};
		document.addEventListener('visibilitychange', this._visibility_handler);
	}

	_cleanup_leave_detection() {
		// Remove all event listeners
		if (this._beforeunload_handler) {
			window.removeEventListener('beforeunload', this._beforeunload_handler);
			this._beforeunload_handler = null;
		}

		if (this._disconnect_handler) {
			frappe.realtime.socket.off('disconnect', this._disconnect_handler);
			this._disconnect_handler = null;
		}

		if (this._visibility_handler) {
			document.removeEventListener('visibilitychange', this._visibility_handler);
			this._visibility_handler = null;
		}
	}

	_setup_realtime_events() {
		// Guard: tear down any previous listeners before adding new ones
		this._cleanup_realtime_events();

		// Store named handlers so we can remove them precisely in cleanup
		this._rt_handlers = {
			canvas_user_joined: (data) => {
				if (data.session_id === this.active_session_id &&
				    data.user !== frappe.session.user &&
				    this.collab_sidebar) {
					this.collab_sidebar.online_users.add_user(data);
				}
			},
			canvas_user_left: (data) => {
				if (data.session_id === this.active_session_id && this.collab_sidebar) {
					this.collab_sidebar.online_users.remove_user(data);
				}
			},
			canvas_chat_message: (data) => {
				if (data.session_id === this.active_session_id && this.collab_sidebar) {
					this.collab_sidebar.chat.add_message(data);
				}
			},
			canvas_updated: (data) => {
				if (data.user === frappe.session.user) return;
				if (data.session_id !== this.active_session_id) return;
				this._apply_remote_canvas_state(data.canvas_state, data.timestamp);
				frappe.show_alert({
					message: __('{0} updated the canvas', [frappe.user_info(data.user).fullname]),
					indicator: 'blue'
				}, 2);
			},
			canvas_node_moved: (data) => {
				if (data.user === frappe.session.user) return;
				if (data.session_id !== this.active_session_id) return;
				const node = this.nodes.get(data.node_id);
				if (node && node.el) {
					node.el.style.left = data.position.left + 'px';
					node.el.style.top = data.position.top + 'px';
					this._render_edges();
				}
			},
		};

		Object.entries(this._rt_handlers).forEach(([event, handler]) => {
			frappe.realtime.on(event, handler);
		});
	}

	_cleanup_realtime_events() {
		if (!this._rt_handlers) return;
		Object.entries(this._rt_handlers).forEach(([event, handler]) => {
			frappe.realtime.off(event, handler);
		});
		this._rt_handlers = null;
	}

	_get_canvas_state() {
		// Serialize current canvas state (nodes, edges, positions)
		const nodes = [];
		this.nodes.forEach((node, id) => {
			nodes.push({
				id: id,
				doctype: node.doctype,
				selected_fields: Array.from(node.selected_fields || []),
				position: {
					left: parseInt(node.el.style.left) || 0,
					top: parseInt(node.el.style.top) || 0
				}
			});
		});

		const edges = this.edges.map(edge => ({
			id: edge.id,
			src_node_id: edge.src_node_id,
			src_field: edge.src_field,
			tgt_node_id: edge.tgt_node_id,
			tgt_field: edge.tgt_field,
			valid: edge.valid,
			confidence: edge.confidence,
			method: edge.method
		}));

		return {
			nodes: nodes,
			edges: edges,
			zoom: this._zoom,
			pan: { x: this._pan_x, y: this._pan_y }
		};
	}

	_save_canvas_state_to_session() {
		// Auto-save canvas state to the active session
		if (!this.active_session_id) return;

		const canvas_state = this._get_canvas_state();

		frappe.call({
			method: 'excel_view.excel_view.doctype.canvas_session.canvas_session.update_canvas_state',
			args: {
				session_id: this.active_session_id,
				canvas_state: canvas_state
			},
			callback: (r) => {
				if (r.message) {
					// Broadcast update to other users
					frappe.realtime.socket.emit('canvas_update', {
						session_id: this.active_session_id,
						canvas_state: canvas_state
					});
				}
			}
		});
	}

	/**
	 * Phase 4: Apply remote canvas state from another user.
	 * Detects whether this is a structural change (nodes/edges added/removed)
	 * or just a position update, and handles accordingly.
	 *
	 * @param {Object} remote_state - Canvas state from remote user
	 * @param {Number} remote_timestamp - Timestamp of remote change
	 */
	_apply_remote_canvas_state(remote_state, remote_timestamp) {
		if (!remote_state || !remote_state.nodes) {
			console.warn('⚠️ Invalid remote canvas state:', remote_state);
			return;
		}

		// CRITICAL: Set flag to prevent ANY auto-save during sync
		this._applying_remote_state = true;

		try {
			// Build local non-base doctype list (sorted for comparison)
			const local_doctypes = [...this.nodes.values()]
				.filter(n => n.doctype !== this.board.doctype)
				.map(n => n.doctype)
				.sort();

			// Build remote non-base doctype list
			const remote_non_base = (remote_state.nodes || [])
				.filter(n => n.doctype !== this.board.doctype);
			const remote_doctypes = remote_non_base.map(n => n.doctype).sort();

			// Build local edge signature set
			const local_edge_sigs = new Set(
				this.edges.map(e => {
					const src_dt = this.nodes.get(e.src_node_id)?.doctype;
					const tgt_dt = this.nodes.get(e.tgt_node_id)?.doctype;
					return `${src_dt}:${e.src_field}->${tgt_dt}:${e.tgt_field}`;
				})
			);

			// Build remote edge signature set (use doctype from remote nodes map)
			const remote_node_map = new Map();
			(remote_state.nodes || []).forEach(n => remote_node_map.set(n.id, n));
			const remote_edge_sigs = new Set(
				(remote_state.edges || []).map(e => {
					const src_dt = remote_node_map.get(e.src_node_id)?.doctype;
					const tgt_dt = remote_node_map.get(e.tgt_node_id)?.doctype;
					return `${src_dt}:${e.src_field}->${tgt_dt}:${e.tgt_field}`;
				})
			);

			// Detect structural change
			const doctypes_match = local_doctypes.join(',') === remote_doctypes.join(',');
			const edges_match = local_edge_sigs.size === remote_edge_sigs.size &&
				[...local_edge_sigs].every(s => remote_edge_sigs.has(s));
			const is_structural_change = !doctypes_match || !edges_match;

			if (is_structural_change) {
				this._apply_structural_sync(remote_state);
			} else {
				this._apply_position_sync(remote_state);
			}

			// Update zoom/pan if present
			if (remote_state.zoom !== undefined) {
				this._zoom = remote_state.zoom;
				this._pan_x = remote_state.pan?.x || 0;
				this._pan_y = remote_state.pan?.y || 0;
				this._apply_transform();
			}

			// Update local timestamp
			this._last_remote_timestamp = remote_timestamp;

		} finally {
			// Always unset flag, even if error occurs
			this._applying_remote_state = false;
		}
	}

	/**
	 * Lightweight position-only sync for existing nodes.
	 * Used when no structural changes detected (same nodes, same edges).
	 */
	_apply_position_sync(remote_state) {
		// Match local nodes to remote nodes by doctype
		for (const [node_id, local_node] of this.nodes.entries()) {
			if (local_node.doctype === this.board.doctype) {
				// Update base node position too
				const remote_base = remote_state.nodes.find(
					rn => rn.doctype === this.board.doctype
				);
				if (remote_base?.position) {
					local_node.el.style.left = remote_base.position.left + 'px';
					local_node.el.style.top = remote_base.position.top + 'px';
				}
				continue;
			}

			const remote_node = remote_state.nodes.find(
				rn => rn.doctype === local_node.doctype
			);
			if (remote_node?.position) {
				local_node.el.style.left = remote_node.position.left + 'px';
				local_node.el.style.top = remote_node.position.top + 'px';
			}
		}
		this._render_edges();
	}

	/**
	 * Full structural sync - removes/adds nodes and edges to match remote state.
	 * Called when remote state has different nodes or edges than local.
	 */
	_apply_structural_sync(remote_state) {
		const remote_non_base = (remote_state.nodes || [])
			.filter(n => n.doctype !== this.board.doctype);
		const remote_doctypes = new Set(remote_non_base.map(n => n.doctype));

		// ── Step 1: Remove local non-base nodes that don't exist in remote ──
		const local_non_base = [...this.nodes.entries()]
			.filter(([_, n]) => n.doctype !== this.board.doctype);

		for (const [node_id, node] of local_non_base) {
			if (!remote_doctypes.has(node.doctype)) {
				// Remove edges connected to this node
				const connected = this.edges.filter(
					e => e.src_node_id === node_id || e.tgt_node_id === node_id
				);
				connected.forEach(e => this._delete_edge(e));
				this.edges = this.edges.filter(
					e => e.src_node_id !== node_id && e.tgt_node_id !== node_id
				);
				node.el.remove();
				this.nodes.delete(node_id);
			}
		}

		// ── Step 2: Update base node position ──────────────────────────────
		const remote_base = remote_state.nodes.find(
			n => n.doctype === this.board.doctype
		);
		const local_base = [...this.nodes.values()].find(
			n => n.doctype === this.board.doctype
		);
		if (remote_base?.position && local_base) {
			local_base.el.style.left = remote_base.position.left + 'px';
			local_base.el.style.top = remote_base.position.top + 'px';
		}

		// ── Step 3: Add new nodes from remote / update existing positions ──
		// Maps remote node id → local node id (for edge restoration)
		const remote_to_local = new Map();

		// Map base node
		if (local_base && remote_base) {
			remote_to_local.set(remote_base.id, local_base.id);
		}

		// Existing local non-base: update position, build mapping
		for (const [node_id, node] of this.nodes.entries()) {
			if (node.doctype === this.board.doctype) continue;
			const remote_node = remote_non_base.find(rn => rn.doctype === node.doctype);
			if (remote_node) {
				remote_to_local.set(remote_node.id, node_id);
				if (remote_node.position) {
					node.el.style.left = remote_node.position.left + 'px';
					node.el.style.top = remote_node.position.top + 'px';
				}
			}
		}

		// New nodes: doctypes in remote but not locally
		const local_doctypes_now = new Set(
			[...this.nodes.values()]
				.filter(n => n.doctype !== this.board.doctype)
				.map(n => n.doctype)
		);

		const nodes_to_add = remote_non_base.filter(
			rn => !local_doctypes_now.has(rn.doctype)
		);

		let pending_loads = nodes_to_add.length;

		const _finish_structural_sync = () => {
			// ── Step 4: Sync edges ─────────────────────────────────────────
			// Remove all existing edges first
			this.edges.forEach(e => this._delete_edge(e));
			this.edges = [];

			// Recreate edges from remote state
			(remote_state.edges || []).forEach(re => {
				const local_src = remote_to_local.get(re.src_node_id);
				const local_tgt = remote_to_local.get(re.tgt_node_id);
				if (!local_src || !local_tgt) return;

				const path_el = this._create_svg_path("ev-jc-edge ev-jc-edge--pending");
				const new_edge = {
					id:          `edge_${this._edge_ctr++}`,
					src_node_id: local_src,
					src_field:   re.src_field,
					tgt_node_id: local_tgt,
					tgt_field:   re.tgt_field,
					valid:       re.valid ?? null,
					confidence:  re.confidence ?? null,
					method:      re.method ?? null,
					path_el,
					badge_el:    null,
					_remove_timer: null,
					_restored:   true,  // Flag: from remote sync, skip auto-save on validate
				};
				this.edges.push(new_edge);

				// Re-validate edge (updates badge/styling)
				this._validate_edge(new_edge);
			});

			this._render_edges();
		};

		if (pending_loads === 0) {
			_finish_structural_sync();
			return;
		}

		// Load new node doctypes and add them
		nodes_to_add.forEach(remote_node => {
			frappe.model.with_doctype(remote_node.doctype, () => {
				const new_id = this._add_node(remote_node.doctype, { base: false });
				remote_to_local.set(remote_node.id, new_id);

				// Set position from remote
				if (remote_node.position) {
					const node_el = this.nodes.get(new_id)?.el;
					if (node_el) {
						node_el.style.left = remote_node.position.left + 'px';
						node_el.style.top = remote_node.position.top + 'px';
					}
				}

				// Restore selected_fields checkboxes
				if (remote_node.selected_fields?.length) {
					const canvas_node = this.nodes.get(new_id);
					const fields_div = canvas_node?.el.querySelector('.ev-jc-node-fields');
					remote_node.selected_fields.forEach(f => {
						const cb = fields_div?.querySelector(
							`[data-field="${f}"] .ev-field-select`
						);
						if (cb && !cb.checked) {
							cb.checked = true;
							cb.dispatchEvent(new Event('change'));
						}
					});
				}

				pending_loads--;
				if (pending_loads === 0) {
					_finish_structural_sync();
				}
			});
		});
	}

	/**
	 * Phase 4: Broadcast node position update (lightweight, no DB save).
	 * Used during drag for real-time position sync across users.
	 *
	 * @param {String} node_id - Node ID being moved
	 * @param {Object} position - {left, top} in pixels
	 */
	_broadcast_node_position(node_id, position) {
		if (!this.active_session_id || !frappe.realtime?.socket) return;

		// Emit lightweight position-only update (no DB write)
		frappe.realtime.socket.emit('canvas_node_moved', {
			session_id: this.active_session_id,
			node_id: node_id,
			position: position,
			user: frappe.session.user
		});
	}
};
