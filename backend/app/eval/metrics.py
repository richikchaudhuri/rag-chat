"""
metrics.py — the scoring functions for the RAG eval harness. Pure and
dependency-free so they're trivial to reason about and unit-test.

Retrieval relevance is judged at the PAGE level: a retrieved chunk counts as
relevant to a gold item if it comes from the right document AND sits on one of
the gold item's labelled pages. Page numbers are stable across re-ingest (chunk
ids are not), so the gold set doesn't rot when the corpus is re-indexed.
"""


def is_relevant(chunk: dict, gold: dict) -> bool:
    """True if a retrieved chunk lies on a labelled gold page of the right doc."""
    if chunk.get("source") != gold.get("source"):
        return False
    return chunk.get("page") in set(gold.get("pages", []))


def hit_at_k(retrieved: list[dict], gold: dict, k: int) -> bool:
    """Did at least one relevant chunk make the top-k? (Did we fetch the answer?)"""
    return any(is_relevant(c, gold) for c in retrieved[:k])


def precision_at_k(retrieved: list[dict], gold: dict, k: int) -> float:
    """Of the k chunks fetched, what fraction are relevant? (How much noise?)"""
    topk = retrieved[:k]
    if not topk:
        return 0.0
    return sum(1 for c in topk if is_relevant(c, gold)) / len(topk)


def reciprocal_rank(retrieved: list[dict], gold: dict) -> float:
    """1 / rank of the first relevant chunk (0 if none). Rewards ranking the
    right passage HIGH, not just somewhere in the list — averaged this is MRR."""
    for i, chunk in enumerate(retrieved, start=1):
        if is_relevant(chunk, gold):
            return 1.0 / i
    return 0.0


def answer_is_correct(answer_text: str, gold: dict) -> bool:
    """For an answerable item: does the generated answer actually state the gold
    fact? Accepts any of the listed substrings (case-insensitive) — a light
    faithfulness check, not a full LLM-as-judge."""
    low = answer_text.lower()
    return any(s.lower() in low for s in gold.get("answer_contains", []))
