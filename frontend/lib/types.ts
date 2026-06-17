/**
 * types.ts — the shapes the backend speaks, mirrored on the client.
 *
 * Keeping these in one file means the API contract (Phase 2's FastAPI) and the
 * UI agree in exactly one place. If an endpoint changes, this is the first file
 * to update and TypeScript points at everything downstream that must follow.
 */

export type Mode = "qa" | "summary";

/** One retrieved passage (the QA-mode `sources` event sends a list of these). */
export interface RetrievedChunk {
  source: string;
  page: number;
  distance: number | null; // cosine distance (null for BM25-only hybrid/rerank hits)
  text: string;
  score?: number | null; // fusion / cross-encoder rerank score (hybrid & rerank methods)
}

/**
 * The first SSE event from /chat, sent BEFORE any answer token so the glass-box
 * panel can render immediately. Discriminated by `mode`:
 *  - qa:      the exact top-k chunks the answer is grounded in.
 *  - summary: a compact "covered these pages" view (synthesis reads many chunks).
 */
export type SourcesEvent =
  | { mode: "qa"; method?: string; chunks: RetrievedChunk[] }
  | { mode: "summary"; chunks_used: number; pages: number[] };

/** The final SSE event: the assembled answer + whether the model abstained. */
export interface DoneEvent {
  answer: string;
  abstained: boolean;
}

export interface HealthResponse {
  status: string;
  chunks_indexed: number;
}

export interface IngestResponse {
  filename: string;
  chunks_indexed: number;
}

/** A chunk as stored (no distance — it isn't relative to a query). */
export interface StoredChunk {
  id: string;
  source: string;
  page: number;
  text: string;
}

/** Body for POST /chat. k/sources/mode are optional (backend has defaults). */
export interface ChatRequest {
  question: string;
  k?: number;
  sources?: string[] | null;
  mode?: Mode;
}

/* ---- UI state types (client-only; not part of the wire contract) ---- */

/** The retrieved-context data attached to one assistant turn (drives the
 *  glass-box panel). Either QA chunks, or a summary's page coverage. */
export interface AssistantMeta {
  mode: Mode;
  chunks?: RetrievedChunk[]; // qa: the exact top-k
  method?: string; // qa: retrieval method used (dense | hybrid | rerank)
  pages?: number[]; // summary: pages covered
  chunksUsed?: number; // summary: how many chunks were synthesised
}

/** The citation the user last clicked — highlights its pill + source chunk. */
export type ActiveCite = { source: string | null; page: number } | null;

/** One turn in the conversation (user question or assistant answer). */
export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  mode?: Mode; // the mode this turn was asked in
  question?: string; // assistant only: the question asked (powers the re-ask action)
  meta?: AssistantMeta; // assistant only: retrieved context
  abstained?: boolean; // assistant only: model said "not in the document"
  streaming?: boolean; // assistant only: tokens still arriving
  error?: string; // assistant only: request failed
}
