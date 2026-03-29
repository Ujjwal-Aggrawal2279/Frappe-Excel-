/**
 * excel_view/components/formula_bar.js
 *
 * Renders the Excel-style formula bar above the grid:
 *
 *  ┌──────────┬────────────────────────────────────────────────┐
 *  │  A1      │  =SUM(A1:A10)  or  raw value                   │
 *  └──────────┴────────────────────────────────────────────────┘
 *   address     formula/value input
 *
 * Updates on HOT `afterSelection`. On formula input, pushes changes back to HOT.
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.FormulaBar = class FormulaBar {
	/**
	 * @param {Object} opts
	 * @param {Object} opts.board     - ExcelBoard instance
	 * @param {Element} opts.wrapper  - DOM element to render into
	 */
	constructor(opts) {
		this.board = opts.board;
		this.wrapper = opts.wrapper;
		this._current_row = 0;
		this._current_col = 0;
		this._editing = false;
	}

	// ── Setup ─────────────────────────────────────────────────────────────────

	setup() {
		this._render();
		this._bind_events();
	}

	_render() {
		$(this.wrapper).html(`
			<div class="ev-formula-bar">
				<div class="ev-cell-address" title="${__("Cell address")}">
					<input class="ev-address-input" type="text" readonly
						placeholder="A1" spellcheck="false" />
				</div>
				<div class="ev-fx-icon ev-fx-help" title="${__("Formula Help — click for examples")}">
					<span>f<sub>x</sub></span>
				</div>
				<div class="ev-formula-input-wrap">
					<input class="ev-formula-input" type="text"
						placeholder="${__("Value or formula (=SUM, =IF, ...)")}"
						spellcheck="false" />
				</div>
			</div>
		`);

		this.$address = $(this.wrapper).find(".ev-address-input");
		this.$formula = $(this.wrapper).find(".ev-formula-input");
	}

	_bind_events() {
		// On Enter in formula input → push value to HOT cell
		this.$formula.on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this._commit();
				this.board.hot?.selectCell(this._current_row, this._current_col);
			}
			if (e.key === "Escape") {
				this._cancel();
				this.board.hot?.selectCell(this._current_row, this._current_col);
			}
		});

		// Track focus state
		this.$formula.on("focus", () => {
			this._editing = true;
		});

		this.$formula.on("blur", () => {
			if (this._editing) {
				this._commit();
				this._editing = false;
			}
		});

		// Address box: navigate to named cell on Enter
		this.$address.removeAttr("readonly").on("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				this._navigate_to_address(this.$address.val().trim());
			}
		});

		// fx button click → formula help popup
		$(this.wrapper).find(".ev-fx-help").on("click", () => this._show_formula_help());

		// No realtime listener needed — configs are fetched fresh on every popup open.
	}

	// ── Public API ────────────────────────────────────────────────────────────

	/**
	 * Update bar to reflect the currently selected HOT cell.
	 * Called from ExcelBoard's afterSelection hook.
	 * @param {number} row
	 * @param {number} col
	 */
	update(row, col) {
		if (this._editing) return; // don't interrupt user input
		this._current_row = row;
		this._current_col = col;

		// Update address box: convert 0-based row/col → Excel-style A1 notation
		this.$address.val(this._to_cell_address(row, col));

		// Show formula string if cell has a formula, otherwise raw value
		const bridge = this.board.formula_bridge;
		const formula = bridge?.get_formula(row, col);
		if (formula) {
			this.$formula.val(formula);
		} else {
			const raw = this.board.matrix?.[row]?.[col] ?? "";
			this.$formula.val(raw !== null && raw !== undefined ? raw : "");
		}
	}

	// ── Private ───────────────────────────────────────────────────────────────

	/**
	 * Push the formula bar input value into the HOT cell.
	 */
	_commit() {
		const value = this.$formula.val();
		if (!this.board.hot) return;

		// Check readOnly
		const col_def = this.board.columns?.[this._current_col];
		if (col_def?._readonly) {
			frappe.show_alert({ message: __("This cell is read-only"), indicator: "orange" }, 2);
			return;
		}

		this.board.hot.setDataAtCell(this._current_row, this._current_col, value);
	}

	/**
	 * Restore formula bar to the current cell's saved value (cancel edit).
	 */
	_cancel() {
		this._editing = false;
		this.update(this._current_row, this._current_col);
	}

	/**
	 * Navigate HOT selection to an Excel-style address (e.g. "B3").
	 * @param {string} address - e.g. "B3", "AA10"
	 */
	_navigate_to_address(address) {
		const match = address.match(/^([A-Za-z]+)(\d+)$/);
		if (!match) return;

		const col = this._col_letters_to_index(match[1].toUpperCase());
		const row = parseInt(match[2], 10) - 1; // 1-based → 0-based

		if (row >= 0 && col >= 0) {
			this.board.hot?.selectCell(row, col);
		}
	}

	/**
	 * Convert 0-based (row, col) → Excel cell address string (e.g. "A1", "Z10", "AA1").
	 */
	_to_cell_address(row, col) {
		return this._col_index_to_letters(col) + (row + 1);
	}

	/**
	 * Convert 0-based column index → Excel column letters (A, B, ..., Z, AA, ...).
	 * @param {number} n
	 * @returns {string}
	 */
	_col_index_to_letters(n) {
		let result = "";
		n = n + 1; // 1-based
		while (n > 0) {
			const rem = (n - 1) % 26;
			result = String.fromCharCode(65 + rem) + result;
			n = Math.floor((n - 1) / 26);
		}
		return result;
	}

	/**
	 * Convert Excel column letters → 0-based column index.
	 * @param {string} letters - e.g. "A", "Z", "AA"
	 * @returns {number}
	 */
	_col_letters_to_index(letters) {
		let n = 0;
		for (let i = 0; i < letters.length; i++) {
			n = n * 26 + (letters.charCodeAt(i) - 64);
		}
		return n - 1;
	}

	/**
	 * Show/hide the formula help popup.
	 *
	 * Performance contract:
	 *   • Open  → instant (renders from frappe.boot cache, zero network wait).
	 *   • Background fetch updates ONLY the "My Formulas" section if configs
	 *     changed — the rest of the popup is never rebuilt.
	 *   • Close → instant toggle, no network call.
	 */
	_show_formula_help() {
		// ── Close path (instant) ──────────────────────────────────────────────
		if (this._$help_popup && !this._$help_popup.hasClass("hide")) {
			this._$help_popup.addClass("hide");
			return;
		}

		// ── Open path (instant from cache) ───────────────────────────────────
		if (!this._$help_popup) {
			this._build_formula_help_popup();
		} else {
			this._$help_popup.removeClass("hide");
		}

		// ── Background refresh — update only "My Formulas" if changed ─────────
		// Runs after the popup is already visible, so the user sees no delay.
		frappe.call({
			method: "excel_view.api.get_formula_configs",
			callback: (r) => {
				if (r.exc) return;
				const fresh = r.message || [];
				const cached_json = JSON.stringify(frappe.boot.excel_formula_configs || []);
				const fresh_json  = JSON.stringify(fresh);
				if (fresh_json === cached_json) return; // nothing changed
				frappe.boot.excel_formula_configs = fresh;
				this._refresh_dyn_section(fresh);
			},
		});
	}

	/**
	 * Replace only the "★ My Formulas" section inside the already-open popup.
	 * All other sections (Math, Logic, ERP …) are untouched.
	 * @param {Array} configs - fresh excel_formula_configs array
	 */
	_refresh_dyn_section(configs) {
		if (!this._$help_popup) return;
		const $erp_grid = this._$help_popup.find(".ev-fh-grid--erp");
		$erp_grid.find(".ev-fh-section--dyn").remove();
		if (!configs.length) return;

		const dyn_html = this._build_dyn_html(configs);
		$erp_grid.append(dyn_html);

		// Bind click handler for the newly added rows
		$erp_grid.find(".ev-fh-section--dyn .ev-fh-row").on("click", (e) => {
			const formula = $(e.currentTarget).data("formula");
			this.$formula.val(formula).focus();
			this._$help_popup.addClass("hide");
		});
	}

	/**
	 * Build the HTML string for the "★ My Formulas" section.
	 * Extracted so both initial render and _refresh_dyn_section use identical markup.
	 * @param {Array} configs
	 * @returns {string}
	 */
	_build_dyn_html(configs) {
		const _row = ({ formula, label, desc, tooltip }) => {
			const tip = frappe.utils.escape_html(tooltip || desc || "");
			return `<div class="ev-fh-row ev-fh-row--dyn"
					data-formula="${frappe.utils.escape_html(formula)}" title="${tip}">
				<code class="ev-fh-formula">${frappe.utils.escape_html(formula)}</code>
				<span class="ev-fh-desc">${frappe.utils.escape_html(label || desc)}</span>
			</div>`;
		};
		const rows = configs.map((c) => _row({
			formula: `=${c.formula_name}()`,
			label:   c.label || c.formula_name,
			desc:    c.description || `${c.formula_type} on ${c.source_doctype}`,
			tooltip: c.description || "",
		})).join("");
		return `
			<div class="ev-fh-section ev-fh-section--dyn">
				<div class="ev-fh-category">★ ${__("My Formulas")}</div>
				<div class="ev-fh-rows">${rows}</div>
			</div>`;
	}

	/** Build and append the formula help popup using frappe.boot.excel_formula_configs. */
	_build_formula_help_popup() {

		// ── Standard HyperFormula sections ────────────────────────────────────
		const std_sections = [
			{
				category: __("Math & Stats"), icon: "Σ",
				items: [
					{ formula: "=SUM(B2:B10)",     desc: __("Sum of a range") },
					{ formula: "=AVERAGE(C2:C5)",  desc: __("Average of values") },
					{ formula: "=MAX(D2:D10)",      desc: __("Maximum value") },
					{ formula: "=MIN(D2:D10)",      desc: __("Minimum value") },
					{ formula: "=COUNT(B2:B10)",    desc: __("Count numeric cells") },
					{ formula: "=ROUND(A1, 2)",     desc: __("Round to 2 decimals") },
					{ formula: "=ABS(A1)",          desc: __("Absolute value") },
				],
			},
			{
				category: __("Logic"), icon: "⎇",
				items: [
					{ formula: '=IF(A1>100,"High","Low")', desc: __("Conditional value") },
					{ formula: "=AND(A1>0, B1>0)",         desc: __("Both conditions true") },
					{ formula: "=OR(A1>0, B1>0)",          desc: __("Either condition true") },
					{ formula: "=IFERROR(A1/B1, 0)",       desc: __("Handle errors gracefully") },
					{ formula: "=NOT(A1)",                  desc: __("Logical NOT") },
				],
			},
			{
				category: __("Text"), icon: "T",
				items: [
					{ formula: '=CONCATENATE(A1," ",B1)', desc: __("Join text together") },
					{ formula: "=LEN(A1)",                desc: __("Length of text") },
					{ formula: "=UPPER(A1)",              desc: __("Convert to uppercase") },
					{ formula: "=LOWER(A1)",              desc: __("Convert to lowercase") },
					{ formula: "=TRIM(A1)",               desc: __("Remove extra spaces") },
					{ formula: "=LEFT(A1, 5)",            desc: __("First 5 characters") },
				],
			},
			{
				category: __("Date & Time"), icon: "📅",
				items: [
					{ formula: "=TODAY()",          desc: __("Today's date") },
					{ formula: "=NOW()",            desc: __("Current date and time") },
					{ formula: "=YEAR(A1)",         desc: __("Extract year") },
					{ formula: "=MONTH(A1)",        desc: __("Extract month") },
					{ formula: "=DAY(A1)",          desc: __("Extract day") },
					{ formula: '=DATEDIF(A1,B1,"D")', desc: __("Days between two dates") },
				],
			},
		];

		// ── Built-in Frappe ERP formulas ──────────────────────────────────────
		const erp_items = [
			{
				formula: "=FRAPPE_GET(doctype, name, fieldname)",
				desc: __("Fetch any field — plain, link-hop, or child row"),
				tooltip: __(
					"Plain: =FRAPPE_GET(\"Customer\",A2,\"credit_limit\") | " +
					"Link hop: =FRAPPE_GET(\"Sales Person\",A2,\"employee.ctc\") | " +
					"Child row: =FRAPPE_GET(\"Sales Invoice\",A2,\"items[1].amount\")"
				),
			},
			{
				formula: "=FRAPPE_CHILD_GET(doctype, name, child_field, row, fieldname)",
				desc: __("Fetch a field from a specific child table row"),
				tooltip: __("Example: =FRAPPE_CHILD_GET(\"Sales Invoice\", A2, \"items\", 1, \"amount\") — row index is 1-based"),
			},
			{
				formula: "=FRAPPE_SUM(doctype, fieldname, fk1, fv1, ...)",
				desc: __("Sum a field across DocType records with filters"),
				tooltip: __("Example: =FRAPPE_SUM(\"Sales Invoice\", \"grand_total\", \"docstatus\", 1)"),
			},
			{
				formula: "=FRAPPE_COUNT(doctype, fk1, fv1, ...)",
				desc: __("Count records in a DocType with filters"),
				tooltip: __("Example: =FRAPPE_COUNT(\"Employee\", \"status\", \"Active\")"),
			},
			{
				formula: "=FRAPPE_AVG(doctype, fieldname, fk1, fv1, ...)",
				desc: __("Average a field across DocType records"),
				tooltip: __("Example: =FRAPPE_AVG(\"Sales Invoice\", \"grand_total\", \"docstatus\", 1)"),
			},
			{
				formula: "=GL_BALANCE(account, company, from_date, to_date)",
				desc: __("Live General Ledger balance for any account"),
				tooltip: __("Example: =GL_BALANCE(\"Debtors - TC\", \"Test Company\")"),
			},
			{
				formula: "=STOCK_QTY(item_code, warehouse, as_of_date)",
				desc: __("Live stock quantity from Bin"),
				tooltip: __("Example: =STOCK_QTY(\"Laptop\", \"Main Warehouse\")"),
			},
			{
				formula: "=ITEM_PRICE(item_code, price_list, qty, customer)",
				desc: __("Fetch item price from a Price List"),
				tooltip: __("Example: =ITEM_PRICE(\"Laptop\", \"Standard Selling\")"),
			},
			{
				formula: "=SMART_LOOKUP(value, target_doctype, return_field)",
				desc: __("Cross-DocType lookup — no manual range needed"),
				tooltip: __("Example: =SMART_LOOKUP(A2, \"Customer\", \"customer_group\")"),
			},
			{
				formula: "=PERIOD_START()",
				desc: __("Start date of the active toolbar period"),
				tooltip: __("Changes with the period picker. Use in date filter args."),
			},
			{
				formula: "=PERIOD_END()",
				desc: __("End date of the active toolbar period"),
				tooltip: __("Changes with the period picker. Use in date filter args."),
			},
		];

		// ── Render helpers (std + ERP sections only) ──────────────────────────
		const _row = ({ formula, desc, tooltip, is_erp, label }) => {
			const tip = frappe.utils.escape_html(tooltip || desc || "");
			return `<div class="ev-fh-row${is_erp ? " ev-fh-row--erp" : ""}"
					data-formula="${frappe.utils.escape_html(formula)}" title="${tip}">
				<code class="ev-fh-formula">${frappe.utils.escape_html(formula)}</code>
				<span class="ev-fh-desc">${frappe.utils.escape_html(label || desc)}</span>
			</div>`;
		};

		const _section = ({ category, icon, items, accent }) => `
			<div class="ev-fh-section${accent ? ` ev-fh-section--${accent}` : ""}">
				<div class="ev-fh-category">${icon} ${category}</div>
				<div class="ev-fh-rows">${items.map(_row).join("")}</div>
			</div>`;

		const std_html = std_sections.map((s) => _section(s)).join("");
		const erp_html = _section({
			category: __("Frappe ERP"),
			icon: "⚡",
			accent: "erp",
			items: erp_items.map((i) => ({ ...i, is_erp: true })),
		});

		// "My Formulas" rendered via shared helper (same markup used by _refresh_dyn_section)
		const dyn_html = this._build_dyn_html(frappe.boot?.excel_formula_configs || []);

		this._$help_popup = $(`
			<div class="ev-formula-help-popup">
				<div class="ev-fh-header">
					<span class="ev-fh-title">📊 ${__("Formula Library")}</span>
					<input class="ev-fh-search" type="text" placeholder="${__("Search formulas…")}" />
					<button class="ev-fh-close" title="${__("Close")}">×</button>
				</div>
				<div class="ev-fh-body">
					<div class="ev-fh-grid ev-fh-grid--std">${std_html}</div>
					<div class="ev-fh-grid ev-fh-grid--erp">${erp_html}${dyn_html}</div>
					<div class="ev-fh-tip">↑ ${__("Click any formula to insert. Hover for description.")}</div>
				</div>
			</div>
		`).appendTo(this.wrapper);

		this._$help_popup.find(".ev-fh-close").on("click", () => {
			this._$help_popup.addClass("hide");
		});

		// Click a formula row → insert into formula bar.
		// Delegated on the popup root so dynamically refreshed dyn rows are covered.
		this._$help_popup.on("click", ".ev-fh-row", (e) => {
			const formula = $(e.currentTarget).attr("data-formula");
			this.$formula.val(formula).focus();
			this._$help_popup.addClass("hide");
		});

		// Search filter — hide non-matching rows live
		this._$help_popup.find(".ev-fh-search").on("input", (e) => {
			const q = e.target.value.toLowerCase();
			this._$help_popup.find(".ev-fh-row").each((_, el) => {
				const text = ($(el).text() + $(el).attr("title")).toLowerCase();
				$(el).toggleClass("hide", !!q && !text.includes(q));
			});
			// Hide section headers with no visible rows
			this._$help_popup.find(".ev-fh-section").each((_, sec) => {
				const visible = $(sec).find(".ev-fh-row:not(.hide)").length;
				$(sec).toggleClass("hide", !visible);
			});
		});

		// Close on outside click
		$(document).on("click.ev-formula-help", (e) => {
			if (!this._$help_popup) return;
			if (!$(e.target).closest(".ev-formula-help-popup, .ev-fx-help").length) {
				this._$help_popup.addClass("hide");
			}
		});
	}

	destroy() {
		$(document).off("click.ev-formula-help");
		if (this._$help_popup) {
			this._$help_popup.remove();
			this._$help_popup = null;
		}
		$(this.wrapper).empty();
	}
};
