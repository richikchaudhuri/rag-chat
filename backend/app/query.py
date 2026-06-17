"""
query.py — terminal CLI to ask a question against the ingested document.

A thin wrapper that composes the real modules so you can test the whole loop
from a shell:  retrieve.py (find chunks) + generate.py (grounded answer). The
web API in Phase 2 will call those same two modules instead of this script, so
this file stays test-only and never grows real logic.

Run:  .venv\\Scripts\\python.exe app\\query.py "your question here"
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.generate import answer
from app.retrieve import retrieve


def ask(question: str, k: int = 4) -> None:
    hits = retrieve(question, k)

    # Debug view — exactly what we retrieved. (This becomes the UI's debug panel.)
    print("\n--- retrieved chunks (closest first) ---")
    for i, h in enumerate(hits):
        preview = h["text"][:90].replace("\n", " ")
        print(f"  [{i + 1}] {h['source']} p.{h['page']}  (cosine dist {h['distance']:.3f})  {preview}...")

    print("\n--- answer ---")
    print(answer(question, hits))
    sources = ", ".join(sorted({f"{h['source']} p.{h['page']}" for h in hits}))
    print(f"\n--- sources consulted: {sources} ---")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print('Usage: python app/query.py "your question"')
        sys.exit(1)
    ask(" ".join(sys.argv[1:]))
