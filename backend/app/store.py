"""
store.py — the ONE place the app talks to the vector database (ChromaDB).

Mirror of gemini.py: gemini.py is our only door to the LLM, store.py is our
only door to the vector store. ingest.py (writes), retrieve.py (reads), and
later main.py (the API) all go through get_collection() instead of each
re-creating the connection. Change DB settings once, here, and nowhere else.
"""

from pathlib import Path

import chromadb

# Persistent on-disk store (survives restarts). Lives under backend/data/,
# which is gitignored — the vectors are regenerated from source docs by ingest.
CHROMA_DIR = Path(__file__).resolve().parent.parent / "data" / "chroma"
COLLECTION = "docs"

# "cosine" = compare vectors by DIRECTION (meaning), not length — the right
# metric for embeddings. Set on the collection at creation time.
SPACE = {"hnsw:space": "cosine"}

# One client per process is enough; reuse it across calls.
_client = chromadb.PersistentClient(path=str(CHROMA_DIR))


def get_collection():
    """Return the shared 'docs' collection, creating it on first use."""
    return _client.get_or_create_collection(COLLECTION, metadata=SPACE)


def list_chunks(sources: list[str] | None = None, limit: int = 200) -> list[dict]:
    """List stored chunks (id, source, page, text) — the data behind the
    glass-box debug panel and the eval harness's view of what got indexed.

    sources: optional filename filter (None = all docs). limit caps the payload
    so a big corpus can't dump thousands of chunks in one response.
    """
    collection = get_collection()
    where = {"source": {"$in": sources}} if sources else None
    data = collection.get(where=where, limit=limit, include=["documents", "metadatas"])
    return [
        {"id": cid, "source": m["source"], "page": m["page"], "text": text}
        for cid, text, m in zip(data["ids"], data["documents"], data["metadatas"])
    ]
