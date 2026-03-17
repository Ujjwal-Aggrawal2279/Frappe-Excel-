"""
Entity Resolution for GenBI.

Enhanced entity extraction with disambiguation, exact match priority,
and pronoun resolution.

Alias resolution priority:
  1. Usage feedback cache (Redis) — crowd-sourced, grows with real queries
  2. Auto-generated aliases from Frappe metadata (naming series, plurals)
  3. Static ERP alias map (fallback for well-known abbreviations)
  4. Exact DocType name substring match
  5. Fuzzy + semantic match (sentence-transformers)
"""

import re
from typing import Optional

import frappe

# Lazy imports
_nlp = None
_embedder = None
_doctype_embeddings = None

_DYNAMIC_ALIAS_CACHE_KEY = "ev_genbi_dynamic_aliases_v1"
_FEEDBACK_CACHE_PREFIX = "ev_genbi_alias_feedback:"


def _ensure_nlp_loaded():
	"""Lazy load spaCy NLP model (only once)."""
	global _nlp

	if _nlp is not None:
		return

	try:
		import spacy

		# Load lightweight English model
		_nlp = spacy.load("en_core_web_sm", disable=["parser", "ner"])
	except (ImportError, OSError):
		raise ImportError(
			"spaCy or model not installed. "
			"Run: bench pip install spacy && python -m spacy download en_core_web_sm"
		)


def _get_device() -> str:
	"""Return 'cuda' if a GPU is available, else 'cpu'."""
	try:
		import torch
		return "cuda" if torch.cuda.is_available() else "cpu"
	except ImportError:
		return "cpu"


def _ensure_embedder_loaded():
	"""Lazy load sentence-transformers (only once), auto-selecting GPU if available.

	CPU optimisations applied when no GPU:
	  - INT8 dynamic quantization  →  2-4x faster linear layers, ~4x less RAM
	  - torch.set_num_threads(2)   →  prevents workers from fighting over all cores
	"""
	global _embedder

	if _embedder is not None:
		return

	try:
		import torch
		from sentence_transformers import SentenceTransformer

		device = _get_device()
		_embedder = SentenceTransformer("all-MiniLM-L6-v2", device=device)

		if device == "cpu":
			# Limit threads per worker (gunicorn uses multiple workers; let OS balance)
			torch.set_num_threads(2)
			# INT8 quantization — only for Linear layers, safe for MiniLM on CPU
			torch.quantization.quantize_dynamic(
				_embedder[0].auto_model,
				{torch.nn.Linear},
				dtype=torch.qint8,
				inplace=True,
			)
	except ImportError:
		raise ImportError("sentence-transformers not installed. Run: bench pip install sentence-transformers")


def _get_doctype_embeddings() -> dict:
	"""Get or compute cached DocType embeddings."""
	global _doctype_embeddings

	if _doctype_embeddings is not None:
		return _doctype_embeddings

	# Try loading from cache
	cache_key = "genbi_doctype_embeddings_v1"
	cached = frappe.cache.get_value(cache_key)

	if cached:
		import json

		_doctype_embeddings = json.loads(cached)
		return _doctype_embeddings

	# Compute embeddings for all DocTypes
	_ensure_embedder_loaded()

	all_doctypes = frappe.get_all("DocType", filters={"issingle": 0, "is_virtual": 0}, pluck="name")

	embeddings = {}
	for doctype in all_doctypes:
		embedding = _embedder.encode(doctype.lower(), convert_to_tensor=False)
		embeddings[doctype] = embedding.tolist()  # Convert to list for JSON serialization

	# Cache for 24 hours
	import json

	frappe.cache.set_value(cache_key, json.dumps(embeddings), expires_in_sec=86400)

	_doctype_embeddings = embeddings
	return _doctype_embeddings


def _build_dynamic_aliases() -> dict[str, str]:
	"""Auto-generate DocType aliases from Frappe metadata — no hardcoding.

	Sources (in merge order, later sources win on conflict):
	  1. Plural forms        — "Sales Invoice" → "sales invoices"
	  2. Naming series prefix — SINV-#### → "sinv" maps to Sales Invoice
	  3. Last-word shorthand  — "Delivery Note" → "delivery note", "note" (if unambiguous)
	  4. Field label mining   — fields named 'customer_name' on Sales Invoice → alias signal

	Result cached in Redis for 1 hour and rebuilt hourly by the scheduler task.
	"""
	cached = frappe.cache().get_value(_DYNAMIC_ALIAS_CACHE_KEY)
	if cached:
		import json
		return json.loads(cached)

	aliases: dict[str, str] = {}
	# Track which alias already maps to a DocType so we can detect conflicts
	conflicts: set[str] = set()

	doctypes = frappe.get_all(
		"DocType",
		filters={"issingle": 0, "is_virtual": 0, "istable": 0},
		fields=["name"],
		pluck="name",
	)

	# Naming series prefixes from DocFields (e.g. SINV-YYYY- → "sinv" → Sales Invoice)
	naming_series_rows = frappe.db.sql(
		"""SELECT parent, `default` FROM `tabDocField`
		   WHERE fieldname = 'naming_series' AND `default` IS NOT NULL AND `default` != ''""",
		as_dict=True,
	)
	series_map: dict[str, str] = {}
	for row in naming_series_rows:
		raw = row.get("default", "")
		# Extract prefix before first digit placeholder (.####, YYYY, etc.)
		prefix = re.split(r"[.\-]", raw)[0].strip().lower()
		if prefix and 2 <= len(prefix) <= 6 and prefix.isalpha():
			series_map[prefix] = row["parent"]

	def _register(alias: str, doctype: str) -> None:
		a = alias.lower().strip()
		if not a or len(a) < 2:
			return
		if a in conflicts:
			return  # ambiguous — skip
		if a in aliases and aliases[a] != doctype:
			conflicts.add(a)
			del aliases[a]
			return
		aliases[a] = doctype

	for dt in doctypes:
		name_lower = dt.lower()

		# 1. Exact name (always added — confirms existing exact match phase)
		_register(name_lower, dt)

		# 2. Plural forms
		_register(name_lower + "s", dt)
		if name_lower.endswith("y"):
			_register(name_lower[:-1] + "ies", dt)
		elif name_lower.endswith(("s", "x", "z", "ch", "sh")):
			_register(name_lower + "es", dt)

		# 3. Last word as shorthand (only if DocType has 2+ words)
		words = name_lower.split()
		if len(words) >= 2:
			_register(words[-1], dt)           # "delivery note" last word → "note"
			_register(words[-1] + "s", dt)    # plural last word

	# 4. Naming series abbreviations (higher signal — override conflicts)
	for prefix, dt in series_map.items():
		aliases[prefix] = dt   # direct set — naming series is authoritative

	import json
	frappe.cache().set_value(_DYNAMIC_ALIAS_CACHE_KEY, json.dumps(aliases), expires_in_sec=3600)
	return aliases


def record_alias_feedback(query_term: str, resolved_doctype: str) -> None:
	"""Record that a user query term resolved to a DocType (usage feedback).

	Called when user clicks a path/canvas — implicit confirmation that the
	entity resolution was correct. Stored in Redis, checked first in resolution.
	"""
	key = _FEEDBACK_CACHE_PREFIX + query_term.lower().strip()
	frappe.cache().set_value(key, resolved_doctype, expires_in_sec=86400 * 30)  # 30 days


def _lookup_feedback(term: str) -> str | None:
	"""Check if this exact term was previously confirmed by a user."""
	return frappe.cache().get_value(_FEEDBACK_CACHE_PREFIX + term.lower().strip())


class EntityResolver:
	"""Enhanced entity extraction with disambiguation."""

	def __init__(self):
		"""Initialize entity resolver."""
		self.all_doctypes = frappe.get_all(
			"DocType", filters={"issingle": 0, "is_virtual": 0}, pluck="name"
		)
		self.doctype_lower_map = {dt.lower(): dt for dt in self.all_doctypes}

	def extract_entities(
		self, query: str, conversation_context: Optional[dict] = None
	) -> list[dict]:
		"""
		Extract DocType entities from query.

		Args:
		    query: User's natural language query
		    conversation_context: Optional conversation context for pronoun resolution

		Returns:
		    [{
		        "doctype": str,
		        "confidence": float,
		        "matched_span": str,
		        "is_exact": bool,
		        "alternatives": [str]
		    }]
		"""
		matches = []

		# Phase 1: Pronoun resolution
		if conversation_context:
			pronouns = ["it", "that", "this", "them", "those"]
			if any(p in query.lower() for p in pronouns):
				last_entities = conversation_context.get("last_entities", [])
				if last_entities:
					matches.append(
						{
							"doctype": last_entities[0],
							"confidence": 0.95,
							"matched_span": "[pronoun]",
							"is_exact": False,
							"alternatives": [],
						}
					)
					return matches

		# Phase 2a: Alias resolution — 3-tier priority (feedback > dynamic > exact)
		# Tier 1: Redis usage-feedback cache (user-confirmed mappings, 30-day TTL)
		# Tier 2: Auto-generated aliases from Frappe metadata (naming series, plurals, last-word)
		query_lower = query.lower()
		seen_doctypes: set[str] = set()

		# Test multi-word spans longest-first so "sales invoice" beats "invoice"
		query_tokens = query_lower.split()
		candidate_spans: list[str] = []
		for n in range(min(len(query_tokens), 4), 0, -1):
			for i in range(len(query_tokens) - n + 1):
				candidate_spans.append(" ".join(query_tokens[i : i + n]))

		_dynamic_aliases = _build_dynamic_aliases()
		for span in candidate_spans:
			# Tier 1: feedback cache (highest priority — confirmed by real user actions)
			feedback_dt = _lookup_feedback(span)
			if feedback_dt and feedback_dt in self.doctype_lower_map.values() and feedback_dt not in seen_doctypes:
				matches.append(
					{
						"doctype": feedback_dt,
						"confidence": 0.99,
						"matched_span": span,
						"is_exact": True,
						"alternatives": [],
					}
				)
				seen_doctypes.add(feedback_dt)
				continue

			# Tier 2: dynamic aliases from metadata
			dt = _dynamic_aliases.get(span)
			if dt and dt in self.doctype_lower_map.values() and dt not in seen_doctypes:
				matches.append(
					{
						"doctype": dt,
						"confidence": 0.97,
						"matched_span": span,
						"is_exact": True,
						"alternatives": [],
					}
				)
				seen_doctypes.add(dt)

		# Phase 2b: Exact substring match against all DocType names
		for dt_lower, dt in self.doctype_lower_map.items():
			if dt_lower in query_lower and dt not in seen_doctypes:
				matches.append(
					{
						"doctype": dt,
						"confidence": 1.0,
						"matched_span": dt,
						"is_exact": True,
						"alternatives": [],
					}
				)
				seen_doctypes.add(dt)

		if matches:
			return matches

		# Phase 3: Fuzzy + semantic matching
		candidates = self._fuzzy_semantic_match(query, threshold=0.7)

		if len(candidates) == 1:
			# Single best match
			matches.append(
				{
					"doctype": candidates[0]["doctype"],
					"confidence": candidates[0]["score"],
					"matched_span": query,
					"is_exact": False,
					"alternatives": [],
				}
			)
		elif len(candidates) > 1:
			# Multiple matches - needs disambiguation
			matches.append(
				{
					"doctype": candidates[0]["doctype"],  # Best guess
					"confidence": candidates[0]["score"],
					"matched_span": query,
					"is_exact": False,
					"alternatives": [c["doctype"] for c in candidates[1:3]],  # Top 2 alternatives
				}
			)

		return matches

	def _fuzzy_semantic_match(self, query: str, threshold: float = 0.7) -> list[dict]:
		"""
		Combine RapidFuzz + sentence-transformers for better matching.

		Args:
		    query: Query text
		    threshold: Minimum composite score

		Returns:
		    [{"doctype": str, "score": float}] sorted by score desc
		"""
		from rapidfuzz import fuzz, process

		# Fuzzy match
		fuzzy_results = process.extract(
			query.lower(), [dt.lower() for dt in self.all_doctypes], scorer=fuzz.token_sort_ratio, limit=5
		)

		# Semantic similarity boost
		_ensure_embedder_loaded()
		import torch

		query_embedding = _embedder.encode(query.lower(), convert_to_tensor=True)
		device = query_embedding.device  # matches whatever device the model is on

		# Pre-fetch embeddings dict outside the loop (avoid repeated Redis/cache calls)
		dt_embeddings = _get_doctype_embeddings()

		candidates = []
		for doctype_lower, fuzzy_score, _ in fuzzy_results:
			doctype = self.doctype_lower_map[doctype_lower]

			if doctype in dt_embeddings:
				# Cached embeddings are JSON lists (CPU) — move to model's device
				dt_embedding = torch.tensor(dt_embeddings[doctype]).to(device)
				semantic_score = torch.nn.functional.cosine_similarity(
					query_embedding.unsqueeze(0), dt_embedding.unsqueeze(0)
				).item()
			else:
				semantic_score = 0.0

			# Composite: 60% fuzzy + 40% semantic
			composite = 0.6 * (fuzzy_score / 100) + 0.4 * semantic_score

			if composite >= threshold:
				candidates.append({"doctype": doctype, "score": round(composite, 2)})

		return sorted(candidates, key=lambda x: -x["score"])
