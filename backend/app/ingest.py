"""
ingest.py — turn a document into searchable vectors.

  read file  ->  split into overlapping TOKEN-sized chunks  ->  embed each chunk
             ->  store (vector + text + where-it-came-from) in ChromaDB

Run:  .venv\\Scripts\\python.exe app\\ingest.py data\\sample.txt
"""

import re
import sys
from pathlib import Path

# Let `from app.gemini import ...` work when this file is run directly as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pypdf import PdfReader

from app.gemini import count_tokens, embed_texts
from app.store import get_collection

# Chunk size in REAL Gemini tokens. Part 0 calls ~200-400 the sweet spot:
# small enough for precise retrieval, big enough to hold a whole idea.
TARGET_TOKENS = 300
OVERLAP_TOKENS = 50
# Typical English ratio, used only as a fallback for text too short to measure.
_DEFAULT_CHARS_PER_TOKEN = 4.0

# Split on whitespace that FOLLOWS a sentence-ender, so the punctuation stays
# attached to its sentence. Good enough for prose; not trying to be perfect.
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")


def load_pages(path: Path) -> list[dict]:
    """Read a .txt or .pdf into [{'text', 'page'}] records.

    PDFs give page numbers for free (great for citations); a .txt is one page.
    We use the pypdf LIBRARY here on purpose — parsing real PDFs (columns,
    tables, odd encodings) is a solved problem we should not reinvent.
    """
    if path.suffix.lower() == ".pdf":
        reader = PdfReader(str(path))
        return [
            {"text": page.extract_text() or "", "page": i + 1}
            for i, page in enumerate(reader.pages)
        ]
    return [{"text": path.read_text(encoding="utf-8", errors="ignore"), "page": 1}]


def _sentences(text: str) -> list[str]:
    """Break text into sentences so chunks begin and end on clean boundaries
    instead of slicing through the middle of one (what the old word-window did)."""
    return [s.strip() for s in _SENTENCE_BOUNDARY.split(text.strip()) if s.strip()]


def _calibrate_chars_per_token(text: str, sample_chars: int = 8000) -> float:
    """Measure, with a SINGLE count_tokens call, how many characters make up one
    Gemini token for this document — from a sample, not the whole thing.

    We size chunks by character length scaled to this ratio, so boundaries track
    Gemini's true tokenizer without an API call per sentence. Calibrating ONCE
    per document (not once per page) is the fix for slow ingests: a 20-page PDF
    used to fire 20 of these calls before embedding even began. The ratio barely
    varies across a document, so one representative sample is enough. Text too
    short to measure uses the ~4 chars/token typical of English prose.
    """
    sample = text.strip()[:sample_chars]
    if len(sample) < 200:
        return _DEFAULT_CHARS_PER_TOKEN
    tokens = count_tokens(sample)
    return len(sample) / tokens if tokens else _DEFAULT_CHARS_PER_TOKEN


def _hard_split(sentence: str, max_chars: float) -> list[str]:
    """Last resort: one 'sentence' longer than an entire chunk (a table row, or
    text with no punctuation) is sliced by words so it can't blow up a chunk."""
    words, out, current, current_len = sentence.split(), [], [], 0
    for word in words:
        if current and current_len + len(word) + 1 > max_chars:
            out.append(" ".join(current))
            current, current_len = [], 0
        current.append(word)
        current_len += len(word) + 1
    if current:
        out.append(" ".join(current))
    return out


def _overlap_tail(sentences: list[str], overlap_chars: float) -> tuple[list[str], int]:
    """Take the trailing sentences of a just-closed chunk (about overlap_chars
    worth) to seed the next chunk, so context carries across the seam."""
    tail, total = [], 0
    for sentence in reversed(sentences):
        if total >= overlap_chars:
            break
        tail.insert(0, sentence)
        total += len(sentence) + 1
    return tail, total


def chunk_by_tokens(
    text: str,
    target_tokens: int = TARGET_TOKENS,
    overlap_tokens: int = OVERLAP_TOKENS,
    chars_per_token: float | None = None,
) -> list[str]:
    """Split text into overlapping chunks of ~target_tokens REAL Gemini tokens,
    breaking only on sentence boundaries.

    WHY tokens, not words: the embedder and the model both see TOKENS, so a
    300-token budget is the model-true size; a 120-word window is anywhere from
    ~90 to ~200 tokens depending on the writing. WHY sentences: a chunk ending
    mid-sentence embeds a fragment of meaning and retrieves worse. WHY overlap:
    an idea split across a boundary still lands whole in at least one chunk —
    chunking is the #1 retrieval lever, so we spend care here.

    chars_per_token: pass a precomputed ratio to reuse one calibration across all
    pages of a document (what ingest() does). Left as None for standalone calls,
    which then calibrate on the spot.
    """
    sentences = _sentences(text)
    if not sentences:
        return []

    if chars_per_token is None:
        chars_per_token = _calibrate_chars_per_token(text)
    target_chars = target_tokens * chars_per_token
    overlap_chars = overlap_tokens * chars_per_token

    chunks: list[str] = []
    current: list[str] = []  # sentences in the chunk currently being built
    current_chars = 0

    for sentence in sentences:
        # A monster sentence bigger than a whole chunk: flush, then hard-split it.
        if len(sentence) > target_chars * 1.5:
            if current:
                chunks.append(" ".join(current))
                current, current_chars = [], 0
            chunks.extend(_hard_split(sentence, target_chars))
            continue

        # Adding this sentence would overflow the budget -> close the chunk first.
        if current and current_chars + len(sentence) > target_chars:
            chunks.append(" ".join(current))
            # Re-seed with the tail of the chunk we just closed (the overlap).
            current, current_chars = _overlap_tail(current, overlap_chars)

        current.append(sentence)
        current_chars += len(sentence) + 1

    if current:
        chunks.append(" ".join(current))
    return chunks


def ingest(path_str: str) -> None:
    path = Path(path_str)
    print(f"Reading {path.name} ...")
    pages = load_pages(path)

    # Calibrate token size ONCE for the whole document (a single count_tokens
    # call), then reuse that ratio for every page — instead of one call per page.
    chars_per_token = _calibrate_chars_per_token("\n".join(p["text"] for p in pages))

    # Build chunks, each tagged with its source file + page (for citations later).
    records = []
    for page in pages:
        for idx, chunk in enumerate(chunk_by_tokens(page["text"], chars_per_token=chars_per_token)):
            records.append(
                {"id": f"{path.name}::p{page['page']}::c{idx}", "text": chunk, "page": page["page"]}
            )

    if not records:
        print("No extractable text found (a scanned PDF?). Nothing to ingest.")
        return

    # task_type="RETRIEVAL_DOCUMENT": these are the passages to be searched. The
    # question side (retrieve.py) uses RETRIEVAL_QUERY — the two must agree.
    print(f"Split into {len(records)} token-sized chunks. Embedding with Gemini ...")
    vectors = embed_texts([r["text"] for r in records], task_type="RETRIEVAL_DOCUMENT")

    collection = get_collection()
    # Re-ingesting the SAME file? Drop its old chunks first. upsert updates by id,
    # but new chunking produces different ids (boundaries moved), so the old
    # chunks would linger as stale duplicates. Delete-by-source = a clean swap.
    stale_ids = collection.get(where={"source": path.name}, include=[])["ids"]
    if stale_ids:
        print(f"Replacing {len(stale_ids)} previously-stored chunks for {path.name} ...")
        collection.delete(where={"source": path.name})

    print(f"Storing {len(vectors)} vectors in ChromaDB ...")
    collection.upsert(
        ids=[r["id"] for r in records],
        documents=[r["text"] for r in records],
        embeddings=vectors,
        metadatas=[{"source": path.name, "page": r["page"]} for r in records],
    )
    print(f"Done. Collection '{collection.name}' now holds {collection.count()} chunks.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python app/ingest.py <path-to-pdf-or-txt>")
        sys.exit(1)
    ingest(sys.argv[1])
