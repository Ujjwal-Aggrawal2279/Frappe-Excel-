/**
 * excel_view/components/toolbar.js
 *
 * Excel-style ribbon toolbar — 5 tabs:
 *   Home | Insert | Formulas | Data | View
 *
 * Always-visible Quick Access Bar above tabs holds workbook/view actions.
 *
 * Home:     Clipboard · Font · Borders · Color · Alignment+Merge · Number · Cond.Fmt
 * Insert:   Charts (Bar/Line/Pie/Donut/Scatter) · PivotTable
 * Formulas: Function Library groups · Show Formulas · Name Manager
 * Data:     Sort A→Z/Z→A · Filter · Insert Record · Delete Selected
 * View:     Freeze Panes · Gridlines
 */

frappe.provide("frappe.views.excel");

frappe.views.excel.ExcelToolbar = class ExcelToolbar {
	constructor(opts) {
		this.board = opts.board;
		this.wrapper = opts.wrapper;
		this._color_target = "color";
		this._last_text_color = "#000000";
		this._last_bg_color = "#FFFF00";
		this._painting = false;
		this._paint_fmt = null;
		this._active_tab = "home";
		this._border_color = "#000000";
		this._border_style = "solid";
		this._border_width = "1";
	}

	// ── Setup ─────────────────────────────────────────────────────────────────

	setup() {
		this._render();
		this._bind_events();
		this._sync_view_state();
	}

	_render() {
		const fonts = ["Calibri","Arial","Times New Roman","Courier New","Georgia","Verdana","Trebuchet MS"];
		const sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];

		$(this.wrapper).html(`
			<div class="ev-toolbar-outer">

				<!-- ── Quick Access Bar ─────────────────────────────────────── -->
				<div class="ev-quick-access">
					<div class="ev-wb-save-wrap">
						<button class="ev-tb-btn ev-qa-btn ev-wb-save-btn" title="${__("Save current view")}">
							<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5.5L11.5 1H3a1 1 0 0 0-1 1zm0 1h9l3 3.5V13H2V3zm3 6h6v1H5v-1zm0-2h6v1H5V7z"/></svg>
							<span class="ev-wb-save-label">${__("Save View")}</span>
						</button>
						<button class="ev-tb-btn ev-qa-btn ev-wb-deselect-btn hide" title="${__("Deselect")}">×</button>
						<button class="ev-tb-btn ev-qa-btn ev-wb-dropdown-arrow" title="${__("More")}">▾</button>
						<div class="ev-wb-dropdown hide">
							<button class="ev-wb-dd-item" data-action="save_as">${__("Save As…")}</button>
						</div>
					</div>
					<button class="ev-tb-btn ev-qa-btn ev-wb-views-btn" title="${__("Open a saved view")}">
						<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9z"/></svg>
						${__("Views")}
					</button>
					<div class="ev-qa-sep"></div>
					<button class="ev-tb-btn ev-qa-btn ev-columns-btn" title="${__("Choose Columns")}">
						<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="4" height="14" rx="1"/><rect x="6" y="1" width="4" height="14" rx="1"/><rect x="11" y="1" width="4" height="14" rx="1"/></svg>
						${__("Columns")}
					</button>
					<button class="ev-tb-btn ev-qa-btn ev-join-btn" title="${__("Link Sheets")}">
						<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="3" cy="8" r="2.2"/><circle cx="13" cy="3.5" r="2.2"/><circle cx="13" cy="12.5" r="2.2"/><line x1="5.1" y1="7.1" x2="10.9" y2="4.3"/><line x1="5.1" y1="8.9" x2="10.9" y2="11.7"/></svg>
						${__("Link Sheets")}
					</button>
				</div>

				<!-- ── Tab Strip ────────────────────────────────────────────── -->
				<div class="ev-ribbon-tabs" role="tablist">
					<div class="ev-ribbon-tab ev-ribbon-tab--active" data-tab="home" role="tab">${__("Home")}</div>
					<div class="ev-ribbon-tab" data-tab="insert" role="tab">${__("Insert")}</div>
					<!-- <div class="ev-ribbon-tab" data-tab="formulas" role="tab">${__("Formulas")}</div> -->
					<div class="ev-ribbon-tab" data-tab="data" role="tab">${__("Data")}</div>
					<div class="ev-ribbon-tab" data-tab="view" role="tab">${__("View")}</div>
				</div>

				<!-- ── Tab Content ──────────────────────────────────────────── -->
				<div class="ev-ribbon-content">

					<!-- HOME TAB ─────────────────────────────────────────────── -->
					<div class="ev-tab-pane ev-tab-pane--active" data-tab="home">

						${this._grp(__("Clipboard"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-tb-fmt-painter" title="${__("Format Painter")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M3 0a1 1 0 0 0-1 1v1H1a1 1 0 0 0 0 2h1v10a1 1 0 0 0 2 0V4h1a3 3 0 0 0 3-3V0H3zm0 2V1h5v0a1 1 0 0 1-1 1H3zM9 5a3 3 0 0 1 3 3v4h1a1 1 0 0 1 0 2h-4a1 1 0 0 1 0-2h1V8a1 1 0 0 0-1-1H9V5z"/></svg>
								<span class="ev-btn-label">${__("Format Painter")}</span>
							</button>
						`)}

						${this._grp(__("Font"), `
							<div class="ev-font-row">
								<select class="ev-tb-select ev-tb-font-family" title="${__("Font")}">
									${fonts.map(f => `<option value="${f}"${f==="Calibri"?" selected":""}>${f}</option>`).join("")}
								</select>
								<select class="ev-tb-select ev-tb-font-size" title="${__("Font Size")}">
									${sizes.map(s => `<option value="${s}"${s===12?" selected":""}>${s}</option>`).join("")}
								</select>
								<button class="ev-tb-btn ev-tb-font-grow" title="${__("Grow Font")}"><b>A</b><sup style="font-size:9px">▲</sup></button>
								<button class="ev-tb-btn ev-tb-font-shrink" title="${__("Shrink Font")}"><b>A</b><sub style="font-size:9px">▼</sub></button>
							</div>
							<div class="ev-font-row2">
								<button class="ev-tb-btn ev-fmt-btn ev-btn-bold" data-fmt="bold" title="${__("Bold")} (Ctrl+B)"><b>B</b></button>
								<button class="ev-tb-btn ev-fmt-btn ev-btn-italic" data-fmt="italic" title="${__("Italic")} (Ctrl+I)"><i>I</i></button>
								<button class="ev-tb-btn ev-fmt-btn ev-btn-underline" data-fmt="underline" title="${__("Underline")} (Ctrl+U)">U</button>
								<button class="ev-tb-btn ev-fmt-btn ev-btn-strike" data-fmt="strike" title="${__("Strikethrough")}"><s>S</s></button>
								<div class="ev-font-color-wrap">
									<button class="ev-tb-btn ev-color-trigger" data-type="color" title="${__("Font Color")}">
										<span class="ev-color-a">A</span>
										<span class="ev-tb-color-bar ev-text-bar" style="background:${this._last_text_color}"></span>
									</button>
									<button class="ev-tb-btn ev-color-trigger ev-color-fill-btn" data-type="bg" title="${__("Fill Color")}">
										<svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M2 10l7-7 3 3-7 7H2v-3z" stroke="currentColor" stroke-width="1.2" fill="rgba(100,100,100,0.12)"/><path d="M11 1l2 2" stroke="currentColor" stroke-width="1.5"/></svg>
										<span class="ev-tb-color-bar ev-bg-bar" style="background:${this._last_bg_color}"></span>
									</button>
									<button class="ev-tb-btn ev-border-trigger" title="${__("Borders")}">
										<svg width="13" height="13" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" rx="0" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" stroke-width="0.8"/><line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" stroke-width="0.8"/></svg>
										<span style="font-size:9px">▾</span>
									</button>
								</div>
							</div>
						`)}

						${this._grp(__("Alignment"), `
							<div class="ev-align-row">
								<button class="ev-tb-btn ev-fmt-btn" data-fmt="valignTop" title="${__("Align Top")}">
									<svg width="15" height="15" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="12" height="1.5" rx="0.5"/><rect x="3" y="3.5" width="3" height="8" rx="0.5"/><rect x="8" y="3.5" width="3" height="5" rx="0.5"/></svg>
								</button>
								<button class="ev-tb-btn ev-fmt-btn" data-fmt="valignMiddle" title="${__("Align Middle")}">
									<svg width="15" height="15" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="6.25" width="12" height="1.5" rx="0.5"/><rect x="3" y="2" width="3" height="10" rx="0.5"/><rect x="8" y="3.5" width="3" height="7" rx="0.5"/></svg>
								</button>
								<button class="ev-tb-btn ev-fmt-btn" data-fmt="valignBottom" title="${__("Align Bottom")}">
									<svg width="15" height="15" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="11.5" width="12" height="1.5" rx="0.5"/><rect x="3" y="2" width="3" height="8" rx="0.5"/><rect x="8" y="4.5" width="3" height="5" rx="0.5"/></svg>
								</button>
								<button class="ev-tb-btn ev-fmt-btn" data-fmt="wrap" title="${__("Wrap Text")}">
									<svg width="15" height="15" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.5"/><rect x="1" y="6" width="8" height="1.5" rx="0.5"/><path d="M10 4.5v5l2-2.5-2-2.5z"/><rect x="1" y="10" width="12" height="1.5" rx="0.5"/></svg>
								</button>
								<button class="ev-tb-btn ev-indent-decrease" title="${__("Decrease Indent")}">
									<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.5"/><rect x="1" y="6" width="9" height="1.5" rx="0.5"/><rect x="1" y="10" width="12" height="1.5" rx="0.5"/><path d="M11 5l2 2-2 2V5z"/></svg>
								</button>
								<button class="ev-tb-btn ev-indent-increase" title="${__("Increase Indent")}">
									<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="2" width="12" height="1.5" rx="0.5"/><rect x="4" y="6" width="9" height="1.5" rx="0.5"/><rect x="1" y="10" width="12" height="1.5" rx="0.5"/><path d="M1 5l2 2-2 2V5z"/></svg>
								</button>
							</div>
							<div class="ev-align-row2">
								<button class="ev-tb-btn ev-fmt-btn" data-fmt="alignLeft" title="${__("Align Left")}">
									<span class="ev-align-icon ev-align-left"></span>
								</button>
								<button class="ev-tb-btn ev-fmt-btn" data-fmt="alignCenter" title="${__("Align Center")}">
									<span class="ev-align-icon ev-align-center"></span>
								</button>
								<button class="ev-tb-btn ev-fmt-btn" data-fmt="alignRight" title="${__("Align Right")}">
									<span class="ev-align-icon ev-align-right"></span>
								</button>
								<div class="ev-merge-wrap">
									<button class="ev-tb-btn ev-merge-btn" title="${__("Merge & Center")}">
										<svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="5" height="12" rx="1" opacity=".35"/><rect x="8" y="1" width="5" height="12" rx="1" opacity=".35"/><path d="M4 6.5l-2 1.5 2 1.5V8h6v1.5l2-1.5-2-1.5V8H4z"/></svg>
									</button>
									<button class="ev-tb-btn ev-merge-dropdown-arrow" title="${__("Merge options")}"><span style="font-size:9px">▾</span></button>
									<div class="ev-merge-popup hide">
										<div class="ev-border-item" data-merge="center">${__("Merge & Center")}</div>
										<div class="ev-border-item" data-merge="across">${__("Merge Across")}</div>
										<div class="ev-border-item" data-merge="cells">${__("Merge Cells")}</div>
										<div class="ev-border-sep"></div>
										<div class="ev-border-item" data-merge="unmerge">${__("Unmerge Cells")}</div>
									</div>
								</div>
							</div>
						`)}

						${this._grp(__("Number"), `
							<div class="ev-num-row">
								<select class="ev-tb-select ev-numfmt-select" title="${__("Number Format")}">
									<option value="general">${__("General")}</option>
									<option value="number">${__("Number")}</option>
									<option value="currency">${__("Currency")}</option>
									<option value="accounting">${__("Accounting")}</option>
									<option value="short_date">${__("Short Date")}</option>
									<option value="percentage">${__("Percentage")}</option>
									<option value="fraction">${__("Fraction")}</option>
									<option value="scientific">${__("Scientific")}</option>
									<option value="text">${__("Text")}</option>
								</select>
							</div>
							<div class="ev-num-row2">
								<button class="ev-tb-btn ev-num-currency" title="${__("Currency")}"><b>$</b></button>
								<button class="ev-tb-btn ev-num-percent ev-fmt-btn" data-fmt="numfmt_pct" title="${__("Percent Style")}"><b>%</b></button>
								<button class="ev-tb-btn ev-num-comma" title="${__("Comma Style")}"><b>,</b></button>
								<button class="ev-tb-btn ev-num-inc-dec" data-decimal="inc" title="${__("Increase Decimal")}"><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><text x="0" y="12" font-size="10">.0</text><text x="9" y="9" font-size="8">+</text></svg></button>
								<button class="ev-tb-btn ev-num-inc-dec" data-decimal="dec" title="${__("Decrease Decimal")}"><svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><text x="0" y="12" font-size="10">.0</text><text x="9" y="9" font-size="8">–</text></svg></button>
							</div>
						`)}

						${this._grp(__("Styles"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-cf-open-btn" title="${__("Conditional Formatting")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="5" height="5" rx="1" fill="#e06c6c"/><rect x="8" y="1" width="5" height="5" rx="1" fill="#70b870"/><rect x="1" y="8" width="5" height="5" rx="1" fill="#70b870"/><rect x="8" y="8" width="5" height="5" rx="1" fill="#4c8abf"/></svg>
								<span class="ev-btn-label">${__("Conditional Formatting")}</span>
							</button>
						`)}

					</div><!-- /home pane -->

					<!-- INSERT TAB ───────────────────────────────────────────── -->
					<div class="ev-tab-pane" data-tab="insert">

						${this._grp(__("Charts"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-chart-btn" data-chart="bar" title="${__("Bar Chart")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 14" fill="currentColor"><rect x="1" y="4" width="3" height="10"/><rect x="5" y="2" width="3" height="12"/><rect x="9" y="6" width="3" height="8"/><rect x="13" y="0" width="3" height="14"/></svg>
								<span class="ev-btn-label">${__("Bar")}</span>
							</button>
							<button class="ev-tb-btn ev-tb-btn--lg ev-chart-btn" data-chart="line" title="${__("Line Chart")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1,12 5,6 9,9 13,2 16,5"/></svg>
								<span class="ev-btn-label">${__("Line")}</span>
							</button>
							<button class="ev-tb-btn ev-tb-btn--lg ev-chart-btn" data-chart="pie" title="${__("Pie Chart")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="currentColor"><path d="M7 7V1a6 6 0 0 1 6 6z" fill="#4c8abf"/><path d="M7 7H1a6 6 0 0 0 6 6z" fill="#70b870"/><path d="M7 7L1 7A6 6 0 0 1 7 1z" fill="#e06c6c"/><path d="M7 7l6 0A6 6 0 0 1 7 13z" fill="#f0a030"/></svg>
								<span class="ev-btn-label">${__("Pie")}</span>
							</button>
							<button class="ev-tb-btn ev-tb-btn--lg ev-chart-btn" data-chart="donut" title="${__("Donut Chart")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="currentColor"><circle cx="7" cy="7" r="6" fill="none" stroke="#4c8abf" stroke-width="3.5" stroke-dasharray="18 20"/><circle cx="7" cy="7" r="2.5" fill="white"/></svg>
								<span class="ev-btn-label">${__("Donut")}</span>
							</button>
							<button class="ev-tb-btn ev-tb-btn--lg ev-chart-btn" data-chart="scatter" title="${__("Scatter Chart")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="#4c8abf"><circle cx="3" cy="10" r="1.8"/><circle cx="6" cy="6" r="1.8"/><circle cx="9" cy="8" r="1.8"/><circle cx="11" cy="3" r="1.8"/><circle cx="4" cy="3" r="1.8"/></svg>
								<span class="ev-btn-label">${__("Scatter")}</span>
							</button>
						`)}

						${this._grp(__("Tables"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-pivot-btn" title="${__("PivotTable")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="1" width="5" height="5" rx="1" opacity=".5"/><rect x="8" y="1" width="5" height="5" rx="1" opacity=".9"/><rect x="1" y="8" width="5" height="5" rx="1" opacity=".9"/><rect x="8" y="8" width="5" height="5" rx="1" opacity=".45"/></svg>
								<span class="ev-btn-label">${__("PivotTable")}</span>
							</button>
						`)}

					</div><!-- /insert pane -->

					<!-- FORMULAS TAB ─────────────────────────────────────────── -->
					<div class="ev-tab-pane" data-tab="formulas">

						${this._grp(__("Function Library"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-autosum-btn" title="${__("AutoSum")}">
								<span class="ev-btn-icon ev-fn-sigma">Σ</span>
								<span class="ev-btn-label">${__("AutoSum")} ▾</span>
							</button>
							${this._fn_group_btn("financial", `<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><text x="2" y="12" font-size="12" font-weight="bold">$</text></svg>`, __("Financial"), ["FRAPPE_SUM","FRAPPE_AVG","FRAPPE_COUNT","GL_BALANCE","ITEM_PRICE","STOCK_QTY"])}
							${this._fn_group_btn("logical", `<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><text x="1" y="13" font-size="11" font-weight="600">IF</text></svg>`, __("Logical"), ["IF","AND","OR","NOT","IFERROR","IFS"])}
							${this._fn_group_btn("text", `<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><text x="0" y="13" font-size="12" font-weight="600">Aα</text></svg>`, __("Text"), ["CONCAT","LEFT","RIGHT","MID","UPPER","LOWER","LEN","TRIM"])}
							${this._fn_group_btn("date", `<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="3" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="1" y1="7" x2="15" y2="7" stroke="currentColor" stroke-width="1.3"/><rect x="4" y="1" width="2" height="4" rx="1"/><rect x="10" y="1" width="2" height="4" rx="1"/></svg>`, __("Date & Time"), ["TODAY","NOW","DATE","YEAR","MONTH","DAY","DAYS","NETWORKDAYS"])}
							${this._fn_group_btn("lookup", `<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6.5" cy="6.5" r="4"/><line x1="9.5" y1="9.5" x2="14" y2="14"/></svg>`, __("Lookup"), ["VLOOKUP","HLOOKUP","INDEX","MATCH","FRAPPE_GET"])}
							${this._fn_group_btn("math", `<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><text x="1" y="13" font-size="14">∑</text></svg>`, __("Math"), ["ROUND","ABS","FLOOR","CEILING","MOD","POWER","SUMIF","COUNTIF"])}
						`)}

						${this._grp(__("Formula Auditing"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-show-formulas-btn" title="${__("Show Formulas")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/></svg>
								<span class="ev-btn-label">${__("Show Formulas")}</span>
							</button>
						`)}

						${this._grp(__("Name Manager"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-name-manager-btn" title="${__("Name Manager")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 1a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3zM3 2.5A1.5 1.5 0 0 1 4.5 1H6a.5.5 0 0 0 0-1H4.5A2.5 2.5 0 0 0 2 2.5v11A2.5 2.5 0 0 0 4.5 16h7A2.5 2.5 0 0 0 14 13.5v-11A2.5 2.5 0 0 0 11.5 0H10a.5.5 0 0 0 0 1h1.5A1.5 1.5 0 0 1 13 2.5v11A1.5 1.5 0 0 1 11.5 15h-7A1.5 1.5 0 0 1 3 13.5v-11z"/><rect x="5" y="6" width="6" height="1"/><rect x="5" y="9" width="6" height="1"/><rect x="5" y="12" width="4" height="1"/></svg>
								<span class="ev-btn-label">${__("Names")}</span>
							</button>
						`)}

					</div><!-- /formulas pane -->

					<!-- DATA TAB ─────────────────────────────────────────────── -->
					<div class="ev-tab-pane" data-tab="data">

						${this._grp(__("Filter"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-filter-toggle-btn" title="${__("Toggle Filters")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="currentColor"><path d="M1 3h12v1.5L9 9v4l-4-2V9L1 4.5z" opacity=".85"/></svg>
								<span class="ev-btn-label">${__("Filter")}</span>
							</button>
						`)}

						${this._grp(__("Records"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-duplicate-record-btn" title="${__("Duplicate selected row as new record")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="currentColor"><rect x="1" y="4" width="7" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="4" y="1" width="7" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><line x1="7" y1="4" x2="7" y2="9" stroke="currentColor" stroke-width="1.3"/><line x1="4.5" y1="6.5" x2="9.5" y2="6.5" stroke="currentColor" stroke-width="1.3"/></svg>
								<span class="ev-btn-label">${__("Duplicate")}</span>
							</button>
							<button class="ev-tb-btn ev-tb-btn--lg ev-insert-record-btn" title="${__("Insert new record with smart defaults")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="#2e7d32"><rect x="6" y="1" width="2" height="12" rx="1"/><rect x="1" y="6" width="12" height="2" rx="1"/></svg>
								<span class="ev-btn-label">${__("Insert")}</span>
							</button>
							<button class="ev-tb-btn ev-tb-btn--lg ev-delete-records-btn" title="${__("Delete Selected Records")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="#c62828" stroke-width="1.3" stroke-linejoin="round"><path d="M2 4h10l-1 8H3L2 4zm4 2v5m2-5v5M5 2h4l1 2H4z"/></svg>
								<span class="ev-btn-label" style="color:#c62828">${__("Delete")}</span>
							</button>
						`)}

					</div><!-- /data pane -->

					<!-- VIEW TAB ─────────────────────────────────────────────── -->
					<div class="ev-tab-pane" data-tab="view">

						${this._grp(__("Freeze"), `
							<div class="ev-freeze-wrap">
								<button class="ev-tb-btn ev-tb-btn--lg ev-freeze-trigger" title="${__("Freeze Panes")}">
									<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="7" y1="1" x2="7" y2="13"/><line x1="1" y1="5" x2="13" y2="5"/><line x1="5" y1="3" x2="9" y2="3"/><line x1="5" y1="11" x2="9" y2="11"/></svg>
									<span class="ev-btn-label">${__("Freeze Panes")} ▾</span>
								</button>
								<div class="ev-border-popup ev-freeze-popup hide">
									<div class="ev-border-item" data-freeze="first_col">${__("Freeze First Column")}</div>
									<div class="ev-border-item" data-freeze="first_row">${__("Freeze First Row")}</div>
									<div class="ev-border-item" data-freeze="selection">${__("Freeze at Selection")}</div>
									<div class="ev-border-sep"></div>
									<div class="ev-border-item" data-freeze="unfreeze">${__("Unfreeze All")}</div>
								</div>
							</div>
						`)}

						${this._grp(__("Show"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-gridlines-btn" title="${__("Toggle Gridlines")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1"><rect x="1" y="1" width="12" height="12"/><line x1="5" y1="1" x2="5" y2="13"/><line x1="9" y1="1" x2="9" y2="13"/><line x1="1" y1="5" x2="13" y2="5"/><line x1="1" y1="9" x2="13" y2="9"/></svg>
								<span class="ev-btn-label ev-gridlines-label">${__("Gridlines")}</span>
							</button>
							<input type="checkbox" class="ev-gridlines-toggle" checked style="display:none">
						`)}


						${this._grp(__("Focus"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-focus-toggle" title="${__("Toggle Focus Cell Crosshair")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><line x1="7" y1="1" x2="7" y2="13"/><line x1="1" y1="7" x2="13" y2="7"/><circle cx="7" cy="7" r="2" fill="currentColor" stroke="none"/></svg>
								<span class="ev-btn-label ev-focus-label">${__("Focus Cell")}</span>
							</button>
							<div class="ev-focus-color-wrap">
								<button class="ev-tb-btn ev-focus-color-btn" title="${__("Focus Color")}">
									<span class="ev-focus-color-swatch" style="background:#217346"></span>
								</button>
							</div>
						`)}
					</div><!-- /view pane -->

				</div><!-- /ev-ribbon-content -->

			</div><!-- /ev-toolbar-outer -->

			<!-- Color palette popup (shared for text + fill) -->
			<div class="ev-palette-popup hide">
				${this._palette_html()}
			</div>

			<!-- Border presets popup -->
			<div class="ev-border-popup ev-border-main-popup hide">
				${this._border_popup_html()}
			</div>
		`);

		this.$toolbar = $(this.wrapper).find(".ev-toolbar-outer");
		this.$palette = $(this.wrapper).find(".ev-palette-popup");
		this.$font_family = this.$toolbar.find(".ev-tb-font-family");
		this.$font_size   = this.$toolbar.find(".ev-tb-font-size");
		this.$numfmt_sel  = this.$toolbar.find(".ev-numfmt-select");
		this.$border_popup = $(this.wrapper).find(".ev-border-main-popup");
	}

	// ── Helper: group wrapper with bottom label ───────────────────────────────

	_grp(label, content) {
		return `
			<div class="ev-ribbon-group">
				<div class="ev-ribbon-group-btns">${content}</div>
				<div class="ev-ribbon-group-name">${label}</div>
			</div>
		`;
	}

	// ── Helper: function group dropdown button ────────────────────────────────

	_fn_group_btn(id, icon_html, label, fns) {
		const items = fns.map(f =>
			`<div class="ev-border-item ev-fn-item" data-fn="${f}">${f}</div>`
		).join("");
		return `
			<div class="ev-fn-group-wrap" data-group="${id}">
				<button class="ev-tb-btn ev-tb-btn--lg ev-fn-group-btn" title="${label}">
					${icon_html}
					<span class="ev-btn-label">${label} ▾</span>
				</button>
				<div class="ev-border-popup ev-fn-popup hide">${items}</div>
			</div>
		`;
	}

	// ── Palette HTML ──────────────────────────────────────────────────────────

	_palette_html() {
		const THEME_BASES = [
			"#FFFFFF","#000000","#EEECE1","#1F497D",
			"#4F81BD","#C0504D","#9BBB59","#8064A2","#4BACC6","#F79646",
		];
		const VARIATIONS = [0.5, 0.35, 0.25, -0.25, -0.5];
		const STANDARD = [
			"#C00000","#FF0000","#FFC000","#FFFF00","#92D050",
			"#00B050","#00B0F0","#0070C0","#002060","#7030A0",
		];
		const swatch = (c) => `<span class="ev-swatch" data-color="${c}" style="background:${c}" title="${c}"></span>`;
		let theme_html = THEME_BASES.map(swatch).join("");
		for (const f of VARIATIONS) {
			theme_html += THEME_BASES.map(c => swatch(this._vary_color(c, f))).join("");
		}
		return `
			<div class="ev-pal-section">
				<span class="ev-pal-label">${__("Theme Colors")}</span>
				<div class="ev-pal-grid ev-pal-theme-grid">${theme_html}</div>
			</div>
			<div class="ev-pal-rule"></div>
			<div class="ev-pal-section">
				<span class="ev-pal-label">${__("Standard Colors")}</span>
				<div class="ev-pal-grid ev-pal-std-grid">${STANDARD.map(swatch).join("")}</div>
			</div>
			<div class="ev-pal-rule"></div>
			<div class="ev-pal-recent-wrap hide">
				<span class="ev-pal-label">${__("Recent Colors")}</span>
				<div class="ev-pal-grid ev-pal-recent-grid"></div>
				<div class="ev-pal-rule"></div>
			</div>
			<button class="ev-pal-more-btn">
				<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style="flex-shrink:0">
					<circle cx="2" cy="6" r="1.5"/><circle cx="6" cy="6" r="1.5"/><circle cx="10" cy="6" r="1.5"/>
				</svg>
				${__("More Colors...")}
			</button>
			<div class="ev-pal-custom-panel hide">
				<input type="color" class="ev-custom-color" value="#000000">
				<input type="text" class="ev-hex-input" placeholder="#000000" maxlength="7">
				<button class="ev-hex-apply-btn">OK</button>
			</div>
		`;
	}

	// ── Border popup HTML ─────────────────────────────────────────────────────

	_border_popup_html() {
		const item = (key, label) => `<div class="ev-border-item" data-border="${key}">${label}</div>`;
		return `
			<div class="ev-border-controls">
				<div class="ev-border-ctrl-row">
					<span class="ev-border-ctrl-label">${__("Color")}</span>
					<input type="color" class="ev-border-color-pick" value="#000000" title="${__("Border Color")}">
					<span class="ev-border-color-preview" style="background:#000000"></span>
				</div>
				<div class="ev-border-ctrl-row">
					<span class="ev-border-ctrl-label">${__("Style")}</span>
					<select class="ev-border-style-sel">
						<option value="solid">───── ${__("Solid")}</option>
						<option value="dashed">- - - ${__("Dashed")}</option>
						<option value="dotted">····· ${__("Dotted")}</option>
						<option value="double">══ ${__("Double")}</option>
					</select>
				</div>
				<div class="ev-border-ctrl-row">
					<span class="ev-border-ctrl-label">${__("Width")}</span>
					<select class="ev-border-width-sel">
						<option value="1">${__("Thin")} (1px)</option>
						<option value="2">${__("Medium")} (2px)</option>
						<option value="3">${__("Thick")} (3px)</option>
					</select>
				</div>
			</div>
			<div class="ev-border-sep"></div>
			${item("none",        "🚫 " + __("No Border"))}
			${item("all",         "⊞ " + __("All Borders"))}
			${item("outside",     "□ " + __("Outside Borders"))}
			${item("thick_box",   "■ " + __("Thick Box Border"))}
			<div class="ev-border-sep"></div>
			${item("bottom",      "─ " + __("Bottom Border"))}
			${item("top",         "‾ " + __("Top Border"))}
			${item("left",        "│ " + __("Left Border"))}
			${item("right",       "│ " + __("Right Border"))}
			<div class="ev-border-sep"></div>
			${item("thick_bottom","═ " + __("Thick Bottom Border"))}
			${item("double_bottom","═ " + __("Double Bottom Border"))}
			${item("top_thick_bottom","T " + __("Top and Thick Bottom"))}
		`;
	}

	// ── Events ────────────────────────────────────────────────────────────────

	_bind_events() {
		const $w = $(this.wrapper);

		// ── Tab switching ───────────────────────────────────────────────────
		$w.on("click", ".ev-ribbon-tab", (e) => {
			const tab = $(e.currentTarget).data("tab");
			this._switch_tab(tab);
		});

		// ── Quick Access actions ────────────────────────────────────────────
		$w.on("click", ".ev-columns-btn", () => this.board.open_field_picker());
		$w.on("click.ev-toolbar", ".ev-join-btn", () => this.board._open_join_canvas());

		// ── Format toggle buttons (bold/italic/wrap/align/valign) ───────────
		$w.on("click", ".ev-fmt-btn", (e) => {
			const fmt = $(e.currentTarget).data("fmt");
			if (fmt) this._toggle_format(fmt);
		});

		// ── Font family / size ──────────────────────────────────────────────
		this.$font_family.on("change", () => this._apply_format({ font: this.$font_family.val() }));
		this.$font_size.on("change", () => this._apply_format({ size: parseInt(this.$font_size.val(), 10) }));

		// ── Font grow / shrink ──────────────────────────────────────────────
		$w.on("click", ".ev-tb-font-grow", () => {
			const cur = parseInt(this.$font_size.val(), 10) || 12;
			const sizes = [8,9,10,11,12,14,16,18,20,24,28,36,48];
			const next = sizes.find(s => s > cur) || cur;
			this.$font_size.val(next);
			this._apply_format({ size: next });
		});
		$w.on("click", ".ev-tb-font-shrink", () => {
			const cur = parseInt(this.$font_size.val(), 10) || 12;
			const sizes = [8,9,10,11,12,14,16,18,20,24,28,36,48];
			const prev = [...sizes].reverse().find(s => s < cur) || cur;
			this.$font_size.val(prev);
			this._apply_format({ size: prev });
		});

		// ── Color triggers ──────────────────────────────────────────────────
		$w.on("click", ".ev-color-trigger", (e) => {
			e.stopPropagation();
			this._show_palette(e.currentTarget, $(e.currentTarget).data("type"));
		});
		this.$palette.on("click", ".ev-swatch", (e) => this._pick_color($(e.currentTarget).data("color")));
		this.$palette.on("click", ".ev-pal-more-btn", (e) => {
			e.stopPropagation();
			const $panel = this.$palette.find(".ev-pal-custom-panel");
			$panel.toggleClass("hide");
			if (!$panel.hasClass("hide")) {
				const cur = this._color_target === "color" ? this._last_text_color : this._last_bg_color;
				const safe = /^#[0-9A-Fa-f]{6}$/.test(cur) ? cur : "#000000";
				$panel.find(".ev-custom-color").val(safe);
				$panel.find(".ev-hex-input").val(safe);
			}
		});
		this.$palette.on("input", ".ev-custom-color", (e) => {
			this.$palette.find(".ev-hex-input").val(e.target.value);
		});
		this.$palette.on("input", ".ev-hex-input", (e) => {
			const v = e.target.value.trim();
			if (/^#[0-9A-Fa-f]{6}$/i.test(v)) this.$palette.find(".ev-custom-color").val(v);
		});
		this.$palette.on("click", ".ev-hex-apply-btn", () => {
			const hex = this.$palette.find(".ev-hex-input").val().trim().toLowerCase();
			const color = /^#[0-9a-f]{6}$/.test(hex) ? hex : this.$palette.find(".ev-custom-color").val();
			this._pick_color(color);
		});

		// ── Borders ─────────────────────────────────────────────────────────
		$w.on("click", ".ev-border-trigger", (e) => {
			e.stopPropagation();
			const btn = e.currentTarget;
			const rect = btn.getBoundingClientRect();
			const wr   = this.wrapper.getBoundingClientRect();
			this.$border_popup.css({ top: rect.bottom - wr.top + 2, left: rect.left - wr.left })
				.toggleClass("hide");
		});
		$w.on("click", ".ev-border-main-popup .ev-border-item", (e) => {
			const preset = $(e.currentTarget).data("border");
			this._apply_border_preset(preset);
			this.$border_popup.addClass("hide");
		});
		// Border color/style/width controls — keep popup open while changing
		$w.on("input change", ".ev-border-color-pick", (e) => {
			this._border_color = e.currentTarget.value;
			this.$border_popup.find(".ev-border-color-preview").css("background", this._border_color);
		});
		$w.on("change", ".ev-border-style-sel", (e) => {
			this._border_style = e.currentTarget.value;
		});
		$w.on("change", ".ev-border-width-sel", (e) => {
			this._border_width = e.currentTarget.value;
		});
		// Prevent popup from closing when clicking inside controls
		$w.on("click", ".ev-border-controls", (e) => e.stopPropagation());

		// ── Merge ───────────────────────────────────────────────────────────
		$w.on("click", ".ev-merge-btn", () => this._do_merge("center"));
		$w.on("click", ".ev-merge-dropdown-arrow", (e) => {
			e.stopPropagation();
			$(e.currentTarget).closest(".ev-merge-wrap").find(".ev-merge-popup").toggleClass("hide");
		});
		$w.on("click", ".ev-merge-popup .ev-border-item", (e) => {
			const mode = $(e.currentTarget).data("merge");
			this._do_merge(mode);
			$(e.currentTarget).closest(".ev-merge-popup").addClass("hide");
		});

		// ── Indent ───────────────────────────────────────────────────────────
		$w.on("click", ".ev-indent-decrease", () => this._apply_indent(-1));
		$w.on("click", ".ev-indent-increase", () => this._apply_indent(1));

		// ── Number Format ───────────────────────────────────────────────────
		this.$numfmt_sel.on("change", () => {
			const fmt = this.$numfmt_sel.val();
			this._apply_format({ numfmt: fmt, decimals: null });
		});
		$w.on("click", ".ev-num-currency", () => {
			this._apply_format({ numfmt: "currency" });
			this.$numfmt_sel.val("currency");
		});
		$w.on("click", ".ev-num-percent", () => {
			this._apply_format({ numfmt: "percentage" });
			this.$numfmt_sel.val("percentage");
		});
		$w.on("click", ".ev-num-comma", () => {
			this._apply_format({ numfmt: "number" });
			this.$numfmt_sel.val("number");
		});
		$w.on("click", ".ev-num-inc-dec", (e) => {
			const dir = $(e.currentTarget).data("decimal");
			this._change_decimals(dir === "inc" ? 1 : -1);
		});

		// ── Conditional Formatting ──────────────────────────────────────────
		$w.on("click", ".ev-cf-open-btn", () => {
			this.board.cf_manager?.open_dialog();
		});

		// ── Format Painter ──────────────────────────────────────────────────
		$w.on("click", ".ev-tb-fmt-painter", () => {
			if (this._painting) {
				// second click cancels
				this._painting = false;
				this._paint_grid = null;
				this._paint_rows = 0;
				this._paint_cols = 0;
				$(this.wrapper).find(".ev-tb-fmt-painter").removeClass("ev-active");
			} else {
				const sel = this.board.hot?.getSelectedLast();
				if (!sel) return;
				const r1 = Math.min(sel[0], sel[2]), r2 = Math.max(sel[0], sel[2]);
				const c1 = Math.min(sel[1], sel[3]), c2 = Math.max(sel[1], sel[3]);
				// Capture per-cell format grid so multi-cell source paints proportionally
				this._paint_rows = r2 - r1 + 1;
				this._paint_cols = c2 - c1 + 1;
				this._paint_grid = [];
				for (let r = r1; r <= r2; r++) {
					const row_fmts = [];
					for (let c = c1; c <= c2; c++) {
						row_fmts.push({ ...(this.board.format_store?.[`${r}:${c}`] || {}) });
					}
					this._paint_grid.push(row_fmts);
				}
				this._painting = true;
				$(this.wrapper).find(".ev-tb-fmt-painter").addClass("ev-active");
			}
		});

		// ── Insert tab: Charts ──────────────────────────────────────────────
		$w.on("click", ".ev-chart-btn", (e) => {
			const type = $(e.currentTarget).data("chart");
			this.board.chart_manager?.open_dialog(type);
		});

		// ── Insert tab: PivotTable ──────────────────────────────────────────
		$w.on("click", ".ev-pivot-btn", () => {
			this.board.pivot_builder?.open_dialog();
		});

		// ── Formulas tab: AutoSum ───────────────────────────────────────────
		$w.on("click", ".ev-autosum-btn", () => this._insert_autosum());

		// ── Formulas tab: function group dropdowns (portal — avoids ribbon clip) ──
		$w.on("click", ".ev-fn-group-btn", (e) => {
			e.stopPropagation();
			const $btn  = $(e.currentTarget);
			const $wrap = $btn.closest(".ev-fn-group-wrap");
			const group = $wrap.data("group");

			// Toggle: if already open for this group, close
			if ($("#ev-fn-portal").data("group") === group) {
				$("#ev-fn-portal").remove();
				return;
			}
			$("#ev-fn-portal").remove();

			// Collect fn items from the hidden inline popup
			const fns = $wrap.find(".ev-fn-item").map(function () {
				return $(this).data("fn");
			}).get();

			const items_html = fns.map((f) =>
				`<div class="ev-fn-portal-item" data-fn="${f}"
					style="padding:6px 14px;cursor:pointer;font-size:12px;white-space:nowrap;
					       color:var(--text-color);"
					onmouseenter="this.style.background='var(--bg-color)'"
					onmouseleave="this.style.background=''">${f}</div>`
			).join("");

			const rect = $btn[0].getBoundingClientRect();
			const $portal = $(`
				<div id="ev-fn-portal"
					style="position:fixed;top:${rect.bottom + 2}px;left:${rect.left}px;
					       z-index:20000;background:var(--fg-color);
					       border:1px solid var(--border-color);border-radius:4px;
					       padding:4px 0;min-width:170px;
					       box-shadow:0 4px 14px rgba(0,0,0,.18);
					       overflow-y:auto;max-height:280px">
					${items_html}
				</div>
			`).appendTo(document.body).data("group", group);

			$portal.on("click", ".ev-fn-portal-item", (ev) => {
				const fn = $(ev.currentTarget).data("fn");
				this._insert_function(fn);
				$("#ev-fn-portal").remove();
			});
		});

		// ── Formulas tab: Show Formulas ─────────────────────────────────────
		$w.on("click", ".ev-show-formulas-btn", (e) => {
			const board = this.board;
			board._show_formulas = !board._show_formulas;
			$(e.currentTarget).toggleClass("ev-active", board._show_formulas);
			board.hot?.render();
		});

		// ── Formulas tab: Name Manager ──────────────────────────────────────
		$w.on("click", ".ev-name-manager-btn", () => this._open_name_manager());

		// ── Data tab: Sort ──────────────────────────────────────────────────
		// ── Data tab: Filter ────────────────────────────────────────────────
		$w.on("click", ".ev-filter-toggle-btn", (e) => {
			$(e.currentTarget).toggleClass("ev-active");
			this.board.list_view?.$page?.find(".page-form")?.slideToggle(150);
		});

		// ── Data tab: Duplicate / Insert / Delete ───────────────────────────
		$w.on("click", ".ev-duplicate-record-btn", () => this._duplicate_record());
		$w.on("click", ".ev-insert-record-btn",    () => this._insert_record_dialog());
		$w.on("click", ".ev-delete-records-btn",   () => this._delete_selected());

		// ── View tab: Freeze Panes (portal popup — escapes ribbon overflow/backdrop-filter) ──
		$w.on("click", ".ev-freeze-trigger", (e) => {
			e.stopPropagation();
			const existing = $("#ev-freeze-portal");
			if (existing.length) { existing.remove(); return; }

			const rect = e.currentTarget.getBoundingClientRect();
			const $portal = $(`
				<div id="ev-freeze-portal" class="ev-freeze-popup" style="position:fixed;top:${rect.bottom + 2}px;left:${rect.left}px;z-index:10000">
					<div class="ev-border-item" data-freeze="first_col">${__("Freeze First Column")}</div>
					<div class="ev-border-item" data-freeze="first_row">${__("Freeze First Row")}</div>
					<div class="ev-border-item" data-freeze="selection">${__("Freeze at Selection")}</div>
					<div class="ev-border-sep"></div>
					<div class="ev-border-item" data-freeze="unfreeze">${__("Unfreeze All")}</div>
				</div>
			`).appendTo(document.body);

			$portal.on("click", ".ev-border-item", (ev) => {
				this._apply_freeze($(ev.currentTarget).data("freeze"));
				$portal.remove();
			});
		});

		// ── View tab: Gridlines ─────────────────────────────────────────────
		$w.on("click", ".ev-gridlines-btn", (e) => {
			const $cb   = $w.find(".ev-gridlines-toggle");
			const show  = !$cb.prop("checked");
			$cb.prop("checked", show);
			$(this.board.$wrapper).find(".ev-hot-container").toggleClass("ev-hide-gridlines", !show);
			$(e.currentTarget).toggleClass("ev-active", show);
			// Save as "hidden" flag so load logic (excel_hide_gridlines truthy = hidden) is consistent
			frappe.model.user_settings.save(this.board.doctype, "excel_hide_gridlines", !show);
		});

		// ── View tab: Focus Cell toggle ─────────────────────────────────────
		$w.on("click", ".ev-focus-toggle", (e) => {
			const enabled = !this.board._focus_enabled;
			this.board._toggle_focus_cell(enabled);
			$(e.currentTarget).toggleClass("ev-active", enabled);
			$(this.wrapper).find(".ev-focus-label").text(
				enabled ? __("Focus: ON") : __("Focus Cell")
			);
		});

		// ── View tab: Focus Color picker ─────────────────────────────────────
		$w.on("click", ".ev-focus-color-btn", (e) => {
			e.stopPropagation();
			const rect = e.currentTarget.getBoundingClientRect();
			$("#ev-focus-color-portal").remove();
			const COLORS = [
				"#000000","#7f7f7f","#c00000","#ff0000","#ff7f00","#ffff00","#00b050","#00b0f0","#0070c0","#7030a0",
				"#ffffff","#d9d9d9","#ffd966","#f4b183","#a9d18e","#9dc3e6","#5b9bd5","#ed7d31","#a5a5a5","#ffc000",
			];
			const $portal = $(`
				<div id="ev-focus-color-portal"
					style="position:fixed;top:${rect.bottom + 4}px;left:${rect.left}px;
					       z-index:20000;background:var(--fg-color);
					       border:1px solid var(--border-color);border-radius:4px;
					       padding:8px;box-shadow:0 4px 14px rgba(0,0,0,.18);">
					<div style="display:grid;grid-template-columns:repeat(10,16px);gap:2px;">
						${COLORS.map(c => `<div class="ev-focus-swatch-item" data-color="${c}"
							style="width:16px;height:16px;background:${c};border:1px solid rgba(0,0,0,.25);cursor:pointer;border-radius:2px;"
							title="${c}"></div>`).join("")}
					</div>
				</div>
			`).appendTo(document.body);
			$portal.on("click", ".ev-focus-swatch-item", (ev) => {
				const color = $(ev.currentTarget).data("color");
				this.board._set_focus_color(color);
				$(this.wrapper).find(".ev-focus-color-swatch").css("background", color);
				$portal.remove();
			});
			setTimeout(() => $(document).one("click.ev-focus-portal", () => $portal.remove()), 100);
		});

		// ── Close popups on outside click ───────────────────────────────────
		$(document).on("click.ev-toolbar", (e) => {
			if (!$(e.target).closest(".ev-palette-popup, .ev-color-trigger").length) {
				this.$palette.addClass("hide");
			}
			if (!$(e.target).closest(".ev-border-main-popup, .ev-border-trigger").length) {
				this.$border_popup.addClass("hide");
			}
			if (!$(e.target).closest(".ev-merge-wrap").length) {
				$w.find(".ev-merge-popup").addClass("hide");
			}
			if (!$(e.target).closest(".ev-freeze-wrap, #ev-freeze-portal").length) {
				$("#ev-freeze-portal").remove();
			}
			if (!$(e.target).closest(".ev-fn-group-wrap, #ev-fn-portal").length) {
				$("#ev-fn-portal").remove();
			}
		});
	}

	// ── Tab switching ─────────────────────────────────────────────────────────

	_switch_tab(tab) {
		this._active_tab = tab;
		$(this.wrapper).find(".ev-ribbon-tab").each((_, el) => {
			$(el).toggleClass("ev-ribbon-tab--active", $(el).data("tab") === tab);
		});
		$(this.wrapper).find(".ev-tab-pane").each((_, el) => {
			$(el).toggleClass("ev-tab-pane--active", $(el).data("tab") === tab);
		});
	}

	// ── Public API ────────────────────────────────────────────────────────────

	sync(row, col) {
		const range = this._get_range() || { r1: row, c1: col, r2: row, c2: col };
		const fmt = this.board.format_store?.[`${row}:${col}`] || {};

		// Toggle buttons
		const ALIGN_MAP  = { alignLeft: "left", alignCenter: "center", alignRight: "right" };
		const VALIGN_MAP = { valignTop: "top", valignMiddle: "middle", valignBottom: "bottom" };
		$(this.wrapper).find(".ev-fmt-btn").each((_, btn) => {
			const f = $(btn).data("fmt");
			if (!f) return;
			if (f.startsWith("align")) {
				const val = ALIGN_MAP[f];
				let all = true;
				outer: for (let r = range.r1; r <= range.r2; r++) {
					for (let c = range.c1; c <= range.c2; c++) {
						if ((this.board.format_store?.[`${r}:${c}`]?.align || null) !== val) { all = false; break outer; }
					}
				}
				$(btn).toggleClass("ev-active", all);
			} else if (f.startsWith("valign")) {
				const val = VALIGN_MAP[f];
				let all = true;
				outer2: for (let r = range.r1; r <= range.r2; r++) {
					for (let c = range.c1; c <= range.c2; c++) {
						const cv = this.board.format_store?.[`${r}:${c}`]?.valign || "middle";
						if (cv !== val) { all = false; break outer2; }
					}
				}
				$(btn).toggleClass("ev-active", all);
			} else if (f !== "numfmt_pct") {
				$(btn).toggleClass("ev-active", this._all_have(range, f));
			}
		});

		// Dropdowns (top-left cell)
		this.$font_family.val(fmt.font || "Calibri");
		this.$font_size.val(fmt.size || 12);
		this.$numfmt_sel.val(fmt.numfmt || "general");

		// Color bars
		const tc = fmt.color || "#000000";
		const bc = fmt.bg    || "#FFFF00";
		this._last_text_color = tc;
		this._last_bg_color   = bc;
		$(this.wrapper).find(".ev-text-bar").css("background", tc);
		$(this.wrapper).find(".ev-bg-bar").css("background", bc);
	}

	/** Sync View-tab UI state (gridlines + focus cell) from current board state. */
	_sync_view_state() {
		const hidden = frappe.get_user_settings(this.board.doctype)?.excel_hide_gridlines;
		if (hidden) {
			$(this.wrapper).find(".ev-gridlines-toggle").prop("checked", false);
			$(this.wrapper).find(".ev-gridlines-btn").removeClass("ev-active");
		}
		// V3.1 — Sync Focus Cell button state
		if (this.board._focus_enabled) {
			$(this.wrapper).find(".ev-focus-toggle").addClass("ev-active");
			$(this.wrapper).find(".ev-focus-label").text(__("Focus: ON"));
		}
		if (this.board._focus_color) {
			$(this.wrapper).find(".ev-focus-color-swatch").css("background", this.board._focus_color);
		}
	}

	toggle(fmt_key) {
		this._toggle_format(fmt_key);
	}

	apply_paint(row, col) {
		if (!this._painting || !this._paint_grid) return;
		if (!this.board.format_store) this.board.format_store = {};
		const nRows = this._paint_rows, nCols = this._paint_cols;
		for (let dr = 0; dr < nRows; dr++) {
			for (let dc = 0; dc < nCols; dc++) {
				const k = `${row + dr}:${col + dc}`;
				// Replace entire cell format with painted format (handles clearing bold etc.)
				const src = this._paint_grid[dr][dc];
				if (Object.keys(src).length === 0) {
					delete this.board.format_store[k];
				} else {
					this.board.format_store[k] = { ...src };
				}
			}
		}
		this.board.hot.render();
		this.board._schedule_format_store_save?.();
		this._painting = false;
		this._paint_grid = null;
		this._paint_rows = 0;
		this._paint_cols = 0;
		$(this.wrapper).find(".ev-tb-fmt-painter").removeClass("ev-active");
	}

	destroy() {
		$(document).off("click.ev-toolbar");
		$("#ev-freeze-portal").remove();
		$(this.wrapper).empty();
	}

	// ── Private helpers ───────────────────────────────────────────────────────

	_get_range() {
		const sel = this.board.hot?.getSelectedLast();
		if (!sel) return null;
		return {
			r1: Math.min(sel[0], sel[2]),
			c1: Math.min(sel[1], sel[3]),
			r2: Math.max(sel[0], sel[2]),
			c2: Math.max(sel[1], sel[3]),
		};
	}

	_toggle_format(fmt_key) {
		const range = this._get_range();
		if (!range) return;
		let recorded_fmt = null;
		if (fmt_key.startsWith("align")) {
			const val = { alignLeft: "left", alignCenter: "center", alignRight: "right" }[fmt_key];
			this._apply_to_range(range, (fmt) => { fmt.align = fmt.align === val ? null : val; });
			recorded_fmt = { align: val };
		} else if (fmt_key.startsWith("valign")) {
			const val = { valignTop: "top", valignMiddle: "middle", valignBottom: "bottom" }[fmt_key];
			this._apply_to_range(range, (fmt) => { fmt.valign = val; });
			recorded_fmt = { valign: val };
		} else if (fmt_key === "numfmt_pct") {
			this._apply_format({ numfmt: "percentage" });
			this.$numfmt_sel.val("percentage");
			return;
		} else {
			const all_on = this._all_have(range, fmt_key);
			this._apply_to_range(range, (fmt) => { fmt[fmt_key] = !all_on; });
			recorded_fmt = { [fmt_key]: !all_on };
		}
		// V3.1 — Record for F4 Repeat Last Action
		if (recorded_fmt) {
			this.board._last_action = { type: "format", fmt: recorded_fmt };
		}
		const HEIGHT_FMT = new Set(["bold", "wrap"]);
		if (HEIGHT_FMT.has(fmt_key)) {
			this.board.refresh_row_heights(range.r1, range.r2);
		} else {
			this.board.hot.render();
		}
		const sel = this.board.hot.getSelectedLast();
		if (sel) this.sync(sel[0], sel[1]);
	}

	_apply_format(fmt_obj) {
		const range = this._get_range();
		if (!range) return;
		this._apply_to_range(range, (fmt) => Object.assign(fmt, fmt_obj));
		if (fmt_obj.size != null) {
			this.board.refresh_row_heights(range.r1, range.r2);
		} else {
			this.board.hot.render();
		}
		// V3.1 — Record for F4 Repeat Last Action
		if ("numfmt" in fmt_obj) {
			this.board._last_action = { type: "numfmt", numfmt: fmt_obj.numfmt };
		} else {
			this.board._last_action = { type: "format", fmt: { ...fmt_obj } };
		}
	}

	// V3.1 — Apply format to an explicit range (used by _repeat_last_action)
	_apply_format_to_range(fmt_obj, r1, c1, r2, c2) {
		this._apply_to_range({ r1, c1, r2, c2 }, (fmt) => Object.assign(fmt, fmt_obj));
		this.board.hot.render();
	}

	_change_decimals(delta) {
		const range = this._get_range();
		if (!range) return;
		this._apply_to_range(range, (fmt) => {
			const base = fmt.decimals ?? 2;
			fmt.decimals = Math.max(0, Math.min(10, base + delta));
		});
		this.board.hot.render();
	}

	_apply_indent(delta) {
		const range = this._get_range();
		if (!range) return;
		this._apply_to_range(range, (fmt) => {
			fmt.indent = Math.max(0, (fmt.indent || 0) + delta);
		});
		this.board.hot.render();
	}

	_apply_border_preset(preset) {
		const range = this._get_range();
		if (!range) return;
		const c = this._border_color;
		const s = this._border_style;
		const w = this._border_width;
		const thin   = `${w}px ${s} ${c}`;
		const thick  = `${Math.max(2, parseInt(w)+1)}px ${s} ${c}`;
		const dbl    = `${Math.max(2, parseInt(w))}px double ${c}`;

		const PRESETS = {
			none:             { top:"", right:"", bottom:"", left:"" },
			all:              { top:thin, right:thin, bottom:thin, left:thin },
			thick_box:        { top:thick, right:thick, bottom:thick, left:thick },
			bottom:           { top:"", right:"", bottom:thin, left:"" },
			top:              { top:thin, right:"", bottom:"", left:"" },
			left:             { top:"", right:"", bottom:"", left:thin },
			right:            { top:"", right:thin, bottom:"", left:"" },
			thick_bottom:     { top:"", right:"", bottom:thick, left:"" },
			double_bottom:    { top:"", right:"", bottom:dbl, left:"" },
			top_thick_bottom: { top:thin, right:"", bottom:thick, left:"" },
		};

		if (preset === "outside") {
			// Apply per-cell, only outer edges
			this._apply_to_range(range, (fmt, r, c) => {
				fmt.borders = {
					top:    r === range.r1 ? thin : "",
					bottom: r === range.r2 ? thin : "",
					left:   c === range.c1 ? thin : "",
					right:  c === range.c2 ? thin : "",
				};
			});
		} else if (PRESETS[preset]) {
			const b = PRESETS[preset];
			this._apply_to_range(range, (fmt) => { fmt.borders = { ...b }; });
		}

		// Mirror top-edge border onto column header bottom for selected columns
		this._apply_header_borders(range, preset, thin, thick);
		this.board.hot.render();
		// V3.1 — Record for F4 Repeat Last Action
		this.board._last_action = { type: "border", preset };
	}

	_apply_header_borders(range, preset, thin, thick) {
		const fs = this.board.format_store;
		const c1 = range.c1, c2 = range.c2;
		for (let c = c1; c <= c2; c++) {
			const key = `h_${c}`;
			if (!fs[key]) fs[key] = {};
			if (preset === "none") {
				fs[key].borders = { top:"", right:"", bottom:"", left:"" };
			} else if (["all", "outside", "thick_box"].includes(preset)) {
				const w = preset === "thick_box" ? thick : thin;
				fs[key].borders = {
					top: "", bottom: w,
					left: c === c1 ? w : "",
					right: c === c2 ? w : "",
				};
			} else if (preset === "top") {
				if (!fs[key].borders) fs[key].borders = { top:"", right:"", bottom:"", left:"" };
				fs[key].borders.bottom = thin;
			} else {
				// other presets don't affect headers
			}
		}
	}

	_do_merge(mode) {
		const hot = this.board.hot;
		const range = this._get_range();
		if (!range) return;
		const plugin = hot.getPlugin("mergeCells");

		if (mode === "unmerge") {
			plugin.unmerge(range.r1, range.c1, range.r2, range.c2);
		} else if (mode === "across") {
			// Merge each row separately
			for (let r = range.r1; r <= range.r2; r++) {
				plugin.merge(r, range.c1, r, range.c2);
			}
		} else {
			// center or cells
			plugin.merge(range.r1, range.c1, range.r2, range.c2);
			if (mode === "center") {
				this._apply_to_range(range, (fmt) => { fmt.align = "center"; fmt.valign = "middle"; });
			}
		}
		hot.render();
	}

	_apply_freeze(mode) {
		const hot   = this.board.hot;
		const board = this.board;
		const sel   = hot.getSelectedLast();

		let cols = board._frozen_cols || 0;   // keep current col freeze by default
		let rows = board._frozen_rows || 0;   // keep current row freeze by default

		if (mode === "first_col") {
			cols = 1; rows = 0;
		} else if (mode === "first_row") {
			cols = 0; rows = 1;
		} else if (mode === "selection" && sel) {
			// Excel "Freeze Panes": freeze everything to-the-left AND above selected cell
			cols = Math.min(sel[1], sel[3]);   // col index = count of cols to freeze
			rows = Math.min(sel[0], sel[2]);   // row index = count of rows to freeze
		} else if (mode === "unfreeze") {
			cols = 0; rows = 0;
		}

		// Apply col freeze via _set_freeze (handles CSS class + persistence + alert)
		if (cols !== (board._frozen_cols || 0)) {
			board._set_freeze?.(cols);
		} else if (cols === 0 && mode === "unfreeze") {
			board._set_freeze?.(0);
		}

		// Apply row freeze separately
		board._frozen_rows = rows;
		hot.updateSettings({ fixedRowsTop: rows });
		frappe.model.user_settings.save(board.doctype, "excel_view_freeze_rows", rows);

		if (rows > 0) {
			frappe.show_alert({ message: __("{0} row(s) frozen", [rows]), indicator: "green" }, 2);
		} else if (mode === "unfreeze") {
			frappe.show_alert({ message: __("Rows unfrozen"), indicator: "blue" }, 2);
		}

		// Re-render after HOT recalculates frozen layout
		setTimeout(() => {
			hot.render();
			hot.refreshDimensions?.();
		}, 30);
	}

	_sort_col(dir) {
		const sel = this.board.hot?.getSelectedLast();
		if (!sel) return;
		const col_idx = Math.min(sel[1], sel[3]);
		const col_cfg = this.board.columns?.[col_idx];
		if (!col_cfg?.data) {
			frappe.show_alert({ message: __("Select a column to sort by"), indicator: "orange" }, 3);
			return;
		}
		const lv = this.board.list_view;
		lv.sort_by = col_cfg.data;
		lv.sort_order = dir === "asc" ? "asc" : "desc";
		lv.start = 0;
		lv.last_args = null; // bypass no_change throttle
		lv.refresh();
	}

	async _delete_selected() {
		if (!this.board.list_view?.can_write) {
			frappe.show_alert({ message: __("You don't have permission to delete"), indicator: "red" }, 3);
			return;
		}
		const sel = this.board.hot?.getSelectedLast();
		if (!sel) return;
		const r1 = Math.min(sel[0], sel[2]);
		const r2 = Math.max(sel[0], sel[2]);
		const names = [];
		for (let r = r1; r <= r2; r++) {
			const name = this.board.list_view.data[r]?.name;
			if (name) names.push(name);
		}
		if (!names.length) return;

		const confirmed = await new Promise(resolve => {
			frappe.confirm(
				__("Delete {0} record(s)? This cannot be undone.", [names.length]),
				() => resolve(true),
				() => resolve(false)
			);
		});
		if (!confirmed) return;

		frappe.show_progress(__("Deleting..."), 0, names.length);
		let done = 0;
		for (const name of names) {
			await frappe.call("frappe.client.delete", { doctype: this.board.doctype, name });
			done++;
			frappe.show_progress(__("Deleting..."), done, names.length);
		}
		frappe.hide_progress();
		frappe.show_alert({ message: __("Deleted {0} record(s)", [names.length]), indicator: "green" }, 3);
		this.board.list_view.refresh();
	}

	// ── Duplicate / Smart Insert ─────────────────────────────────────────────

	/**
	 * Duplicate the selected row as a new record.
	 * Copies all user-editable field values from the source row,
	 * strips system fields, then opens the smart insert dialog pre-filled.
	 */
	async _duplicate_record() {
		if (!this.board.list_view?.can_write) {
			frappe.show_alert({ message: __("You don't have write permission"), indicator: "red" }, 3);
			return;
		}
		const sel = this.board.hot?.getSelectedLast();
		if (!sel) {
			frappe.show_alert({ message: __("Select a row to duplicate"), indicator: "orange" }, 3);
			return;
		}
		const row_idx = Math.min(sel[0], sel[2]);
		const row_data = this.board.list_view.data?.[row_idx];
		if (!row_data || row_data._is_new) return;

		// Strip system/readonly fields — keep only user-editable values
		const SYSTEM = new Set(["name","creation","modified","modified_by","owner",
			"docstatus","idx","_user_tags","_comments","_assign","_liked_by","_seen",
			"amended_from","naming_series"]);
		const prefill = {};
		for (const [k, v] of Object.entries(row_data)) {
			if (!SYSTEM.has(k) && !k.startsWith("_") && v != null && v !== "") {
				prefill[k] = v;
			}
		}
		this.board._start_inline_insert(prefill, /* is_duplicate */ true);
	}

	/**
	 * Contextual pattern detection — scans visible rows, picks the most-frequent
	 * value per field (≥2 occurrences) as a hint.
	 * System/meta/PS defaults are now owned by board._start_inline_insert.
	 * @param {boolean} is_duplicate
	 * @returns {Object} pattern_defaults
	 */
	_detect_patterns(is_duplicate) {
		if (is_duplicate) return {};
		const dt   = this.board.doctype;
		const meta = frappe.get_meta(dt);
		if (!meta) return {};

		const SCALAR_TYPES = new Set([
			"Data","Link","Select","Date","Datetime","Time","Int","Float","Currency",
			"Percent","Small Text","Text","Long Text","Check","Dynamic Link",
			"Date Range","Phone","Autocomplete","Color","Rating",
		]);
		const SKIP_FNS = new Set(["name","creation","modified","modified_by",
			"owner","docstatus","idx","naming_series"]);
		const meta_fields = (meta.fields || []).filter(f =>
			SCALAR_TYPES.has(f.fieldtype) && !f.read_only && !f.hidden && !SKIP_FNS.has(f.fieldname));

		const freq = {};
		(this.board.list_view.data || [])
			.filter(r => !r._is_new)
			.slice(0, 40)
			.forEach(row => {
				meta_fields.forEach(f => {
					const v = row[f.fieldname];
					if (v != null && v !== "") {
						freq[f.fieldname] = freq[f.fieldname] || {};
						freq[f.fieldname][v] = (freq[f.fieldname][v] || 0) + 1;
					}
				});
			});

		const patterns = {};
		Object.entries(freq).forEach(([fn, counts]) => {
			const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
			if (top?.[1] >= 2) patterns[fn] = top[0];
		});
		return patterns;
	}

	/**
	 * Smart Insert — pattern detection provides contextual hints;
	 * full default resolution (system defaults, meta defaults, PS overrides,
	 * fetch_from chain) is handled dynamically in board._start_inline_insert.
	 */
	_insert_record_dialog(prefill = {}, is_duplicate = false) {
		if (!this.board.list_view?.can_write) {
			frappe.show_alert({ message: __("You don't have write permission"), indicator: "red" }, 3);
			return;
		}
		const dt   = this.board.doctype;
		const meta = frappe.get_meta(dt);
		if (!meta) { frappe.new_doc(dt); return; }

		const pattern_defaults = this._detect_patterns(is_duplicate);
		// Pattern hints are lowest priority — board's model defaults + prefill override them
		this.board._start_inline_insert({ ...pattern_defaults, ...prefill }, is_duplicate);
	}

	_insert_autosum() {
		const sel = this.board.hot?.getSelectedLast();
		if (!sel) return;
		const c    = Math.min(sel[1], sel[3]);
		const r1   = Math.min(sel[0], sel[2]);
		const r2   = Math.max(sel[0], sel[2]);
		const col_letter = this.board._col_letter ? this.board._col_letter(c + 1) : String.fromCharCode(65 + c);
		const formula = `=SUM(${col_letter}${r1 + 1}:${col_letter}${r2 + 1})`;
		this.board.hot.setDataAtCell(r2 + 1, c, formula);
	}

	_insert_function(fn_name) {
		const sel = this.board.hot?.getSelectedLast();
		if (!sel) return;
		const r = Math.min(sel[0], sel[2]);
		const c = Math.min(sel[1], sel[3]);
		// Force text editor so formula strings survive CurrencyEditor / NumericEditor commit
		this.board.hot.setCellMeta(r, c, "editor", "text");
		this.board.hot.setDataAtCell(r, c, `=${fn_name}(`);
		setTimeout(() => {
			this.board.hot.selectCell(r, c);
			try {
				const editor = this.board.hot.getActiveEditor();
				editor?.beginEditing();
				// Move cursor to end — prevents browser select-all-on-focus replacing the prefix
				setTimeout(() => {
					const ta = editor?.TEXTAREA;
					if (ta) { const n = ta.value.length; ta.setSelectionRange(n, n); }
				}, 0);
			} catch (_) {}
		}, 0);
	}

	_open_name_manager() {
		const doctype   = this.board.doctype;
		const hf        = this.board.formula_bridge?.hf;

		const dialog = new frappe.ui.Dialog({
			title: __("Name Manager"),
			fields: [{ fieldtype: "HTML", fieldname: "nm_body" }],
		});

		const render = () => {
			const rows = Object.entries(frappe.get_user_settings(doctype)?.excel_named_ranges || {});
			dialog.get_field("nm_body").$wrapper.html(`
				<table class="table table-bordered" style="font-size:13px">
					<thead><tr><th>${__("Name")}</th><th>${__("Range")}</th><th></th></tr></thead>
					<tbody>
					${rows.map(([n, ref]) => `
						<tr>
							<td>${frappe.utils.escape_html(n)}</td>
							<td><code>${frappe.utils.escape_html(ref)}</code></td>
							<td><button class="btn btn-xs btn-danger ev-nm-del" data-name="${frappe.utils.escape_html(n)}">${__("Delete")}</button></td>
						</tr>`).join("")}
					${!rows.length ? `<tr><td colspan="3" class="text-muted text-center">${__("No named ranges")}</td></tr>` : ""}
					</tbody>
				</table>
				<div style="display:flex;gap:8px;margin-top:10px">
					<input type="text" class="form-control ev-nm-name" placeholder="${__("Name")}" style="width:140px">
					<input type="text" class="form-control ev-nm-ref" placeholder="A1:B10" style="flex:1">
					<button class="btn btn-sm btn-primary ev-nm-add">${__("Add")}</button>
				</div>
			`);
			dialog.get_field("nm_body").$wrapper.off("click").on("click", ".ev-nm-del", (e) => {
				const name = $(e.currentTarget).data("name");
				const nr = frappe.get_user_settings(doctype)?.excel_named_ranges || {};
				delete nr[name];
				frappe.model.user_settings.save(doctype, "excel_named_ranges", nr);
				hf?.removeNamedExpression(name);
				render();
			}).on("click", ".ev-nm-add", () => {
				const name = dialog.get_field("nm_body").$wrapper.find(".ev-nm-name").val().trim();
				const ref  = dialog.get_field("nm_body").$wrapper.find(".ev-nm-ref").val().trim();
				if (!name || !ref) return;
				const nr = frappe.get_user_settings(doctype)?.excel_named_ranges || {};
				nr[name] = ref;
				frappe.model.user_settings.save(doctype, "excel_named_ranges", nr);
				try { hf?.addNamedExpression(name, `=${ref}`); } catch(e) { /* ignore */ }
				render();
			});
		};

		dialog.show();
		render();
	}

	// ── Color palette helpers ─────────────────────────────────────────────────

	_show_palette(trigger_el, type) {
		this._color_target = type;
		this._refresh_recent_swatches();
		this.$palette.find(".ev-pal-custom-panel").addClass("hide");
		const btn_rect  = trigger_el.getBoundingClientRect();
		const wrap_rect = this.wrapper.getBoundingClientRect();
		this.$palette.css({
			top:  btn_rect.bottom - wrap_rect.top + 2,
			left: Math.max(0, btn_rect.left - wrap_rect.left),
		}).removeClass("hide");
	}

	_pick_color(color) {
		const range = this._get_range();
		if (range) {
			const key = this._color_target === "color" ? "color" : "bg";
			this._apply_to_range(range, (fmt) => { fmt[key] = color; });
			this.board.hot.render();
			if (key === "color") {
				this._last_text_color = color;
				$(this.wrapper).find(".ev-text-bar").css("background", color);
			} else {
				this._last_bg_color = color;
				$(this.wrapper).find(".ev-bg-bar").css("background", color);
			}
		}
		this._save_recent(color);
		this.$palette.addClass("hide");
	}

	_apply_to_range(range, fn) {
		if (!this.board.format_store) this.board.format_store = {};
		for (let r = range.r1; r <= range.r2; r++) {
			for (let c = range.c1; c <= range.c2; c++) {
				const k = `${r}:${c}`;
				if (!this.board.format_store[k]) this.board.format_store[k] = {};
				fn(this.board.format_store[k], r, c);
				if (!Object.values(this.board.format_store[k]).some(v => v !== null && v !== undefined && v !== "" && v !== false)) {
					delete this.board.format_store[k];
				}
			}
		}
		this.board._schedule_format_store_save?.();
	}

	_all_have(range, fmt_key) {
		for (let r = range.r1; r <= range.r2; r++) {
			for (let c = range.c1; c <= range.c2; c++) {
				if (!this.board.format_store?.[`${r}:${c}`]?.[fmt_key]) return false;
			}
		}
		return true;
	}

	_vary_color(hex, factor) {
		const r = parseInt(hex.slice(1,3), 16);
		const g = parseInt(hex.slice(3,5), 16);
		const b = parseInt(hex.slice(5,7), 16);
		let nr, ng, nb;
		if (factor > 0) {
			nr = Math.round(r + (255-r)*factor);
			ng = Math.round(g + (255-g)*factor);
			nb = Math.round(b + (255-b)*factor);
		} else {
			const s = -factor;
			nr = Math.round(r*(1-s));
			ng = Math.round(g*(1-s));
			nb = Math.round(b*(1-s));
		}
		return "#" + [nr,ng,nb].map(v => Math.min(255,Math.max(0,v)).toString(16).padStart(2,"0")).join("");
	}

	_load_recent() {
		try { return JSON.parse(localStorage.getItem("ev_recent_colors") || "[]"); }
		catch { return []; }
	}

	_save_recent(color) {
		let recent = this._load_recent().filter(c => c !== color);
		recent.unshift(color);
		localStorage.setItem("ev_recent_colors", JSON.stringify(recent.slice(0, 10)));
	}

	_refresh_recent_swatches() {
		const recent = this._load_recent();
		const $wrap = this.$palette.find(".ev-pal-recent-wrap");
		if (!recent.length) { $wrap.addClass("hide"); return; }
		$wrap.removeClass("hide");
		$wrap.find(".ev-pal-recent-grid").html(
			recent.map(c => `<span class="ev-swatch" data-color="${c}" style="background:${c}" title="${c}"></span>`).join("")
		);
	}
};
