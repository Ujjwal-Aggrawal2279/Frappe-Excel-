/**
 * excel_view/cell_types/date_cell.js
 *
 * HOT 6.x custom cell types for Frappe Date / Datetime / Time fields.
 *  - ev-date  : Date  (input[type=date])
 *  - ev-date  : Datetime  (input[type=datetime-local], _is_datetime:true on column)
 *  - ev-time  : Time  (input[type=time])
 *
 * Dark-theme: handled entirely via CSS (.ev-date-editor / .ev-time-editor).
 * color-scheme:dark in the SCSS block tells the browser to render the native
 * calendar / clock popup in dark mode as well.
 *
 * IMPORTANT — HOT editor lifecycle:
 *   init()    — called ONCE when editor is first instantiated; cellProperties is
 *               NOT available yet (only this.hot is set).  Never access
 *               cellProperties here.
 *   prepare() — called before each edit; cellProperties IS available.
 *   open()    — shows the editor; this.TD is the cell DOM element (set by
 *               BaseEditor.prepare via super.prepare()).
 */

import Handsontable from "handsontable";

frappe.provide("frappe.views.excel");

// ── Shared helper ─────────────────────────────────────────────────────────────

/**
 * Create the base input element for Date / Datetime / Time editors.
 * Layout is inline; colors are handled by CSS class so the dark-theme block
 * in SCSS can override them cleanly without fighting inline specificity.
 */
function _make_input(type, css_class) {
	const input = document.createElement("input");
	input.type = type;
	input.className = css_class;
	// Layout only — no color/background (theme CSS handles those)
	input.style.cssText =
		"position:absolute;top:0;left:0;width:100%;height:100%;" +
		"border:none;padding:4px 6px;font-size:inherit;z-index:200;outline:none;";
	return input;
}

// ── Date / Datetime renderer ──────────────────────────────────────────────────

function dateRenderer(hotInstance, td, row, col, prop, value, cellProperties) {
	Handsontable.renderers.TextRenderer.apply(this, arguments);

	if (value) {
		try {
			// frappe stores Date as YYYY-MM-DD and Datetime as YYYY-MM-DD HH:MM:SS
			const formatted = frappe.datetime.str_to_user(value);
			td.innerText = formatted || value;
		} catch {
			td.innerText = value;
		}
	}

	if (cellProperties.readOnly) td.classList.add("htDimmed");
}

// ── Date / Datetime editor ────────────────────────────────────────────────────

class DateEditor extends Handsontable.editors.BaseEditor {
	init() {
		// cellProperties is NOT available in init() — see file header.
		// Always start as type="date"; prepare() switches to datetime-local as needed.
		this._is_datetime = false;
		this._input = _make_input("date", "ev-date-editor");

		this._input.addEventListener("change", () => this.finishEditing());
		this._input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") this.finishEditing(true);
			if (e.key === "Enter") this.finishEditing();
		});
	}

	prepare(row, col, prop, td, originalValue, cellProperties) {
		super.prepare(row, col, prop, td, originalValue, cellProperties);
		// Update input type based on the actual column's _is_datetime flag
		const is_dt = !!cellProperties?._is_datetime;
		if (is_dt !== this._is_datetime) {
			this._is_datetime = is_dt;
			this._input.type = is_dt ? "datetime-local" : "date";
		}
	}

	getValue() {
		const raw = this._input.value || "";
		if (!raw) return "";
		if (this._is_datetime) {
			// datetime-local gives "YYYY-MM-DDTHH:MM" → Frappe wants "YYYY-MM-DD HH:MM:SS"
			return raw.replace("T", " ") + (raw.length === 16 ? ":00" : "");
		}
		return raw; // date: already YYYY-MM-DD
	}

	setValue(newValue) {
		if (!newValue) { this._input.value = ""; return; }

		if (this._is_datetime) {
			// Accept "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM"
			const iso = String(newValue).replace(" ", "T").substring(0, 16);
			this._input.value = /^\d{4}-\d{2}-\d{2}T/.test(iso) ? iso : "";
		} else {
			if (/^\d{4}-\d{2}-\d{2}/.test(String(newValue))) {
				this._input.value = String(newValue).substring(0, 10);
			} else {
				try {
					const sys_date = frappe.datetime.user_to_str(newValue);
					this._input.value = sys_date ? sys_date.substring(0, 10) : "";
				} catch {
					this._input.value = "";
				}
			}
		}
	}

	open() {
		// this.TD is the cell DOM element — set by BaseEditor.prepare() via super.prepare()
		this.TD.style.padding = "0";
		this.TD.appendChild(this._input);
		this._input.focus();
		// showPicker() opens the native calendar / datetime popup immediately.
		// Supported in Chrome 99+ / Chromium; silently ignored on older browsers.
		try { this._input.showPicker(); } catch (_) {}
	}

	close() {
		if (this._input.parentNode) {
			this._input.parentNode.style.padding = "";
			this._input.parentNode.removeChild(this._input);
		}
	}
}

// ── Time renderer ─────────────────────────────────────────────────────────────

function timeRenderer(hotInstance, td, row, col, prop, value, cellProperties) {
	Handsontable.renderers.TextRenderer.apply(this, arguments);
	// Time is stored as HH:MM:SS — display as HH:MM for readability
	if (value && /^\d{2}:\d{2}/.test(value)) {
		td.innerText = value.substring(0, 5);
	}
	if (cellProperties.readOnly) td.classList.add("htDimmed");
}

// ── Time editor ───────────────────────────────────────────────────────────────

class TimeEditor extends Handsontable.editors.BaseEditor {
	init() {
		// cellProperties is NOT available in init() — see file header.
		this._input = _make_input("time", "ev-time-editor");
		this._input.step = "1"; // show seconds in the picker

		this._input.addEventListener("change", () => this.finishEditing());
		this._input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") this.finishEditing(true);
			if (e.key === "Enter") this.finishEditing();
		});
	}

	prepare(row, col, prop, td, originalValue, cellProperties) {
		super.prepare(row, col, prop, td, originalValue, cellProperties);
	}

	getValue() {
		const v = this._input.value || "";
		if (!v) return "";
		// Normalise to HH:MM:SS (input[type=time] may give HH:MM)
		return v.length === 5 ? v + ":00" : v;
	}

	setValue(newValue) {
		if (!newValue) { this._input.value = ""; return; }
		// input[type=time] accepts HH:MM or HH:MM:SS
		this._input.value = String(newValue).substring(0, 8);
	}

	open() {
		this.TD.style.padding = "0";
		this.TD.appendChild(this._input);
		this._input.focus();
		try { this._input.showPicker(); } catch (_) {}
	}

	close() {
		if (this._input.parentNode) {
			this._input.parentNode.style.padding = "";
			this._input.parentNode.removeChild(this._input);
		}
	}
}

// ── Register ──────────────────────────────────────────────────────────────────

Handsontable.renderers.registerRenderer("ev-date", dateRenderer);
Handsontable.editors.registerEditor("ev-date", DateEditor);
Handsontable.cellTypes.registerCellType("ev-date", {
	renderer: dateRenderer,
	editor: DateEditor,
});

Handsontable.renderers.registerRenderer("ev-time", timeRenderer);
Handsontable.editors.registerEditor("ev-time", TimeEditor);
Handsontable.cellTypes.registerCellType("ev-time", {
	renderer: timeRenderer,
	editor: TimeEditor,
});
