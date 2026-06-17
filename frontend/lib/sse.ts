/**
 * sse.ts — consume the POST /chat Server-Sent Events stream.
 *
 * The browser's built-in EventSource only does GET with no body, but /chat is a
 * POST carrying {question, k, sources, mode}. So we issue the POST with fetch,
 * read the response body as a stream, and parse the SSE frames by hand. The
 * protocol is tiny: each frame is some `event:`/`data:` lines, and frames are
 * separated by a blank line.
 */

import { API_BASE, ApiError, extractDetail } from "./api";
import type { ChatRequest, DoneEvent, SourcesEvent } from "./types";

export interface ChatHandlers {
  onSources?: (e: SourcesEvent) => void;
  onToken?: (text: string) => void;
  onDone?: (e: DoneEvent) => void;
}

/** Parse one raw frame ("event: token\ndata: {...}") into its parts. */
function parseFrame(raw: string): { event: string; data: string } {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: dataLines.join("\n") };
}

/**
 * POST /chat and drive the handlers as events arrive:
 *   onSources  once, first (the retrieved chunks / covered pages)
 *   onToken    repeatedly, as the answer is written
 *   onDone     once, last (full text + abstained flag)
 *
 * Pass an AbortSignal to support a Stop button — aborting makes the underlying
 * read reject with an AbortError, which the caller should treat as "stopped"
 * (the partial answer already rendered stays on screen).
 */
export async function streamChat(
  req: ChatRequest,
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok || !res.body) {
    let msg = `Chat request failed (${res.status})`;
    try {
      msg = extractDetail(await res.json()) ?? msg;
    } catch {
      /* not JSON */
    }
    throw new ApiError(msg);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Normalise CRLF so we can split on a single blank-line delimiter.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let delim: number;
      while ((delim = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, delim);
        buffer = buffer.slice(delim + 2);
        if (!raw.trim()) continue;

        const { event, data } = parseFrame(raw);
        if (!data) continue;

        let payload: unknown;
        try {
          payload = JSON.parse(data);
        } catch {
          continue; // ignore an unparseable frame rather than killing the stream
        }

        if (event === "sources") handlers.onSources?.(payload as SourcesEvent);
        else if (event === "token") handlers.onToken?.((payload as { text?: string }).text ?? "");
        else if (event === "done") handlers.onDone?.(payload as DoneEvent);
        else if (event === "error")
          throw new ApiError(
            (payload as { message?: string }).message ?? "The backend reported an error.",
          );
      }
    }
  } catch (err) {
    // A user-initiated Stop aborts the read with AbortError — re-throw so the
    // caller treats it as "stopped" and keeps the partial answer.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // A clean 'error' SSE event (e.g. a rate limit) is already an ApiError — pass through.
    if (err instanceof ApiError) throw err;
    // Otherwise the server closed the stream early (e.g. the page reloaded, or
    // the backend errored mid-generation — a Gemini rate limit / over-long
    // request). Surface something clearer than a raw network error.
    throw new ApiError(
      "The answer stream stopped early — the connection closed mid-reply. " +
        "This usually means the page reloaded, or the backend hit a Gemini rate limit. Please try again.",
    );
  }
}
