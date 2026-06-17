"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import type { Mode } from "@/lib/types";
import { IconChat, IconSend, IconSparkle, IconStop } from "./icons";

/**
 * Composer — the question box. Carries the Q&A / Summarise mode toggle (so the
 * user never has to know about the backend `mode` field) and, in QA mode, a
 * compact top-k "depth" stepper — a small nod to the inspectable/eval theme,
 * since k is exactly what the glass-box then shows.
 */
export function Composer({
  value,
  onChange,
  mode,
  onModeChange,
  k,
  onKChange,
  onSend,
  onStop,
  streaming,
  disabled,
  disabledReason,
}: {
  value: string;
  onChange: (v: string) => void;
  mode: Mode;
  onModeChange: (m: Mode) => void;
  k: number;
  onKChange: (k: number) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea with its content, up to a cap.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !disabled && !streaming;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-2.5 shadow-sm">
      {/* options row */}
      <div className="mb-2 flex items-center gap-2 px-1">
        <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
          <ModeButton active={mode === "qa"} onClick={() => onModeChange("qa")} label="Q & A">
            <IconChat className="h-3.5 w-3.5" />
          </ModeButton>
          <ModeButton
            active={mode === "summary"}
            onClick={() => onModeChange("summary")}
            label="Summarise"
          >
            <IconSparkle className="h-3.5 w-3.5" />
          </ModeButton>
        </div>

        {mode === "qa" ? (
          <div
            className="ml-auto flex items-center gap-1.5 text-xs text-muted"
            title="Top-k: how many chunks to retrieve. The glass-box shows exactly these."
          >
            <span className="hidden sm:inline">depth</span>
            <span className="font-mono text-faint">k</span>
            <div className="flex items-center overflow-hidden rounded-lg border border-border bg-surface">
              <button
                type="button"
                onClick={() => onKChange(Math.max(1, k - 1))}
                className="px-2 py-1 leading-none text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label="decrease k"
              >
                −
              </button>
              <span className="w-5 text-center font-mono tabular-nums text-ink">{k}</span>
              <button
                type="button"
                onClick={() => onKChange(Math.min(12, k + 1))}
                className="px-2 py-1 leading-none text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                aria-label="increase k"
              >
                +
              </button>
            </div>
          </div>
        ) : (
          <span className="ml-auto text-[0.7rem] text-faint">reads the whole document</span>
        )}
      </div>

      {/* input row */}
      <div className="relative">
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={
            mode === "qa"
              ? "Ask a question about your documents…"
              : "Summarise a document — e.g. “the key points I should revise”…"
          }
          className="block max-h-[200px] w-full resize-none rounded-xl bg-transparent px-3 py-2.5 pr-14 text-[0.95rem] text-ink placeholder:text-faint focus:outline-none"
        />
        <div className="absolute bottom-2 right-2">
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-ink"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <IconStop className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSend()}
              disabled={!canSend}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl transition-colors",
                canSend
                  ? "bg-accent text-accent-fg hover:opacity-90"
                  : "cursor-not-allowed bg-surface-2 text-faint",
              )}
              title={disabled ? (disabledReason ?? "Unavailable") : "Send (Enter)"}
              aria-label="Send"
            >
              <IconSend className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="px-1 pt-1.5 text-[0.7rem] text-faint">
        {disabled && disabledReason ? (
          <span className="text-warn">{disabledReason}</span>
        ) : (
          <span>
            <span className="font-medium text-muted">Enter</span> to send ·{" "}
            <span className="font-medium text-muted">Shift+Enter</span> for a new line
          </span>
        )}
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
      )}
    >
      {children}
      {label}
    </button>
  );
}
