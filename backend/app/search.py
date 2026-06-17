"""
search.py — improved retrieval: hybrid (BM25 keyword + dense vector) fused with
Reciprocal Rank Fusion, plus an optional cross-encoder reranker.

The dense baseline lives in retrieve.py. This module layers two well-known
retrieval upgrades on top and exposes ONE entry point, search(), with a `method`
switch so the eval harness can measure each layer's contribution independently:

  dense   -> vector cosine top-k                         (the baseline)
  hybrid  -> vector + BM25, fused with RRF               (keyword + semantic recall)
  rerank  -> hybrid candidates re-scored by a cross-encoder, then top-k

Why each layer helps:
- BM25 rewards exact-term overlap (codes like "D40", IDs like "dnxpt5gea",
  numbers) that dense embeddings tend to blur; dense rewards paraphrase/meaning
  that BM25 misses. Fusing the two ranked lists beats either alone.
- A cross-encoder reads the (question, chunk) pair TOGETHER through one
  transformer, so its relevance judgement is far sharper than comparing two
  separately-computed vectors — but it's expensive, so we only run it on the
  ~20 fused candidates, never the whole corpus.
"""

import re

from app.gemini import embed_texts
from app.retrieve import retrieve  # dense baseline
from app.store import get_collection, list_chunks

_TOKEN = re.compile(r"[a-z0-9]+")


def _tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def _vector_candidates(question: str, sources: list[str] | None, n: int) -> list[dict]:
    """Top-n dense (cosine) candidates from ChromaDB, with ids for fusion."""
    qvec = embed_texts([question], task_type="RETRIEVAL_QUERY")[0]
    where = {"source": {"$in": sources}} if sources else None
    res = get_collection().query(query_embeddings=[qvec], n_results=n, where=where)
    return [
        {"id": cid, "text": t, "source": m["source"], "page": m["page"], "distance": d}
        for cid, t, m, d in zip(
            res["ids"][0], res["documents"][0], res["metadatas"][0], res["distances"][0]
        )
    ]


def _bm25_candidates(question: str, sources: list[str] | None, n: int) -> list[dict]:
    """Top-n BM25 keyword candidates over the SAME scoped corpus as the vector
    search. Built per-query (cheap at this scale; cache if the corpus grows)."""
    from rank_bm25 import BM25Okapi

    pool = list_chunks(sources=sources, limit=5000)
    if not pool:
        return []
    bm25 = BM25Okapi([_tokenize(c["text"]) for c in pool])
    scores = bm25.get_scores(_tokenize(question))
    ranked = sorted(zip(pool, scores), key=lambda cs: cs[1], reverse=True)
    # drop zero-overlap chunks; mark distance None (BM25 has no cosine distance)
    return [dict(c, distance=None) for c, s in ranked[:n] if s > 0]


def _rrf(ranked_lists: list[list[dict]], c: int = 60) -> list[dict]:
    """Reciprocal Rank Fusion: score = sum over lists of 1/(c + rank). Rank-based,
    so it fuses cosine distance and BM25 scores without needing to normalise
    their incomparable scales. c=60 is the standard constant from the RRF paper."""
    scores: dict[str, float] = {}
    rep: dict[str, dict] = {}
    for lst in ranked_lists:
        for rank, ch in enumerate(lst, start=1):
            cid = ch["id"]
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (c + rank)
            # keep a representative; prefer one carrying a real cosine distance
            if cid not in rep or (rep[cid].get("distance") is None and ch.get("distance") is not None):
                rep[cid] = ch
    order = sorted(scores, key=lambda cid: scores[cid], reverse=True)
    return [dict(rep[cid], score=round(scores[cid], 5)) for cid in order]


def retrieve_hybrid(
    question: str, k: int = 4, sources: list[str] | None = None, candidates: int = 20
) -> list[dict]:
    """Fuse dense + BM25 candidate lists with RRF and return the top-k."""
    vec = _vector_candidates(question, sources, candidates)
    bm = _bm25_candidates(question, sources, candidates)
    return _rrf([vec, bm])[:k]


# --- cross-encoder reranker (lazy + cached; heavy import deferred until used) ---
_RERANK_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
_reranker = None


def _get_reranker():
    global _reranker
    if _reranker is None:
        from sentence_transformers import CrossEncoder

        _reranker = CrossEncoder(_RERANK_MODEL)
    return _reranker


def retrieve_rerank(
    question: str, k: int = 4, sources: list[str] | None = None, candidates: int = 20
) -> list[dict]:
    """Hybrid-fuse to a candidate pool, then re-score every (question, chunk) pair
    with the cross-encoder and return the top-k by that sharper score."""
    fused = _rrf(
        [
            _vector_candidates(question, sources, candidates),
            _bm25_candidates(question, sources, candidates),
        ]
    )
    if not fused:
        return []
    model = _get_reranker()
    scores = model.predict([(question, c["text"]) for c in fused])
    for chunk, score in zip(fused, scores):
        chunk["score"] = float(score)
    fused.sort(key=lambda c: c["score"], reverse=True)
    return fused[:k]


def search(
    question: str, k: int = 4, sources: list[str] | None = None, method: str = "dense"
) -> list[dict]:
    """One retrieval entry point. method = dense (baseline) | hybrid | rerank.

    rerank degrades gracefully to the dense baseline if the cross-encoder can't
    load (e.g. sentence-transformers/torch missing or a model-download failure),
    so a live chat never 500s on a retrieval-backend hiccup."""
    if method == "hybrid":
        return retrieve_hybrid(question, k, sources)
    if method == "rerank":
        try:
            return retrieve_rerank(question, k, sources)
        except Exception as err:  # noqa: BLE001 - degrade, don't fail the request
            print(f"[search] reranker unavailable ({err}); falling back to dense", flush=True)
            return retrieve(question, k=k, sources=sources)
    return retrieve(question, k=k, sources=sources)
