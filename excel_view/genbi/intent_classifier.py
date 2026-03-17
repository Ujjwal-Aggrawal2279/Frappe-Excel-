"""
Intent Classification for GenBI.

Uses sentence-transformers for semantic similarity matching against intent templates.
Pre-processing: Hinglish normalization + multi-intent detection.
"""

import re
from typing import Optional

# Hinglish → English signal map (intent-relevant words only, not full translation)
_HINGLISH: dict[str, str] = {
	"dikhao": "show", "dikha": "show", "dekho": "show",
	"batao": "explain", "bata": "explain", "samjhao": "explain",
	"banao": "create", "bana": "create",
	"kaise": "how", "kya": "what", "kitne": "how many", "kitna": "how many",
	"kyun": "why", "kaun": "which",
	"kaise link hai": "how linked", "kaise juda hai": "how connected",
	"kaise connected hai": "how connected",
	"ka connection": "connection of", "ka relation": "relation of",
	"se link": "linked to", "se juda": "connected to",
	"aur dikhao": "show more", "aur batao": "show more",
	"doosra": "different", "alag": "different", "aur": "and",
}

# Multi-intent split patterns — "find X and explain it", "show path then build"
_MULTI_INTENT_SPLIT = re.compile(
	r"\b(and then|then|and also|also|, then|, and)\b", re.I
)


def _normalize_hinglish(query: str) -> str:
	"""Replace Hinglish words with English equivalents for intent classification."""
	q = query
	# Longer phrases first to avoid partial replacements
	for hi, en in sorted(_HINGLISH.items(), key=lambda x: -len(x[0])):
		q = re.sub(r"\b" + re.escape(hi) + r"\b", en, q, flags=re.I)
	return q


def _extract_primary_intent_query(query: str) -> tuple[str, str | None]:
	"""Split multi-intent query into primary and secondary.

	"find path to Sales Order and explain it" →
	    primary: "find path to Sales Order"
	    secondary: "explain it"
	"""
	parts = _MULTI_INTENT_SPLIT.split(query, maxsplit=1)
	if len(parts) >= 3:  # [before, separator, after]
		return parts[0].strip(), parts[2].strip()
	return query, None

# Lazy imports - loaded only when first chat is opened
_embedder = None
_intent_embeddings = None


def _ensure_model_loaded():
	"""Lazy load sentence-transformers model (only once)."""
	global _embedder, _intent_embeddings

	if _embedder is not None:
		return

	try:
		from sentence_transformers import SentenceTransformer, util

		# Use lightweight model (~80MB)
		import torch
		_device = "cuda" if torch.cuda.is_available() else "cpu"
		_embedder = SentenceTransformer("all-MiniLM-L6-v2", device=_device)

		if _device == "cpu":
			torch.set_num_threads(2)
			torch.quantization.quantize_dynamic(
				_embedder[0].auto_model,
				{torch.nn.Linear},
				dtype=torch.qint8,
				inplace=True,
			)

		# Precompute intent template embeddings
		intent_templates = {
			"FIND_PATH": [
				"connect to",
				"path to",
				"join with",
				"link to",
				"show connection",
				"how to reach",
				"find connection between",
			],
			"EXPLAIN": [
				"why are they connected",
				"explain this relationship",
				"what does this connection mean",
				"which path is better",
				"how are they related",
				"tell me about this connection",
			],
			"BUILD_CANVAS": [
				"build canvas",
				"create canvas",
				"show me canvas",
				"create view",
				"grouped by",
				"with fields",
				"employee salary deductions",
			],
			"SUGGEST": [
				"what can I join",
				"recommend",
				"suggest connections",
				"what else",
				"show options",
			],
			"ANALYZE_DATA": [
				"how many rows",
				"check data",
				"empty tables",
				"row count",
				"has data",
				"cardinality",
			],
			"REFINE": [
				"show me more",
				"exclude",
				"shorter paths",
				"filter",
				"different options",
				"not that one",
			],
		}

		# Compute embeddings for all templates
		_intent_embeddings = {}
		for intent, templates in intent_templates.items():
			# Average embedding of all templates for this intent
			template_embeds = _embedder.encode(templates, convert_to_tensor=True)
			_intent_embeddings[intent] = template_embeds.mean(dim=0)

	except ImportError:
		# sentence-transformers not installed yet
		raise ImportError(
			"sentence-transformers is not installed. "
			"Run: bench pip install sentence-transformers"
		)


class IntentClassifier:
	"""Classifies user query intent using semantic similarity."""

	def __init__(self):
		"""Initialize intent classifier (lazy loads model on first use)."""
		pass

	def classify(
		self, query: str, conversation_context: Optional[dict] = None
	) -> tuple[str, float, str | None]:
		"""
		Classify user query intent.

		Args:
		    query: User's natural language query
		    conversation_context: Optional conversation context for follow-up detection

		Returns:
		    (intent: str, confidence: float, secondary_intent: str | None)
		    secondary_intent is set when query has two chained intents:
		    "find path to Sales Order and explain it" → ("FIND_PATH", 0.9, "EXPLAIN")
		"""
		# Lazy load model
		_ensure_model_loaded()

		from sentence_transformers import util

		# Step 1: Hinglish normalization
		normalized = _normalize_hinglish(query)

		# Step 2: Multi-intent detection — classify primary only, carry secondary
		primary_query, secondary_query = _extract_primary_intent_query(normalized)

		# Encode primary query
		query_embedding = _embedder.encode(primary_query, convert_to_tensor=True)

		best_intent = None
		best_score = 0.0

		# Compare against all intent embeddings
		for intent, intent_embedding in _intent_embeddings.items():
			score = util.cos_sim(query_embedding, intent_embedding).item()
			if score > best_score:
				best_score = score
				best_intent = intent

		# Context boost for follow-up queries
		if conversation_context:
			follow_up_mode = conversation_context.get("follow_up_mode")

			# If last intent was FIND_PATH and user says "explain" → boost EXPLAIN
			if follow_up_mode == "explain" and best_score < 0.7:
				if any(word in query.lower() for word in ["why", "how", "explain", "tell"]):
					best_intent = "EXPLAIN"
					best_score = 0.85

			# If last intent was EXPLAIN and user says "build" → boost BUILD_CANVAS
			if follow_up_mode == "build" and best_score < 0.7:
				if any(word in query.lower() for word in ["build", "create", "show", "make"]):
					best_intent = "BUILD_CANVAS"
					best_score = 0.85

			# Refine mode detection
			if conversation_context.get("last_paths"):
				if any(word in query.lower() for word in ["more", "other", "different", "exclude"]):
					best_intent = "REFINE"
					best_score = 0.9

		# Default to FIND_PATH if confidence too low
		# BUILD_CANVAS needs high confidence (≥0.65) to avoid false positives on journey queries
		if best_score < 0.4 or (best_intent == "BUILD_CANVAS" and best_score < 0.65):
			best_intent = "FIND_PATH"
			best_score = 0.5

		# Classify secondary intent if multi-intent query was detected
		secondary_intent = None
		if secondary_query:
			sec_embedding = _embedder.encode(secondary_query, convert_to_tensor=True)
			sec_best_intent, sec_best_score = None, 0.0
			for intent, intent_embedding in _intent_embeddings.items():
				score = util.cos_sim(sec_embedding, intent_embedding).item()
				if score > sec_best_score:
					sec_best_score = score
					sec_best_intent = intent
			if sec_best_score >= 0.4 and sec_best_intent != best_intent:
				secondary_intent = sec_best_intent

		return best_intent, round(best_score, 2), secondary_intent
