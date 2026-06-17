"use client";

/**
 * Sidebar — the document workspace: store status, the per-document search filter
 * (the multi-document differentiator — empty selection = search everything), and
 * the upload control. Lives to the left of the chat.
 */

import type { DocSummary } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { IngestResponse } from "@/lib/types";
import { IconDatabase, IconDoc, IconLens } from "./icons";
import { UploadControl } from "./UploadControl";

export function Sidebar({
  docs,
  selected,
  onToggle,
  onClear,
  chunkCount,
  connected,
  onIngested,
  loadingDocs,
}: {
  docs: DocSummary[];
  selected: Set<string>;
  onToggle: (source: string) => void;
  onClear: () => void;
  chunkCount: number | null;
  connected: boolean;
  onIngested: (res: IngestResponse) => void;
  loadingDocs: boolean;
}) {
  const allMode = selected.size === 0;

  return (
    <aside className="flex h-full flex-col gap-4 overflow-y-auto border-r border-border bg-surface p-4">
      {/* brand */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-bg">
          <IconLens className="h-4 w-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-ink">DocLens</div>
          <div className="text-[0.68rem] text-faint">measured, inspectable RAG</div>
        </div>
      </div>

      {/* store status */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2">
        <IconDatabase className="h-4 w-4 text-faint" />
        <span className="text-xs text-muted">
          <span className="font-mono text-ink">{chunkCount ?? "—"}</span> chunks indexed
        </span>
        <span
          className="ml-auto flex items-center gap-1.5 text-[0.68rem]"
          title={connected ? "Backend reachable" : "Backend unreachable"}
        >
          <span className={cn("h-2 w-2 rounded-full", connected ? "bg-ok" : "bg-warn")} />
          <span className={connected ? "text-muted" : "text-warn"}>
            {connected ? "live" : "offline"}
          </span>
        </span>
      </div>

      {/* documents + filter */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-faint">
            Documents
          </span>
          <span className="text-[0.68rem] text-faint">
            {allMode ? "searching all" : `${selected.size} of ${docs.length}`}
          </span>
        </div>

        <div className="-mx-1 flex-1 space-y-1 overflow-y-auto px-1">
          {loadingDocs && docs.length === 0 ? (
            <p className="px-1 py-2 text-[0.72rem] text-faint">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="px-1 py-2 text-[0.72rem] leading-relaxed text-faint">
              No documents yet. Upload one below to start asking questions.
            </p>
          ) : (
            docs.map((d) => {
              const isSelected = selected.has(d.source);
              return (
                <button
                  key={d.source}
                  type="button"
                  onClick={() => onToggle(d.source)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                    isSelected
                      ? "border-accent bg-accent-soft"
                      : "border-transparent hover:border-border hover:bg-bg",
                  )}
                  title={allMode ? "Click to search only this document" : "Click to toggle"}
                >
                  <IconDoc
                    className={cn("h-4 w-4 shrink-0", isSelected ? "text-accent-ink" : "text-faint")}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink" title={d.source}>
                    {d.source}
                  </span>
                  <span className="shrink-0 font-mono text-[0.66rem] text-faint">{d.chunks}</span>
                </button>
              );
            })
          )}
        </div>

        {!allMode && (
          <button
            type="button"
            onClick={onClear}
            className="mt-1.5 self-start text-[0.7rem] text-accent-ink transition-opacity hover:opacity-70"
          >
            clear filter — search all
          </button>
        )}
      </div>

      {/* upload */}
      <UploadControl onIngested={onIngested} />
    </aside>
  );
}
