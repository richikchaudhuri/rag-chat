"use client";

/**
 * RichText — renders an answer string as light markdown with inline, clickable
 * citations. Deliberately small and dependency-free: it handles the subset the
 * model actually emits (headings, bullet/numbered lists, **bold**, `code`) and
 * weaves citation pills into every text run.
 *
 * Re-parsing the FULL accumulated answer on each render (rather than per token)
 * is what makes streaming citations robust: a half-arrived "[p." is just text
 * until the closing "]" lands, then it becomes a pill — no token-boundary bugs.
 */

import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { citeEquals, splitCitations, type CiteSegment } from "@/lib/citations";
import type { ActiveCite } from "@/lib/types";
import { Citation } from "./Citation";

type Block =
  | { type: "h"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

/** Group raw lines into block elements (paragraphs, headings, lists). */
function toBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ type: "p", text: para.join(" ") });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list);
      list = null;
    }
  };

  for (const rawLine of src.split("\n")) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const boldHead = /^\*\*(.+?)\*\*:?\s*$/.exec(line); // a line that's only **Heading**
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);

    if (h) {
      flushPara();
      flushList();
      blocks.push({ type: "h", level: Math.min(h[1].length + 2, 6), text: h[2] });
    } else if (boldHead) {
      flushPara();
      flushList();
      blocks.push({ type: "h", level: 4, text: boldHead[1] });
    } else if (ul) {
      flushPara();
      if (!list || list.type !== "ul") {
        flushList();
        list = { type: "ul", items: [] };
      }
      list.items.push(ul[1]);
    } else if (ol) {
      flushPara();
      if (!list || list.type !== "ol") {
        flushList();
        list = { type: "ol", items: [] };
      }
      list.items.push(ol[1]);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

const INLINE_RE = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;

interface InlineCtx {
  onCite?: (c: CiteSegment) => void;
  active: ActiveCite;
}

/** Apply **bold** / `code` formatting within a plain text run. */
function formatRuns(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[2] !== undefined) {
      out.push(
        <strong key={`${key}-b${i}`} className="font-semibold text-ink">
          {m[2]}
        </strong>,
      );
    } else {
      out.push(
        <code
          key={`${key}-c${i}`}
          className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-ink"
        >
          {m[3]}
        </code>,
      );
    }
    last = INLINE_RE.lastIndex;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Split a run into citations + formatted text, in order. */
function renderInline(text: string, ctx: InlineCtx, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  splitCitations(text).forEach((seg, idx) => {
    if (seg.type === "text") {
      out.push(...formatRuns(seg.value, `${key}-t${idx}`));
    } else {
      out.push(
        <Citation
          key={`${key}-cite${idx}`}
          cite={seg}
          onCite={ctx.onCite}
          active={citeEquals(ctx.active, seg)}
        />,
      );
    }
  });
  return out;
}

const caretEl = <span key="caret" className="caret" aria-hidden="true" />;

export function RichText({
  text,
  onCite,
  active = null,
  caret = false,
  className,
}: {
  text: string;
  onCite?: (c: CiteSegment) => void;
  active?: ActiveCite;
  caret?: boolean; // append a blinking cursor to the end (while streaming)
  className?: string;
}) {
  const ctx: InlineCtx = { onCite, active };
  const blocks = toBlocks(text);
  return (
    <div className={cn("text-[0.94rem] leading-relaxed text-ink", className)}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        const last = i === blocks.length - 1;
        const tail = caret && last ? caretEl : null;

        if (b.type === "h") {
          const cls =
            b.level <= 3
              ? "mt-4 mb-1.5 text-[0.95rem] font-semibold text-ink first:mt-0"
              : b.level === 4
                ? "mt-3 mb-1 text-sm font-semibold text-ink first:mt-0"
                : "mt-2.5 mb-1 text-xs font-semibold uppercase tracking-wide text-muted first:mt-0";
          return (
            <p key={key} className={cls}>
              {renderInline(b.text, ctx, key)}
              {tail}
            </p>
          );
        }
        if (b.type === "ul") {
          return (
            <Fragment key={key}>
              <ul className="mt-2 space-y-1.5 first:mt-0">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2.5">
                    <span className="mt-[0.62em] h-1 w-1 shrink-0 rounded-full bg-faint" />
                    <span>{renderInline(it, ctx, `${key}-${j}`)}</span>
                  </li>
                ))}
              </ul>
              {tail}
            </Fragment>
          );
        }
        if (b.type === "ol") {
          return (
            <Fragment key={key}>
              <ol className="mt-2 space-y-1.5 first:mt-0">
                {b.items.map((it, j) => (
                  <li key={j} className="flex gap-2.5">
                    <span className="mt-px shrink-0 font-mono text-xs tabular-nums text-faint">
                      {j + 1}.
                    </span>
                    <span>{renderInline(it, ctx, `${key}-${j}`)}</span>
                  </li>
                ))}
              </ol>
              {tail}
            </Fragment>
          );
        }
        return (
          <p key={key} className="mt-2.5 first:mt-0">
            {renderInline(b.text, ctx, key)}
            {tail}
          </p>
        );
      })}
    </div>
  );
}
