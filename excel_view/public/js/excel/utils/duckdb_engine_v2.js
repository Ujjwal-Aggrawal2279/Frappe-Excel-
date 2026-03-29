/**
 * duckdb_engine_v2.js — DuckDBEngineV2: Full analytical SQL engine for IntelliFlow.
 *
 * Extends the pivot-only DuckDBEngine with:
 *  - load_table(name, rows)  — load a DocType data array into DuckDB
 *  - run_query(sql)          — execute arbitrary SQL, return {headers, rows, query_ms}
 *  - count_query(sql)        — run COUNT(*) wrapper, return integer
 *  - IndexedDB cache layer   — fetch DocType data once, cache forever (with TTL)
 *  - bulk_fetch(doctype)     — calls excel_view.api.bulk_fetch_for_duckdb, caches in IDB
 *  - run_ast(ast)            — SQLGenerator → SQL → run_query
 *
 * All operations are async and non-blocking (WASM runs in same thread).
 * Singleton: frappe.views.excel.duckdb_v2
 *
 * V3 IntelliFlow — Zero LLM, 100% on-premise.
 */

import * as duckdb from "@duckdb/duckdb-wasm";

// ── Minimal ES2017-safe IDB helpers (no async generators, no idb package) ─────
function _idb_open() {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(IDB_NAME, IDB_VERSION);
		req.onupgradeneeded = (e) => {
			const db = e.target.result;
			if (!db.objectStoreNames.contains(IDB_STORE)) {
				db.createObjectStore(IDB_STORE);
			}
		};
		req.onsuccess = (e) => resolve(e.target.result);
		req.onerror   = (e) => reject(e.target.error);
	});
}
function _idb_get(db, key) {
	return new Promise((resolve, reject) => {
		const tx  = db.transaction(IDB_STORE, "readonly");
		const req = tx.objectStore(IDB_STORE).get(key);
		req.onsuccess = (e) => resolve(e.target.result);
		req.onerror   = (e) => reject(e.target.error);
	});
}
function _idb_put(db, key, value) {
	return new Promise((resolve, reject) => {
		const tx  = db.transaction(IDB_STORE, "readwrite");
		const req = tx.objectStore(IDB_STORE).put(value, key);
		req.onsuccess = () => resolve();
		req.onerror   = (e) => reject(e.target.error);
	});
}
function _idb_getAllKeys(db) {
	return new Promise((resolve, reject) => {
		const tx  = db.transaction(IDB_STORE, "readonly");
		const req = tx.objectStore(IDB_STORE).getAllKeys();
		req.onsuccess = (e) => resolve(e.target.result);
		req.onerror   = (e) => reject(e.target.error);
	});
}
function _idb_delete(db, key) {
	return new Promise((resolve, reject) => {
		const tx  = db.transaction(IDB_STORE, "readwrite");
		const req = tx.objectStore(IDB_STORE).delete(key);
		req.onsuccess = () => resolve();
		req.onerror   = (e) => reject(e.target.error);
	});
}

frappe.provide("frappe.views.excel");

const IDB_NAME = "ev_duckdb_cache";
const IDB_STORE = "tables";
const IDB_VERSION = 2;
const CACHE_TTL_MS = 10 * 60 * 1000;  // 10 minutes

frappe.views.excel.DuckDBEngineV2 = class DuckDBEngineV2 {
	constructor() {
		this._db           = null;
		this._conn         = null;
		this._init_promise = null;
		this._available    = null;
		this._loaded_tables = new Set();  // tables currently in DuckDB memory
		this._idb          = null;        // opened IDBDatabase instance
		this._idb_open_promise = null;
	}

	// ── Public API ─────────────────────────────────────────────────────────

	/**
	 * Load a DocType data array into a DuckDB table.
	 * If the table was already loaded this session, re-use it.
	 */
	async load_table(name, rows) {
		if (!rows || rows.length === 0) return;
		await this._init();
		if (this._loaded_tables.has(name)) return;  // already loaded

		const safe = name.replace(/[^a-zA-Z0-9_]/g, "_");
		const csv = this._rows_to_csv(rows);
		await this._conn.query(`DROP TABLE IF EXISTS "${safe}"`);
		await this._conn.query(`CREATE TABLE "${safe}" AS SELECT * FROM read_csv_auto('${safe}.csv')`);

		// DuckDB-wasm: load via insertCSVFromPath or arrow
		// Use the arrow/buffer approach for reliability
		await this._load_via_arrow(safe, rows);
		this._loaded_tables.add(name);
	}

	/**
	 * Bulk-fetch a DocType from server (with IDB cache), load into DuckDB.
	 * Returns {rows, from_cache, fetch_ms}
	 */
	async bulk_fetch(doctype, filters = [], limit = 50000) {
		await this._init();  // ensure db is ready before any table operations
		const cache_key = `${doctype}__${JSON.stringify(filters)}`;

		// Check IDB cache
		const cached = await this._idb_get(cache_key);
		if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
			await this._load_via_arrow(this._safe_name(doctype), cached.rows, cached.fields);
			this._loaded_tables.add(doctype);
			return { rows: cached.rows, from_cache: true, fetch_ms: 0 };
		}

		// Fetch from server
		const t0 = performance.now();
		const r = await new Promise((resolve, reject) => {
			frappe.call({
				method: "excel_view.api.bulk_fetch_for_duckdb",
				args: { doctype, filters: JSON.stringify(filters), limit },
				callback: resolve,
				error: (err) => reject(new Error(err?.message || String(err))),
			});
		});

		if (!r || !r.message) throw new Error(`bulk_fetch: no response for ${doctype}`);
		const rows = r.message.rows || [];
		const fields = r.message.fields || [];
		const fetch_ms = Math.round(performance.now() - t0);

		await this._idb_set(cache_key, { rows, fields, ts: Date.now() });
		await this._load_via_arrow(this._safe_name(doctype), rows, fields);
		this._loaded_tables.add(doctype);
		return { rows, fields, from_cache: false, fetch_ms };
	}

	/**
	 * Run arbitrary SQL. Returns {headers: string[], rows: any[][], query_ms: number}.
	 */
	async run_query(sql) {
		await this._init();
		const t0 = performance.now();
		const result = await this._conn.query(sql);
		const query_ms = Math.round(performance.now() - t0);

		const schema = result.schema;
		const headers = schema.fields.map(f => f.name);
		const rows = [];
		for (const batch of result.batches) {
			for (let i = 0; i < batch.numRows; i++) {
				const row = [];
				for (let j = 0; j < headers.length; j++) {
					const val = batch.getChildAt(j).get(i);
					row.push(val === null ? null : typeof val === "bigint" ? Number(val) : val);
				}
				rows.push(row);
			}
		}

		return { headers, rows, query_ms };
	}

	/**
	 * Run a COUNT(*) wrapper. Returns integer.
	 */
	async count_query(sql) {
		const wrapped = `SELECT COUNT(*) AS __count FROM (${sql}) __sub`;
		const { rows } = await this.run_query(wrapped);
		return rows.length ? Number(rows[0][0]) : 0;
	}

	/**
	 * Convert a QueryAST → SQL → run_query.
	 * Auto-fetches any tables not yet loaded.
	 */
	async run_ast(ast) {
		// Init DuckDB first — _load_via_arrow needs this._db / this._conn
		await this._init();

		const { SQLGenerator, QueryAST } = frappe.views.excel;
		const gen = new SQLGenerator(ast);
		const sql = gen.generate();

		// Ensure source table is loaded
		await this._ensure_table(ast.source.doctype);

		// Ensure joined tables are loaded
		for (const j of ast.joins) {
			if (j.tgt_doctype) await this._ensure_table(j.tgt_doctype);
		}

		// Rewrite table refs: "tabSales Invoice" → safe DuckDB table name
		const rewritten_sql = this._rewrite_table_refs(sql, ast);

		return await this.run_query(rewritten_sql);
	}

	/**
	 * Invalidate IDB cache for a DocType (call after data changes).
	 */
	async invalidate(doctype) {
		try {
			const idb = await this._open_idb();
			const keys = await _idb_getAllKeys(idb);
			const to_delete = keys.filter(k => k.startsWith(doctype + "__"));
			await Promise.all(to_delete.map(k => _idb_delete(idb, k)));
		} catch (_) { /* non-fatal */ }
		this._loaded_tables.delete(doctype);
	}

	// ── Init ───────────────────────────────────────────────────────────────

	async _init() {
		if (this._conn) return;
		if (this._init_promise) return this._init_promise;

		this._init_promise = (async () => {
			const base = `${location.origin}/assets/excel_view/node_modules/@duckdb/duckdb-wasm/dist/`;
			const BUNDLES = {
				mvp: {
					mainModule: base + "duckdb-mvp.wasm",
					mainWorker: base + "duckdb-browser-mvp.worker.js",
				},
				eh: {
					mainModule: base + "duckdb-eh.wasm",
					mainWorker: base + "duckdb-browser-eh.worker.js",
				},
			};
			const bundle = await duckdb.selectBundle(BUNDLES);
			const worker_url = URL.createObjectURL(
				new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" })
			);
			const worker = new Worker(worker_url);
			const logger = new duckdb.VoidLogger();
			this._db = new duckdb.AsyncDuckDB(logger, worker);
			await this._db.instantiate(bundle.mainModule, bundle.pthreadWorker);
			URL.revokeObjectURL(worker_url);
			this._conn = await this._db.connect();
			this._available = true;
		})();

		return this._init_promise;
	}

	// ── Table loading ──────────────────────────────────────────────────────

	async _ensure_table(doctype) {
		if (!doctype || this._loaded_tables.has(doctype)) return;
		await this.bulk_fetch(doctype);
	}

	async _load_via_arrow(safe_name, rows, fields) {
		await this._conn.query(`DROP TABLE IF EXISTS "${safe_name}"`);

		if (!rows || rows.length === 0) {
			// No data — create empty table using schema fields so SQL doesn't fail
			const cols = (fields && fields.length)
				? fields
				: (rows && rows[0] ? Object.keys(rows[0]) : []);
			if (!cols.length) return;  // truly unknown schema — skip
			const col_defs = cols.map(c => `"${c}" VARCHAR`).join(", ");
			await this._conn.query(`CREATE TABLE "${safe_name}" (${col_defs})`);
			return;
		}

		// Build CSV string and use DuckDB's CSV reader
		const csv = this._rows_to_csv(rows);
		const enc = new TextEncoder();
		const buf = enc.encode(csv);

		await this._db.registerFileBuffer(`${safe_name}.csv`, buf);
		await this._conn.query(`CREATE TABLE "${safe_name}" AS SELECT * FROM read_csv_auto('${safe_name}.csv', header=true)`);
	}

	_rows_to_csv(rows) {
		if (!rows.length) return "";
		const keys = Object.keys(rows[0]);
		const escape = (v) => {
			if (v === null || v === undefined) return "";
			const s = String(v);
			if (s.includes(",") || s.includes('"') || s.includes("\n")) {
				return `"${s.replace(/"/g, '""')}"`;
			}
			return s;
		};
		const header = keys.map(k => escape(k)).join(",");
		const body = rows.map(r => keys.map(k => escape(r[k])).join(",")).join("\n");
		return header + "\n" + body;
	}

	_safe_name(doctype) {
		return doctype.replace(/[^a-zA-Z0-9_]/g, "_");
	}

	// ── SQL rewriting ──────────────────────────────────────────────────────
	// SQLGenerator outputs: "tabSales Invoice" AS t0
	// DuckDB loaded table is: Sales_Invoice (safe_name)
	// We rewrite table refs accordingly.

	_rewrite_table_refs(sql, ast) {
		let out = sql;
		// Rewrite source
		if (ast.source.doctype) {
			const orig = `"tab${ast.source.doctype}"`;
			const safe = `"${this._safe_name(ast.source.doctype)}"`;
			out = out.split(orig).join(safe);
		}
		// Rewrite joins
		ast.joins.forEach(j => {
			if (j.tgt_doctype) {
				const orig = `"tab${j.tgt_doctype}"`;
				const safe = `"${this._safe_name(j.tgt_doctype)}"`;
				out = out.split(orig).join(safe);
			}
		});
		return out;
	}

	// ── IndexedDB helpers ──────────────────────────────────────────────────

	async _open_idb() {
		if (this._idb) return this._idb;
		if (this._idb_open_promise) return this._idb_open_promise;
		this._idb_open_promise = _idb_open().then(db => { this._idb = db; return db; });
		return this._idb_open_promise;
	}

	async _idb_get(key) {
		try {
			const db = await this._open_idb();
			return await _idb_get(db, key);
		} catch (_) {
			return null;
		}
	}

	async _idb_set(key, value) {
		try {
			const db = await this._open_idb();
			await _idb_put(db, key, value);
		} catch (_) {
			// IDB write failure is non-fatal
		}
	}
};

// ── Singleton ──────────────────────────────────────────────────────────────
frappe.views.excel.duckdb_v2 = new frappe.views.excel.DuckDBEngineV2();
