"""
retrieve.py — the "R" in RAG: find the chunks closest in meaning to a question.

  embed the question (as a QUERY)  ->  cosine top-k search in ChromaDB
                                   ->  return hits with text + citation info

Its own importable module so the FastAPI layer (Phase 2) and the eval harness
(Phase 4) can call retrieve() directly, without dragging in generation.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.gemini import embed_texts
from app.store import get_collection, list_chunks


def retrieve(question: str, k: int = 4, sources: list[str] | None = None) -> list[dict]:
    """Find the k chunks whose MEANING is closest to the question.

    The question is embedded with task_type="RETRIEVAL_QUERY"; the stored chunks
    used "RETRIEVAL_DOCUMENT". That matched pair is what pulls a question and the
    passage answering it closer together, so the right chunk ranks higher than a
    generic embedding would place it.

    sources: optional list of filenames to search within (the store can hold many
    documents). None = search everything. This is the multi-document filter the
    API exposes.
    """
    qvec = embed_texts([question], task_type="RETRIEVAL_QUERY")[0]
    collection = get_collection()
    # Chroma applies the metadata filter BEFORE the vector search, so we only
    # ever rank chunks from the chosen document(s).
    where = {"source": {"$in": sources}} if sources else None
    res = collection.query(query_embeddings=[qvec], n_results=k, where=where)
    # Chroma returns one result-list per query; we sent one query, so take [0].
    # Distance is cosine distance: smaller = closer in meaning (nearest first).
    return [
        {"text": t, "source": m["source"], "page": m["page"], "distance": d}
        for t, m, d in zip(res["documents"][0], res["metadatas"][0], res["distances"][0])
    ]


def gather_for_summary(
    sources: list[str] | None, question: str | None = None, max_chunks: int = 150
) -> list[dict]:
    """Collect BROAD context for a summary/synthesis answer — not just the top-k.

    A "summarise the key points" request needs coverage of the whole document,
    not the 4 nearest chunks. So if a document is named, take ALL of its chunks
    in reading order (page, then position within the page) — a study-guide view
    of the entire thing. With no document named, fall back to a wide vector
    search on the question. max_chunks caps the payload so a very large corpus
    can't blow up the prompt.
    """
    if sources:
        chunks = list_chunks(sources=sources, limit=max_chunks)

        def reading_order(c: dict) -> tuple[int, int]:
            # ids look like "<file>::p<page>::c<idx>"; sort by page then idx so
            # the model reads the document top-to-bottom.
            try:
                idx = int(c["id"].rsplit("::c", 1)[1])
            except (IndexError, ValueError):
                idx = 0
            return (c["page"], idx)

        chunks.sort(key=reading_order)
        return [
            {"source": c["source"], "page": c["page"], "text": c["text"], "distance": None}
            for c in chunks
        ]
    return retrieve(question or "key points", k=min(max_chunks, 20))
