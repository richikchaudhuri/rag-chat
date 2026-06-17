"""
main.py — the FastAPI backend: one HTTP surface over the RAG engine.

  GET  /health   liveness + how many chunks are indexed
  POST /ingest   upload a .pdf/.txt -> parse -> chunk -> embed -> store
  POST /chat     ask a question -> SSE stream: 'sources' event, then 'token'
                 events as the answer is written, then a 'done' event
  GET  /chunks   list stored chunks (the glass-box debug panel's data)

This file only wires HTTP to the engine modules (retrieve / generate / ingest /
store). It contains no RAG logic of its own — that lives in those modules, which
is exactly why splitting them out in Phase 1 made this layer thin.

Run:  .venv\\Scripts\\python.exe -m uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs  (FastAPI auto-generates an interactive page)
"""

import json
import shutil
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.eval.run import evaluate
from app.gemini import describe_error
from app.generate import answer_stream, is_abstention, summarize_stream
from app.ingest import ingest
from app.retrieve import gather_for_summary, retrieve
from app.search import search
from app.store import get_collection, list_chunks

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Preload the cross-encoder reranker in the MAIN thread at startup. Sync
    endpoints run in a worker thread, and loading a torch model there can crash
    the process on some setups (notably Windows); loading it once here avoids
    that and removes the first-request lag. Skipped gracefully if
    sentence-transformers/torch isn't installed."""
    try:
        from app.search import _get_reranker

        _get_reranker()
        print("[startup] reranker preloaded", flush=True)
    except Exception as err:  # noqa: BLE001 - rerank is optional; dense still works
        print(f"[startup] reranker preload skipped ({err})", flush=True)
    yield


app = FastAPI(title="RAG — Chat with your Documents", lifespan=lifespan)

# CORS: the Next.js dev server (Phase 3) runs on a DIFFERENT origin (port 3000).
# Browsers block cross-origin requests unless the server explicitly opts in, so
# we allow the local frontend here. The deployed frontend's origin gets added in
# Phase 6.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    """The POST /chat body. pydantic validates types for us and rejects bad input
    with a clear 422 before our code ever runs."""
    question: str
    k: int = 4                         # how many chunks to retrieve (eval-lab lever)
    sources: list[str] | None = None   # optional document filter (multi-doc)
    mode: str = "qa"                   # "qa" = strict extractive; "summary" = grounded synthesis
    method: str = "rerank"             # retrieval method: dense | hybrid | rerank (rerank = best, auto-falls back to dense)


def _sse(event: str, data: dict) -> str:
    """Format one Server-Sent Event. The whole protocol is: an 'event:' line, a
    'data:' line, and a blank line to mark the end of the event. That's it."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.get("/health")
def health() -> dict:
    """Cheap liveness check + how many chunks are currently indexed."""
    return {"status": "ok", "chunks_indexed": get_collection().count()}


@app.post("/ingest")
def ingest_endpoint(file: UploadFile) -> dict:
    """Upload a .pdf/.txt, persist it under data/, and ingest it into the store."""
    name = Path(file.filename or "").name  # .name strips any '../' path tricks
    if Path(name).suffix.lower() not in {".pdf", ".txt"}:
        raise HTTPException(status_code=400, detail="Only .pdf or .txt files are supported.")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    dest = DATA_DIR / name
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)  # stream upload to disk (no full read into RAM)
    ingest(str(dest))                       # parse -> chunk -> embed -> store (clean re-ingest)
    return {"filename": name, "chunks_indexed": get_collection().count()}


@app.post("/chat")
def chat(req: ChatRequest) -> StreamingResponse:
    """Answer a question against the indexed documents, streamed as SSE.

    Two modes: "qa" does strict extractive retrieval (top-k, refuse if absent);
    "summary" gathers the whole document and synthesises the key points (grounded
    in that material, but allowed to summarise — what study questions need)."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question must not be empty.")

    summary = req.mode == "summary"
    if summary:
        hits = gather_for_summary(req.sources, question=req.question)
        doc_label = ", ".join(req.sources) if req.sources else "the indexed documents"
    else:
        hits = search(req.question, k=req.k, sources=req.sources, method=req.method)

    def stream():
        # 1) Send what we retrieved FIRST so the glass-box panel can render it
        #    before any answer token arrives. QA sends the chunks (few); summary
        #    sends a compact "covered these pages" view (it can use dozens).
        if summary:
            yield _sse("sources", {"mode": "summary", "chunks_used": len(hits),
                                   "pages": sorted({h["page"] for h in hits})})
        else:
            yield _sse("sources", {"mode": "qa", "method": req.method, "chunks": [
                {"source": h["source"], "page": h["page"],
                 "distance": h.get("distance"), "text": h["text"], "score": h.get("score")}
                for h in hits
            ]})
        # 2) Stream the grounded answer / summary token-by-token.
        deltas = (summarize_stream(req.question, hits, doc_label)
                  if summary else answer_stream(req.question, hits))
        collected = []
        try:
            for delta in deltas:
                collected.append(delta)
                yield _sse("token", {"text": delta})
        except Exception as err:  # noqa: BLE001 - surface ANY generation failure cleanly
            # A crash here (e.g. a Gemini 429 rate limit) would otherwise abort the
            # HTTP stream and reach the browser as a generic network error. Instead
            # we emit an 'error' SSE event the frontend can show verbatim, then end
            # the stream cleanly.
            yield _sse("error", {"message": describe_error(err)})
            return
        # 3) Final event: the assembled text + whether the model abstained.
        full = "".join(collected).strip()
        yield _sse("done", {"answer": full, "abstained": is_abstention(full)})

    # StreamingResponse runs this SYNC generator in a threadpool, so the blocking
    # Gemini network calls never stall the server's async event loop.
    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/chunks")
def chunks(source: str | None = None, limit: int = 200) -> dict:
    """List indexed chunks for the debug panel. Optional ?source= filter."""
    sources = [source] if source else None
    return {"chunks": list_chunks(sources=sources, limit=limit)}


@app.get("/eval")
def eval_endpoint(k: str = "1,3,5,10", answers: bool = False) -> dict:
    """Run the gold-set evaluation harness and return the metrics — the "RAG
    quality lab" surface.

    Retrieval-only by default (cheap: one query embedding per gold question).
    Pass ?answers=true for the faithfulness + abstention pass, which is slow and
    spends Gemini generation quota (one generation per gold question)."""
    ks = sorted({int(x) for x in k.split(",") if x.strip().isdigit()}) or [1, 3, 5, 10]
    return evaluate(ks, with_answers=answers)
