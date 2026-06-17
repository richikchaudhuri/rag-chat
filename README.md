# DocLens — chat with your documents, audit every answer

**Upload a PDF or text file, ask questions in plain English, and get answers grounded in your documents — every claim cited to the exact source page, with the retrieved passages one click away.**

A retrieval-augmented generation (RAG) app built to show the *whole* pipeline, not a black-box wrapper. The retrieval engine is written from scratch — token-aware chunking, embeddings, vector search, grounded generation, citations — then **measured with an evaluation harness** and **improved with hybrid search + cross-encoder reranking**, with the gain proven on a held-out question set.

<!-- TODO: add a demo GIF and the live URL once deployed -->
> **Live demo:** _deploying — link coming._ · **Demo GIF:** _coming._

---

## Why this is different

Most RAG demos are a thin wrapper you have to take on faith. This one is **measured** and **inspectable**:

- **📊 Measured** — a real eval harness scores retrieval (hit-rate@k, MRR, precision@k) and answer faithfulness/abstention on a hand-built gold set. I didn't *guess* that reranking helped — I measured it.
- **🔍 Inspectable ("glass-box")** — every answer ships with the exact chunks it was built from, their source page, and their relevance score. Click any citation to jump straight to its passage.
- **📈 Improved, with proof** — dense baseline → hybrid (BM25 + vector) → cross-encoder reranking, each step measured on the same gold set.

## The headline result

Retrieval quality on a 15-question held-out gold set (a technical handbook):

| Retrieval method | MRR | Hit-rate@1 | Hit-rate@3 | Hit-rate@5 |
|---|---|---|---|---|
| Dense (cosine baseline) | 0.772 | 66.7% | 83.3% | 83.3% |
| + Hybrid (BM25 ⊕ vector, RRF) | 0.726 | 58.3% | 83.3% | 91.7% |
| **+ Cross-encoder rerank** | **0.884** | **83.3%** | **91.7%** | 91.7% |

**Reranking lifts MRR by +0.11 (0.772 → 0.884) and Hit-rate@1 by +17 points (66.7% → 83.3%) over the dense baseline.** Hybrid alone trades top-1 precision for recall (an honest finding — naive rank fusion dilutes an already-strong dense ranker); the cross-encoder then re-orders the wider candidate pool to land the right passage at #1.

On answer quality (dense baseline): **75% answer accuracy** (states the gold fact, cited) and **100% abstention accuracy** (correctly refuses all out-of-document questions — no hallucination).

Reproduce any of it:
```bash
python app/eval/run.py --compare dense hybrid rerank   # the table above
python app/eval/run.py --answers                       # faithfulness + abstention
```

## How it works

```
Ingest:  PDF/txt → parse → token-aware chunking → embed (Gemini) → store (ChromaDB)

Ask (Q&A):  question → [ BM25 + vector retrieval → RRF fuse → cross-encoder rerank ] → top-k
                     → grounded prompt ("answer ONLY from this context; cite the page;
                       if it isn't here, say so") → Gemini, streamed token-by-token
                     → answer + clickable page citations + glass-box of the source chunks
```

Two answer modes: **Q&A** (strict extractive — refuses if the answer isn't in the documents) and **Summarise** (whole-document synthesis for study/overview questions), with a one-click nudge from one to the other.

### From scratch vs. libraries
**Hand-built** (the parts I can explain line by line): token-aware chunking, embedding orchestration (query/document task-type pairing, batching, rate-limit retry), the retrieval pipeline, Reciprocal Rank Fusion, the grounded-prompt + citation + abstention contract, and the evaluation harness.
**Libraries** (where bespoke code breaks on real input): PDF text extraction (`pypdf`/`pymupdf`), approximate-nearest-neighbour search (`ChromaDB`), the LLM + embeddings (`Gemini`), and the cross-encoder model (`sentence-transformers`).

## Stack
- **Backend:** Python · FastAPI (SSE streaming) · ChromaDB · Google Gemini (`gemini-2.0-flash` + `gemini-embedding-001`)
- **Retrieval:** from-scratch chunking + cosine top-k · hybrid BM25 + vector (`rank-bm25`, Reciprocal Rank Fusion) · cross-encoder reranking (`sentence-transformers`, `ms-marco-MiniLM-L-6-v2`)
- **Frontend:** Next.js / React (App Router) · Tailwind CSS · streamed answers, clickable citations, glass-box panel, upload-with-progress — no UI-component library
- **Eval:** custom harness — gold Q&A set, page-level relevance labels, hit-rate@k / MRR / precision@k + faithfulness & abstention

## Run it locally

**Prereqs:** Python 3.11, Node 18+, a free [Gemini API key](https://aistudio.google.com) (no card).

```bash
# 1) Backend
cd rag-chat-with-docs/backend
python -m venv .venv
.venv\Scripts\activate                                              # Windows (use source .venv/bin/activate on macOS/Linux)
pip install torch --index-url https://download.pytorch.org/whl/cpu  # CPU build — skips the giant CUDA wheel
pip install -r requirements.txt
echo GEMINI_API_KEY=your_key_here > .env
python -m uvicorn app.main:app --port 8000                          # → http://localhost:8000/docs

# 2) Frontend (new terminal)
cd rag-chat-with-docs/frontend
npm install
npm run dev                                                         # → http://localhost:3000
```

API surface: `POST /ingest` · `POST /chat` (SSE) · `GET /chunks` · `GET /eval`.

## Notes & honest limits
- **Free-tier quota:** Gemini's free tier caps **generation at ~20 requests/day per model**. Embeddings (ingest + retrieval) have a much higher quota, so the eval and retrieval metrics run freely; heavy interactive use wants a paid key.
- **Scanned PDFs:** v1 handles text-based PDFs and `.txt`. OCR for scanned documents is a planned extension.
- The cross-encoder is preloaded at server startup — a torch model loaded lazily inside a request worker thread can crash the process on Windows.

---

*Built by Richik Chaudhuri.* <!-- TODO: add links — GitHub · portfolio · LinkedIn -->
