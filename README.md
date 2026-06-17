# DocLens

**Upload a document. Ask it anything. Get answers that cite the exact page they came from, with the receipts one click away.**

Most "chat with your PDF" tools are a magic 8-ball in a trench coat: you ask, it guesses, you nod along and hope. DocLens is the opposite. I built the retrieval engine from scratch (chunking, embeddings, vector search, grounded generation, citations), then did the deeply unglamorous thing and actually *measured* it on a held-out test set. Then I made it measurably better. Then I measured that too, because "trust me, it's smarter now" is not a methodology.

> **Live demo:** deploying, link incoming. **Demo GIF:** also incoming. Rome wasn't deployed in a day.

## Why you should care

Three reasons this isn't another weekend LangChain wrapper:

**It's measured.** I didn't put "improved retrieval quality" on a slide and take a bow. There's a real eval harness that scores retrieval and answer faithfulness against a hand-built gold set. Receipts, not vibes.

**It's inspectable.** Every answer comes with a "glass box": the exact chunks it used, their source page, and their relevance score. Click any citation and it jumps you straight to the passage. If the model says something, you get to check its homework.

**It got better on purpose.** Dense baseline, then hybrid search, then cross-encoder reranking, each step measured on the same gold set. The graph goes up and to the right, which is the only direction I accept.

## The headline (a.k.a. the receipts)

Retrieval quality on a 15-question held-out gold set:

| Retrieval method | MRR | Hit@1 | Hit@3 | Hit@5 |
|---|---|---|---|---|
| Dense (cosine baseline) | 0.772 | 66.7% | 83.3% | 83.3% |
| + Hybrid (BM25 + vector, RRF) | 0.726 | 58.3% | 83.3% | 91.7% |
| **+ Cross-encoder rerank** | **0.884** | **83.3%** | **91.7%** | 91.7% |

Reranking pushed **MRR from 0.772 to 0.884** and **Hit-rate@1 from 66.7% to 83.3%, a clean +17 points.**

Plot twist: hybrid search *on its own* made the top-1 result slightly worse (it trades precision for recall). I left that row in on purpose, because pretending every experiment works is how you end up shipping a flying suit that can't land. The cross-encoder then re-ranks the wider candidate pool and parks the right passage at #1, which is the whole point.

On answers (baseline): **75% answer accuracy** and **100% abstention accuracy**, meaning it correctly refused every out-of-document question. Zero hallucinations. It would rather say "I couldn't find that" than confidently invent something, which is a refreshingly high bar these days.

Want to re-run the numbers yourself? Be my guest:
```bash
python app/eval/run.py --compare dense hybrid rerank   # the table above
python app/eval/run.py --answers                       # faithfulness + abstention
```

## How it works

```
Ingest:  PDF / txt  ->  parse  ->  token-aware chunking  ->  embed (Gemini)  ->  store (ChromaDB)

Ask:     question  ->  [ BM25 + vector retrieval  ->  RRF fuse  ->  cross-encoder rerank ]  ->  top-k
                    ->  grounded prompt ("answer ONLY from this; cite the page; no bluffing")
                    ->  Gemini, streamed token by token  ->  answer + clickable citations + glass box
```

Two modes, because not every question is the same shape. **Q&A** is the strict one: it answers from your documents or it stays quiet. **Summarise** reads the whole document for the "give me the key points" study questions. There's a one-click nudge between them, so you never have to guess which one you actually wanted.

### What I built vs. what I borrowed

I'm confident, not delusional. The clever bits are hand-built: token-aware chunking, the embedding pipeline (query/document task-type pairing, batching, rate-limit retries), the retrieval logic, Reciprocal Rank Fusion, the grounded prompt with its citation and "I don't know" contract, and the entire eval harness. The boring-but-load-bearing bits are libraries, because reinventing a PDF parser is a fantastic way to lose a weekend: `pypdf` / `pymupdf` for extraction, `ChromaDB` for vector search, `Gemini` for the LLM and embeddings, and `sentence-transformers` for the cross-encoder.

## Stack

- **Backend:** Python, FastAPI (with SSE streaming), ChromaDB, Google Gemini
- **Retrieval:** from-scratch chunking and cosine top-k, hybrid BM25 + vector (Reciprocal Rank Fusion), cross-encoder reranking (`ms-marco-MiniLM-L-6-v2`)
- **Frontend:** Next.js / React, Tailwind, streamed answers, clickable citations, the glass-box panel, upload with a real progress bar, and exactly zero UI component libraries (I like control)
- **Eval:** a custom harness with a gold Q&A set, page-level relevance labels, hit-rate@k / MRR / precision@k, plus faithfulness and abstention

## Run it locally

You'll need Python 3.11, Node 18+, and a free [Gemini API key](https://aistudio.google.com) (no credit card).

```bash
# 1) Backend
cd rag-chat-with-docs/backend
python -m venv .venv
.venv\Scripts\activate                                              # Windows (use source .venv/bin/activate elsewhere)
pip install torch --index-url https://download.pytorch.org/whl/cpu  # CPU build, skips the 2.5 GB CUDA wheel nobody asked for
pip install -r requirements.txt
echo GEMINI_API_KEY=your_key_here > .env
python -m uvicorn app.main:app --port 8000                          # http://localhost:8000/docs

# 2) Frontend (new terminal)
cd rag-chat-with-docs/frontend
npm install
npm run dev                                                         # http://localhost:3000
```

## The fine print (the honest stuff)

- **Free-tier quota:** Gemini's free tier caps generation at roughly 20 requests per day per model. Embeddings are far more generous, so the eval and retrieval metrics run all day; heavy interactive use wants a paid key. Power isn't free, who knew.
- **Scanned PDFs:** v1 handles text-based PDFs and `.txt`. OCR for scanned documents is on the list.
- The cross-encoder is preloaded at startup, because loading a torch model inside a request worker thread on Windows is a very fast way to crash a process and learn a lesson.

---

*Built by Richik Chaudhuri.* (GitHub, portfolio, and LinkedIn links coming soon.)
