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

						${this._grp(__("Dashboard"), `
							<button class="ev-tb-btn ev-tb-btn--lg ev-dash-numcard-btn" title="${__("Add Number Card to dashboard")}">
								<span class="ev-tb-icon">🔢</span>
								<span class="ev-btn-label">${__("Number Card")}</span>
							</button>
							<button class="ev-tb-btn ev-tb-btn--lg ev-dash-chart-btn" title="${__("Add Chart to dashboard")}">
								<span class="ev-tb-icon">📊</span>
								<span class="ev-btn-label">${__("Chart")}</span>
							</button>
							<button class="ev-tb-btn ev-tb-btn--lg ev-dash-date-btn" title="${__("Add Date Filter to dashboard")}">
								<span class="ev-tb-icon">📅</span>
								<span class="ev-btn-label">${__("Date Filter")}</span>
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
							<button class="ev-tb-btn ev-tb-btn--lg ev-duplicate-record-btn" title="${__("Duplicate selected row(s) as new record(s)")}">
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
							<button class="ev-tb-btn ev-tb-btn--lg ev-bulk-add-btn" title="${__("Add multiple blank rows and create records in bulk — paste from Excel/Sheets")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>
								<span class="ev-btn-label">${__("Bulk Add")}</span>
							</button>
							<button class="ev-tb-btn ev-tb-btn--lg ev-bulk-import-btn" title="${__("Import rows from CSV, Report or any Get Data source into this DocType")}">
								<svg class="ev-btn-icon" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 0-.708-.708l3-3z"/></svg>
								<span class="ev-btn-label">${__("Bulk Import")}</span>
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

		// ── Insert tab: Dashboard widgets ──────────────────────────────────
		const _check_dashboard = () => {
			if (!this.board.sheet_manager?.get_current()?.is_dashboard) {
				frappe.show_alert({ message: __("Switch to a Dashboard sheet first"), indicator: "orange" }, 3);
				return false;
			}
			return true;
		};
		$w.on("click", ".ev-dash-numcard-btn", () => {
			if (_check_dashboard()) this.board.dashboard_manager?._open_widget_modal("number_card");
		});
		$w.on("click", ".ev-dash-chart-btn", () => {
			if (_check_dashboard()) this.board.dashboard_manager?._open_widget_modal("chart");
		});
		$w.on("click", ".ev-dash-date-btn", () => {
			if (_check_dashboard()) this.board.dashboard_manager?._open_widget_modal("date_filter");
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

		// Bulk Add — prompt for row count then enter bulk-add mode
		$w.on("click", ".ev-bulk-add-btn", () => {
			if (this.board._bulk_add_start >= 0) {
				// Already in bulk mode — ask if they want to cancel
				frappe.confirm(
					__("Bulk Add is already active. Cancel it and start fresh?"),
					() => {
						this.board._exit_bulk_add_mode();
						this._prompt_bulk_add();
					}
				);
			} else {
				this._prompt_bulk_add();
			}
		});

		// Bulk Import — open Get Data in import mode → Column Mapper → bulk-add with data
		$w.on("click", ".ev-bulk-import-btn", () => {
			if (!this.board.list_view?.can_write) {
				frappe.show_alert({ message: __("You don't have write permission"), indicator: "red" }, 3);
				return;
			}
			this._gd_import_mode = true;
			this._gd_open();
		});

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

	/** Prompt user for row count, then enter bulk-add mode on the board. */
	_prompt_bulk_add() {
		frappe.prompt(
			{
				fieldtype: "Int",
				fieldname: "n",
				label:     __("How many blank rows?"),
				default:   10,
				description: __("Fill them in, or paste directly from Excel/Google Sheets (Ctrl+V). Then click Create Records."),
			},
			({ n }) => {
				const count = Math.min(Math.max(parseInt(n) || 10, 1), 500);
				this.board._enter_bulk_add_mode(count);
			},
			__("Bulk Add Rows"),
			__("Add Rows"),
		);
	}

	// ── Duplicate / Smart Insert ─────────────────────────────────────────────

	/**
	 * Duplicate selected row(s) as new record(s).
	 * - Single row → inline insert dialog pre-filled (existing UX).
	 * - Multiple rows → bulk-duplicate mode (editable grid rows, then Create).
	 */
	async _duplicate_record() {
		if (!this.board.list_view?.can_write) {
			frappe.show_alert({ message: __("You don't have write permission"), indicator: "red" }, 3);
			return;
		}

		const selections = this.board.hot?.getSelected() || [];
		if (!selections.length) {
			frappe.show_alert({ message: __("Select row(s) to duplicate"), indicator: "orange" }, 3);
			return;
		}

		// Collect unique row indices from all selection ranges
		const row_set = new Set();
		for (const [r1, , r2] of selections) {
			const from = Math.min(r1, r2), to = Math.max(r1, r2);
			for (let r = from; r <= to; r++) row_set.add(r);
		}
		const row_indices = [...row_set].sort((a, b) => a - b);

		if (row_indices.length === 1) {
			// Single row — existing inline insert dialog
			const row_data = this.board.list_view.data?.[row_indices[0]];
			if (!row_data || row_data._is_new) return;
			const SYSTEM = new Set(["name","creation","modified","modified_by","owner",
				"docstatus","idx","_user_tags","_comments","_assign","_liked_by","_seen",
				"amended_from","naming_series"]);
			const prefill = {};
			for (const [k, v] of Object.entries(row_data)) {
				if (!SYSTEM.has(k) && !k.startsWith("_") && v != null && v !== "") prefill[k] = v;
			}
			this.board._start_inline_insert(prefill, /* is_duplicate */ true);
		} else {
			// Multiple rows — bulk duplicate mode
			this.board._bulk_duplicate(row_indices);
		}
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
		const sheets = (sm.get_all() || []).filter(s =>
			(s.columns_config?.length > 0 || s._columns?.length > 0) && !s.is_dashboard && !s.is_blank
		);

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
						<div class="ev-rs-icon">
							<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
								<path d="M11.5 2a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-1 0v-11a.5.5 0 0 1 .5-.5zm-3 3a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-1 0v-8a.5.5 0 0 1 .5-.5zm-3 3a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-1 0v-5a.5.5 0 0 1 .5-.5zm-3 3a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2a.5.5 0 0 1 .5-.5z"/>
							</svg>
						</div>
						<div>
							<div class="ev-rs-title">${__("Smart Lookup")}</div>
							<div class="ev-rs-sub">${__("Auto-detect join columns")}</div>
						</div>
					</div>
					<button class="ev-rs-close" title="${__("Close")}">
						<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M6 5.293l4.146-4.147.708.708L6.707 6l4.147 4.146-.708.708L6 6.707l-4.146 4.147-.708-.708L5.293 6 1.146 1.854l.708-.708z"/></svg>
					</button>
				</div>
				<div class="ev-rs-body">
					${sheets.length < 2 ? `
						<div class="ev-slk-empty">
							<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M17.5 14v7"/></svg>
							<div>${__("Load data into at least 2 sheets to use Smart Lookup.")}</div>
							<div style="margin-top:6px;font-size:11px">${__("Use Data → Get Data to add sheets.")}</div>
						</div>
					` : `
						<div class="ev-rs-field">
							<div class="ev-rs-label">
								<span class="ev-slk-lbl-badge ev-slk-lbl-badge--dest">IN</span>
								${__("Add Columns To")}
							</div>
							<select class="ev-slk-src-select form-control form-control-sm">${opts_html}</select>
							<div class="ev-rs-hint">${__("New lookup columns appear in this sheet")}</div>
						</div>
						<div class="ev-rs-field">
							<div class="ev-rs-label">
								<span class="ev-slk-lbl-badge ev-slk-lbl-badge--src">FROM</span>
								${__("Pull Data From")}
							</div>
							<select class="ev-slk-tgt-select form-control form-control-sm">${opts_html}</select>
							<div class="ev-rs-hint">${__("Reference sheet — columns from here get joined")}</div>
						</div>
						<div style="display:flex;gap:6px;margin-top:2px">
							<button class="btn btn-xs btn-default ev-slk-swap-btn" style="flex:0 0 auto" title="${__("Swap sheets")}">
								<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>
								${__("Swap")}
							</button>
							<button class="btn btn-primary btn-sm ev-slk-analyze-btn" style="flex:1">
								${__("Analyze Joins")} →
							</button>
						</div>
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

		const src_sample = (src.data || []).slice(0, 200).map(row =>
			src_headers.map(h => String(row[h.fieldname] ?? ""))
		);
		const tgt_sample = (tgt.data || []).slice(0, 200).map(row =>
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
					this._apply_client_side_lookup(src, tgt, candidate, return_fields);
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
		$apply.find(".ev-slk-fieldpick-label").html(`
			<span>${__("From")} <strong>${frappe.utils.escape_html(tgt_sheet.label)}</strong>:</span>
			<button class="ev-slk-chip-toggle" data-all="0">${__("Select all")}</button>
		`);

		$chips.html(pickable.map(c => {
			const fn  = c.fieldname || c.data || "";
			const lbl = c.label || c.title || fn;
			return `<button class="ev-slk-chip" data-fn="${frappe.utils.escape_html(fn)}" data-lbl="${frappe.utils.escape_html(lbl)}">
				${frappe.utils.escape_html(lbl)}
			</button>`;
		}).join("") || `<span class="ev-slk-chips-empty text-muted" style="font-size:11px">${__("No columns available")}</span>`);

		// Toggle chip selection on click
		$chips.off("click.chip").on("click.chip", ".ev-slk-chip", (e) => {
			$(e.currentTarget).toggleClass("ev-slk-chip--selected");
		});

		// Select all / none toggle
		$apply.off("click.chiptoggle").on("click.chiptoggle", ".ev-slk-chip-toggle", (e) => {
			const $btn = $(e.currentTarget);
			const all = $btn.data("all") === 1;
			$chips.find(".ev-slk-chip").toggleClass("ev-slk-chip--selected", !all);
			$btn.data("all", all ? 0 : 1).text(all ? __("Select all") : __("Select none"));
		});
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
				this._apply_client_side_lookup(src_sheet, tgt_sheet, candidate, return_fields);
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

		const board = this.board;
		const new_cols = return_fields.map(f => ({
			data: `_slk_${f.fieldname}`,
			title: `${f.label} [${tgt_sheet.label}]`,
			readOnly: true,
			_is_lookup_col: true,
		}));

		const _do_join = () => {
			_sheet_data(src_sheet).forEach(row => {
				const key    = String(row[candidate.src_field] ?? "").trim().toLowerCase();
				const tgt_row = tgt_map.get(key);
				return_fields.forEach(f => {
					row[`_slk_${f.fieldname}`] = tgt_row ? (tgt_row[f.fieldname] ?? "") : "";
				});
			});

			// Persist new col defs onto the sheet
			src_sheet.columns_config = [...(src_sheet.columns_config || []), ...new_cols];

			const is_base = src_sheet.id === sm._get_sheet0_id();
			if (is_base) {
				const existing_keys = new Set(board._master_columns.map(c => c.data));
				const truly_new = new_cols.filter(c => !existing_keys.has(c.data));
				if (truly_new.length) {
					board._master_columns.push(...truly_new);
					board.columns = board._master_columns.filter(c => !board._hidden_col_keys.has(c.data));
					board.hot?.updateSettings({ columns: board.columns });
					board.hot?.render();
				}
			} else if (sm.get_current()?.id === src_sheet.id) {
				if (src_sheet._columns) {
					// Secondary sheet uses _columns — inject directly, skip _apply_sheet
					const existing = new Set(src_sheet._columns.map(c => c.data));
					new_cols.forEach(c => { if (!existing.has(c.data)) src_sheet._columns.push(c); });
					board.columns = src_sheet._columns;
					board.hot?.updateSettings({ columns: board.columns });
					board.hot?.loadData(src_sheet.data || []);
				} else {
					sm._apply_sheet(src_sheet);
				}
			}
		};

		// If the join-key field was not fetched for a secondary DocType sheet, get it now
		const src_rows = _sheet_data(src_sheet);
		const join_key_missing = src_sheet.doctype
			&& src_rows.length > 0
			&& !(candidate.src_field in src_rows[0]);
		if (join_key_missing) {
			frappe.db.get_list(src_sheet.doctype, { fields: ["name", candidate.src_field], limit: 0 })
				.then(rows => {
					const key_map = new Map(rows.map(r => [r.name, r[candidate.src_field] ?? ""]));
					src_rows.forEach(row => { row[candidate.src_field] = key_map.get(row.name) ?? ""; });
					_do_join();
				});
		} else {
			_do_join();
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
			src_sheet_id:      src_sheet.id,      // ephemeral — used within-session only
			src_sheet_label:   src_sheet.label,   // persistent identifier for cross-session restore
			src_sheet_doctype: src_sheet.doctype || null,
			tgt_sheet_id:    tgt_sheet.id,
			tgt_sheet_label: tgt_sheet.label,
			tgt_source,
			src_field:       candidate.src_field,
			tgt_field:       candidate.tgt_field,
			return_fields,
			_value_cache:    value_cache,
		});
		// Sync-patch to avoid race condition with concurrent saves.
		// Never save data values (_value_cache, _fresh_rows) to user_settings — only config.
		const _slk_save = board._applied_lookups.map(({ _fresh_rows: _f, _value_cache: _v, ...rest }) => rest);
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

	// ─── BULK IMPORT (Column Mapper) ──────────────────────────────────────────

	/**
	 * Open the Column Mapper modal after the user has chosen a data source via Get Data.
	 * Allows mapping source columns → DocType fields, checks link dependencies, then
	 * enters bulk-add-with-data mode for inline review before creating.
	 */
	_open_bulk_import_mapper(headers, rows, fieldnames) {
		const doctype = this.board.doctype;
		frappe.model.with_doctype(doctype, () => {
			const meta = frappe.get_meta(doctype);
			if (!meta) {
				frappe.show_alert({ message: __("DocType meta not loaded"), indicator: "red" }, 3);
				return;
			}

			const SKIP_TYPES = new Set(["Section Break","Column Break","Tab Break","HTML","Heading","Button","Fold"]);
			// For import, include all non-structural fields (even read_only/hidden —
			// bulk insert can set any field regardless of form-level read_only).
			const usable = (meta.fields || []).filter(f =>
				!SKIP_TYPES.has(f.fieldtype) && f.fieldname
			);

			const matched = this._bi_match_fields(headers, fieldnames, usable);

			const esc = frappe.utils.escape_html;

			// ── Select options (built once, pre-selected per row) ────────────────────────
			const _select_opts = (pre_fn) =>
				`<option value=""${!pre_fn ? " selected" : ""}>— ${__("Skip")} —</option>` +
				usable.map(f => {
					const lbl = __(f.label || f.fieldname);
					return `<option value="${esc(f.fieldname)}"${f.fieldname === pre_fn ? " selected" : ""}>${esc(lbl)}</option>`;
				}).join("");

			// ── Detect child table columns (Frappe standard formats) ──────────────────────
			// Format 1: "Field Label (table_fieldname)"  e.g. "Rate (items)"
			// Format 2: "table_fieldname.child_fieldname" e.g. "items.rate"
			const table_flds_meta = (meta.fields || []).filter(f => f.fieldtype === "Table");
			const CHILD_LABEL_RE  = /^(.+?)\s*\((\w+)\)\s*$/;
			const CHILD_DOT_RE    = /^(\w+)\.(\w+)$/;
			const child_col_cfg   = [];

			const parent_rows_html = [];
			const child_groups   = {};   // table_field → { label, rows: html[] }

			headers.forEach((h, i) => {
				const h_t = h.trim();

				// Format 2: table_field.child_field  e.g. "items.rate"
				const dot_m = h_t.match(CHILD_DOT_RE);
				if (dot_m) {
					const [, tbl, cfld] = dot_m;
					const tbl_meta = table_flds_meta.find(f => f.fieldname === tbl);
					if (tbl_meta) {
						if (!child_groups[tbl]) child_groups[tbl] = { label: __(tbl_meta.label || tbl), rows: [] };
						child_groups[tbl].rows.push(`<div class="ev-bi-child-col-row">
							<span class="ev-bi-cc-src">${esc(h_t)}</span>
							<span class="ev-bi-cc-arrow">\u2192</span>
							<span class="ev-bi-cc-fn">${esc(cfld)}</span>
						</div>`);
						child_col_cfg.push({ src_idx: i, table_field: tbl, child_field: cfld });
						return;
					}
				}

				// Format 1: Label (table_field)  e.g. "Rate (items)"
				const lbl_m = h_t.match(CHILD_LABEL_RE);
				if (lbl_m) {
					const [, lbl, tbl] = lbl_m;
					const tbl_meta = table_flds_meta.find(f => f.fieldname === tbl);
					if (tbl_meta) {
						if (!child_groups[tbl]) child_groups[tbl] = { label: __(tbl_meta.label || tbl), rows: [] };
						child_groups[tbl].rows.push(`<div class="ev-bi-child-col-row">
							<span class="ev-bi-cc-src">${esc(h_t)}</span>
							<span class="ev-bi-cc-arrow">\u2192</span>
							<span class="ev-bi-cc-fn">${esc(lbl.trim())}</span>
						</div>`);
						child_col_cfg.push({ src_idx: i, table_field: tbl, child_field_label: lbl.trim() });
						return;
					}
				}

				// Regular parent column — only show if a plausible BOM field match exists.
				// Unrecognised columns (e.g. "item_group" when BOM has no such field) are
				// hidden from the mapper but still collected as unmapped_cols for dep-graph.
				const pre_fn = matched[i] || "";
				if (!pre_fn) {
					const fn_norm = h_t.toLowerCase().replace(/[\s\-]+/g, "_");
					const has_field = usable.some(f =>
						f.fieldname === fn_norm ||
						(f.label || "").toLowerCase().replace(/\s+/g, "_") === fn_norm
					);
					if (!has_field) return;   // no meta match → skip mapper row silently
				}
				parent_rows_html.push(`<tr class="${pre_fn ? "ev-bi-row--matched" : ""}">
					<td class="ev-bi-src-col">${esc(h_t)}</td>
					<td>
						<select class="ev-bi-map form-control form-control-sm" data-src-idx="${i}">
							${_select_opts(pre_fn)}
						</select>
					</td>
				</tr>`);
			});

			// \u2500\u2500 Child groups HTML \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
			const child_groups_html = Object.entries(child_groups).map(([, grp]) =>
				`<div class="ev-bi-child-group">
					<div class="ev-bi-child-grp-hdr">
						<span class="ev-bi-child-grp-lbl">${esc(grp.label)}</span>
						<span class="ev-bi-child-grp-cnt">${grp.rows.length}</span>
					</div>
					<div class="ev-bi-child-grp-body">${grp.rows.join("")}</div>
				</div>`
			).join("");

			// \u2500\u2500 Stats \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
			const n_rows    = rows.length;
			const n_parent  = parent_rows_html.length;
			const n_auto    = child_col_cfg.length;
			const n_matched = matched.filter(Boolean).length;

			const auto_sec_html = child_col_cfg.length ? `
				<div class="ev-bi-auto-section">
					<div class="ev-bi-auto-sec-hdr">\u2713 ${__("Auto-detected child columns")}</div>
					${child_groups_html}
				</div>` : "";

			// \u2500\u2500 Modal HTML \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
			this.$bi_modal = $(`
				<div class="ev-bi-backdrop">
					<div class="ev-bi-modal">
						<div class="ev-bi-modal-hdr">
							<span class="ev-bi-title">${__("Import into")} <span class="ev-bi-title-dt">${esc(doctype)}</span></span>
							<button class="ev-bi-modal-close" aria-label="${__("Close")}">
								<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
							</button>
						</div>
						<div class="ev-bi-stats-bar">
							<span class="ev-bi-stat-chip ev-bi-stat-chip--rows">${n_rows} ${__("rows")}</span>
							\u00b7
							<span class="ev-bi-stat-chip ev-bi-stat-chip--map">${n_parent - n_matched} ${__("to map")}</span>
							\u00b7
							<span class="ev-bi-stat-chip ev-bi-stat-chip--auto">\u2713 ${n_auto} ${__("auto-detected")}</span>
						</div>
						<div class="ev-bi-two-col">
							<div class="ev-bi-col-map">
								<table class="ev-bi-table">
									<thead><tr>
										<th>${__("Your Column")}</th>
										<th>${__("Maps to")}</th>
									</tr></thead>
									<tbody>${parent_rows_html.join("")}</tbody>
								</table>
							</div>
							${auto_sec_html ? `<div class="ev-bi-col-auto">${auto_sec_html}</div>` : ""}
						</div>
						<div class="ev-bi-modal-footer">
							<button class="btn btn-sm btn-default ev-bi-back-btn">
								<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" style="margin-right:4px"><path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/></svg>
								${__("Back")}
							</button>
							<div class="ev-bi-foot-right">
								<button class="btn btn-sm btn-default ev-bi-cancel-btn">${__("Cancel")}</button>
								<button class="btn btn-sm btn-primary ev-bi-import-btn">${__("Next")} →</button>
							</div>
						</div>
					</div>
				</div>
			`).appendTo($("body"));

			// ── Event bindings ────────────────────────────────────────────────────────
			this.$bi_modal
				.on("click", ".ev-bi-modal-close, .ev-bi-cancel-btn", () => {
					this.$bi_modal?.remove(); this.$bi_modal = null;
				})
				.on("click", ".ev-bi-back-btn", () => {
					this.$bi_modal?.remove(); this.$bi_modal = null;
					this._gd_import_mode = true;
					this._gd_open();
				})
				.on("click", ".ev-bi-import-btn", () => {
					const col_map = {};
					this.$bi_modal.find(".ev-bi-map").each(function () {
						const fn  = $(this).val();
						const idx = parseInt($(this).attr("data-src-idx"));
						if (fn) col_map[idx] = fn;
					});
					const mapped_rows = this._bi_build_records(rows, col_map, child_col_cfg, headers);
					if (!mapped_rows.length) {
						frappe.show_alert({ message: __("No records found."), indicator: "orange" }, 3);
						return;
					}
					this.$bi_modal?.remove();
					this.$bi_modal = null;
					this._bi_show_dep_graph(mapped_rows, rows, headers, fieldnames, col_map, child_col_cfg);
				});

			// Backdrop click closes
			this.$bi_modal.on("click.bi", (e) => {
				if ($(e.target).hasClass("ev-bi-backdrop")) {
					this.$bi_modal?.remove(); this.$bi_modal = null;
				}
			});
		});
	}

	// \u2500\u2500\u2500 BULK IMPORT HELPERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

	/**
	 * Match CSV headers to DocType fieldnames.
	 * 4-layer: L1 exact fieldnames list \u2192 L2 exact fieldname set \u2192 L3 exact scrubbed label \u2192 L4 bare scrubbed label.
	 */
	_bi_match_fields(headers, fieldnames, usable) {
		const scrub = s => (s || "").toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
		const fn_set  = new Set(usable.map(f => f.fieldname));
		const lbl_map = {};
		usable.forEach(f => {
			const lbl = (f.label || f.fieldname || "").toLowerCase();
			lbl_map[lbl]          = f.fieldname;
			lbl_map[scrub(f.label || f.fieldname)] = f.fieldname;
		});
		const fn_list = new Set((fieldnames || []).map(s => (s || "").toLowerCase()));
		return headers.map(h => {
			const h_lc = (h || "").trim().toLowerCase();
			const h_sc = scrub(h);
			// L1: in provided fieldnames list
			if (fn_list.has(h_lc)) return fn_set.has(h_lc) ? h_lc : null;
			// L2: exact match in usable fieldname set
			if (fn_set.has(h_lc)) return h_lc;
			// L3: scrubbed label exact
			if (lbl_map[h_lc]) return lbl_map[h_lc];
			// L4: bare scrubbed
			if (lbl_map[h_sc]) return lbl_map[h_sc];
			return null;
		});
	}

	/**
	 * Build mapped record objects from raw CSV rows + column mapping.
	 * Returns array of plain objects ready for frappe.get_doc.
	 */
	_bi_build_records(rows, col_map, child_col_cfg, headers) {
		const mapped_idxs = Object.keys(col_map).map(Number);
		const child_idxs  = new Set((child_col_cfg || []).map(c => c.src_idx));
		const is_cont = (row) => mapped_idxs.length > 0 &&
			mapped_idxs.every(idx => !String(row[idx] ?? "").trim());

		// Extra columns: not in col_map and not child-table source — folded into record
		// so the dep-graph backend can find them via meta Link-field scan (e.g. item_group).
		const extra_idxs = headers
			? headers.map((h, i) => ({ i, fn: (h || "").trim().toLowerCase().replace(/[\s\-]+/g, "_") }))
				.filter(({ i, fn }) => fn && !mapped_idxs.includes(i) && !child_idxs.has(i) && !fn.includes("."))
			: [];

		const groups = [];
		for (const row of rows) {
			if (!is_cont(row)) groups.push({ parent: row, cont: [] });
			else if (groups.length) groups[groups.length - 1].cont.push(row);
		}

		return groups.map(({ parent, cont }) => {
			const obj = {};
			Object.entries(col_map).forEach(([idx_s, fn]) => {
				const v = String(parent[parseInt(idx_s)] ?? "").trim();
				if (v) obj[fn] = v;
			});
			// Fold extra column values into record for dep-graph analysis
			extra_idxs.forEach(({ i, fn }) => {
				const v = String(parent[i] ?? "").trim();
				if (v && !(fn in obj)) obj[fn] = v;
			});
			const by_table = {};
			[parent, ...cont].forEach(row => {
				const per_table = {};
				child_col_cfg.forEach(cfg => {
					const v = String(row[cfg.src_idx] ?? "").trim();
					if (!v) return;
					if (!per_table[cfg.table_field]) per_table[cfg.table_field] = {};
					if (cfg.child_field) per_table[cfg.table_field][cfg.child_field] = v;
				});
				Object.entries(per_table).forEach(([tbl, child_obj]) => {
					if (Object.keys(child_obj).length) {
						if (!by_table[tbl]) by_table[tbl] = [];
						by_table[tbl].push(child_obj);
					}
				});
			});
			Object.assign(obj, by_table);
			return obj;
		});
	}

	/**
	 * Process CSV rows \u2192 record objects with parent fields + child arrays, then
	 * dispatch to Tree import (TreeImportEngine) or flat import (_enter_bulk_add_mode_with_data).
	 */
	_bi_do_import(_headers, rows, col_map, child_col_cfg, $modal) {
		const doctype = this.board.doctype;
		const meta    = frappe.get_meta(doctype);

		const mapped_rows = this._bi_build_records(rows, col_map, child_col_cfg, _headers);
		if (!mapped_rows.length) {
			frappe.show_alert({ message: __("No records found in the file."), indicator: "orange" }, 4);
			return;
		}

		// \u2500\u2500 Tree vs flat dispatch \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
		const tree_info = this._bi_detect_tree_pattern(doctype);

		if (tree_info.pattern && mapped_rows.length) {
			const engine = new frappe.views.TreeImportEngine({
				doctype,
				meta,
				mapped_rows,
				tree_info,
				$modal,
				on_done: () => { this.board.list_view?.refresh(); },
			});
			engine.run();
			return;
		}

		// Flat import
		$modal?.remove();
		this.board._enter_bulk_add_mode_with_data(mapped_rows);
	}

	/**
	 * Step 2: Fetch dependency analysis from server, then render the node graph.
	 */
	async _bi_show_dep_graph(mapped_rows, rows, headers, fieldnames, col_map, child_col_cfg) {
		const doctype = this.board.doctype;

		// ── Build unmapped_cols: CSV columns not mapped to any BOM field or child table ──
		// These may contain data useful for dep DocType fields (e.g. "item_group" col B
		// isn't a BOM field but IS a field on Item → tells us which Item Groups are needed).
		const mapped_main_idxs = new Set(Object.keys(col_map).map(Number));
		const child_src_idxs   = new Set((child_col_cfg || []).map(cc => cc.src_idx));
		const unmapped_cols = {};
		// col_pair_data[fn] = {key_header, col_header, pairs:[{key,val}]}
		// Pairs key=first-mapped-col value, val=unmapped col value — used by View Mapping dialog
		const col_pair_data = {};
		const first_mapped_idx = Math.min(...[...mapped_main_idxs]);
		headers.forEach((h, i) => {
			if (mapped_main_idxs.has(i) || child_src_idxs.has(i)) return;
			const fn = (h || "").trim().toLowerCase().replace(/[\s\-]+/g, "_");
			if (!fn) return;
			const with_val = rows.map(r => (r[i] ?? "").toString().trim()).filter(Boolean);
			const unique_vals = [...new Set(with_val)];
			if (!unique_vals.length) return;
			unmapped_cols[fn] = { vals: unique_vals, rows_with_value: with_val.length };
			// Build per-row pairs for View Mapping dialog (key = first mapped col value)
			const pairs = rows
				.map(r => ({
					key: (r[first_mapped_idx] ?? "").toString().trim(),
					val: (r[i] ?? "").toString().trim(),
				}))
				.filter(p => p.key);
			if (pairs.some(p => p.val)) {
				col_pair_data[fn] = {
					key_header : headers[first_mapped_idx] || "Key",
					col_header : h || fn,
					pairs,
				};
			}
		});

		// ── Virtual state (deep-copy on first call, preserved across re-renders) ──────
		// Stores the canonical mutable copy of all import data. User edits from the
		// Fix panel are accumulated here so re-analysis never needs the original CSV.
		// Destroyed on Back / Cancel / successful import.
		if (!this._bi_vs) {
			this._bi_vs = {
				mapped_rows  : JSON.parse(JSON.stringify(mapped_rows)),
				rows         : JSON.parse(JSON.stringify(rows)),
				headers      : headers ? [...headers] : [],
				fieldnames   : fieldnames ? [...fieldnames] : [],
				col_map      : {...col_map},
				child_col_cfg: child_col_cfg ? JSON.parse(JSON.stringify(child_col_cfg)) : null,
				unmapped_cols: JSON.parse(JSON.stringify(unmapped_cols)),
				col_pair_data: JSON.parse(JSON.stringify(col_pair_data)),
				user_edits   : {},   // {fn: {item_name → value}} — accumulated fix panel edits
				dt_cache     : {},   // {doctype → [names]}       — autocomplete cache
			};
		}

		// Loading backdrop
		const $loading = $(`
			<div class="ev-bi-backdrop">
				<div class="ev-dg-loading">
					<div class="ev-dg-spinner"></div>
					<div class="ev-dg-loading-txt">${__("Analysing dependencies…")}</div>
				</div>
			</div>
		`).appendTo($("body"));

		let graph;
		try {
			graph = await frappe.xcall("excel_view.tree_import.analyze_import_deps", {
				doctype,
				records_json: JSON.stringify(mapped_rows),
			});
		} catch (e) {
			$loading.remove();
			frappe.show_alert({ message: __("Dependency analysis failed."), indicator: "red" }, 4);
			return;
		}
		$loading.remove();

		this._bi_render_dep_graph(graph, mapped_rows, rows, headers, fieldnames, col_map, child_col_cfg, col_pair_data);
	}

	/**
	 * Render the dependency graph modal.
	 */
	_bi_render_dep_graph(graph, mapped_rows, rows, headers, fieldnames, col_map, child_col_cfg, col_pair_data = {}) {
		const doctype   = this.board.doctype;
		const { nodes, edges } = graph;

		// ── 1. Layout ──────────────────────────────────────────────────────────────
		// BFS backwards from main node to assign column depth
		const adj_in = {};
		nodes.forEach(n => { adj_in[n.id] = []; });
		edges.forEach(e => { if (adj_in[e.to]) adj_in[e.to].push(e.from); });

		const col_depth = {};   // node_id → col depth (0 = main/rightmost, increases leftward)
		const queue = [doctype];
		col_depth[doctype] = 0;
		while (queue.length) {
			const cur = queue.shift();
			for (const src of (adj_in[cur] || [])) {
				if (col_depth[src] === undefined) {
					col_depth[src] = col_depth[cur] + 1;
					queue.push(src);
				}
			}
		}

		const max_depth = Math.max(...Object.values(col_depth), 0);
		nodes.forEach(n => {
			// display col: 0=leftmost dep, max_depth=main
			n._col = max_depth - (col_depth[n.id] ?? 0);
		});

		// Group by display column
		const by_col = {};
		nodes.forEach(n => {
			if (!by_col[n._col]) by_col[n._col] = [];
			by_col[n._col].push(n);
		});

		// ── 2. Pixel positions ─────────────────────────────────────────────────────
		const NW = 210, NH = 82, COL_GAP = 88, ROW_GAP = 14, PAD = 32;
		const num_cols  = max_depth + 1;
		const max_rows  = Math.max(...Object.values(by_col).map(a => a.length));
		const canvas_w  = PAD * 2 + num_cols * NW + (num_cols - 1) * COL_GAP;
		const canvas_h  = PAD * 2 + max_rows * NH + Math.max(0, max_rows - 1) * ROW_GAP;

		Object.entries(by_col).forEach(([col_s, col_nodes]) => {
			const col = parseInt(col_s);
			const cx  = PAD + col * (NW + COL_GAP);
			const total_h = col_nodes.length * NH + Math.max(0, col_nodes.length - 1) * ROW_GAP;
			const sy  = PAD + (canvas_h - PAD * 2 - total_h) / 2;
			col_nodes.forEach((n, i) => {
				n._x = cx;
				n._y = sy + i * (NH + ROW_GAP);
			});
		});

		// ── 3. Node card HTML ──────────────────────────────────────────────────────
		const esc = frappe.utils.escape_html;

		// DocType → SVG path (Heroicons outline, viewBox 0 0 24 24)
		const _DT_PATHS = {
			"BOM"         : "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
			"Item"        : "M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4",
			"Item Group"  : "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
			"UOM"         : "M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3",
			"Company"     : "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0H5m14 0H5m-2 0h2M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
			"Operation"   : "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
			"Workstation" : "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
			"Routing"     : "M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7",
			"Currency"    : "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
			"Warehouse"   : "M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z",
			"Customer"    : "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0",
			"Supplier"    : "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
		};
		const _DEFAULT_PATH = "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z";

		const _status_class = (n) => {
			if (n.type === "main")    return "ev-dg-node--main";
			if (n.total === 0)        return "ev-dg-node--structural";
			if (n.to_create === 0)    return "ev-dg-node--ok";
			if (n.existing > 0)       return "ev-dg-node--partial";
			return "ev-dg-node--create";
		};

		const _icon_html = (n) => {
			const sc  = _status_class(n);
			const d   = _DT_PATHS[n.id] || _DEFAULT_PATH;
			return `<div class="ev-dg-icon ${sc}">
				<svg viewBox="0 0 24 24" width="15" height="15" fill="none"
				     stroke="currentColor" stroke-width="1.75"
				     stroke-linecap="round" stroke-linejoin="round">
					<path d="${d}"/>
				</svg>
			</div>`;
		};

		const _stat_line = (n) => {
			if (n.type === "main")
				return `<div class="ev-dg-stat">${n.total} ${__("records to import")}</div>`;
			if (n.total === 0)
				return `<div class="ev-dg-stat ev-dg-stat--structural">${__("Prerequisite")}</div>`;
			const parts = [];
			if (n.existing)  parts.push(`<span class="ev-dg-ok">\u2713 ${n.existing}</span>`);
			if (n.to_create) parts.push(`<span class="ev-dg-cr">+ ${n.to_create}</span>`);
			// Incomplete nodes (unmapped col, coverage < 100%): show fraction covered
			if (n.incomplete && n.coverage_have != null) {
				parts.push(`<span class="ev-dg-cov">${n.coverage_have}/${n.coverage_total} ${__("covered")}</span>`);
			}
			let stat_html = `<div class="ev-dg-stat">${parts.join(" &nbsp;")} ${__("records")}</div>`;
			// Show which CSV column was assumed as the source (e.g. "via \"item_group\" col")
			if (n.source_col) {
				stat_html += `<div class="ev-dg-via">${__("via")} <code>${esc(n.source_col)}</code> ${__("col")}</div>`;
			}
			return stat_html;
		};

		const nodes_html = nodes.map(n => {
			const extra_cls    = n.incomplete ? " ev-dg-node--incomplete" : "";
			const data_src_col = n.source_col ? ` data-source-col="${esc(n.source_col)}"` : "";
			const footer_html  = n.incomplete ? `
				<div class="ev-dg-node-footer">
					${col_pair_data[n.source_col]
						? `<button class="ev-dg-map-btn">${__("View Mapping")}</button>` : ""}
					<button class="ev-dg-fix-btn">${__("Fix")} →</button>
				</div>` : "";
			return `
			<div class="ev-dg-node ${_status_class(n)}${extra_cls}"
			     style="left:${n._x}px;top:${n._y}px;width:${NW}px;"
			     data-id="${esc(n.id)}" title="${esc(n.id)}"${data_src_col}>
				<div class="ev-dg-node-prog-wrap"><div class="ev-dg-node-prog-fill"></div></div>
				<div class="ev-dg-node-row">
					${_icon_html(n)}
					<div class="ev-dg-node-text">
						<div class="ev-dg-label">${esc(n.label || n.id)}</div>
						${_stat_line(n)}
					</div>
				</div>
				${footer_html}
			</div>`;
		}).join("");

		// ── 4. SVG edges ──────────────────────────────────────────────────────────
		const node_map = {};
		nodes.forEach(n => { node_map[n.id] = n; });

		// Memoised DFS: is this dep chain blocked by missing/incomplete data?
		// GREEN = dep data is complete all the way up the chain (even if records need creating)
		// RED   = dep data is missing or incomplete for some references (cascade from upstream)
		// Uses a _visiting set to safely handle any graph cycles (no stack overflow).
		const _blocked_cache = {};
		const _visiting      = new Set();
		const _is_blocked = (nid) => {
			if (nid in _blocked_cache) return _blocked_cache[nid];
			if (_visiting.has(nid))    return (_blocked_cache[nid] = false); // cycle → treat as unblocked
			const n = node_map[nid];
			if (!n || n.total === 0) return (_blocked_cache[nid] = false);
			if (n.incomplete)        return (_blocked_cache[nid] = true);
			_visiting.add(nid);
			const blocked = edges.filter(e => e.to === nid).some(e => _is_blocked(e.from));
			_visiting.delete(nid);
			return (_blocked_cache[nid] = blocked);
		};

		// Per-edge: {color, dash, marker_id}
		const _edge_style = (e) => {
			const src = node_map[e.from];
			if (!src || src.total === 0) return { color: "#94a3b8", dash: "5,3", mid: "ev-dg-arr-gray" };
			if (_is_blocked(e.from))     return { color: "#ef4444", dash: "none", mid: "ev-dg-arr-red" };
			return                               { color: "#22c55e", dash: "none", mid: "ev-dg-arr-grn" };
		};

		const paths_html = edges.map(e => {
			const src = node_map[e.from];
			const tgt = node_map[e.to];
			if (!src || !tgt) return "";
			const x1 = src._x + NW, y1 = src._y + NH / 2;
			const x2 = tgt._x - 2,  y2 = tgt._y + NH / 2;
			const cx  = (x1 + x2) / 2;
			const { color, dash, mid } = _edge_style(e);
			return `<path fill="none" stroke="${color}" stroke-width="1.5"
			              stroke-dasharray="${dash}" marker-end="url(#${mid})"
			              d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}"/>`;
		}).join("");

		// ── 5. Legend ──────────────────────────────────────────────────────────────
		const legend_html = `
			<div class="ev-dg-legend">
				<span class="ev-dg-legend-item"><span class="ev-dg-dot ev-dg-node--ok"></span>${__("All exist in DB")}</span>
				<span class="ev-dg-legend-item"><span class="ev-dg-dot ev-dg-node--partial"></span>${__("Some to create")}</span>
				<span class="ev-dg-legend-item"><span class="ev-dg-dot ev-dg-node--create"></span>${__("Will be created")}</span>
				<span class="ev-dg-legend-item"><span class="ev-dg-legend-line ev-dg-legend-line--green"></span>${__("Data complete")}</span>
				<span class="ev-dg-legend-item"><span class="ev-dg-legend-line ev-dg-legend-line--red"></span>${__("Data missing")}</span>
			</div>
		`;

		// ── 6. Modal ───────────────────────────────────────────────────────────────
		this.$bi_dg_modal = $(`
			<div class="ev-bi-backdrop">
				<div class="ev-dg-modal">
					<div class="ev-bi-modal-hdr">
						<span class="ev-bi-title">${__("Import into")} <span class="ev-bi-title-dt">${esc(doctype)}</span> <span class="ev-dg-step-badge">${__("Step 2 — Dependency Review")}</span></span>
						<button class="ev-bi-modal-close ev-dg-close-btn" aria-label="${__("Close")}">
							<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
						</button>
					</div>
					<div class="ev-dg-canvas-wrap">
						<div class="ev-dg-canvas" style="width:${canvas_w}px;height:${canvas_h}px;position:relative;">
							<svg class="ev-dg-svg" width="${canvas_w}" height="${canvas_h}" style="position:absolute;inset:0;overflow:visible;">
								<defs>
									<marker id="ev-dg-arr-gray" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
										<path d="M0,0 L7,3.5 L0,7 Z" fill="#94a3b8"/>
									</marker>
									<marker id="ev-dg-arr-grn" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
										<path d="M0,0 L7,3.5 L0,7 Z" fill="#22c55e"/>
									</marker>
									<marker id="ev-dg-arr-red" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
										<path d="M0,0 L7,3.5 L0,7 Z" fill="#ef4444"/>
									</marker>
								</defs>
								${paths_html}
							</svg>
							${nodes_html}
						</div>
					</div>
					<div class="ev-dg-footer">
						${legend_html}
						<div class="ev-bi-foot-right">
							<button class="btn btn-sm btn-default ev-dg-back-btn">
								<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12" style="margin-right:4px"><path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/></svg>
								${__("Back")}
							</button>
							<button class="btn btn-sm btn-default ev-dg-cancel-btn">${__("Cancel")}</button>
			<button class="btn btn-sm btn-primary ev-dg-import-btn">${__("Import")} ${mapped_rows.length} ${__("records")}</button>
						</div>
					</div>
				</div>
			</div>
		`).appendTo($("body"));

		this.$bi_dg_modal
			.on("click", ".ev-bi-modal-close, .ev-dg-cancel-btn", () => {
				this.$bi_dg_modal?.remove(); this.$bi_dg_modal = null;
				this._bi_vs = null;   // destroy virtual state
			})
			.on("click", ".ev-dg-back-btn", () => {
				this.$bi_dg_modal?.remove(); this.$bi_dg_modal = null;
				this._bi_vs = null;   // destroy virtual state — user re-maps from scratch
				this._open_bulk_import_mapper(headers, rows, fieldnames);
			})
			.on("click", ".ev-dg-import-btn", async () => {
				const _vs            = this._bi_vs;
				const _rows          = _vs?.rows          || rows;
				const _col_map       = _vs?.col_map       || col_map;
				const _child_col_cfg = _vs?.child_col_cfg ?? child_col_cfg;
				const _mapped_rows   = this._bi_build_records(_rows, _col_map, _child_col_cfg, _vs?.headers);
				if (!_mapped_rows.length) return;

				// Lock UI
				const $modal = this.$bi_dg_modal;
				$modal.find(".ev-dg-import-btn, .ev-dg-back-btn, .ev-dg-cancel-btn, .ev-bi-modal-close")
				      .prop("disabled", true).css("opacity", .45);
				$modal.find(".ev-dg-import-btn").text(__("Creating deps…"));

				const job_id = `ev_imp_${Date.now()}`;

				// Per-node progress updater — each node tracks its own done/total
				const _node_prog = {};  // {node_id: {done, total}}
				nodes.forEach(n => { _node_prog[n.id] = { done: 0, total: n.to_create || 0 }; });
				_node_prog[doctype] = { done: 0, total: _mapped_rows.length };

				const _update_node = (node_id, done, total) => {
					_node_prog[node_id] = { done, total };
					const $n  = $modal.find(`.ev-dg-node[data-id="${node_id}"]`);
					const pct = total ? Math.round(done / total * 100) : (done > 0 ? 100 : 0);
					$n.find(".ev-dg-node-prog-fill").css("width", pct + "%");
					$n.find(".ev-dg-stat").text(
						node_id === doctype
							? `${done} / ${total}`
							: `✓ ${done} / ${total}`
					);
					if (pct >= 100 && !$n.hasClass("ev-dg-node--import-done")) {
						$n.addClass("ev-dg-node--import-done");
						if (!$n.find(".ev-dg-check").length)
							$n.find(".ev-dg-node-row").append('<span class="ev-dg-check">✓</span>');
					}
				};

				const _finish_all = (main_done, errors) => {
					frappe.realtime.off("ev_tree_progress");
					this._bi_vs = null;
					if (!errors.length) {
						_update_node(doctype, main_done, main_done);
						// Show success banner; keep Import button disabled
						$modal.find(".ev-dg-import-btn").prop("disabled", true).text(__("Import complete"));
						if (!$modal.find(".ev-dg-success-banner").length) {
							$modal.find(".ev-dg-footer").prepend(
								`<div class="ev-dg-success-banner">✓ ${main_done} ${__("records imported successfully")}</div>`
							);
						}
						setTimeout(() => {
							$modal.remove(); this.$bi_dg_modal = null;
							frappe.show_alert({ message: `${main_done} ${__("records created successfully")}`, indicator: "green" }, 4);
							this.board.list_view?.refresh();
						}, 2500);
					} else {
						$modal.find(`.ev-dg-node[data-id="${doctype}"]`).addClass("ev-dg-node--import-error");
						$modal.find(".ev-dg-import-btn").prop("disabled", false).css("opacity", 1).text(__("Import") + " " + _mapped_rows.length + " " + __("records"));
						$modal.find(".ev-dg-cancel-btn, .ev-bi-modal-close").prop("disabled", false).css("opacity", 1);
						const errs = errors.map(e => `${esc(e.doctype || e.name || "")}: ${esc(e.error || "")}`).join("\n");
						frappe.msgprint({ title: __("Import errors"), message: `<pre style="font-size:11px">${errs}</pre>`, indicator: "red" });
					}
				};

				// ── Step 1: Pre-create all dep records ──────────────────────────────
				const dep_nodes = nodes.filter(n => n.type !== "main" && (n.to_create || 0) > 0);
				if (dep_nodes.length) {
					// Track per-dep-node progress from ev_dep_progress events
					const dep_done = {};
					dep_nodes.forEach(n => { dep_done[n.id] = 0; });

					// Counter-based completion: wait until all expected events received or timeout
					const dep_total_expected = dep_nodes.reduce((s, n) => s + (n.to_create || 0), 0);
					let dep_received = 0;
					let _dep_resolve = null;
					const dep_done_promise = new Promise(r => { _dep_resolve = r; });

					frappe.realtime.on("ev_dep_progress", (data) => {
						if (data.job_id !== job_id) return;
						if (data.status === "ok") {
							dep_received++;
							dep_done[data.doctype] = (dep_done[data.doctype] || 0) + 1;
							const nd = nodes.find(n => n.id === data.doctype);
							_update_node(data.doctype, dep_done[data.doctype], nd?.to_create || data.total || 1);
							if (dep_received >= dep_total_expected) _dep_resolve?.();
						}
					});

					// Build per-record attribute hints from CSV data (stock_uom per item, etc.)
					const _dep_attrs = {};
					const _child_cfg = _vs?.child_col_cfg;
					const _vs_rows   = _vs?.rows || [];
					if (_child_cfg) {
						for (const [, col_map] of Object.entries(_child_cfg)) {
							const ic_col  = col_map["item_code"];
							const uom_col = col_map["uom"];
							if (ic_col === undefined || uom_col === undefined) continue;
							_dep_attrs["Item"] = _dep_attrs["Item"] || {};
							_vs_rows.forEach(r => {
								const ic  = (r[ic_col]  || "").trim();
								const uom = (r[uom_col] || "").trim();
								if (ic && uom && !_dep_attrs["Item"][ic]) {
									_dep_attrs["Item"][ic] = { stock_uom: uom };
								}
							});
						}
					}
					// Merge item_group from Fix-panel user_edits
					const _ig_map = _vs?.user_edits?.["item_group"] || {};
					Object.entries(_ig_map).forEach(([ic, ig]) => {
						_dep_attrs["Item"] = _dep_attrs["Item"] || {};
						_dep_attrs["Item"][ic] = { ...(_dep_attrs["Item"][ic] || {}), item_group: ig };
					});

					// Build per-Routing operations from CSV rows
					// The dep graph shows Operation→Routing→BOM; Routing must be created WITH operations
					const _routing_col = _vs?.col_map?.["routing"];
					const _item_col    = _vs?.col_map?.["item"];
					if (_child_cfg && _routing_col !== undefined && _item_col !== undefined) {
						// Find the child table key that has operation/workstation/time_in_mins
						for (const [, op_map] of Object.entries(_child_cfg)) {
							const op_col  = op_map["operation"];
							const ws_col  = op_map["workstation"];
							const tm_col  = op_map["time_in_mins"];
							if (op_col === undefined) continue;
							let cur_routing = null;
							_vs_rows.forEach(r => {
								const item = (r[_item_col] || "").trim();
								if (item) cur_routing = (r[_routing_col] || "").trim() || null;
								if (!cur_routing) return;
								const op = (r[op_col]  || "").trim();
								const ws = ws_col !== undefined ? (r[ws_col] || "").trim() : "";
								const tm = tm_col !== undefined ? parseFloat(r[tm_col]) || 0 : 0;
								if (!op) return;
								_dep_attrs["Routing"] = _dep_attrs["Routing"] || {};
								_dep_attrs["Routing"][cur_routing] = _dep_attrs["Routing"][cur_routing] || { operations: [] };
								const already = _dep_attrs["Routing"][cur_routing].operations;
								if (!already.some(x => x.operation === op && x.workstation === ws)) {
									already.push({ operation: op, workstation: ws, time_in_mins: tm });
								}
							});
							break; // only process first matching child table
						}
					}

					try {
						const dep_result = await frappe.xcall("excel_view.tree_import.pre_create_deps", {
							doctype,
							nodes_json      : JSON.stringify(nodes),
							edges_json      : JSON.stringify(graph.edges || []),
							user_edits_json : JSON.stringify(_vs?.user_edits || {}),
							dep_attrs_json  : JSON.stringify(_dep_attrs),
							job_id,
						});
						// Wait for all expected events (or 8s safety timeout) before removing handler
						await Promise.race([dep_done_promise, new Promise(r => setTimeout(r, 8000))]);
						frappe.realtime.off("ev_dep_progress");
						if (dep_result.errors?.length) {
							_finish_all(0, dep_result.errors);
							return;
						}
					} catch(err) {
						frappe.realtime.off("ev_dep_progress");
						_finish_all(0, [{ doctype: "deps", error: String(err) }]);
						return;
					}
				}

				// ── Step 2: Create main records ─────────────────────────────────────
				$modal.find(".ev-dg-import-btn").text(__("Importing…"));
				const tree_info = this._bi_detect_tree_pattern(doctype);
				let main_done = 0;

				if (tree_info.pattern) {
					let _tree_resolve = null;
					const tree_done_promise = new Promise(r => { _tree_resolve = r; });
					frappe.realtime.on("ev_tree_progress", (data) => {
						if (data.job_id !== job_id) return;
						if (data.status === "ok") {
							main_done++;
							_update_node(doctype, main_done, _mapped_rows.length);
							if (main_done >= _mapped_rows.length) _tree_resolve?.();
						}
						if (data.status === "rolled_back") _tree_resolve?.();
					});
					try {
						const result = await frappe.xcall("excel_view.tree_import.import_tree", {
							doctype,
							records_json     : JSON.stringify(_mapped_rows),
							pattern          : String(tree_info.pattern),
							pattern_info_json: JSON.stringify(tree_info),
							job_id,
						});
						await Promise.race([tree_done_promise, new Promise(r => setTimeout(r, 15000))]);
						frappe.realtime.off("ev_tree_progress");
						if (result.status === "rolled_back") {
							_finish_all(0, result.errors || []);
						} else {
							_finish_all(result.created || main_done, result.errors || []);
						}
					} catch(err) {
						frappe.realtime.off("ev_tree_progress");
						_finish_all(main_done, [{ doctype, error: String(err) }]);
					}
				} else {
					const errors = [];
					for (let i = 0; i < _mapped_rows.length; i++) {
						try {
							await frappe.xcall("frappe.client.insert", { doc: { doctype, ..._mapped_rows[i] } });
							main_done++;
						} catch(err) {
							errors.push({ doctype, name: _mapped_rows[i].name || `Row ${i+1}`, error: String(err) });
						}
						_update_node(doctype, i + 1, _mapped_rows.length);
					}
					_finish_all(main_done, errors);
				}
			})
			.on("click", ".ev-dg-map-btn", (e) => {
				e.stopPropagation();
				// Prevent duplicate — toggle: close if already open
				const $existing = this.$bi_dg_modal.find(".ev-dg-map-overlay");
				if ($existing.length) { $existing.remove(); return; }
				const src_col = $(e.currentTarget).closest(".ev-dg-node").attr("data-source-col");
				const pd      = src_col && col_pair_data[src_col];
				if (!pd) return;
				const { key_header, col_header, pairs } = pd;
				const mapped    = pairs.filter(p => p.val);
				const no_val    = pairs.filter(p => !p.val).length;
				const rows_html = mapped.map(p =>
					`<tr><td>${esc(p.key)}</td><td>${esc(p.val)}</td></tr>`
				).join("");
				const note_html = no_val
					? `<div class="ev-dg-map-note">&#9888; ${no_val} ${__("rows have no")} <b>${esc(col_header)}</b> ${__("value — those records will need item groups assigned separately.")}</div>`
					: "";
				const $overlay = $(`
					<div class="ev-dg-map-overlay">
						<div class="ev-dg-map-panel">
							<div class="ev-dg-map-hdr">
								<span class="ev-dg-map-title">${esc(col_header)} ${__("column mapping")}</span>
								<button class="ev-dg-map-close" aria-label="${__("Close")}">&times;</button>
							</div>
							${note_html}
							<div class="ev-dg-map-body">
								<table class="ev-dg-map-table">
									<thead><tr><th>${esc(key_header)}</th><th>${esc(col_header)}</th></tr></thead>
									<tbody>${rows_html}</tbody>
								</table>
							</div>
						</div>
					</div>
				`).appendTo(this.$bi_dg_modal.find(".ev-dg-modal"));
				$overlay.on("click", (ev) => {
					if ($(ev.target).is(".ev-dg-map-overlay, .ev-dg-map-close")) $overlay.remove();
				});
			})
			.on("click", ".ev-dg-fix-btn", (e) => {
				e.stopPropagation();
				this.$bi_dg_modal.find(".ev-dg-fix-overlay").remove();
				const $node   = $(e.currentTarget).closest(".ev-dg-node");
				const src_col = $node.attr("data-source-col");
				const vs      = this._bi_vs;
				if (!src_col || !vs) return;
				const pd = vs.col_pair_data[src_col];
				if (!pd) return;
				const dep_node  = nodes.find(n => n.source_col === src_col);
				const target_dt = dep_node?.id || null;
				// Build csv_map from pairs that have a value
				const csv_map = {};
				pd.pairs.forEach(p => { if (p.key && p.val) csv_map[p.key] = p.val; });
				const cur_map = {...csv_map, ...(vs.user_edits[src_col] || {})};
				// ALL items that need this dep: come from the PARENT node's values
				// e.g. for "Item Group" incomplete node, parent is "Item" which has all 33 item codes
				const parent_edge = (graph.edges || []).find(eg => eg.from === dep_node?.id);
				const parent_node = parent_edge ? nodes.find(n => n.id === parent_edge.to) : null;
				const parent_vals = parent_node?.values || [];
				// Union: parent node values + pairs keys (covers edge cases where parent node has no values)
				const known_items = new Set([
					...parent_vals,
					...pd.pairs.map(p => p.key).filter(Boolean),
				]);
				const _render_fix = (autocomplete_vals) => {
					const items  = [...known_items].sort();
					const total  = items.length;
					const filled = items.filter(i => cur_map[i]).length;
					const pct    = total ? Math.round(filled / total * 100) : 0;
					const dl_id  = `ev-dg-dl-${src_col.replace(/\W/g,"")}${Date.now()}`;
					const dl_html = autocomplete_vals.map(v => `<option value="${esc(v)}">`).join("");
					const rows_html = items.map((item, i) => {
						const val        = esc(cur_map[item] || "");
						const mapped_cls = cur_map[item] ? " ev-dg-fi-mapped" : "";
						const dot        = cur_map[item]
							? `<span class="ev-dg-fi-dot ev-dg-fi-dot--on"></span>`
							: `<span class="ev-dg-fi-dot"></span>`;
						return `<tr class="ev-dg-fi-row${mapped_cls}" data-row="${i}" data-item="${esc(item)}">
							<td class="ev-dg-fi-key">${dot}${esc(item)}</td>
							<td class="ev-dg-fi-val">
								<input class="ev-dg-fi-input" value="${val}" placeholder="${__("Select or type…")}" list="${dl_id}" autocomplete="off"/>
								<div class="ev-dg-fi-handle" title="${__("Drag to fill down")}"></div>
							</td>
						</tr>`;
					}).join("");
					const $ov = $(`
						<div class="ev-dg-fix-overlay">
							<div class="ev-dg-fix-panel">
								<div class="ev-dg-fix-hdr">
									<div class="ev-dg-fix-hdr-left">
										<div class="ev-dg-fix-title">${__("Fix data gap")} <span class="ev-dg-fix-col">${esc(pd.col_header || src_col)}</span></div>
										<div class="ev-dg-fix-sub">${filled}/${total} ${__("mapped")}</div>
									</div>
									<button class="ev-dg-fix-close" aria-label="${__("Close")}">×</button>
								</div>
								<div class="ev-dg-fix-progress">
									<div class="ev-dg-fix-progress-bar" style="width:${pct}%"></div>
								</div>
								<div class="ev-dg-fix-tip">${__("Drag ↕ handle to fill down. Type or pick from system.")}</div>
								<div class="ev-dg-fix-body">
									<datalist id="${dl_id}">${dl_html}</datalist>
									<table class="ev-dg-fi-table">
										<thead><tr>
											<th>${esc(pd.key_header || "Item")}</th>
											<th>${esc(pd.col_header || src_col)}</th>
										</tr></thead>
										<tbody>${rows_html}</tbody>
									</table>
								</div>
								<div class="ev-dg-fix-footer">
									<span class="ev-dg-fix-foot-count">${total - filled} ${__("remaining")}</span>
									<div class="ev-dg-fix-foot-btns">
										<button class="ev-dg-fix-cancel btn btn-sm btn-default">${__("Cancel")}</button>
										<button class="ev-dg-fix-apply btn btn-sm btn-primary">${__("Apply & Refresh")}</button>
									</div>
								</div>
							</div>
						</div>
					`).appendTo(this.$bi_dg_modal.find(".ev-dg-modal"));
					// ── Drag-to-fill ─────────────────────────────────────────────
					let _drag = false, _drag_val = "", _drag_from = -1;
					const $tbody = $ov.find("tbody");
					$tbody
						.on("mousedown", ".ev-dg-fi-handle", ev => {
							ev.preventDefault();
							_drag = true;
							_drag_from = +$(ev.currentTarget).closest("tr").attr("data-row");
							_drag_val  = $(ev.currentTarget).closest("tr").find(".ev-dg-fi-input").val();
							$ov.find(".ev-dg-fi-table").addClass("ev-dg-fi-dragging");
						})
						.on("mouseover", "tr", ev => {
							if (!_drag) return;
							const to = +$(ev.currentTarget).attr("data-row");
							$tbody.find("tr").each(function() {
								const ri = +$(this).attr("data-row");
								if (ri > _drag_from && ri <= to)
									$(this).find(".ev-dg-fi-input").val(_drag_val).closest("tr").addClass("ev-dg-fi-dragged");
								else if (ri > to)
									$(this).removeClass("ev-dg-fi-dragged");
							});
						});
					$(document).on("mouseup.ev_fix", () => {
						_drag = false;
						$ov.find(".ev-dg-fi-table").removeClass("ev-dg-fi-dragging");
						$tbody.find(".ev-dg-fi-dragged").each(function() {
							$(this).removeClass("ev-dg-fi-dragged").addClass("ev-dg-fi-mapped");
						});
					});
					// ── Close ────────────────────────────────────────────────────
					const _close_fix = () => { $ov.remove(); $(document).off("mouseup.ev_fix"); };
					$ov.on("click", ".ev-dg-fix-close, .ev-dg-fix-cancel", _close_fix)
					   .on("click", ev => { if ($(ev.target).is(".ev-dg-fix-overlay")) _close_fix(); });
					// ── Apply ────────────────────────────────────────────────────
					$ov.on("click", ".ev-dg-fix-apply", async () => {
						const edits = {};
						$ov.find("tr[data-item]").each(function() {
							const item = $(this).attr("data-item");
							const val  = $(this).find(".ev-dg-fi-input").val().trim();
							if (val) edits[item] = val;
						});
						vs.user_edits[src_col] = edits;
						// Rebuild unmapped_cols entry from edits
						const all_vals = [...new Set(Object.values(edits).filter(Boolean))];
						vs.unmapped_cols[src_col] = { vals: all_vals, rows_with_value: Object.keys(edits).length };
						// Also update col_pair_data so View Mapping reflects edits
						if (vs.col_pair_data[src_col]) {
							vs.col_pair_data[src_col].pairs = Object.entries(edits).map(([k,v]) => ({key:k, val:v}));
						}
						_close_fix();
						this.$bi_dg_modal?.remove(); this.$bi_dg_modal = null;
						const $ld = $(`<div class="ev-bi-backdrop"><div class="ev-dg-loading"><div class="ev-dg-spinner"></div><div class="ev-dg-loading-txt">${__("Re-analysing…")}</div></div></div>`).appendTo($("body"));
						try {
							const g2 = await frappe.xcall("excel_view.tree_import.analyze_import_deps", {
								doctype: this.board.doctype,
								records_json: JSON.stringify(vs.mapped_rows),
							});
							$ld.remove();
							this._bi_render_dep_graph(g2, vs.mapped_rows, vs.rows, vs.headers, vs.fieldnames, vs.col_map, vs.child_col_cfg, vs.col_pair_data);
						} catch(_) {
							$ld.remove();
							frappe.show_alert({message: __("Re-analysis failed."), indicator: "red"}, 4);
						}
					});
				};
				// Autocomplete: fetch target doctype names once, cache in virtual state
				if (target_dt && vs.dt_cache[target_dt]) {
					_render_fix(vs.dt_cache[target_dt]);
				} else if (target_dt) {
					frappe.db.get_list(target_dt, {fields:["name"], limit:500, order_by:"name asc"})
						.then(recs => {
							vs.dt_cache[target_dt] = recs.map(r => r.name);
							_render_fix(vs.dt_cache[target_dt]);
						}).catch(() => _render_fix([]));
				} else {
					_render_fix([]);
				}
			})
			.on("click.dg", (e) => {
				if ($(e.target).hasClass("ev-bi-backdrop")) {
					this.$bi_dg_modal?.remove(); this.$bi_dg_modal = null;
				}
			});
	}

	/**
	 * Inspect client-side DocType meta to detect whether this is a tree DocType.
	 *
	 * Pattern 1 \u2014 NSM self-referential tree:  meta.is_tree + meta.nsm_parent_field
	 * Pattern 2 \u2014 Cross-document ref tree:    Table field \u2192 child DocType \u2192 Link back to this doctype
	 * Returns: {pattern: 1|2, ...info} or {pattern: null}
	 */
	_bi_detect_tree_pattern(doctype) {
		const meta = frappe.get_meta(doctype);
		if (!meta) return { pattern: null };

		// Pattern 1
		if (meta.is_tree && meta.nsm_parent_field) {
			return { pattern: 1, parent_field: meta.nsm_parent_field };
		}

		// Pattern 2: scan Table fields for a Link back to this doctype in child meta
		for (const df of (meta.fields || [])) {
			if (df.fieldtype !== "Table" || !df.options) continue;
			const child_meta = frappe.get_meta(df.options);
			if (!child_meta) continue;
			for (const cdf of (child_meta.fields || [])) {
				if (cdf.fieldtype === "Link" && cdf.options === doctype) {
					// Also detect the identity_field: first mandatory non-system Link/Data field
					// before the first Table field (mirrors tree_import.py _detect_identity_field)
					let identity_field = null;
					for (const idf of (meta.fields || [])) {
						if (idf.fieldtype === "Table") break;
						if (idf.reqd && !["name","naming_series"].includes(idf.fieldname) &&
								["Link","Data","Dynamic Link"].includes(idf.fieldtype)) {
							identity_field = idf.fieldname;
							break;
						}
					}
					return {
						pattern      : 2,
						table_field  : df.fieldname,
						link_field   : cdf.fieldname,
						child_doctype: df.options,
						identity_field,
					};
				}
			}
		}
		return { pattern: null };
	}

	// \u2500\u2500\u2500 GET DATA \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

	_gd_open() {
		this._gd_target = "new";
		const is_import = !!this._gd_import_mode;
		const title     = is_import ? __("Import Records") : __("Get Data");
		const step2_lbl = is_import ? __("Map Columns")   : __("Configure");
		const title_icon = is_import
			? `<svg class="ev-gd-title-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a1 1 0 0 1 .707.293l4 4a1 1 0 0 1-1.414 1.414L11 5.414V13a1 1 0 1 1-2 0V5.414L6.707 7.707a1 1 0 0 1-1.414-1.414l4-4A1 1 0 0 1 10 2zM4 15a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2H4z"/></svg>`
			: `<svg class="ev-gd-title-icon" viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4zm0 6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2zm0 6a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-1z"/></svg>`;
		this.$gd_modal = $(`
			<div class="ev-gd-backdrop">
				<div class="ev-gd-modal${is_import ? " ev-gd-modal--import" : ""}">
					<div class="ev-gd-modal-header">
						<div class="ev-gd-title-group">
							${title_icon}
							<span class="ev-gd-modal-title">${title}</span>
						</div>
						<div class="ev-gd-stepper">
							<div class="ev-gd-step ev-gd-step--active" data-step="1">
								<div class="ev-gd-step-bubble">
									<span class="ev-gd-step-num">1</span>
									<svg class="ev-gd-step-check" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9.5 10,2.5"/></svg>
								</div>
								<span class="ev-gd-step-lbl">${__("Source")}</span>
							</div>
							<div class="ev-gd-step-line"></div>
							<div class="ev-gd-step" data-step="2">
								<div class="ev-gd-step-bubble"><span class="ev-gd-step-num">2</span></div>
								<span class="ev-gd-step-lbl">${step2_lbl}</span>
							</div>
						</div>
						<button class="ev-gd-close-btn" aria-label="${__("Close")}">
							<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
						</button>
					</div>
					<div class="ev-gd-modal-body"></div>
					${is_import ? "" : `
					<div class="ev-gd-modal-footer">
						<span class="ev-gd-target-lbl">${__("Load into:")}</span>
						<label class="ev-gd-radio"><input type="radio" name="ev_gd_target" value="new" checked> ${__("New Sheet")}</label>
						<label class="ev-gd-radio"><input type="radio" name="ev_gd_target" value="current"> ${__("Current Sheet")}</label>
					</div>`}
				</div>
			</div>
		`).appendTo(document.body);
		this.$gd_modal.find(".ev-gd-close-btn").on("click", () => this._gd_close());
		this.$gd_modal.on("click.gd", (e) => { if ($(e.target).hasClass("ev-gd-backdrop")) this._gd_close(); });
		this.$gd_modal.on("change.gd", "input[name=ev_gd_target]", (e) => {
			this._gd_target = $(e.currentTarget).val();
		});
		const $body = this.$gd_modal.find(".ev-gd-modal-body");
		this._gd_step1($body);
	}

	_gd_close() {
		this.$gd_modal?.remove();
		this.$gd_modal = null;
		this._gd_import_mode = false;
	}

	_gd_set_step(n) {
		this.$gd_modal?.find(".ev-gd-step").each(function () {
			const s = parseInt($(this).data("step"));
			$(this).removeClass("ev-gd-step--active ev-gd-step--done");
			if (s < n)       $(this).addClass("ev-gd-step--done");
			else if (s === n) $(this).addClass("ev-gd-step--active");
		});
		this.$gd_modal?.find(".ev-gd-step-line").toggleClass("ev-gd-step-line--done", n > 1);
	}

	_gd_step1($body) {
		this._gd_set_step(1);
		const ALL_SOURCES = [
			{ id: "reports", color: "#1565c0", label: __("From Reports"), sub: __("Frappe standard & custom reports"),
			  icon: `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor"><path d="M1 11a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-3zm5-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7zm5-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V2z"/></svg>` },
			{ id: "gsheets", color: "#2e7d32", label: __("Google Sheets"), sub: __("Public spreadsheet by URL"),
			  icon: `<svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="1" width="12" height="14" rx="1"/><line x1="2" y1="5" x2="14" y2="5"/><line x1="2" y1="9" x2="14" y2="9"/><line x1="6" y1="1" x2="6" y2="15"/></svg>` },
			{ id: "csv",     color: "#e65100", label: __("CSV"),           sub: __("File upload or URL"),
			  icon: `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 2a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1h-5zm0 2a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1h-3z"/><path d="M3 0h7.586a1 1 0 0 1 .707.293L13.707 2.707A1 1 0 0 1 14 3.414V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 2v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4h-2.5A1.5 1.5 0 0 1 9 2.5V0H4a1 1 0 0 0-1 1z"/></svg>` },
			{ id: "json",    color: "#6a1b9a", label: __("JSON"),          sub: __("File, URL, or paste"),
			  icon: `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/><path d="M4.5 5.5a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7zm0 2a.5.5 0 0 0 0 1h7a.5.5 0 0 0 0-1h-7zm0 2a.5.5 0 0 0 0 1h4a.5.5 0 0 0 0-1h-4z"/></svg>` },
			{ id: "pdf",     color: "#b71c1c", label: __("PDF"),           sub: __("Extract tables from PDF"),
			  icon: `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor"><path d="M14 14V4.5L9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2zM9.5 3A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h5.5v2z"/></svg>` },
			{ id: "webapi",  color: "#00695c", label: __("Web API"),       sub: __("Any REST endpoint"),
			  icon: `<svg width="24" height="24" viewBox="0 0 16 16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5z"/></svg>` },
		];
		const IMPORT_SOURCES = ALL_SOURCES.filter(s => s.id !== "reports");
		const chevron = `<svg class="ev-gd-isrc-arrow" viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>`;

		if (this._gd_import_mode) {
			$body.html(`
				<div class="ev-gd-step1 ev-gd-step1--import">
					<p class="ev-gd-import-hint">
						${__("Select a file format to import records into")}
						<span class="ev-gd-import-doctype">${this.board.doctype}</span>
					</p>
					<div class="ev-gd-isrc-list">
						${IMPORT_SOURCES.map(s => `
							<div class="ev-gd-isrc" data-src="${s.id}" role="button" tabindex="0">
								<div class="ev-gd-isrc-icon" style="--isrc-color:${s.color}">${s.icon}</div>
								<div class="ev-gd-isrc-body">
									<div class="ev-gd-isrc-label">${s.label}</div>
									<div class="ev-gd-isrc-sub">${s.sub}</div>
								</div>
								${chevron}
							</div>
						`).join("")}
					</div>
				</div>
			`);
			$body.off(".gd").on("click.gd keypress.gd", ".ev-gd-isrc", (e) => {
				if (e.type === "keypress" && e.which !== 13) return;
				this._gd_src($body, $(e.currentTarget).data("src"));
			});
		} else {
			$body.html(`
				<div class="ev-gd-step1">
					<div class="ev-gd-sources-grid">
						${ALL_SOURCES.map(s => `
							<div class="ev-gd-card" data-src="${s.id}" role="button" tabindex="0">
								<div class="ev-gd-card-icon-wrap" style="--card-color:${s.color}">${s.icon}</div>
								<div class="ev-gd-card-label">${s.label}</div>
								<div class="ev-gd-card-sub">${s.sub}</div>
							</div>
						`).join("")}
					</div>
				</div>
			`);
			$body.off(".gd").on("click.gd keypress.gd", ".ev-gd-card", (e) => {
				if (e.type === "keypress" && e.which !== 13) return;
				this._gd_src($body, $(e.currentTarget).data("src"));
			});
		}
	}

	_gd_src($body, src) {
		this._gd_set_step(2);
		$body.off(".gd");
		({
			reports: () => this._gd_reports($body),
			gsheets: () => this._gd_gsheets($body),
			csv:     () => this._gd_csv($body),
			json:    () => this._gd_json($body),
			pdf:     () => this._gd_pdf($body),
			webapi:  () => this._gd_webapi($body),
		})[src]?.();
		$body.on("click.gd", ".ev-gd-back, .ev-gd-back-btn", () => { $body.off(".gd"); this._gd_step1($body); });
	}

	_gd_wrap(title, inner, footer = "") {
		return `<div class="ev-gd-step2">
			<div class="ev-gd-step2-hdr">
				<button class="ev-gd-back ev-gd-back-btn">
					<svg viewBox="0 0 16 16" fill="currentColor" width="13" height="13"><path fill-rule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"/></svg>
					${__("Back")}
				</button>
				<span class="ev-gd-step2-title">${title}</span>
			</div>
			<div class="ev-gd-step2-body">${inner}</div>
			${footer ? `<div class="ev-gd-step2-footer">${footer}</div>` : ""}
		</div>`;
	}

	_gd_preview_tbl(headers, rows) {
		const sample = rows.slice(0, 5);
		return `<div class="ev-gd-preview">
			<div class="ev-gd-preview-lbl">${__("Preview")} \u2014 ${rows.length} ${__("rows")}</div>
			<div class="ev-gd-preview-scroll"><table class="ev-gd-ptbl">
				<thead><tr>${headers.map(h => `<th>${frappe.utils.escape_html(String(h))}</th>`).join("")}</tr></thead>
				<tbody>${sample.map(r => `<tr>${r.map(v => `<td>${frappe.utils.escape_html(String(v ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody>
			</table></div>
		</div>`;
	}

	// \u2500\u2500 Reports \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

	_gd_reports($body) {
		const doctype = this.board.doctype;
		const esc     = frappe.utils.escape_html;
		$body.html(this._gd_wrap(__("From Reports"), `
			<div class="ev-gd-reports-split">
				<div class="ev-gd-rpt-left">
					<div class="ev-gd-info" style="margin-bottom:8px">
						\ud83d\udcc8 ${__("Reports for")} <strong>${esc(doctype)}</strong>
					</div>
					<input type="text" class="form-control ev-gd-report-search" placeholder="${__("Search reports\u2026")}" style="margin-bottom:8px" autocomplete="off">
					<div class="ev-gd-report-list ev-gd-loading">${__("Loading\u2026")}</div>
				</div>
				<div class="ev-gd-rpt-right">
					<div class="ev-gd-rpt-right-placeholder">${__("Select a report to configure filters.")}</div>
					<div class="ev-gd-filters-wrap hide">
						<div class="ev-gd-rpt-filter-hdr">
							<span>${__("Filters for")} <strong class="ev-gd-report-sel-name"></strong></span>
							<span class="ev-gd-filter-loading text-muted" style="font-size:11px"></span>
						</div>
						<div class="ev-gd-rpt-filter-rows"></div>
					</div>
					<div class="ev-gd-actions hide">
						<button class="ev-gd-btn ev-gd-btn--secondary ev-gd-preview-btn" disabled>${__("Preview")}</button>
						<button class="ev-gd-btn ev-gd-btn--primary ev-gd-load-btn" disabled>${__("Load \u2192")}</button>
					</div>
					<div class="ev-gd-preview-area"></div>
				</div>
			</div>
		`));

		let _all = [], _sel = null, _res = null, _filter_defs = [];
		const _get_filters = () => this._gd_collect_filters($body);

		const _load_filters = (report_name) => {
			const $rows = $body.find(".ev-gd-rpt-filter-rows");
			const $lbl  = $body.find(".ev-gd-filter-loading");
			$rows.html(""); $lbl.text(__("Loading filters\u2026"));
			frappe.call({
				method: "frappe.desk.query_report.get_script",
				args: { report_name },
				callback: (r) => {
					$lbl.text("");
					let filters = [];
					try {
						if (!frappe.query_reports) frappe.query_reports = {};
						const script = r.message?.script || (typeof r.message === "string" ? r.message : "");
						if (script) (0, eval)(script);
						filters = (frappe.query_reports?.[report_name]?.filters || []).filter(f => f && f.fieldname);
					} catch (e) { /* silent */ }
					_filter_defs = filters;
					$rows.html(filters.length
						? filters.map(f => this._gd_filter_row(f)).join("")
						: `<div class="ev-gd-empty" style="padding:10px 0">${__("This report has no filters.")}</div>`);
				},
			});
		};

		frappe.call({
			method: "frappe.client.get_list",
			args: { doctype: "Report", fields: ["name","report_type","ref_doctype"], filters: [["ref_doctype","=",doctype]], limit: 500, order_by: "modified desc" },
			callback: (r) => {
				_all = r.message || [];
				const render = (list) => {
					const $l = $body.find(".ev-gd-report-list").removeClass("ev-gd-loading");
					$l.html(list.length
						? list.map(x => `<div class="ev-gd-report-item" data-name="${esc(x.name)}">
								<div class="ev-gd-report-name">${esc(x.name)}</div>
								<div class="ev-gd-report-meta">${esc(x.report_type || "")}</div>
							</div>`).join("")
						: `<div class="ev-gd-empty">${__("No reports found for")} <strong>${esc(doctype)}</strong></div>`);
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
					$body.find(".ev-gd-rpt-right-placeholder").hide();
					$body.find(".ev-gd-filters-wrap, .ev-gd-actions").removeClass("hide");
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
				freeze: true, freeze_message: __("Running report\u2026"),
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
				const raw  = res.columns || [];
				const cols = raw.map(c => typeof c === "string" ? { label: c, fieldname: c } : c);
				const headers = cols.map(c => c.label || c.fieldname);
				const keys    = cols.map(c => c.fieldname || c.label);
				const rows    = (res.result || []).filter(r => !r.is_subtotal && !r.is_total)
					.map(r => keys.map((k, i) => Array.isArray(r) ? r[i] : (r[k] ?? "")));
				this._gd_load(headers, rows, _sel, { name: _sel, filter_defs: _filter_defs, current_filters: _get_filters() }, keys);
				this._gd_close();
			};
			_res ? go(_res) : _run(go);
		});
	}

	// ── Google Sheets ─────────────────────────────────────────────────────────

	_gd_gsheets($body) {
		$body.html(this._gd_wrap(__("Google Sheets"), `
			<div class="ev-gd-field-row">
				<label class="ev-gd-lbl">${__("Spreadsheet URL")}</label>
				<input type="text" class="form-control ev-gd-gs-url" placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off">
			</div>
			<div class="ev-gd-field-row">
				<label class="ev-gd-lbl">${__("Sheet / Tab Name")} <span class="ev-gd-lbl-opt">${__("optional")}</span></label>
				<input type="text" class="form-control ev-gd-gs-tab" placeholder="Sheet1">
			</div>
			<div class="ev-gd-info">
				<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>
				<span>${__('Set sharing to "Anyone with link can view" before pasting the URL.')}</span>
			</div>
		`, `
			<button class="ev-gd-btn ev-gd-btn--secondary ev-gd-preview-btn">${__("Preview")}</button>
			<button class="ev-gd-btn ev-gd-btn--primary ev-gd-load-btn">${__("Load")}</button>
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
		$body.on("click.gd", ".ev-gd-load-btn", () => _fetch(() => { this._gd_load(_h, _r, $body.find(".ev-gd-gs-tab").val().trim() || "Google Sheet"); this._gd_close(); }));
	}

	// ── CSV ───────────────────────────────────────────────────────────────────

	_gd_csv($body) {
		const _dz_inner = () => `
			<div class="ev-gd-drop-icon">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
			</div>
			<div class="ev-gd-dz-label">${__("Drop file here or")} <span class="ev-gd-browse">${__("browse")}</span></div>
			<div class="ev-gd-dz-sub">.csv · .tsv · .txt</div>
			<input type="file" accept=".csv,.tsv,.txt" class="ev-gd-file-in" style="display:none">`;

		$body.html(this._gd_wrap(__("CSV"), `
			<div class="ev-gd-two-col">
				<div class="ev-gd-col-drop">
					<div class="ev-gd-dropzone ev-gd-drop-csv">${_dz_inner()}</div>
				</div>
				<div class="ev-gd-col-form">
					<div class="ev-gd-field-row">
						<label class="ev-gd-lbl">${__("Or paste a URL")}</label>
						<input type="text" class="form-control ev-gd-url-in" placeholder="https://example.com/data.csv" autocomplete="off">
					</div>
					<div class="ev-gd-two-col-sep"></div>
					<div class="ev-gd-field-row">
						<label class="ev-gd-lbl">${__("Delimiter")}</label>
						<select class="ev-gd-sel ev-gd-delim">
							<option value="auto">${__("Auto-detect")}</option>
							<option value=",">, (comma)</option>
							<option value=";">; (semicolon)</option>
							<option value="\t">${__("Tab")}</option>
							<option value="|">| (pipe)</option>
						</select>
					</div>
					<label class="ev-gd-checkbox-row">
						<input type="checkbox" class="ev-gd-has-hdr" checked>
						${__("First row is header")}
					</label>
				</div>
			</div>
		`, `
			<button class="ev-gd-btn ev-gd-btn--secondary ev-gd-preview-btn">${__("Preview")}</button>
			<button class="ev-gd-btn ev-gd-btn--primary ev-gd-load-btn">${__("Load")}</button>
		`));
		let _h = [], _r = [];
		const _parse = (text) => {
			const d = $body.find(".ev-gd-delim").val();
			const has_hdr = $body.find(".ev-gd-has-hdr").prop("checked");
			const all = this._gd_parse_csv(text, d === "auto" ? this._gd_detect_delim(text) : d);
			_h = all.length ? (has_hdr ? all[0] : all[0].map((_, i) => `Col${i + 1}`)) : [];
			_r = has_hdr ? all.slice(1) : all;
		};
		const _set_file = (fname, read_fn) => {
			const esc = frappe.utils.escape_html;
			$body.find(".ev-gd-drop-csv")
				.addClass("ev-gd-dropzone--loaded")
				.html(`<span class="ev-gd-file-chip">
					<span class="ev-gd-file-chip-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
					<span class="ev-gd-file-chip-name">${esc(fname)}</span>
					<button class="ev-gd-file-chip-clear" title="${__("Clear")}">
						<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
					</button>
				</span>`);
			read_fn();
		};
		$body.on("click.gd", ".ev-gd-file-chip-clear", () => {
			$body.find(".ev-gd-drop-csv")
				.removeClass("ev-gd-dropzone--loaded")
				.html(_dz_inner());
			$body.find(".ev-gd-preview-area").empty();
			_h = []; _r = [];
		});
		$body.on("click.gd", ".ev-gd-browse", () => $body.find(".ev-gd-file-in").click());
		$body.on("change.gd", ".ev-gd-file-in", (e) => {
			const f = e.target.files[0]; if (!f) return;
			_set_file(f.name, () => {
				const rd = new FileReader(); rd.onload = (ev) => { _parse(ev.target.result); $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r)); };
				rd.readAsText(f);
			});
		});
		$body.on("dragover.gd", ".ev-gd-drop-csv", (e) => { e.preventDefault(); $(e.currentTarget).addClass("ev-gd-over"); });
		$body.on("dragleave.gd drop.gd", ".ev-gd-drop-csv", (e) => { e.preventDefault(); $(e.currentTarget).removeClass("ev-gd-over"); });
		$body.on("drop.gd", ".ev-gd-drop-csv", (e) => {
			const f = e.originalEvent.dataTransfer.files[0]; if (!f) return;
			_set_file(f.name, () => {
				const rd = new FileReader(); rd.onload = (ev) => { _parse(ev.target.result); $body.find(".ev-gd-preview-area").html(this._gd_preview_tbl(_h, _r)); };
				rd.readAsText(f);
			});
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
			this._gd_load(_h, _r, "CSV Import"); this._gd_close();
		});
	}

	// ── JSON ──────────────────────────────────────────────────────────────────

	_gd_json($body) {
		$body.html(this._gd_wrap(__("JSON"), `
			<div class="ev-gd-two-col">
				<div class="ev-gd-col-drop">
					<div class="ev-gd-dropzone ev-gd-drop-json">
						<div class="ev-gd-drop-icon">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
						</div>
						<div class="ev-gd-dz-label">${__("Drop file here or")} <span class="ev-gd-browse">${__("browse")}</span></div>
						<div class="ev-gd-dz-sub">.json</div>
						<input type="file" accept=".json" class="ev-gd-file-in" style="display:none">
					</div>
				</div>
				<div class="ev-gd-col-form">
					<div class="ev-gd-field-row">
						<label class="ev-gd-lbl">${__("Or paste a URL")}</label>
						<input type="text" class="form-control ev-gd-url-in" placeholder="https://api.example.com/data.json" autocomplete="off">
					</div>
					<div class="ev-gd-two-col-sep"></div>
					<div class="ev-gd-field-row">
						<label class="ev-gd-lbl">${__("JSON Path")} <span class="ev-gd-lbl-opt">${__("blank for root array")}</span></label>
						<input type="text" class="form-control ev-gd-json-path" placeholder="data.items">
					</div>
				</div>
			</div>
		`, `
			<button class="ev-gd-btn ev-gd-btn--secondary ev-gd-preview-btn">${__("Preview")}</button>
			<button class="ev-gd-btn ev-gd-btn--primary ev-gd-load-btn">${__("Load")}</button>
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
			this._gd_load(_h, _r, "JSON Import"); this._gd_close();
		});
	}

	// ── PDF ───────────────────────────────────────────────────────────────────

	_gd_pdf($body) {
		$body.html(this._gd_wrap(__("PDF"), `
			<div class="ev-gd-dropzone ev-gd-drop-pdf">
				<div class="ev-gd-drop-icon">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" width="36" height="36"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9.5 12.5h1a1 1 0 0 1 0 2h-1v-2zm0 0V15m2.5-2.5h1.25a1.25 1.25 0 1 1 0 2.5H12V12.5zm3.5 0v2.5"/></svg>
				</div>
				<div class="ev-gd-dz-label">${__("Drop PDF here or")} <span class="ev-gd-browse">${__("browse")}</span></div>
				<div class="ev-gd-dz-sub">.pdf</div>
				<input type="file" accept=".pdf" class="ev-gd-file-in" style="display:none">
			</div>
			<div class="ev-gd-info">
				<svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm.93-9.412-1 4.705c-.07.34.029.533.304.533.194 0 .487-.07.686-.246l-.088.416c-.287.346-.92.598-1.465.598-.703 0-1.002-.422-.808-1.319l.738-3.468c.064-.293.006-.399-.287-.47l-.451-.081.082-.381 2.29-.287zM8 5.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>
				<span>${__("Tables are extracted automatically. Works best with structured PDF grids.")}</span>
			</div>
			<div class="ev-gd-field-row hide ev-gd-tbl-sel-row">
				<label class="ev-gd-lbl">${__("Table")}</label>
				<select class="ev-gd-sel ev-gd-tbl-sel ev-gd-tbl-sel-input"></select>
			</div>
		`, `
			<button class="ev-gd-btn ev-gd-btn--primary ev-gd-load-btn" disabled>${__("Load")}</button>
		`));
		let _tables = [];
		$body.on("click.gd", ".ev-gd-browse", () => $body.find(".ev-gd-file-in").click());
		$body.on("change.gd", ".ev-gd-file-in", (e) => {
			const f = e.target.files[0]; if (!f) return;
			$body.find(".ev-gd-drop-pdf").addClass("ev-gd-dropzone--loaded").html(`
				<span class="ev-gd-file-chip">
					<span class="ev-gd-file-chip-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
					<span class="ev-gd-file-chip-name">${frappe.utils.escape_html(f.name)}</span>
				</span>
			`);
			// re-bind the file input after DOM replacement
			const inp2 = document.createElement("input"); inp2.type = "file"; inp2.accept = ".pdf"; inp2.className = "ev-gd-file-in"; inp2.style.display = "none"; $body.find(".ev-gd-drop-pdf")[0].appendChild(inp2);
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
			this._gd_load(t.headers, t.rows, "PDF Table"); this._gd_close();
		});
	}

	// ── Web API ───────────────────────────────────────────────────────────────

	_gd_webapi($body) {
		$body.html(this._gd_wrap(__("Web API"), `
			<div class="ev-gd-field-row">
				<label class="ev-gd-lbl">${__("Endpoint")}</label>
				<div class="ev-gd-api-url-row">
					<select class="ev-gd-sel ev-gd-method ev-gd-api-method">
						<option>GET</option><option>POST</option>
					</select>
					<input type="text" class="form-control ev-gd-url-in ev-gd-api-url-in" placeholder="https://api.example.com/data" autocomplete="off">
				</div>
			</div>
			<div class="ev-gd-field-row">
				<div class="ev-gd-api-hdrs-hdr">
					<label class="ev-gd-lbl ev-gd-lbl--inline">${__("Headers")}</label>
					<button class="ev-gd-btn ev-gd-btn--ghost ev-gd-add-hdr">
						<svg viewBox="0 0 16 16" fill="currentColor" width="11" height="11"><path d="M8 2a.5.5 0 0 1 .5.5v5h5a.5.5 0 0 1 0 1h-5v5a.5.5 0 0 1-1 0v-5h-5a.5.5 0 0 1 0-1h5v-5A.5.5 0 0 1 8 2z"/></svg>
						${__("Add header")}
					</button>
				</div>
				<div class="ev-gd-hdrs-list"></div>
			</div>
			<div class="ev-gd-field-row">
				<label class="ev-gd-lbl">${__("JSON Path")} <span class="ev-gd-lbl-opt">${__("e.g. data.results — blank for root array")}</span></label>
				<input type="text" class="form-control ev-gd-json-path" placeholder="data">
			</div>
		`, `
			<button class="ev-gd-btn ev-gd-btn--secondary ev-gd-preview-btn">${__("Test & Preview")}</button>
			<button class="ev-gd-btn ev-gd-btn--primary ev-gd-load-btn">${__("Load")}</button>
		`));
		let _h = [], _r = [];
		$body.on("click.gd", ".ev-gd-add-hdr", () => {
			$body.find(".ev-gd-hdrs-list").append(`
				<div class="ev-gd-hdr-row">
					<input type="text" class="form-control ev-gd-hk ev-gd-hdr-key" placeholder="${__("Header name")}">
					<input type="text" class="form-control ev-gd-hv ev-gd-hdr-val" placeholder="${__("Value")}">
					<button class="ev-gd-btn ev-gd-btn--danger-ghost ev-gd-del-hdr" title="${__("Remove")}">
						<svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>
					</button>
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
		$body.on("click.gd", ".ev-gd-load-btn", () => _fetch(() => { this._gd_load(_h, _r, "Web API"); this._gd_close(); }));
	}

	// ── Shared load + utilities ───────────────────────────────────────────────

	_gd_load(headers, rows, label, report_meta = null, fieldnames = null) {
		// Bulk Import mode: intercept and open Column Mapper instead of creating a new sheet
		if (this._gd_import_mode) {
			this._gd_import_mode = false;
			this._open_bulk_import_mapper(headers, rows, fieldnames);
			return;
		}

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
