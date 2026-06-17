"use client";

/**
 * ChatMessage — renders one conversation turn.
 *  - user: a right-aligned bubble.
 *  - assistant: avatar + answer (live markdown + citations) + the glass-box,
 *    plus a one-click "Re-ask in Summarise mode" nudge for study questions.
 *
 * Each assistant turn owns its own `active` citation state, so clicking a pill
 * highlights the matching chunk in THIS answer's glass-box (and clicking it
 * again clears the highlight).
 */

import { useState } from "react";
import { cn } from "@/lib/cn";
import { citeEquals, type CiteSegment } from "@/lib/citations";
import { looksLikeStudyRequest } from "@/lib/intent";
import type { ActiveCite, ChatTurn } from "@/lib/types";
import { GlassBox } from "./GlassBox";
import { RichText } from "./RichText";
import { IconAlert, IconLens, IconSparkle } from "./icons";

export function ChatMessage({
  turn,
  onReaskSummary,
}: {
  turn: ChatTurn;
  onReaskSummary?: (question: string) => void;
}) {
  if (turn.role === "user") {
    return (
      <div className="fade-up flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-user-bubble px-4 py-2.5 text-[0.95rem] text-user-ink">
          {turn.text}
        </div>
      </div>
    );
  }
  return <AssistantMessage turn={turn} onReaskSummary={onReaskSummary} />;
}

function AssistantMessage({
  turn,
  onReaskSummary,
}: {
  turn: ChatTurn;
  onReaskSummary?: (question: string) => void;
}) {
  const [active, setActive] = useState<ActiveCite>(null);
  const summary = turn.mode === "summary";
  const waiting = turn.streaming && !turn.text;

  const onCite = (c: CiteSegment) => {
    const next = { source: c.source, page: c.page };
    setActive((prev) => (citeEquals(prev, next) ? null : next));
  };

  // Offer a jump to Summarise mode when a finished QA turn either abstained or
  // reads like a study request ("exam topics", "key points", ...) — exactly the
  // questions strict extractive QA can't satisfy but whole-doc synthesis can.
  const showSummaryNudge =
    !summary &&
    !turn.streaming &&
    !turn.error &&
    !!turn.question &&
    !!onReaskSummary &&
    (turn.abstained || looksLikeStudyRequest(turn.question));

  return (
    <div className="fade-up flex gap-3">
      {/* avatar — signals mode (lens = QA, sparkle = summary) or state */}
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
          turn.abstained
            ? "border-warn-soft bg-warn-soft text-warn"
            : "border-border bg-surface text-accent",
        )}
      >
        {turn.error ? (
          <IconAlert className="h-3.5 w-3.5 text-warn" />
        ) : summary ? (
          <IconSparkle className="h-3.5 w-3.5" />
        ) : (
          <IconLens className="h-3.5 w-3.5" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-[0.7rem] text-faint">
          <span className="font-medium text-muted">{summary ? "Summary" : "Answer"}</span>
          {turn.abstained && (
            <span className="rounded-full bg-warn-soft px-1.5 py-0.5 text-warn">
              not in documents
            </span>
          )}
        </div>

        {turn.error ? (
          <div className="rounded-xl border border-warn-soft bg-warn-soft px-3.5 py-3 text-[0.9rem] text-warn">
            {turn.error}
          </div>
        ) : waiting ? (
          <Waiting summary={summary} />
        ) : (
          <RichText text={turn.text} onCite={onCite} active={active} caret={turn.streaming} />
        )}

        {showSummaryNudge && (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onReaskSummary!(turn.question!)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-soft bg-accent-soft px-2.5 py-1.5 text-xs font-medium text-accent-ink transition-colors hover:border-accent hover:bg-accent hover:text-accent-fg"
            >
              <IconSparkle className="h-3.5 w-3.5" />
              Re-ask in Summarise mode
            </button>
            <span className="text-[0.7rem] text-faint">
              for a synthesised, page-cited study guide
            </span>
          </div>
        )}

        {turn.meta && !turn.error && <GlassBox meta={turn.meta} active={active} />}
      </div>
    </div>
  );
}

function Waiting({ summary }: { summary: boolean }) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      <span className="flex gap-1">
        <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
      </span>
      <span className="text-faint">
        {summary ? "Reading the document…" : "Searching your documents…"}
      </span>
    </div>
  );
}

function Dot({ delay = "0ms" }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-faint"
      style={{ animationDelay: delay }}
    />
  );
}
