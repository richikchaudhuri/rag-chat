"use client";

import { cn } from "@/lib/cn";
import { sourceLabel, type CiteSegment } from "@/lib/citations";

function shorten(s: string, n = 16): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * A clickable citation pill rendered inline in the answer, e.g. "📄 GeoAI · p.5"
 * (QA) or "p.5" (summary). Clicking calls onCite — the chat message uses that to
 * open its glass-box panel and highlight the exact chunk this fact came from.
 */
export function Citation({
  cite,
  onCite,
  active = false,
}: {
  cite: CiteSegment;
  onCite?: (cite: CiteSegment) => void;
  active?: boolean;
}) {
  const label = cite.source
    ? `${shorten(sourceLabel(cite.source))} · p.${cite.page}`
    : `p.${cite.page}`;
  return (
    <button
      type="button"
      onClick={() => onCite?.(cite)}
      title={cite.source ? `${cite.source} — page ${cite.page}` : `Page ${cite.page}`}
      className={cn(
        "mx-0.5 inline-flex translate-y-px items-center gap-1 rounded-md border px-1.5 py-0.5 align-baseline font-mono text-[0.72em] font-medium leading-none transition-colors",
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-accent-soft bg-accent-soft text-accent-ink hover:border-accent hover:bg-accent hover:text-accent-fg",
      )}
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M14 3v5h5" />
        <path d="M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      </svg>
      {label}
    </button>
  );
}
