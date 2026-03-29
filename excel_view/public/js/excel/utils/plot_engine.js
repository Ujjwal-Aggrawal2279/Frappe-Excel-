/**
 * excel_view/utils/plot_engine.js
 *
 * PlotEngine — replaces frappe.Chart with:
 *   • Observable Plot  (bar, line non-date, area, scatter)
 *   • uPlot            (line / area with date x-axis — Grafana-grade canvas renderer)
 *   • Vanilla SVG arc  (pie / donut — no extra library)
 *
 * Auto-detects chart type and theme (light / dark) on every render.
 * Zero NaN issues: explicit pixel dimensions passed before frappe.Chart ever
 * had the chance to read a zero-width container.
 */

import * as Plot from "@observablehq/plot";
import uPlot    from "uplot";

// ── uPlot CSS (injected once, same pattern as HOT CSS in excel_view.bundle.js) ─
if (!document.getElementById("ev-uplot-css")) {
	const link = document.createElement("link");
	link.id   = "ev-uplot-css";
	link.rel  = "stylesheet";
	link.href = "/assets/excel_view/node_modules/uplot/dist/uPlot.min.css";
	document.head.appendChild(link);
}

frappe.provide("frappe.views.excel");

frappe.views.excel.PlotEngine = class PlotEngine {
	/**
	 * Render a chart into a DOM element.
	 * Replaces `new frappe.Chart(el, opts)` throughout the app.
	 *
	 * @param {HTMLElement} el
	 * @param {Object} cfg  — { type, title, labels, datasets, width, height }
	 *   datasets: [{ name, values }]  (frappe.Chart format — unchanged)
	 * @returns {{ destroy: Function }}  — call destroy() before re-rendering
	 */
	static render(el, cfg) {
		const {
			type     = "bar",
			labels   = [],
			datasets = [],
			width,
			height,
		} = cfg;

		const w = width  || el.offsetWidth  || 500;
		const h = height || el.offsetHeight || 260;

		el.innerHTML = "";

		// ── Route ────────────────────────────────────────────────────────────
		if ((type === "line" || type === "area") && PlotEngine._is_time_series(labels)) {
			return PlotEngine._uplot(el, cfg, w, h);
		}
		if (type === "pie" || type === "donut" || type === "percentage") {
			return PlotEngine._pie_svg(el, cfg, w, h, type !== "pie");
		}
		return PlotEngine._observable(el, cfg, w, h);
	}

	// ── Observable Plot ───────────────────────────────────────────────────────

	static _observable(el, cfg, w, h) {
		const { type = "bar", labels, datasets } = cfg;
		const dark    = document.documentElement.getAttribute("data-theme") === "dark";
		const COLORS  = ["#2196F3","#4CAF50","#FF9800","#E91E63","#9C27B0","#00BCD4","#FF5722"];
		const multi   = datasets.length > 1;

		// Flatten to [{x, y, s}] — the universal input for every mark
		const rows = [];
		datasets.forEach((ds, di) => {
			labels.forEach((lbl, i) => {
				rows.push({ x: lbl, y: Number(ds.values[i]) || 0, s: ds.name || `Series ${di + 1}` });
			});
		});

		const stroke_c = multi ? "s" : COLORS[0];
		const fill_c   = multi ? "s" : COLORS[0];
		const txt      = dark ? "#adb5bd" : "#525252";
		const grid_c   = dark ? "#2d2d2d" : "#ebebeb";
		const marks    = [];

		switch (type) {
			case "bar":
				marks.push(
					Plot.barY(rows, Plot.groupX({ y: "sum" }, { x: "x", y: "y", fill: fill_c, tip: true })),
					Plot.ruleY([0]),
				);
				break;
			case "line":
				marks.push(
					Plot.lineY(rows, { x: "x", y: "y", stroke: stroke_c, strokeWidth: 2.5, tip: true }),
					Plot.dot(rows, { x: "x", y: "y", fill: fill_c, r: 3 }),
				);
				break;
			case "area":
				marks.push(
					Plot.areaY(rows, { x: "x", y: "y", fill: fill_c, fillOpacity: 0.15 }),
					Plot.lineY(rows, { x: "x", y: "y", stroke: stroke_c, strokeWidth: 2.5 }),
				);
				break;
			case "scatter":
				marks.push(
					Plot.dot(rows, { x: "x", y: "y", fill: fill_c, r: 5, tip: true }),
				);
				break;
			default: // fallback bar
				marks.push(
					Plot.barY(rows, Plot.groupX({ y: "sum" }, { x: "x", y: "y", fill: fill_c, tip: true })),
					Plot.ruleY([0]),
				);
		}

		const svg = Plot.plot({
			width:        w,
			height:       h,
			marginBottom: 58,
			marginLeft:   54,
			style: {
				background: "transparent",
				color:      txt,
				fontFamily: "var(--font-stack,'Inter',sans-serif)",
				fontSize:   "11px",
				overflow:   "visible",
			},
			x:     { tickRotate: -30, label: null, tickSize: 4 },
			y:     { grid: true, label: null, gridColor: grid_c },
			color: multi ? { legend: true, scheme: "tableau10" } : undefined,
			marks,
		});

		el.append(svg);
		return { destroy: () => { try { el.innerHTML = ""; } catch (_) {} } };
	}

	// ── uPlot — Grafana-grade time-series canvas renderer ─────────────────────

	static _uplot(el, cfg, w, h) {
		const { labels, datasets } = cfg;
		const dark   = document.documentElement.getAttribute("data-theme") === "dark";
		const COLORS = ["#2196F3","#4CAF50","#FF9800","#E91E63","#9C27B0","#00BCD4"];
		const ax_c   = dark ? "#555" : "#bbb";
		const grid_c = dark ? "#232323" : "#f0f0f0";
		const lbl_c  = dark ? "#9a9a9a" : "#888";

		const timestamps = labels.map(l => Math.floor(new Date(l).getTime() / 1000));
		const series_vals = datasets.map(ds => ds.values.map(v => Number(v) ?? null));

		const opts = {
			width:  w,
			height: h,
			cursor: { show: true },
			legend: { show: datasets.length > 1 },
			scales: { x: { time: true } },
			axes: [
				{
					stroke: lbl_c,
					ticks:  { stroke: ax_c },
					grid:   { stroke: grid_c, width: 1 },
					font:   "11px var(--font-stack,'Inter',sans-serif)",
				},
				{
					stroke: lbl_c,
					ticks:  { stroke: ax_c },
					grid:   { stroke: grid_c, width: 1 },
					font:   "11px var(--font-stack,'Inter',sans-serif)",
				},
			],
			series: [
				{ label: "Date" },
				...datasets.map((ds, i) => ({
					label:  ds.name || "Value",
					stroke: COLORS[i % COLORS.length],
					width:  2.5,
					fill:   cfg.type === "area"
						? PlotEngine._hex_alpha(COLORS[i % COLORS.length], 0.10)
						: undefined,
					points: { show: timestamps.length <= 80, size: 4 },
				})),
			],
		};

		const u = new uPlot(opts, [timestamps, ...series_vals], el);
		return { destroy: () => { try { u.destroy(); } catch (_) {} } };
	}

	// ── Pie / Donut — vanilla SVG, no D3 ─────────────────────────────────────

	static _pie_svg(el, cfg, w, h, is_donut) {
		const { labels, datasets } = cfg;
		const dark   = document.documentElement.getAttribute("data-theme") === "dark";
		const COLORS = ["#2196F3","#4CAF50","#FF9800","#E91E63","#9C27B0","#00BCD4","#FF5722","#795548"];
		const txt    = dark ? "#ccc" : "#444";
		const stroke = dark ? "#1a1a1a" : "#fff";

		const vals  = (datasets[0]?.values || []).map(v => Math.max(0, Number(v) || 0));
		const total = vals.reduce((a, b) => a + b, 0) || 1;

		const cx = w / 2, cy = (h - 60) / 2 + 10; // leave 60px for legend
		const R  = Math.min(cx, cy) - 24;
		const R2 = is_donut ? R * 0.50 : 0;

		let angle = -Math.PI / 2;
		let paths = "", legend = "";

		vals.forEach((v, i) => {
			if (!v) return;
			const slice = (v / total) * 2 * Math.PI;
			const x1 = cx + R  * Math.cos(angle);
			const y1 = cy + R  * Math.sin(angle);
			const x2 = cx + R2 * Math.cos(angle);
			const y2 = cy + R2 * Math.sin(angle);
			angle += slice;
			const x3 = cx + R  * Math.cos(angle);
			const y3 = cy + R  * Math.sin(angle);
			const x4 = cx + R2 * Math.cos(angle);
			const y4 = cy + R2 * Math.sin(angle);
			const lf = slice > Math.PI ? 1 : 0;
			const co = COLORS[i % COLORS.length];
			const pct = ((v / total) * 100).toFixed(1);

			const d = is_donut
				? `M${x2.toFixed(2)},${y2.toFixed(2)} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${lf},1 ${x3.toFixed(2)},${y3.toFixed(2)} L${x4.toFixed(2)},${y4.toFixed(2)} A${R2},${R2} 0 ${lf},0 ${x2.toFixed(2)},${y2.toFixed(2)} Z`
				: `M${cx.toFixed(2)},${cy.toFixed(2)} L${x1.toFixed(2)},${y1.toFixed(2)} A${R},${R} 0 ${lf},1 ${x3.toFixed(2)},${y3.toFixed(2)} Z`;

			paths += `<path d="${d}" fill="${co}" stroke="${stroke}" stroke-width="1.5" opacity="0.92">
				<title>${frappe.utils.escape_html(labels[i] ?? "")} — ${v.toLocaleString()} (${pct}%)</title>
			</path>`;
			legend += `<span class="ev-pie-legend-item"><span style="background:${co}"></span>${frappe.utils.escape_html(labels[i] ?? "")} ${pct}%</span>`;
		});

		el.innerHTML = `
			<svg class="ev-pie-svg" width="${w}" height="${h - 54}" viewBox="0 0 ${w} ${h - 54}">
				${paths}
				${is_donut
					? `<text x="${cx.toFixed(2)}" y="${(cy + 5).toFixed(2)}" text-anchor="middle"
						font-size="13" font-weight="600" fill="${txt}"
						font-family="var(--font-stack,'Inter',sans-serif)">${total.toLocaleString()}</text>`
					: ""}
			</svg>
			<div class="ev-pie-legend">${legend}</div>`;

		return { destroy: () => { el.innerHTML = ""; } };
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	/** Returns true if every sampled label looks like a date (YYYY-MM-DD…) */
	static _is_time_series(labels) {
		if (!labels?.length) return false;
		return labels.slice(0, 6).every(l => /^\d{4}-\d{2}-\d{2}/.test(String(l)));
	}

	static _hex_alpha(hex, a) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r},${g},${b},${a})`;
	}
};
