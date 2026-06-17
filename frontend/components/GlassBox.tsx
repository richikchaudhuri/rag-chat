"use client";

/**
 * GlassBox — the inspectable "what did retrieval actually return?" panel shown
 * under each assistant answer. This is the project's glass-box differentiator:
 * instead of trusting a black box, you can see the exact chunks, their source
 * page, and their cosine distance (rendered as a similarity bar). Clicking a
 * citation in the answer opens this panel and scrolls to the matching chunk.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { citeMatchesChunk } from "@/lib/citations";
import type { ActiveCite, AssistantMeta } from "@/lib/types";
import { IconChevron, IconLens } from "./icons";

export function GlassBox({ meta, active }: { meta: AssistantMeta; active: ActiveCite }) {
  const [open, setOpen] = useState(false);
  const chunkRefs = useRef<(HTMLDivElement | null)[]>([]);
  const summary = meta.mode === "summary";

  // A citation click (active changes) opens the panel and scrolls to its chunk.
  useEffect(() => {
    if (!active || summary || !meta.chunks) return;
    const idx = meta.chunks.findIndex((c) => citeMatchesChunk(active, c));
    if (idx === -1) return;
    setOpen(true);
    requestAnimationFrame(() =>
      chunkRefs.current[idx]?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }, [active, summary, meta.chunks]);

  const count = summary ? (meta.chunksUsed ?? 0) : (meta.chunks?.length ?? 0);
  const headline = summary
    ? `synthesised from ${count} chunk${count === 1 ? "" : "s"}${
        meta.pages?.length ? ` · ${meta.pages.length} pages` : ""
      }`
    : `${meta.method ? `${meta.method} · ` : ""}${count} chunk${count === 1 ? "" : "s"} retrieved`;

  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
      >
        <IconLens className="h-3.5 w-3.5 text-faint" />
        <span className="text-xs font-medium text-muted">Retrieved context</span>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[0.68rem] text-muted">
          {headline}
        </span>
        <span className="ml-auto flex items-center gap-1 text-[0.68rem] text-faint">
          {open ? "hide" : "inspect"}
          <IconChevron
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-3">
          {summary ? (
            <SummaryView meta={meta} active={active} />
          ) : meta.chunks && meta.chunks.length > 0 ? (
            <>
              <p className="mb-2.5 text-[0.7rem] text-faint">
                {meta.method && meta.method !== "dense"
                  ? "Ranked by the retrieval method’s relevance score (higher = better). The answer was grounded in these passages only."
                  : "Ranked by cosine distance — lower is closer in meaning. The answer was grounded in these passages only."}
              </p>
              <div className="space-y-2.5">
                {meta.chunks.map((c, i) => {
                  const isActive = active ? citeMatchesChunk(active, c) : false;
                  const hasDist = typeof c.distance === "number";
                  const hasScore = typeof c.score === "number";
                  const similarity = hasDist
                    ? Math.max(0, Math.min(1, 1 - (c.distance as number)))
                    : 0;
                  return (
                    <div
                      key={i}
                      ref={(el) => {
                        chunkRefs.current[i] = el;
                      }}
                      className={cn(
                        "rounded-lg border bg-surface px-3 py-2.5",
                        isActive ? "border-accent flash" : "border-border",
                      )}
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="font-mono text-[0.68rem] text-faint">#{i + 1}</span>
                        <span
                          className="truncate font-mono text-[0.7rem] text-muted"
                          title={c.source}
                        >
                          {c.source} · p.{c.page}
                        </span>
                        {hasScore ? (
                          <span
                            className="ml-auto shrink-0 font-mono text-[0.68rem] tabular-nums text-faint"
                            title="cross-encoder / fusion ranking score (higher = more relevant)"
                          >
                            score {(c.score as number).toFixed(2)}
                          </span>
                        ) : hasDist ? (
                          <div
                            className="ml-auto flex shrink-0 items-center gap-2"
                            title={`cosine distance ${(c.distance as number).toFixed(4)} (lower = closer)`}
                          >
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                              <div
                                className="h-full rounded-full bg-accent"
                                style={{ width: `${similarity * 100}%` }}
                              />
                            </div>
                            <span className="font-mono text-[0.68rem] tabular-nums text-faint">
                              {(c.distance as number).toFixed(3)}
                            </span>
                          </div>
                        ) : (
                          <span className="ml-auto shrink-0 font-mono text-[0.68rem] text-faint">
                            —
                          </span>
                        )}
                      </div>
                      <p className="max-h-44 overflow-auto whitespace-pre-wrap text-[0.8rem] leading-relaxed text-muted">
                        {c.text}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-[0.8rem] text-faint">No chunks were retrieved for this question.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryView({ meta, active }: { meta: AssistantMeta; active: ActiveCite }) {
  return (
    <div>
      <p className="mb-2 text-[0.7rem] text-faint">
        Summary mode reads the whole document, so there’s no single top-k — these are the
        pages it drew from:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {meta.pages?.map((p) => (
          <span
            key={p}
            className={cn(
              "rounded-md border px-1.5 py-0.5 font-mono text-[0.7rem]",
              active && active.page === p
                ? "border-accent bg-accent text-accent-fg"
                : "border-border bg-surface-2 text-muted",
            )}
          >
            p.{p}
          </span>
        ))}
      </div>
    </div>
  );
}
