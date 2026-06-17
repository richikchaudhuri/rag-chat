"use client";

/**
 * page.tsx — the DocLens chat app.
 *
 * Owns the conversation, drives the POST /chat SSE stream (token-by-token), and
 * wires the sidebar (documents + upload + source filter) to the composer and
 * the message list. This is the only stateful orchestrator; everything else is
 * a presentational component fed by props.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getHealth, listDocuments, type DocSummary } from "@/lib/api";
import { sourceLabel } from "@/lib/citations";
import { streamChat } from "@/lib/sse";
import type { ChatTurn, Mode } from "@/lib/types";
import { ChatMessage } from "@/components/ChatMessage";
import { Composer } from "@/components/Composer";
import { Sidebar } from "@/components/Sidebar";
import { IconChat, IconDoc, IconLens, IconSparkle } from "@/components/icons";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const STARTERS: { mode: Mode; text: string }[] = [
  { mode: "qa", text: "What is this document about?" },
  { mode: "qa", text: "List the key terms defined here." },
  { mode: "summary", text: "Summarise the key points I should revise." },
];

export default function Home() {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("qa");
  const [k, setK] = useState(4);

  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chunkCount, setChunkCount] = useState<number | null>(null);
  const [connected, setConnected] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(true);

  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // keep view pinned to bottom only when near it

  // ---- data loading ----
  const refresh = useCallback(async () => {
    try {
      const h = await getHealth();
      setChunkCount(h.chunks_indexed);
      setConnected(true);
    } catch {
      setConnected(false);
    }
    try {
      setLoadingDocs(true);
      setDocs(await listDocuments());
      setConnected(true);
    } catch {
      /* keep whatever docs we already have */
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Autoscroll on new content, but only if the user is already near the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // ---- source filter ----
  const toggleSource = (s: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const clearSelected = () => setSelected(new Set());

  // ---- chat ----
  const send = (override?: { question?: string; mode?: Mode }) => {
    const q = (override?.question ?? input).trim();
    if (!q || streaming) return;
    const useMode = override?.mode ?? mode;

    const aId = uid();
    setMessages((prev) => [
      ...prev,
      { id: uid(), role: "user", text: q },
      { id: aId, role: "assistant", text: "", mode: useMode, question: q, streaming: true },
    ]);
    if (!override?.question) setInput(""); // only clear the composer on a normal send
    setStreaming(true);
    stick.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    const sources = selected.size ? [...selected] : null;

    // Patch just the assistant turn we created (by id).
    const update = (patch: Partial<ChatTurn> | ((t: ChatTurn) => Partial<ChatTurn>)) =>
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aId ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m,
        ),
      );

    streamChat(
      { question: q, k, sources, mode: useMode },
      {
        onSources: (e) =>
          update(
            e.mode === "qa"
              ? { meta: { mode: "qa", chunks: e.chunks, method: e.method } }
              : { meta: { mode: "summary", pages: e.pages, chunksUsed: e.chunks_used } },
          ),
        onToken: (t) => update((m) => ({ text: m.text + t })),
        onDone: (e) => update({ text: e.answer, abstained: e.abstained, streaming: false }),
      },
      controller.signal,
    )
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          update({ streaming: false }); // user hit Stop — keep partial answer
          return;
        }
        const msg =
          err instanceof ApiError ? err.message : "Something went wrong talking to the backend.";
        // Show an error block only if nothing streamed yet; otherwise keep the text.
        update((m) => ({ streaming: false, error: m.text ? undefined : msg }));
      })
      .finally(() => {
        setStreaming(false);
        abortRef.current = null;
      });
  };

  const stop = () => abortRef.current?.abort();
  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
  };

  // ---- derived ----
  const noDocs = connected && chunkCount === 0;
  const composerDisabled = !connected || noDocs;
  const disabledReason = !connected
    ? "Backend offline — start the FastAPI server on port 8000."
    : noDocs
      ? "Upload a document to start asking questions."
      : undefined;

  const allMode = selected.size === 0;
  const scopeLabel = allMode
    ? "Asking across all documents"
    : `Filtered to ${[...selected].map(sourceLabel).join(", ")}`;

  const sidebarProps = {
    docs,
    selected,
    onToggle: toggleSource,
    onClear: clearSelected,
    chunkCount,
    connected,
    onIngested: refresh,
    loadingDocs,
  };

  return (
    <div className="flex h-screen overflow-hidden bg-bg text-ink">
      {/* sidebar — fixed column on desktop */}
      <div className="hidden w-[300px] shrink-0 md:block">
        <Sidebar {...sidebarProps} />
      </div>

      {/* sidebar — slide-over on mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            className="absolute inset-0 bg-ink/30"
            aria-label="Close documents panel"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[290px] max-w-[85%] shadow-xl">
            <Sidebar {...sidebarProps} />
          </div>
        </div>
      )}

      {/* main column */}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted transition-colors hover:text-ink md:hidden"
            aria-label="Open documents panel"
            onClick={() => setSidebarOpen(true)}
          >
            <IconDoc className="h-4 w-4" />
          </button>
          <span className="min-w-0 truncate text-sm text-muted" title={scopeLabel}>
            {scopeLabel}
          </span>
          {messages.length > 0 && (
            <button
              onClick={newChat}
              className="ml-auto rounded-lg border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-ink"
            >
              New chat
            </button>
          )}
        </header>

        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <EmptyState
              connected={connected}
              onPick={(s) => {
                setMode(s.mode);
                setInput(s.text);
              }}
            />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-7 px-4 py-6">
              {messages.map((m) => (
                <ChatMessage
                  key={m.id}
                  turn={m}
                  onReaskSummary={(question) => send({ question, mode: "summary" })}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-surface px-4 py-3">
          <div className="mx-auto max-w-3xl">
            <Composer
              value={input}
              onChange={setInput}
              mode={mode}
              onModeChange={setMode}
              k={k}
              onKChange={setK}
              onSend={send}
              onStop={stop}
              streaming={streaming}
              disabled={composerDisabled}
              disabledReason={disabledReason}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

function EmptyState({
  connected,
  onPick,
}: {
  connected: boolean;
  onPick: (s: { mode: Mode; text: string }) => void;
}) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-bg">
        <IconLens className="h-6 w-6" />
      </div>
      <h1 className="mt-4 text-xl font-semibold text-ink">Chat with your documents</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">
        Ask in plain English and get answers grounded in your files — every claim cited to its
        source page, with the exact retrieved passages one click away.
      </p>
      {!connected && (
        <p className="mt-3 text-xs text-warn">
          Backend offline — start the FastAPI server on port 8000.
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {STARTERS.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onPick(s)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-ink"
          >
            {s.mode === "summary" ? (
              <IconSparkle className="h-3.5 w-3.5" />
            ) : (
              <IconChat className="h-3.5 w-3.5" />
            )}
            {s.text}
          </button>
        ))}
      </div>
    </div>
  );
}
