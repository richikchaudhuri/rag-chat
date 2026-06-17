/**
 * api.ts — the client's single door to the FastAPI backend (mirror of the
 * backend's store.py / gemini.py "one boundary" idea).
 *
 * Covers the non-streaming endpoints (/health, /chunks, /ingest). The streaming
 * /chat endpoint lives in sse.ts because consuming Server-Sent Events needs its
 * own machinery.
 */

import type { HealthResponse, IngestResponse, StoredChunk } from "./types";

/** Backend base URL. Set in .env.local (NEXT_PUBLIC_API_BASE); falls back to the
 *  local dev server. Trailing slash stripped so `${API_BASE}/health` is clean. */
export const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000").replace(/\/+$/, "");

/** Errors we surface to the user with a readable message (vs. raw exceptions). */
export class ApiError extends Error {}

/** Pull a human message out of a FastAPI error body without using `any`.
 *  FastAPI sends `{detail: "..."}` for HTTPException and `{detail: [{msg,...}]}`
 *  for request-validation (422) errors. */
export function extractDetail(data: unknown): string | null {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (Array.isArray(detail)) {
      return detail
        .map((d) =>
          d && typeof d === "object" && "msg" in d
            ? String((d as { msg: unknown }).msg)
            : "",
        )
        .filter(Boolean)
        .join("; ");
    }
    if (detail != null) return String(detail);
  }
  return null;
}

async function failWith(res: Response, fallback: string): Promise<never> {
  let msg = `${fallback} (${res.status})`;
  try {
    msg = extractDetail(await res.json()) ?? msg;
  } catch {
    /* body wasn't JSON — keep the fallback */
  }
  throw new ApiError(msg);
}

/** Liveness + how many chunks are currently indexed (drives the header badge). */
export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`, { signal });
  if (!res.ok) return failWith(res, "Health check failed");
  return res.json();
}

/** Raw stored chunks, optionally filtered to one document. */
export async function listChunks(
  source?: string,
  limit = 2000,
  signal?: AbortSignal,
): Promise<StoredChunk[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (source) params.set("source", source);
  const res = await fetch(`${API_BASE}/chunks?${params.toString()}`, { signal });
  if (!res.ok) return failWith(res, "Failed to load chunks");
  const data = (await res.json()) as { chunks?: StoredChunk[] };
  return data.chunks ?? [];
}

export interface DocSummary {
  source: string;
  chunks: number;
}

/** Distinct documents in the store with a per-document chunk count.
 *  Derived from /chunks (there's no dedicated /documents endpoint yet — a good
 *  small backend addition later). Counts are exact while the corpus is under the
 *  fetch limit. */
export async function listDocuments(signal?: AbortSignal): Promise<DocSummary[]> {
  const chunks = await listChunks(undefined, 5000, signal);
  const counts = new Map<string, number>();
  for (const c of chunks) counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
  return [...counts.entries()]
    .map(([source, n]) => ({ source, chunks: n }))
    .sort((a, b) => a.source.localeCompare(b.source));
}

/**
 * Upload + ingest a file, reporting REAL byte-level progress.
 *
 * Why XMLHttpRequest and not fetch? `fetch` has no upload-progress events —
 * `xhr.upload.onprogress` is the only browser API that reports how many bytes
 * have been sent. onProgress fires 0→1 for the byte upload; once it reaches 1
 * the server is parsing → chunking → EMBEDDING (the slow part, a Gemini round
 * trip), so the UI should switch to an indeterminate "indexing" state until the
 * returned promise resolves. Returns an `abort()` so the user can cancel.
 */
export function ingestFile(
  file: File,
  handlers: { onProgress?: (fraction: number) => void; onUploaded?: () => void } = {},
): { promise: Promise<IngestResponse>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<IngestResponse>((resolve, reject) => {
    xhr.open("POST", `${API_BASE}/ingest`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) handlers.onProgress?.(e.loaded / e.total);
    };
    xhr.upload.onload = () => {
      handlers.onProgress?.(1);
      handlers.onUploaded?.(); // bytes are up; server now indexing
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as IngestResponse);
        } catch {
          reject(new ApiError("Server returned an unreadable response."));
        }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          msg = extractDetail(JSON.parse(xhr.responseText)) ?? msg;
        } catch {
          /* keep fallback */
        }
        reject(new ApiError(msg));
      }
    };
    xhr.onerror = () =>
      reject(new ApiError(`Couldn't reach the backend at ${API_BASE}. Is it running?`));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    const fd = new FormData();
    fd.append("file", file); // field name MUST be "file" — matches the FastAPI param
    xhr.send(fd);
  });
  return { promise, abort: () => xhr.abort() };
}
