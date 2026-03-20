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
					<div class="ev-qa-sep"></div>
					<!-- ── Period Picker ──────────────────────────────────── -->
					<div class="ev-period-wrap">
						<button class="ev-tb-btn ev-qa-btn ev-period-btn" title="${__("Filter formula aggregates by date period")}">
							<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1zm-3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1zm-5 3a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1zm3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1zM3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM2 2a1 1 0 0 0-1 1v1h14V3a1 1 0 0 0-1-1H2zm13 3H1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5z"/></svg>
							<span class="ev-period-label">${__("This Month")}</span>
							<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style="margin-left:2px"><path d="M1 2l3 3 3-3"/></svg>
						</button>
						<div class="ev-period-dropdown hide">
							<div class="ev-period-item" data-period="today">${__("Today")}</div>
							<div class="ev-period-item" data-period="this_week">${__("This Week")}</div>
							<div class="ev-period-item ev-period-item--active" data-period="this_month">${__("This Month")}</div>
							<div class="ev-period-item" data-period="last_month">${__("Last Month")}</div>
							<div class="ev-period-item" data-period="this_quarter">${__("This Quarter")}</div>
							<div class="ev-period-item" data-period="last_quarter">${__("Last Quarter")}</div>
							<div class="ev-period-item" data-period="this_year">${__("This Year")}</div>
							<div class="ev-period-item" data-period="last_year">${__("Last Year")}</div>
							<div class="ev-period-sep"></div>
							<div class="ev-period-item" data-period="custom">${__("Custom Range…")}</div>
						</div>
					</div>
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

						${this._grp(__("External Data"), `
							<div class="ev-getdata-wrap">
								<button class="ev-tb-btn ev-tb-btn--lg ev-get-data-btn" title="${__("Import data from Reports, Google Sheets, CSV, JSON, PDF or Web API")}">
									<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/></svg>
									<span class="ev-btn-label">${__("Get Data")} ▾</span>
								</button>
							</div>
							<button class="ev-tb-btn ev-tb-btn--lg ev-smart-lookup-btn" data-rs-panel="smart_lookup" title="${__('Suggest join columns between sheets using field metadata, header similarity, and data overlap')}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 2a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-1 0v-11a.5.5 0 0 1 .5-.5zm-3 3a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5zm-3 3a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 1 .5-.5zm-3 3a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5z"/></svg>
								<span class="ev-btn-label">${__("Smart Lookup")}</span>
							</button>
						`)}

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

		// ── Period picker ───────────────────────────────────────────────────
		$w.on("click", ".ev-period-btn", (e) => {
			e.stopPropagation();
			$w.find(".ev-period-dropdown").toggleClass("hide");
		});
		$w.on("click", ".ev-period-item", (e) => {
			const period = $(e.currentTarget).data("period");
			const fm     = frappe.views.excel.formula_manager;
			if (!fm) return;

			if (period === "custom") {
				const d = new frappe.ui.Dialog({
					title: __("Custom Date Range"),
					fields: [
						{ fieldname: "from_date", fieldtype: "Date", label: __("From"), reqd: 1 },
						{ fieldname: "to_date",   fieldtype: "Date", label: __("To"),   reqd: 1 },
					],
					primary_action_label: __("Apply"),
					primary_action({ from_date, to_date }) {
						fm.set_period("custom", from_date, to_date);
						$w.find(".ev-period-label").text(`${from_date} → ${to_date}`);
						$w.find(".ev-period-item").removeClass("ev-period-item--active");
						$(e.currentTarget).addClass("ev-period-item--active");
						d.hide();
					},
				});
				d.show();
			} else {
				fm.set_period(period);
				$w.find(".ev-period-label").text(fm.period_label);
				$w.find(".ev-period-item").removeClass("ev-period-item--active");
				$(e.currentTarget).addClass("ev-period-item--active");
			}
			$w.find(".ev-period-dropdown").addClass("hide");
		});
		// Close dropdown on outside click
		$(document).on("click.ev-period", () => $w.find(".ev-period-dropdown").addClass("hide"));

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

		// ── Data tab: Get Data ───────────────────────────────────────────────
		$w.on("click", ".ev-get-data-btn", () => this._gd_open());
		$w.on("click", ".ev-smart-lookup-btn", () => this._open_smart_lookup());

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

	// ─── RIGHT SIDEBAR (shared: Smart Lookup, Agent Mode, etc.) ──────────────

	_open_right_sidebar(panel_name, $content) {
		const $sb = this.board.$right_sidebar;
		if (!$sb) return;
		$sb.empty().append($content);
		$sb.data("panel", panel_name);
		$sb.addClass("ev-right-sidebar--open");
		this.board.$wrapper.find(`[data-rs-panel="${panel_name}"]`).addClass("ev-tb-btn--active");
	}

	_close_right_sidebar() {
		const $sb = this.board.$right_sidebar;
		if (!$sb) return;
		const panel = $sb.data("panel");
		$sb.removeClass("ev-right-sidebar--open");
		$sb.data("panel", null);
		if (panel) this.board.$wrapper.find(`[data-rs-panel="${panel}"]`).removeClass("ev-tb-btn--active");
		// Clear content after CSS transition finishes
		setTimeout(() => { if (!$sb.hasClass("ev-right-sidebar--open")) $sb.empty(); }, 250);
	}

	// ─── SMART LOOKUP ─────────────────────────────────────────────────────────

	_open_smart_lookup() {
		const $sb = this.board.$right_sidebar;

		// Toggle: close if already open on Smart Lookup
		if ($sb?.data("panel") === "smart_lookup" && $sb.hasClass("ev-right-sidebar--open")) {
			this._close_right_sidebar();
			return;
		}

		const sm = this.board.sheet_manager;
		const sheets = (sm.get_all() || []).filter(s => s.columns_config?.length > 0);

		const $panel = this._build_slk_panel(sheets);
		this._open_right_sidebar("smart_lookup", $panel);
	}

	_build_slk_panel(sheets) {
		const sm = this.board.sheet_manager;
		const cur = sm.get_current();

		const opts_html = sheets.map(s =>
			`<option value="${frappe.utils.escape_html(s.id)}">${frappe.utils.escape_html(s.doctype ? `${s.label} (${s.doctype})` : s.label)}</option>`
		).join("");

		const $panel = $(`
			<div class="ev-rs-panel" data-rs-panel="smart_lookup">
				<div class="ev-rs-head">
					<div class="ev-rs-title-wrap">
						<svg class="ev-rs-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
							<path d="M11.5 2a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-1 0v-11a.5.5 0 0 1 .5-.5zm-3 3a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5zm-3 3a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 1 .5-.5zm-3 3a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5z"/>
						</svg>
						<div>
							<div class="ev-rs-title">${__("Smart Lookup")}</div>
							<div class="ev-rs-sub">${__("Detect join columns · Zero-LLM")}</div>
						</div>
					</div>
					<button class="ev-rs-close" title="${__("Close")}">✕</button>
				</div>
				<div class="ev-rs-body">
					${sheets.length < 2 ? `
						<div class="ev-slk-empty">
							${__("Load data into at least 2 sheets to use Smart Lookup.")}
							<br><br>
							${__("Use Data → Get Data to load a DocType or report into a sheet.")}
						</div>
					` : `
						<div class="ev-rs-field">
							<div class="ev-rs-label">
								<span class="ev-slk-lbl-badge ev-slk-lbl-badge--dest">▼ IN</span>
								${__("Add Columns To")}
							</div>
							<select class="ev-slk-src-select form-control form-control-sm">${opts_html}</select>
							<div class="ev-rs-hint">${__("Results land here — new columns get injected")}</div>
						</div>
						<div class="ev-rs-field" style="margin-top:8px">
							<div class="ev-rs-label">
								<span class="ev-slk-lbl-badge ev-slk-lbl-badge--src">↑ FROM</span>
								${__("Pull Data From")}
							</div>
							<select class="ev-slk-tgt-select form-control form-control-sm">${opts_html}</select>
							<div class="ev-rs-hint">${__("Reference sheet — its columns appear in the picker below")}</div>
						</div>
						<div style="text-align:center;margin:4px 0">
							<button class="btn btn-xs btn-default ev-slk-swap-btn" title="${__("Swap sheets")}">⇅ ${__("Swap")}</button>
						</div>
						<button class="btn btn-primary btn-sm ev-slk-analyze-btn" style="width:100%;margin-top:4px">
							${__("Analyze →")}
						</button>
						<div class="ev-slk-divider"></div>
						<div class="ev-slk-results-wrap" style="display:none">
							<div class="ev-slk-results-head"></div>
							<div class="ev-slk-cards-list"></div>
							<div class="ev-slk-apply-wrap" style="display:none">
								<div class="ev-slk-join-key"></div>
								<div class="ev-slk-fieldpick-label">${__("Pull these columns:")}</div>
								<div class="ev-slk-field-chips"></div>
								<button class="btn btn-sm btn-primary ev-slk-pull-btn" style="width:100%;margin-top:8px">
									⚡ ${__("Pull Data into Sheet")}
								</button>
							</div>
							<div class="ev-slk-expand-wrap" style="display:none">
								<div class="ev-slk-expand-head">
									<span class="ev-slk-expand-chevron">▾</span>
									${__("Auto-Expand Relationships")}
								</div>
								<div class="ev-slk-expand-list"></div>
							</div>
						</div>
					`}
				</div>
			</div>
		`);

		// Set default selections
		if (cur?.id) $panel.find(".ev-slk-src-select").val(cur.id);
		const other = sheets.find(s => s.id !== cur?.id);
		if (other) $panel.find(".ev-slk-tgt-select").val(other.id);

		$panel.find(".ev-rs-close").on("click", () => this._close_right_sidebar());

		$panel.find(".ev-slk-swap-btn").on("click", () => {
			const $src = $panel.find(".ev-slk-src-select");
			const $tgt = $panel.find(".ev-slk-tgt-select");
			const src_val = $src.val(), tgt_val = $tgt.val();
			$src.val(tgt_val); $tgt.val(src_val);
		});

		$panel.find(".ev-slk-analyze-btn").on("click", () => {
			const src = sm._sheets.get($panel.find(".ev-slk-src-select").val());
			const tgt = sm._sheets.get($panel.find(".ev-slk-tgt-select").val());
			if (!src || !tgt || src.id === tgt.id) {
				frappe.show_alert({ message: __("Select two different sheets"), indicator: "orange" }, 3);
				return;
			}
			this._run_slk_analysis($panel, src, tgt);
		});

		return $panel;
	}

	_run_slk_analysis($panel, src, tgt) {
		const $results = $panel.find(".ev-slk-results-wrap");
		const $head    = $panel.find(".ev-slk-results-head");
		const $cards   = $panel.find(".ev-slk-cards-list");
		const $apply   = $panel.find(".ev-slk-apply-wrap");

		$results.show();
		$apply.hide();
		$head.text(__("Analyzing…"));
		$cards.html(`<div class="ev-slk-empty" style="padding:16px 0">${__("Running 3-layer detection…")}</div>`);

		const src_headers = (src.columns_config || []).map(c => ({
			fieldname: c.fieldname || c.data || c.key || "",
			label: c.label || c.title || c.fieldname || "",
			fieldtype: c._df?.fieldtype || "Data",
			options: c._df?.options || "",
		})).filter(h => h.fieldname && !h.fieldname.startsWith("_")
			&& !(src._hidden_col_keys?.has(h.fieldname)));

		const tgt_headers = (tgt.columns_config || []).map(c => ({
			fieldname: c.fieldname || c.data || c.key || "",
			label: c.label || c.title || c.fieldname || "",
			fieldtype: c._df?.fieldtype || "Data",
			options: c._df?.options || "",
		})).filter(h => h.fieldname && !h.fieldname.startsWith("_")
			&& !(tgt._hidden_col_keys?.has(h.fieldname)));

		const src_sample = (src.data || []).slice(0, 50).map(row =>
			src_headers.map(h => String(row[h.fieldname] ?? ""))
		);
		const tgt_sample = (tgt.data || []).slice(0, 50).map(row =>
			tgt_headers.map(h => String(row[h.fieldname] ?? ""))
		);

		frappe.call({
			method: "excel_view.api.smart_lookup_suggest",
			args: {
				source_doctype: src.doctype || "",
				target_doctype: tgt.doctype || "",
				source_headers: JSON.stringify(src_headers),
				target_headers: JSON.stringify(tgt_headers),
				source_sample:  JSON.stringify(src_sample),
				target_sample:  JSON.stringify(tgt_sample),
			},
			callback: (r) => {
				const suggestions = r.message || [];
				if (!suggestions.length) {
					$head.text(__("No matches found"));
					$cards.html(`<div class="ev-slk-empty">${__("No join columns detected. The sheets may not share matching fields or overlapping data.")}</div>`);
					return;
				}

				const strategy_label = {
					primary_key_match:  __("Primary Key"),
					link_field:         __("Link Field"),
					header_match:       __("Header Match"),
					data_content_match: __("Data Content"),
					data_overlap:       __("Data Overlap"),
				};
				const strategy_icon = {
					primary_key_match:  "🔑",
					link_field:         "🔗",
					header_match:       "🔤",
					data_content_match: "📊",
					data_overlap:       "📊",
				};

				$head.text(`${__("Suggested joins")} — ${src.label} → ${tgt.label}`);

				// Build fieldname → human label maps so cards show readable names
				const src_lbl = Object.fromEntries(src_headers.map(h => [h.fieldname, h.label || h.fieldname]));
				const tgt_lbl = Object.fromEntries(tgt_headers.map(h => [h.fieldname, h.label || h.fieldname]));

				// Auto-expand highest-confidence card only if >95%, else first card
				const top_idx = suggestions.findIndex(s => s.confidence >= 0.95) === -1 ? 0 : suggestions.findIndex(s => s.confidence >= 0.95);

				$cards.html(suggestions.map((s, i) => {
					const pct = Math.round(s.confidence * 100);
					const bar_color = pct >= 80 ? "#217346" : pct >= 50 ? "#f59700" : "#888";
					const src_display = frappe.utils.escape_html(src_lbl[s.source_col] || s.source_col);
					const tgt_display = frappe.utils.escape_html(tgt_lbl[s.target_col] || s.target_col);
					const is_expanded = i === top_idx;
					return `<div class="ev-slk-card ${is_expanded ? "ev-slk-card--expanded" : "ev-slk-card--collapsed"}" data-idx="${i}">
						<div class="ev-slk-card-hdr">
							<span class="ev-slk-card-hdr-left">
								<span class="ev-slk-strategy">${strategy_icon[s.strategy] || "🔍"} ${strategy_label[s.strategy] || s.strategy}</span>
								<span class="ev-slk-cols-inline">${src_display} → ${tgt_display}</span>
							</span>
							<span class="ev-slk-card-hdr-right">
								<span class="ev-slk-conf" style="color:${bar_color}">${pct}%</span>
								<span class="ev-slk-chevron">${is_expanded ? "▾" : "▸"}</span>
							</span>
						</div>
						<div class="ev-slk-card-body">
							<div class="ev-slk-cols">
								<span class="ev-slk-col-pill">${src_display}</span>
								<span class="ev-slk-arrow">→</span>
								<span class="ev-slk-col-pill">${tgt_display}</span>
							</div>
							<div class="ev-slk-reason">${frappe.utils.escape_html(s.reason)}</div>
							<div class="ev-slk-bar"><div class="ev-slk-bar-fill" style="width:${pct}%;background:${bar_color}"></div></div>
						</div>
					</div>`;
				}).join(""));

				// Auto-select + show field picker for top card immediately
				const $top_card = $cards.find(`.ev-slk-card[data-idx="${top_idx}"]`);
				$top_card.addClass("ev-slk-card--selected");
				$panel.data("slk_idx", top_idx);
				this._populate_field_picker($apply, src, tgt, suggestions[top_idx]);
				$apply.show();
				this._show_expand_rel($panel, src, tgt, suggestions[top_idx]);

				// Card click → accordion: expand clicked, collapse others, update field picker
				$cards.off("click", ".ev-slk-card").on("click", ".ev-slk-card", (e) => {
					const $card = $(e.currentTarget);
					const idx   = +$card.data("idx");
					const is_same = $card.hasClass("ev-slk-card--selected");

					// Accordion: collapse all, expand clicked
					$cards.find(".ev-slk-card")
						.removeClass("ev-slk-card--selected ev-slk-card--expanded")
						.addClass("ev-slk-card--collapsed");
					$cards.find(".ev-slk-chevron").text("▸");

					$card.removeClass("ev-slk-card--collapsed")
						.addClass("ev-slk-card--selected ev-slk-card--expanded");
					$card.find(".ev-slk-chevron").text("▾");

					$panel.data("slk_idx", idx);
					this._populate_field_picker($apply, src, tgt, suggestions[idx]);
					$apply.show();
					this._show_expand_rel($panel, src, tgt, suggestions[idx]);
				});

				$apply.off("click", ".ev-slk-pull-btn").on("click", ".ev-slk-pull-btn", () => {
					const idx = $panel.data("slk_idx");
					const suggestion = suggestions[idx];
					if (suggestion == null) return;
					const checked = [...$apply.find(".ev-slk-chip--selected")];
					if (!checked.length) {
						frappe.show_alert({ message: __("Select at least one column"), indicator: "orange" }, 2);
						return;
					}
					const return_fields = checked.map(el => ({
						fieldname: el.dataset.fn,
						label: el.dataset.lbl,
					}));
					const candidate = {
						src_field: suggestion.source_col,
						tgt_field: suggestion.target_col,
						label: suggestion.source_col,
					};
					if (src.doctype && tgt.doctype) {
						this.board.sheet_manager._apply_lookup(src.doctype, tgt.doctype, candidate, return_fields, tgt.id);
					} else {
						this._apply_client_side_lookup(src, tgt, candidate, return_fields);
					}
				});

				$results.show();
			},
		});
	}

	_populate_field_picker($apply, src_sheet, tgt_sheet, suggestion) {
		const $key   = $apply.find(".ev-slk-join-key");
		const $chips = $apply.find(".ev-slk-field-chips");

		// Join key pill
		$key.html(`
			<div class="ev-slk-key-pill">
				<span class="ev-slk-key-src">${frappe.utils.escape_html(suggestion.source_col)}</span>
				<span class="ev-slk-key-arrow">→</span>
				<span class="ev-slk-key-tgt">${frappe.utils.escape_html(suggestion.target_col)}</span>
				<span class="ev-slk-key-exact">${__("Exact Match")}</span>
			</div>
		`);

		// Build field chips from target sheet columns (skip the join column itself)
		const skip = new Set([suggestion.target_col, "_meta"]);
		const pickable = (tgt_sheet.columns_config || []).filter(c => {
			const fn = c.fieldname || c.data || "";
			return fn && !fn.startsWith("_") && !skip.has(fn);
		});

		// Update label to show which sheet we're pulling FROM
		$apply.find(".ev-slk-fieldpick-label").html(
			`${__("Pull from")} <strong>${frappe.utils.escape_html(tgt_sheet.label)}</strong>:`
		);

		$chips.html(pickable.map(c => {
			const fn  = c.fieldname || c.data || "";
			const lbl = c.label || c.title || fn;
			return `<button class="ev-slk-chip" data-fn="${frappe.utils.escape_html(fn)}" data-lbl="${frappe.utils.escape_html(lbl)}">
				${frappe.utils.escape_html(lbl)}
			</button>`;
		}).join("") || `<span class="ev-slk-chips-empty text-muted" style="font-size:11px">${__("No columns available")}</span>`);

		// Toggle chip selection
		$chips.off("click.chip").on("click.chip", ".ev-slk-chip", (e) => {
			$(e.currentTarget).toggleClass("ev-slk-chip--selected");
		});

		// Auto-select all chips on first open
		$chips.find(".ev-slk-chip").addClass("ev-slk-chip--selected");
	}

	_apply_smart_lookup(src_sheet, tgt_sheet, suggestion) {
		const candidate = {
			src_field: suggestion.source_col,
			tgt_field: suggestion.target_col,
			label: suggestion.source_col,
		};
		// If both sheets have a doctype, use the proven IntelliLookup picker
		if (src_sheet.doctype && tgt_sheet.doctype) {
			this.board.sheet_manager._open_lookup_picker(
				src_sheet.doctype,
				tgt_sheet.doctype,
				candidate,
				tgt_sheet.id
			);
			return;
		}
		// Fallback: column picker from target sheet's columns_config
		this._open_slk_column_picker(src_sheet, tgt_sheet, candidate);
	}

	_open_slk_column_picker(src_sheet, tgt_sheet, candidate) {
		const pickable = (tgt_sheet.columns_config || []).filter(c => {
			const fn = c.fieldname || c.data || "";
			return fn && !fn.startsWith("_");
		});
		const fields_html = pickable.map(c => {
			const fn = c.fieldname || c.data || "";
			const lbl = c.label || c.title || fn;
			return `<label class="ev-ilk-field-row">
				<input type="checkbox" data-fieldname="${frappe.utils.escape_html(fn)}" data-label="${frappe.utils.escape_html(lbl)}">
				<span>${frappe.utils.escape_html(lbl)}</span>
			</label>`;
		}).join("");

		const d = new frappe.ui.Dialog({
			title: __("Lookup from {0}", [tgt_sheet.label]),
			fields: [{
				fieldtype: "HTML",
				options: `
					<p style="font-size:12px;color:var(--text-muted)">
						${__("Join key:")} <b>${frappe.utils.escape_html(candidate.src_field)}</b>
						→ <b>${frappe.utils.escape_html(candidate.tgt_field)}</b>
					</p>
					<p style="font-size:12px;margin-bottom:6px">${__("Select fields to pull:")}</p>
					<div class="ev-ilk-field-list" style="max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">
						${fields_html}
					</div>
				`,
			}],
			primary_action_label: __("Add Lookup Columns"),
			primary_action: () => {
				const checked = [...d.$wrapper.find(".ev-ilk-field-list input:checked")];
				if (!checked.length) {
					frappe.show_alert({ message: __("Select at least one field"), indicator: "orange" }, 3);
					return;
				}
				const return_fields = checked.map(el => ({ fieldname: el.dataset.fieldname, label: el.dataset.label }));
				d.hide();
				// If either side is not a real DocType sheet, use client-side join
				if (!src_sheet.doctype || !tgt_sheet.doctype) {
					this._apply_client_side_lookup(src_sheet, tgt_sheet, candidate, return_fields);
					return;
				}
				this.board.sheet_manager._apply_lookup(
					src_sheet.doctype,
					tgt_sheet.doctype,
					candidate,
					return_fields,
					tgt_sheet.id
				);
			},
		});
		d.show();
	}

	_apply_client_side_lookup(src_sheet, tgt_sheet, candidate, return_fields) {
		const sm = this.board.sheet_manager;
		// Doctype sheets store data in list_view.data, not in sheet.data
		const _sheet_data = (s) => {
			if (s.data?.length) return s.data;
			if (s.id === sm._get_sheet0_id()) return this.board.list_view.data || [];
			return [];
		};
		const tgt_data = _sheet_data(tgt_sheet);
		const tgt_map = new Map();
		tgt_data.forEach(row => {
			const key = String(row[candidate.tgt_field] ?? "").trim().toLowerCase();
			if (key) tgt_map.set(key, row);
		});
		// Build value cache so lookup data survives page refresh
		const value_cache = {};
		tgt_data.forEach(row => {
			const key = String(row[candidate.tgt_field] ?? "").trim().toLowerCase();
			if (!key) return;
			const cached = {};
			return_fields.forEach(f => { cached[f.fieldname] = row[f.fieldname] ?? ""; });
			value_cache[key] = cached;
		});
		_sheet_data(src_sheet).forEach(row => {
			const key = String(row[candidate.src_field] ?? "").trim().toLowerCase();
			const tgt_row = tgt_map.get(key);
			return_fields.forEach(f => {
				row[`_slk_${f.fieldname}`] = tgt_row ? (tgt_row[f.fieldname] ?? "") : "";
			});
		});
		const new_cols = return_fields.map(f => ({
			data: `_slk_${f.fieldname}`,
			title: `${f.label} [${tgt_sheet.label}]`,
			readOnly: true,
			_is_lookup_col: true,
		}));
		src_sheet.columns_config = [...(src_sheet.columns_config || []), ...new_cols];

		const board = this.board;
		const is_base = src_sheet.id === sm._get_sheet0_id();
		if (is_base) {
			// Base DocType sheet: _switch_sheet_context uses _master_columns not columns_config.
			// Inject directly into the board column arrays.
			const existing_keys = new Set(board._master_columns.map(c => c.data));
			const truly_new = new_cols.filter(c => !existing_keys.has(c.data));
			if (truly_new.length) {
				board._master_columns.push(...truly_new);
				board.columns = board._master_columns.filter(c => !board._hidden_col_keys.has(c.data));
				board.hot?.updateSettings({ columns: board.columns });
				board.hot?.render();
			}
		} else if (sm.get_current()?.id === src_sheet.id) {
			sm._apply_sheet(src_sheet);
		}
		// Persist lookup config to board state + user_settings
		if (!board._applied_lookups) board._applied_lookups = [];
		// Remove any existing config for same tgt+fields to avoid duplicates
		board._applied_lookups = board._applied_lookups.filter(c =>
			!(c.tgt_sheet_label === tgt_sheet.label && c.src_field === candidate.src_field)
		);
		// tgt_source: persisted so _reapply_smart_lookups can fetch FRESH data on restore
		// instead of relying on stale _value_cache.
		const tgt_source = tgt_sheet.doctype
			? { doctype: tgt_sheet.doctype }
			: tgt_sheet.report_meta?.name
				? {
					report_name:    tgt_sheet.report_meta.name,
					report_filters: tgt_sheet.report_meta.current_filters || {},
					// Column key order so result rows can be re-keyed correctly
					col_keys: (tgt_sheet.columns_config || []).map(c => c.data),
				}
				: null; // blank/formula sheet — cache is the only option
		board._applied_lookups.push({
			src_sheet_id:    src_sheet.id,      // identifies which sheet's data to enrich on restore
			tgt_sheet_id:    tgt_sheet.id,
			tgt_sheet_label: tgt_sheet.label,
			tgt_source,
			src_field:       candidate.src_field,
			tgt_field:       candidate.tgt_field,
			return_fields,
			_value_cache:    value_cache,
		});
		// Sync-patch to avoid race condition with concurrent saves.
		const _slk_save = board._applied_lookups.map(({ _fresh_rows: _f, ...rest }) => rest);
		if (!frappe.model.user_settings[board.doctype]) frappe.model.user_settings[board.doctype] = {};
		frappe.model.user_settings[board.doctype].excel_smart_lookups = _slk_save;
		frappe.model.user_settings.update(board.doctype, frappe.model.user_settings[board.doctype]);
		frappe.show_alert({ message: __(`Added ${return_fields.length} lookup column(s) from ${tgt_sheet.label}`), indicator: "green" }, 3);
	}

	// ─── EXPAND RELATIONSHIP ──────────────────────────────────────────────────

	_show_expand_rel($panel, src_sheet, tgt_sheet, suggestion) {
		const $wrap = $panel.find(".ev-slk-expand-wrap");
		const $list = $panel.find(".ev-slk-expand-list");

		if (!tgt_sheet?.doctype) { $wrap.hide(); return; }

		$wrap.show();
		$list.html(`<div class="ev-slk-expand-loading">${__("Discovering relationships…")}</div>`);

		frappe.call({
			method: "excel_view.api.find_related_doctypes",
			args:   { source_doctype: tgt_sheet.doctype, max_hops: 1 },
			callback: (r) => {
				const related = r.message || [];
				if (!related.length) {
					$list.html(`<div class="ev-slk-expand-empty">${__("No direct relationships found.")}</div>`);
					return;
				}

				$list.html(related.map((rel, i) => {
					const badge = rel.cardinality === "1:N"
						? `<span class="ev-slk-card-badge ev-slk-card-badge--1n">1:N</span>`
						: `<span class="ev-slk-card-badge ev-slk-card-badge--n1">N:1</span>`;
					const agg_opts = rel.cardinality === "1:N"
						? `<select class="ev-slk-agg-select form-control form-control-sm" data-rel-idx="${i}">
							<option value="count">${__("Count")}</option>
							<option value="sum">${__("Sum")}</option>
							<option value="average">${__("Average")}</option>
							<option value="latest">${__("Latest row")}</option>
						</select>` : "";
					return `<div class="ev-slk-expand-card" data-rel-idx="${i}">
						<div class="ev-slk-expand-card-head">
							${badge}
							<span class="ev-slk-expand-dt">${frappe.utils.escape_html(rel.doctype)}</span>
							${rel.via ? `<span class="ev-slk-expand-via">${__("via")} ${frappe.utils.escape_html(rel.via)}</span>` : ""}
						</div>
						<div class="ev-slk-expand-join">${__("Join:")} <b>${frappe.utils.escape_html(rel.join_label || rel.join_field)}</b></div>
						${agg_opts}
						<button class="btn btn-xs ev-slk-expand-add-btn" data-rel-idx="${i}">
							+ ${__("Add to Sheet")}
						</button>
					</div>`;
				}).join(""));

				$panel.data("slk_related", related);

				$list.off("click", ".ev-slk-expand-add-btn").on("click", ".ev-slk-expand-add-btn", (e) => {
					e.stopPropagation();
					const ri  = +$(e.currentTarget).data("rel-idx");
					const rel = ($panel.data("slk_related") || [])[ri];
					if (!rel) return;
					const agg = $list.find(`.ev-slk-agg-select[data-rel-idx="${ri}"]`).val() || "latest";
					this._apply_expand_rel(src_sheet, tgt_sheet, rel, agg, suggestion);
				});
			},
		});
	}

	_apply_expand_rel(src_sheet, tgt_sheet, rel, agg_preset, suggestion) {
		const sm = this.board.sheet_manager;
		const _sheet_data = (s) => {
			if (s.data?.length) return s.data;
			if (s.id === sm._get_sheet0_id()) return this.board.list_view.data || [];
			return [];
		};
		const join_field = suggestion?.source_col || "name";
		const src_vals = [...new Set(
			_sheet_data(src_sheet)
				.map(r => String(r[join_field] ?? "").trim())
				.filter(Boolean)
		)].slice(0, 500);

		if (!src_vals.length) {
			frappe.show_alert({ message: __("No source values to expand"), indicator: "orange" }, 3);
			return;
		}

		frappe.show_alert({ message: __("Fetching {0}…", [rel.doctype]), indicator: "blue" }, 2);

		frappe.call({
			method:   "excel_view.api.expand_relationship",
			args: {
				source_doctype: tgt_sheet.doctype,
				target_doctype: rel.doctype,
				join_field:     rel.join_field,
				source_values:  JSON.stringify(src_vals),
				agg_preset:     agg_preset,
				return_fields:  "[]",
			},
			callback: (r) => {
				const res = r.message || {};
				if (res.error) {
					frappe.msgprint({ title: __("Expand Error"), message: res.error, indicator: "red" });
					return;
				}
				const rows = res.rows || [];
				if (!rows.length) {
					frappe.show_alert({ message: __("No data found in {0}", [rel.doctype]), indicator: "orange" }, 3);
					return;
				}

				const exp_map = new Map();
				rows.forEach(row => exp_map.set(String(row._src_key ?? "").trim().toLowerCase(), row));

				const return_cols = (res.columns || []).filter(c => c.fieldname !== "_src_key");
				_sheet_data(src_sheet).forEach(row => {
					const key = String(row[join_field] ?? "").trim().toLowerCase();
					const exp = exp_map.get(key);
					return_cols.forEach(col => {
						row[`_exp_${col.fieldname}`] = exp ? (exp[col.fieldname] ?? "") : "";
					});
				});

				const new_cols = return_cols.map(col => ({
					data:           `_exp_${col.fieldname}`,
					title:          `${col.label} [${rel.doctype}·${agg_preset}]`,
					readOnly:       true,
					_is_lookup_col: true,
				}));
				src_sheet.columns_config = [...(src_sheet.columns_config || []), ...new_cols];
				if (sm.get_current()?.id === src_sheet.id) sm._apply_sheet(src_sheet);
				frappe.show_alert({
					message:   __("Added {0} column(s) from {1}", [return_cols.length, rel.doctype]),
					indicator: "green",
				}, 3);
			},
		});
	}

	// ─── GET DATA ─────────────────────────────────────────────────────────────

	_gd_open() {
		this._gd_target = "new";
		this._gd_d = new frappe.ui.Dialog({ title: __("Get Data"), size: "large" });
		this._gd_d.show();
		const $body = $(this._gd_d.body);
		$body.addClass("ev-gd-body");
		this._gd_step1($body);
	}

	_gd_step1($body) {
		const SOURCES = [
			{ id: "reports", color: "#1565c0", label: __("From Reports"), sub: __("Frappe standard & custom reports"),
			  icon: `<svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor"><path d="M1 11a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-3zm5-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7zm5-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V2z"/></svg>` },
			{ id: "gsheets", color: "#2e7d32", label: __("Google Sheets"), sub: __("Public spreadsheet by URL"),
			  icon: `<svg width="28" height="28" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="1" width="12" height="14" rx="1"/><line x1="2" y1="5" x2="14" y2="5"/><line x1="2" y1="9" x2="14" y2="9"/><line x1="6" y1="1" x2="6" y2="15"/></svg>` },
			{ id: "csv",     color: "#e65100", label: __("CSV"),           sub: __("File upload or URL"),
			  icon: `<svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 2a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 2a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3z"/><path d="M3 0h7.586a1 1 0 0 1 .707.293L13.707 2.707A1 1 0 0 1 14 3.414V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 2v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4h-2.5A1.5 1.5 0 0 1 9 2.5V0H4a1 1 0 0 0-1 1z"/></svg>` },
			{ id: "json",    color: "#6a1b9a", label: __("JSON"),          sub: __("File, URL, or paste"),
			  icon: `<svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/><path d="M4.5 5.5a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7zm0 2a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7zm0 2a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4z"/></svg>` },
			{ id: "pdf",     color: "#b71c1c", label: __("PDF"),           sub: __("Extract tables from PDF"),
			  icon: `<svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor"><path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/></svg>` },
			{ id: "webapi",  color: "#00695c", label: __("Web API"),       sub: __("Any REST endpoint"),
			  icon: `<svg width="28" height="28" viewBox="0 0 16 16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.386.295.744.468 1.068.552 1.035 1.218 1.65 1.887 1.855V12H5.145zm.182 2.472a6.696 6.696 0 0 1-.597-.933A9.268 9.268 0 0 1 4.09 12H2.255a7.024 7.024 0 0 0 3.072 2.472zM3.82 11a13.652 13.652 0 0 1-.312-2.5h-2.49c.062.89.291 1.733.656 2.5H3.82zm6.853 3.472A7.024 7.024 0 0 0 13.745 12H11.91a9.27 9.27 0 0 1-.64 1.539 6.688 6.688 0 0 1-.597.933zM8.5 12v2.923c.67-.204 1.335-.82 1.887-1.855.173-.324.33-.682.468-1.068H8.5zm3.68-1h2.146c.365-.767.594-1.61.656-2.5h-2.49a13.65 13.65 0 0 1-.312 2.5zm2.802-3.5a6.959 6.959 0 0 0-.656-2.5H12.18c.174.782.282 1.623.312 2.5h2.49zM11.27 2.461c.247.464.462.98.64 1.539h1.835a7.024 7.024 0 0 0-3.072-2.472c.218.284.418.598.597.933zM10.855 4a7.966 7.966 0 0 0-.468-1.068C9.835 1.897 9.17 1.282 8.5 1.077V4h2.355z"/></svg>` },
		];
		$body.html(`
			<div class="ev-gd-step1">
				<div class="ev-gd-grid">
					${SOURCES.map(s => `
						<div class="ev-gd-card" data-src="${s.id}" role="button" tabindex="0">
							<div class="ev-gd-card-icon" style="color:${s.color}">${s.icon}</div>
							<div class="ev-gd-card-label">${s.label}</div>
							<div class="ev-gd-card-sub">${s.sub}</div>
						</div>
					`).join("")}
				</div>
				<div class="ev-gd-target-row">
					<span class="ev-gd-target-lbl">${__("Load into:")}</span>
					<label class="ev-gd-radio"><input type="radio" name="ev_gd_target" value="new" checked> ${__("New Sheet")}</label>
					<label class="ev-gd-radio"><input type="radio" name="ev_gd_target" value="current"> ${__("Current Sheet")}</label>
				</div>
			</div>
		`);
		$body.off(".gd")
			.on("change.gd", "input[name=ev_gd_target]", (e) => { this._gd_target = $(e.currentTarget).val(); })
			.on("click.gd keypress.gd", ".ev-gd-card", (e) => {
				if (e.type === "keypress" && e.which !== 13) return;
				this._gd_src($body, $(e.currentTarget).data("src"));
			});
	}

	_gd_src($body, src) {
		$body.off(".gd");
		({ reports: () => this._gd_reports($body),
		   gsheets: () => this._gd_gsheets($body),
		   csv:     () => this._gd_csv($body),
		   json:    () => this._gd_json($body),
		   pdf:     () => this._gd_pdf($body),
		   webapi:  () => this._gd_webapi($body),
		})[src]?.();
		$body.on("click.gd", ".ev-gd-back", () => { $body.off(".gd"); this._gd_step1($body); });
	}

	_gd_wrap(title, inner) {
		return `<div class="ev-gd-step2">
			<div class="ev-gd-step2-hdr">
				<button class="ev-gd-back btn btn-xs btn-default">← ${__("Back")}</button>
				<span class="ev-gd-step2-title">${title}</span>
			</div>
			<div class="ev-gd-step2-body">${inner}</div>
		</div>`;
	}

	_gd_preview_tbl(headers, rows) {
		const sample = rows.slice(0, 5);
		return `<div class="ev-gd-preview">
			<div class="ev-gd-preview-lbl">${__("Preview")} — ${rows.length} ${__("rows")}</div>
			<div class="ev-gd-preview-scroll"><table class="ev-gd-ptbl">
				<thead><tr>${headers.map(h => `<th>${frappe.utils.escape_html(String(h))}</th>`).join("")}</tr></thead>
				<tbody>${sample.map(r => `<tr>${r.map(v => `<td>${frappe.utils.escape_html(String(v ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody>
			</table></div>
		</div>`;
	}

	// ── Reports ───────────────────────────────────────────────────────────────

	_gd_reports($body) {
		const doctype = this.board.doctype;
		$body.html(this._gd_wrap(__("From Reports"), `
			<div class="ev-gd-info" style="margin-bottom:8px">
				📊 ${__("Showing reports for")} <strong>${frappe.utils.escape_html(doctype)}</strong>
			</div>
			<input type="text" class="form-control ev-gd-report-search" placeholder="${__("Search reports…")}" style="margin-bottom:8px">
			<div class="ev-gd-report-list ev-gd-loading">${__("Loading…")}</div>
			<div class="ev-gd-filters-wrap hide">
				<div class="ev-gd-rpt-filter-hdr">
					<span>${__("Filters for")} <strong class="ev-gd-report-sel-name"></strong></span>
					<span class="ev-gd-filter-loading text-muted" style="font-size:11px"></span>
				</div>
				<div class="ev-gd-rpt-filter-rows"></div>
			</div>
			<div class="ev-gd-actions">
				<button class="btn btn-sm btn-default ev-gd-preview-btn" disabled>${__("Preview")}</button>
				<button class="btn btn-sm btn-primary ev-gd-load-btn" disabled>${__("Load →")}</button>
			</div>
			<div class="ev-gd-preview-area"></div>
		`));
		let _all = [], _sel = null, _res = null, _filter_defs = [];

		const _filter_row = (f) => this._gd_filter_row(f);
		const _get_filters = () => this._gd_collect_filters($body);

		/** Fetch report JS via get_script, eval in global scope, read frappe.query_reports[name].filters */
		const _load_filters = (report_name) => {
			const $rows = $body.find(".ev-gd-rpt-filter-rows");
			const $lbl  = $body.find(".ev-gd-filter-loading");
			$rows.html(""); $lbl.text(__("Loading filters…"));
			frappe.call({
				method: "frappe.desk.query_report.get_script",
				args: { report_name },
				callback: (r) => {
					$lbl.text("");
					let filters = [];
					try {
						// frappe.query_reports may not exist yet — initialise defensively
						if (!frappe.query_reports) frappe.query_reports = {};

						const script = r.message?.script || (typeof r.message === "string" ? r.message : "");
						if (script) {
							// Indirect eval → runs in global scope (same as Frappe's own report runner)
							// This populates frappe.query_reports[report_name] = { filters: [...] }
							// eslint-disable-next-line no-eval
							(0, eval)(script);
						}
						filters = (frappe.query_reports?.[report_name]?.filters || [])
							.filter(f => f && f.fieldname);
					} catch (e) {
						console.warn("[GetData] report filter eval error:", e);
					}

					_filter_defs = filters;
					if (!filters.length) {
						$rows.html(`<div class="ev-gd-empty" style="padding:10px 0">${__("This report has no filters.")}</div>`);
						return;
					}
					$rows.html(filters.map(_filter_row).join(""));
				},
			});
		};

		frappe.call({
			method: "frappe.client.get_list",
			args: { doctype: "Report", fields: ["name", "report_type", "ref_doctype"], filters: [["ref_doctype", "=", doctype]], limit: 500, order_by: "modified desc" },
			callback: (r) => {
				_all = r.message || [];
				const render = (list) => {
					const $l = $body.find(".ev-gd-report-list").removeClass("ev-gd-loading");
					$l.html(list.length
						? list.map(x => `<div class="ev-gd-report-item" data-name="${frappe.utils.escape_html(x.name)}">
								<div class="ev-gd-report-name">${frappe.utils.escape_html(x.name)}</div>
								<div class="ev-gd-report-meta">${frappe.utils.escape_html(x.report_type || "")}</div>
							</div>`).join("")
						: `<div class="ev-gd-empty">${__("No reports found for")} <strong>${frappe.utils.escape_html(doctype)}</strong></div>`);
				};
				render(_all);
				$body.on("input.gd", ".ev-gd-report-search", (e) => {
					const q = $(e.currentTarget).val().toLowerCase();
					render(q ? _all.filter(x => x.name.toLowerCase().includes(q)) : _all);
				}).on("click.gd", ".ev-gd-report-item", (e) => {
					$body.find(".ev-gd-report-item").removeClass("ev-gd-selected");
					$(e.currentTarget).addClass("ev-gd-selected");
					_sel = $(e.currentTarget).data("name");
					$body.find(".ev-gd-report-sel-name").text(_sel);
					$body.find(".ev-gd-filters-wrap").removeClass("hide");
					$body.find(".ev-gd-preview-btn, .ev-gd-load-btn").prop("disabled", false);
					_res = null; $body.find(".ev-gd-preview-area").empty();
					_load_filters(_sel);
				});
			},
		});

		const _run = (cb) => {
			if (!_sel) return;
			frappe.call({
				method: "frappe.desk.query_report.run",
				args: { report_name: _sel, filters: _get_filters(), ignore_prepared_report: 1 },
				freeze: true, freeze_message: __("Running report…"),
				callback: (r) => { _res = r.message; cb?.(_res); },
			});
		};
		$body.on("click.gd", ".ev-gd-preview-btn", () => _run((res) => {
			const cols = (res.columns || []).map(c => typeof c === "string" ? c : (c.label || c.fieldname));
			const rows = (res.result || []).filter(r => !r.is_subtotal && !r.is_total)
				.map(r => cols.map((_, i) => Array.isArray(r) ? r[i] : (r[cols[i]] ?? "")));
			$body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(cols, rows));
		}));
		$body.on("click.gd", ".ev-gd-load-btn", () => {
			const go = (res) => {
				const raw = res.columns || [];
				const cols = raw.map(c => typeof c === "string" ? { label: c, fieldname: c } : c);
				const headers = cols.map(c => c.label || c.fieldname);
				const keys = cols.map(c => c.fieldname || c.label);
				const rows = (res.result || []).filter(r => !r.is_subtotal && !r.is_total)
					.map(r => keys.map((k, i) => Array.isArray(r) ? r[i] : (r[k] ?? "")));
				this._gd_load(headers, rows, _sel, { name: _sel, filter_defs: _filter_defs, current_filters: _get_filters() }, keys); this._gd_d.hide();
			};
			_res ? go(_res) : _run(go);
		});
	}

	// ── Google Sheets ─────────────────────────────────────────────────────────

	_gd_gsheets($body) {
		$body.html(this._gd_wrap(__("Google Sheets"), `
			<div class="ev-gd-field-row">
				<label class="ev-gd-lbl">${__("Spreadsheet URL")}</label>
				<input type="text" class="form-control ev-gd-gs-url" placeholder="https://docs.google.com/spreadsheets/d/…">
			</div>
			<div class="ev-gd-field-row">
				<label class="ev-gd-lbl">${__("Sheet / Tab name")} <span class="text-muted">(${__("optional")})</span></label>
				<input type="text" class="form-control ev-gd-gs-tab" placeholder="Sheet1">
			</div>
			<div class="ev-gd-info">ℹ ${__('Sheet must be set to "Anyone with link can view".')}</div>
			<div class="ev-gd-actions">
				<button class="btn btn-sm btn-default ev-gd-preview-btn">${__("Preview")}</button>
				<button class="btn btn-sm btn-primary ev-gd-load-btn">${__("Load →")}</button>
			</div>
			<div class="ev-gd-preview-area"></div>
		`));
		let _h = [], _r = [];
		const _fetch = (cb) => {
			const url = $body.find(".ev-gd-gs-url").val().trim();
			const tab = $body.find(".ev-gd-gs-tab").val().trim();
			if (!url) { frappe.msgprint(__("Please enter a URL.")); return; }
			frappe.call({
				method: "excel_view.api.fetch_google_sheet",
				args: { url, tab_name: tab },
				freeze: true, freeze_message: __("Fetching sheet…"),
				callback: (r) => {
					if (r.message?.error) { frappe.msgprint(r.message.error); return; }
					_h = r.message.headers || []; _r = r.message.rows || []; cb?.();
				},
			});
		};
		$body.on("click.gd", ".ev-gd-preview-btn", () => _fetch(() => $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r))));
		$body.on("click.gd", ".ev-gd-load-btn", () => _fetch(() => { this._gd_load(_h, _r, $body.find(".ev-gd-gs-tab").val().trim() || "Google Sheet"); this._gd_d.hide(); }));
	}

	// ── CSV ───────────────────────────────────────────────────────────────────

	_gd_csv($body) {
		$body.html(this._gd_wrap(__("CSV"), `
			<div class="ev-gd-dropzone ev-gd-drop-csv">
				<div class="ev-gd-drop-icon">📄</div>
				<div>${__("Drop CSV here or")} <span class="ev-gd-browse">${__("browse")}</span></div>
				<input type="file" accept=".csv,.tsv,.txt" class="ev-gd-file-in" style="display:none">
			</div>
			<div class="ev-gd-or-sep"><span>${__("or")}</span></div>
			<div class="ev-gd-field-row">
				<input type="text" class="form-control ev-gd-url-in" placeholder="${__("Paste URL to CSV file")}">
			</div>
			<div class="ev-gd-opts-row">
				<label class="ev-gd-lbl" style="width:auto;margin:0">${__("Delimiter:")}</label>
				<select class="ev-gd-sel ev-gd-delim">
					<option value="auto">${__("Auto")}</option>
					<option value=",">,</option><option value=";">;</option>
					<option value="\t">${__("Tab")}</option><option value="|">|</option>
				</select>
				<label class="ev-gd-radio" style="margin-left:10px"><input type="checkbox" class="ev-gd-has-hdr" checked> ${__("First row as header")}</label>
			</div>
			<div class="ev-gd-actions">
				<button class="btn btn-sm btn-default ev-gd-preview-btn">${__("Preview")}</button>
				<button class="btn btn-sm btn-primary ev-gd-load-btn">${__("Load →")}</button>
			</div>
			<div class="ev-gd-preview-area"></div>
		`));
		let _h = [], _r = [];
		const _parse = (text) => {
			const d = $body.find(".ev-gd-delim").val();
			const has_hdr = $body.find(".ev-gd-has-hdr").prop("checked");
			const all = this._gd_parse_csv(text, d === "auto" ? this._gd_detect_delim(text) : d);
			_h = all.length ? (has_hdr ? all[0] : all[0].map((_, i) => `Col${i + 1}`)) : [];
			_r = has_hdr ? all.slice(1) : all;
		};
		$body.on("click.gd", ".ev-gd-browse", () => $body.find(".ev-gd-file-in").click());
		$body.on("change.gd", ".ev-gd-file-in", (e) => {
			const f = e.target.files[0]; if (!f) return;
			$body.find(".ev-gd-drop-csv .ev-gd-drop-icon").text("📄 " + f.name);
			const rd = new FileReader(); rd.onload = (ev) => { _parse(ev.target.result); $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r)); };
			rd.readAsText(f);
		});
		$body.on("dragover.gd", ".ev-gd-drop-csv", (e) => { e.preventDefault(); $(e.currentTarget).addClass("ev-gd-over"); });
		$body.on("dragleave.gd drop.gd", ".ev-gd-drop-csv", (e) => { e.preventDefault(); $(e.currentTarget).removeClass("ev-gd-over"); });
		$body.on("drop.gd", ".ev-gd-drop-csv", (e) => {
			const f = e.originalEvent.dataTransfer.files[0]; if (!f) return;
			const rd = new FileReader(); rd.onload = (ev) => { _parse(ev.target.result); $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r)); };
			rd.readAsText(f);
		});
		$body.on("click.gd", ".ev-gd-preview-btn", () => {
			const url = $body.find(".ev-gd-url-in").val().trim();
			if (url) {
				frappe.call({ method: "excel_view.api.fetch_url_text", args: { url }, freeze: true, freeze_message: __("Fetching…"),
					callback: (r) => { if (r.message?.text) { _parse(r.message.text); $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r)); } } });
			} else if (_r.length) {
				$body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r));
			} else { frappe.msgprint(__("Upload a file or enter a URL first.")); }
		});
		$body.on("click.gd", ".ev-gd-load-btn", () => {
			if (!_h.length) { frappe.msgprint(__("No data — click Preview first.")); return; }
			this._gd_load(_h, _r, "CSV Import"); this._gd_d.hide();
		});
	}

	// ── JSON ──────────────────────────────────────────────────────────────────

	_gd_json($body) {
		$body.html(this._gd_wrap(__("JSON"), `
			<div class="ev-gd-dropzone ev-gd-drop-json">
				<div class="ev-gd-drop-icon">{ }</div>
				<div>${__("Drop JSON file here or")} <span class="ev-gd-browse">${__("browse")}</span></div>
				<input type="file" accept=".json" class="ev-gd-file-in" style="display:none">
			</div>
			<div class="ev-gd-or-sep"><span>${__("or")}</span></div>
			<div class="ev-gd-field-row">
				<input type="text" class="form-control ev-gd-url-in" placeholder="${__("Paste URL to JSON endpoint")}">
			</div>
			<div class="ev-gd-field-row">
				<label class="ev-gd-lbl">${__("JSON Path")} <span class="text-muted">(${__("e.g. data.items — leave blank for root array")})</span></label>
				<input type="text" class="form-control ev-gd-json-path" placeholder="data.items">
			</div>
			<div class="ev-gd-actions">
				<button class="btn btn-sm btn-default ev-gd-preview-btn">${__("Preview")}</button>
				<button class="btn btn-sm btn-primary ev-gd-load-btn">${__("Load →")}</button>
			</div>
			<div class="ev-gd-preview-area"></div>
		`));
		let _h = [], _r = [];
		const _parse = (text) => {
			try {
				let obj = JSON.parse(text);
				const path = $body.find(".ev-gd-json-path").val().trim();
				if (path) obj = this._gd_path(obj, path);
				if (!Array.isArray(obj)) obj = obj != null ? [obj] : [];
				if (!obj.length) { frappe.msgprint(__("No array found at that path.")); return; }
				_h = Object.keys(obj[0]);
				_r = obj.map(row => _h.map(k => row[k] ?? ""));
			} catch (e) { frappe.msgprint(__("Invalid JSON: ") + e.message); }
		};
		$body.on("click.gd", ".ev-gd-browse", () => $body.find(".ev-gd-file-in").click());
		$body.on("change.gd", ".ev-gd-file-in", (e) => {
			const f = e.target.files[0]; if (!f) return;
			const rd = new FileReader(); rd.onload = (ev) => { _parse(ev.target.result); $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r)); };
			rd.readAsText(f);
		});
		$body.on("click.gd", ".ev-gd-preview-btn", () => {
			const url = $body.find(".ev-gd-url-in").val().trim();
			if (url) {
				frappe.call({ method: "excel_view.api.fetch_url_text", args: { url }, freeze: true, freeze_message: __("Fetching…"),
					callback: (r) => { if (r.message?.text) { _parse(r.message.text); $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r)); } } });
			} else if (_r.length) { $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r));
			} else { frappe.msgprint(__("Upload a file or enter a URL.")); }
		});
		$body.on("click.gd", ".ev-gd-load-btn", () => {
			if (!_h.length) { frappe.msgprint(__("No data — click Preview first.")); return; }
			this._gd_load(_h, _r, "JSON Import"); this._gd_d.hide();
		});
	}

	// ── PDF ───────────────────────────────────────────────────────────────────

	_gd_pdf($body) {
		$body.html(this._gd_wrap(__("PDF"), `
			<div class="ev-gd-dropzone ev-gd-drop-pdf">
				<div class="ev-gd-drop-icon">📕</div>
				<div>${__("Drop PDF here or")} <span class="ev-gd-browse">${__("browse")}</span></div>
				<input type="file" accept=".pdf" class="ev-gd-file-in" style="display:none">
			</div>
			<div class="ev-gd-info">ℹ ${__("Tables are extracted automatically. Works best with structured PDF grids.")}</div>
			<div class="ev-gd-field-row hide ev-gd-tbl-sel-row">
				<label class="ev-gd-lbl" style="width:auto;margin:0">${__("Table:")}</label>
				<select class="ev-gd-sel ev-gd-tbl-sel"></select>
			</div>
			<div class="ev-gd-actions">
				<button class="btn btn-sm btn-primary ev-gd-load-btn" disabled>${__("Load →")}</button>
			</div>
			<div class="ev-gd-preview-area"></div>
		`));
		let _tables = [];
		$body.on("click.gd", ".ev-gd-browse", () => $body.find(".ev-gd-file-in").click());
		$body.on("change.gd", ".ev-gd-file-in", (e) => {
			const f = e.target.files[0]; if (!f) return;
			$body.find(".ev-gd-drop-pdf .ev-gd-drop-icon").text("📕 " + f.name);
			const rd = new FileReader();
			rd.onload = (ev) => {
				frappe.call({
					method: "excel_view.api.extract_pdf_tables",
					args: { pdf_b64: ev.target.result.split(",")[1] },
					freeze: true, freeze_message: __("Extracting tables…"),
					callback: (r) => {
						if (r.message?.error) { frappe.msgprint(r.message.error); return; }
						_tables = r.message?.tables || [];
						if (!_tables.length) { frappe.msgprint(__("No tables found in this PDF.")); return; }
						const $sel = $body.find(".ev-gd-tbl-sel").empty();
						_tables.forEach((t, i) => $sel.append(`<option value="${i}">${__("Table")} ${i + 1} (${t.rows.length} ${__("rows")})</option>`));
						$body.find(".ev-gd-tbl-sel-row").removeClass("hide");
						$body.find(".ev-gd-load-btn").prop("disabled", false);
						const show = (i) => $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_tables[i].headers, _tables[i].rows));
						show(0);
						$body.on("change.gd", ".ev-gd-tbl-sel", (e2) => show(+$(e2.currentTarget).val()));
					},
				});
			};
			rd.readAsDataURL(f);
		});
		$body.on("click.gd", ".ev-gd-load-btn", () => {
			const t = _tables[+$body.find(".ev-gd-tbl-sel").val() || 0];
			if (!t) return;
			this._gd_load(t.headers, t.rows, "PDF Table"); this._gd_d.hide();
		});
	}

	// ── Web API ───────────────────────────────────────────────────────────────

	_gd_webapi($body) {
		$body.html(this._gd_wrap(__("Web API"), `
			<div class="ev-gd-url-row">
				<select class="ev-gd-sel ev-gd-method" style="width:76px;flex-shrink:0">
					<option>GET</option><option>POST</option>
				</select>
				<input type="text" class="form-control ev-gd-url-in" placeholder="https://api.example.com/data" style="flex:1;margin-left:6px">
			</div>
			<div class="ev-gd-field-row" style="flex-direction:column;align-items:flex-start">
				<label class="ev-gd-lbl">${__("Headers")} <button class="btn btn-xs btn-default ev-gd-add-hdr" style="margin-left:6px">+ ${__("Add")}</button></label>
				<div class="ev-gd-hdrs-list" style="width:100%"></div>
			</div>
			<div class="ev-gd-field-row">
				<label class="ev-gd-lbl">${__("JSON Path")} <span class="text-muted">(${__("e.g. data.results — leave blank for root array")})</span></label>
				<input type="text" class="form-control ev-gd-json-path" placeholder="data">
			</div>
			<div class="ev-gd-actions">
				<button class="btn btn-sm btn-default ev-gd-preview-btn">${__("Test & Preview")}</button>
				<button class="btn btn-sm btn-primary ev-gd-load-btn">${__("Load →")}</button>
			</div>
			<div class="ev-gd-preview-area"></div>
		`));
		let _h = [], _r = [];
		$body.on("click.gd", ".ev-gd-add-hdr", () => {
			$body.find(".ev-gd-hdrs-list").append(`
				<div class="ev-gd-hdr-row">
					<input type="text" class="form-control ev-gd-hk" placeholder="${__("Name")}" style="width:140px">
					<input type="text" class="form-control ev-gd-hv" placeholder="${__("Value")}" style="flex:1;margin:0 6px">
					<button class="btn btn-xs btn-danger ev-gd-del-hdr">✕</button>
				</div>`);
		});
		$body.on("click.gd", ".ev-gd-del-hdr", (e) => $(e.currentTarget).closest(".ev-gd-hdr-row").remove());
		const _fetch = (cb) => {
			const url = $body.find(".ev-gd-url-in").val().trim();
			if (!url) { frappe.msgprint(__("Please enter a URL.")); return; }
			const hdrs = {};
			$body.find(".ev-gd-hdr-row").each((_, row) => {
				const k = $(row).find(".ev-gd-hk").val().trim();
				if (k) hdrs[k] = $(row).find(".ev-gd-hv").val().trim();
			});
			frappe.call({
				method: "excel_view.api.fetch_web_api",
				args: { url, method: $body.find(".ev-gd-method").val(), headers: JSON.stringify(hdrs), json_path: $body.find(".ev-gd-json-path").val().trim() },
				freeze: true, freeze_message: __("Fetching…"),
				callback: (r) => {
					if (r.message?.error) { frappe.msgprint(r.message.error); return; }
					_h = r.message.headers || []; _r = r.message.rows || []; cb?.();
				},
			});
		};
		$body.on("click.gd", ".ev-gd-preview-btn", () => _fetch(() => $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r))));
		$body.on("click.gd", ".ev-gd-load-btn", () => _fetch(() => { this._gd_load(_h, _r, "Web API"); this._gd_d.hide(); }));
	}

	// ── Shared load + utilities ───────────────────────────────────────────────

	_gd_load(headers, rows, label, report_meta = null, fieldnames = null) {
		// Use actual fieldnames as data keys when available (fixes Smart Lookup matching)
		const keys = fieldnames || headers.map((_, i) => String(i));
		const col_configs = headers.map((h, i) => ({
			data: keys[i], title: String(h), type: "text",
			width: Math.max(80, Math.min(200, String(h).length * 9 + 20)),
		}));
		const blank = Object.fromEntries(keys.map(k => [k, ""]));
		const data_rows = rows.map(r => Object.fromEntries(keys.map((k, i) => [k, String(r[i] ?? "")])));
		while (data_rows.length < 50) data_rows.push({ ...blank });

		if (this._gd_target === "current") {
			const sm = this.board.sheet_manager;
			const s = sm?._sheets?.get(sm?._active_id);
			if (s?.is_blank) {
				s.columns_config = col_configs; s.data = data_rows; s.report_meta = report_meta;
				sm._apply_sheet(s); return;
			}
			frappe.msgprint(__("Current sheet is a DocType sheet — loading into a new sheet instead."));
		}
		this.board.sheet_manager.add_blank_sheet_with_data(label || __("Import"), col_configs, data_rows, report_meta);
	}

	// ── Report filter helper class methods (shared with in-sheet filter bar) ──

	/** Resolve the default value for a report filter definition. */
	_gd_default_val(f) {
		let d = f.default;
		if (typeof d === "function") { try { d = d(); } catch (_) { d = ""; } }
		if (typeof d === "string") {
			if (d === "Today")      return frappe.datetime.get_today();
			if (d === "Year Start") return frappe.datetime.year_start();
		}
		return d ?? "";
	}

	/** Render one filter row HTML from a filter definition object. */
	_gd_filter_row(f) {
		const fn  = frappe.utils.escape_html(f.fieldname || "");
		const lbl = frappe.utils.escape_html(__(f.label || f.fieldname || ""));
		const ft  = (f.fieldtype || "Data").toLowerCase();
		const def = frappe.utils.escape_html(String(this._gd_default_val(f)));
		const req = f.reqd ? `<span class="ev-gd-req" title="${__("Required")}">*</span>` : "";

		let input;
		if (ft === "date") {
			input = `<input type="date" class="form-control ev-gd-rfv" data-fn="${fn}" value="${def}">`;
		} else if (ft === "daterange") {
			const parts = Array.isArray(f.default) ? f.default : [frappe.datetime.year_start(), frappe.datetime.get_today()];
			input = `<input type="date" class="form-control ev-gd-rfv ev-gd-rfv-from" data-fn="${fn}" value="${parts[0]}" style="width:calc(50% - 10px)">
				<span style="margin:0 4px;color:var(--text-muted)">–</span>
				<input type="date" class="form-control ev-gd-rfv ev-gd-rfv-to" data-fn="${fn}__to" value="${parts[1]}" style="width:calc(50% - 10px)">`;
		} else if (ft === "select") {
			const raw_opts = f.options ?? "";
			const opts = Array.isArray(raw_opts) ? raw_opts : String(raw_opts).split("\n").filter(Boolean);
			input = `<select class="form-control ev-gd-rfv" data-fn="${fn}">
				${opts.map(o => `<option${o === def ? " selected" : ""}>${frappe.utils.escape_html(o)}</option>`).join("")}
			</select>`;
		} else if (ft === "check") {
			input = `<input type="checkbox" class="ev-gd-rfv ev-gd-rfv-check" data-fn="${fn}"${def === "1" || def === "true" ? " checked" : ""} style="margin-top:6px">`;
		} else if (ft === "int" || ft === "float" || ft === "currency") {
			input = `<input type="number" class="form-control ev-gd-rfv" data-fn="${fn}" value="${def}">`;
		} else {
			input = `<input type="text" class="form-control ev-gd-rfv" data-fn="${fn}" value="${def}" placeholder="${lbl}">`;
		}

		return `<div class="ev-gd-rpt-frow ev-gd-rpt-frow--dynamic" data-fn="${fn}">
			<label class="ev-gd-rpt-flbl">${lbl}${req}</label>
			<div class="ev-gd-rpt-finputs">${input}</div>
		</div>`;
	}

	/** Collect filter values from .ev-gd-rfv inputs inside $container. */
	_gd_collect_filters($container) {
		const f = {};
		$container.find(".ev-gd-rpt-frow--dynamic").each((_, row) => {
			$(row).find(".ev-gd-rfv").each((_, inp) => {
				const fn = $(inp).data("fn");
				if (!fn) return;
				if ($(inp).is("[type=checkbox]")) f[fn] = $(inp).prop("checked") ? 1 : 0;
				else f[fn] = $(inp).val();
			});
		});
		return f;
	}

	/** Render/update the in-sheet report filter bar above the HOT grid. */
	_show_report_filter_bar(sheet) {
		this.board.$wrapper.find(".ev-report-filter-bar").remove();
		if (!sheet?.report_meta?.name) return;

		const rm = sheet.report_meta;
		const filter_defs = rm.filter_defs || [];

		const $bar = $(`
			<div class="ev-report-filter-bar">
				<div class="ev-rfb-inner">
					<span class="ev-rfb-badge">
						<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M14 2H2v2.17l5 4.99V13l2 1V9.15l5-4.99V2z"/></svg>
						${frappe.utils.escape_html(rm.name)}
					</span>
					<div class="ev-rfb-controls-wrap"></div>
					<div class="ev-rfb-actions">
						<button class="ev-rfb-refresh-btn btn btn-xs btn-primary">↻ ${__("Refresh")}</button>
						<button class="ev-rfb-collapse-btn" title="${__("Collapse filters")}">▾</button>
					</div>
				</div>
			</div>
		`).prependTo(this.board.$hot_container.parent());

		const $cw = $bar.find(".ev-rfb-controls-wrap");
		rm._controls = {};

		filter_defs.forEach(f => {
			const ft = (f.fieldtype || "Data").toLowerCase();
			const label_html = `<span class="ev-rfb-ctrl-lbl">${frappe.utils.escape_html(__(f.label || f.fieldname))}${f.reqd ? '<span class="ev-rfb-req">*</span>' : ""}</span>`;

			if (ft === "daterange") {
				// DateRange → two Date controls side by side
				const $item = $(`<div class="ev-rfb-ctrl-item ev-rfb-ctrl-item--range">${label_html}<div class="ev-rfb-range-inputs"></div></div>`).appendTo($cw);
				const $ri = $item.find(".ev-rfb-range-inputs");
				const $fw = $(`<div class="ev-rfb-date-half"></div>`).appendTo($ri);
				$(`<span class="ev-rfb-range-sep">–</span><div class="ev-rfb-date-half"></div>`).appendTo($ri);

				const from_ctrl = frappe.ui.form.make_control({ df: { fieldtype: "Date", fieldname: f.fieldname, label: "" }, parent: $fw[0], render_input: true });
				const to_ctrl   = frappe.ui.form.make_control({ df: { fieldtype: "Date", fieldname: f.fieldname + "__to", label: "" }, parent: $ri.find(".ev-rfb-date-half").last()[0], render_input: true });
				from_ctrl.refresh(); to_ctrl.refresh();

				const parts = Array.isArray(f.default) ? f.default : [frappe.datetime.year_start(), frappe.datetime.get_today()];
				setTimeout(() => {
					from_ctrl.set_value(rm.current_filters?.[f.fieldname] || parts[0]);
					to_ctrl.set_value(rm.current_filters?.[f.fieldname + "__to"] || parts[1]);
				}, 50);
				rm._controls[f.fieldname] = from_ctrl;
				rm._controls[f.fieldname + "__to"] = to_ctrl;

			} else {
				const $item = $(`<div class="ev-rfb-ctrl-item">${label_html}<div class="ev-rfb-ctrl-input"></div></div>`).appendTo($cw);

				// Normalize Select options: can be array OR newline-separated string
				let df_options = f.options || "";
				if (ft === "select" && Array.isArray(f.options)) df_options = f.options.join("\n");

				const ctrl = frappe.ui.form.make_control({
					df: {
						fieldtype: f.fieldtype || "Data",
						fieldname: f.fieldname,
						label: "",
						options: df_options,
						reqd: f.reqd ? 1 : 0,
					},
					parent: $item.find(".ev-rfb-ctrl-input")[0],
					render_input: true,
				});
				ctrl.refresh();

				// Apply custom report filter JS properties (get_query, query, filters)
				// so Link autocomplete respects any constraints defined in the report JS file
				if (ft === "link") {
					if (f.get_query) ctrl.get_query = f.get_query;
					if (f.query)     ctrl.df.query   = f.query;
					if (f.filters)   ctrl.df.filters  = f.filters;
				}

				const saved_val = rm.current_filters?.[f.fieldname];
				const default_val = this._gd_default_val(f);
				const val = saved_val !== undefined ? saved_val : default_val;
				if (val !== "" && val !== null && val !== undefined) {
					setTimeout(() => ctrl.set_value(String(val)), 50);
				}
				rm._controls[f.fieldname] = ctrl;
			}
		});

		// Toggle collapse
		$bar.on("click", ".ev-rfb-collapse-btn", (e) => {
			$bar.toggleClass("ev-rfb--collapsed");
			$(e.currentTarget).text($bar.hasClass("ev-rfb--collapsed") ? "▸" : "▾");
		});

		// Auto-refresh if sheet data is stale from workbook restore
		if (sheet._data_is_stale) {
			setTimeout(() => $bar.find(".ev-rfb-refresh-btn").trigger("click"), 0);
		}

		// Refresh — collect from Frappe controls
		$bar.on("click", ".ev-rfb-refresh-btn", () => {
			const filters = {};
			filter_defs.forEach(f => {
				const ft = (f.fieldtype || "Data").toLowerCase();
				if (ft === "daterange") {
					const from_v = rm._controls[f.fieldname]?.get_value?.();
					const to_v   = rm._controls[f.fieldname + "__to"]?.get_value?.();
					if (from_v || to_v) filters[f.fieldname] = [from_v || "", to_v || ""];
				} else {
					const v = rm._controls[f.fieldname]?.get_value?.();
					if (v !== null && v !== undefined && v !== "") filters[f.fieldname] = v;
				}
			});
			rm.current_filters = { ...filters };

			frappe.call({
				method: "frappe.desk.query_report.run",
				args: { report_name: rm.name, filters, ignore_prepared_report: 1 },
				freeze: true, freeze_message: __("Refreshing report…"),
				callback: (r) => {
					if (!r.message) return;
					const res = r.message;
					const raw = res.columns || [];
					const cols = raw.map(c => typeof c === "string" ? { label: c, fieldname: c } : c);
					const hdrs = cols.map(c => c.label || c.fieldname);
					const keys = cols.map(c => c.fieldname || c.label);
					const result_rows = (res.result || [])
						.filter(row => !row.is_subtotal && !row.is_total)
						.map(row => keys.map((k, i) => Array.isArray(row) ? row[i] : (row[k] ?? "")));
					// Use fieldnames as data keys (matches col_configs created at load time)
					const sheet_keys = sheet.columns_config?.length ? sheet.columns_config.map(c => c.data) : keys;
					const blank = Object.fromEntries(sheet_keys.map(k => [k, ""]));
					const data_rows = result_rows.map(row => Object.fromEntries(sheet_keys.map((k, i) => [k, String(row[i] ?? "")])));
					while (data_rows.length < 50) data_rows.push({ ...blank });
					sheet.data = data_rows;
					sheet._data_is_stale = false;
					this.board.hot.loadData(data_rows);
					// Re-run any Smart Lookups that enrich this sheet's rows.
					if (this.board._applied_lookups?.some(c => c.src_sheet_id === sheet.id)) {
						setTimeout(() => this.board._reapply_smart_lookups(), 0);
					}
					frappe.show_alert({ message: __("{0} rows loaded", [result_rows.length]), indicator: "green" }, 2);
				},
			});
		});
	}

	_gd_detect_delim(text) {
		const s = text.slice(0, 2000), c = { ",": 0, ";": 0, "\t": 0, "|": 0 };
		for (const ch of s) if (ch in c) c[ch]++;
		return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
	}

	_gd_parse_csv(text, delim = ",") {
		const rows = []; let row = [], cur = "", inq = false;
		for (let i = 0; i < text.length; i++) {
			const c = text[i];
			if (inq) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') { inq = false; } else { cur += c; } }
			else if (c === '"') { inq = true; }
			else if (c === delim) { row.push(cur); cur = ""; }
			else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
			else if (c !== "\r") { cur += c; }
		}
		if (cur || row.length) { row.push(cur); rows.push(row); }
		return rows.filter(r => r.some(v => v.trim()));
	}

	_gd_path(obj, path) {
		return path.split(".").reduce((o, k) => (o != null ? o[k] : undefined), obj);
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
