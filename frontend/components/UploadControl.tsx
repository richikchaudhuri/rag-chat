"use client";

/**
 * UploadControl — drop/click a PDF or .txt, then watch it ingest.
 *
 * The progress story is honest about where time actually goes:
 *  - "uploading"  → REAL byte-level % from xhr.upload.onprogress (fast on localhost)
 *  - "indexing"   → indeterminate shimmer while the server parses, chunks and
 *                   EMBEDS via Gemini (the slow part, which the backend doesn't
 *                   stream progress for — so we don't fake a percentage for it).
 */

import { useRef, useState } from "react";
import { ApiError, ingestFile } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { IngestResponse } from "@/lib/types";
import { IconUpload, IconX } from "./icons";

type Phase = "idle" | "uploading" | "indexing" | "done" | "error";

export function UploadControl({ onIngested }: { onIngested: (res: IngestResponse) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setPhase("idle");
    setProgress(0);
    setFileName("");
    setMessage("");
  };

  const start = (file: File) => {
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    if (ext !== ".pdf" && ext !== ".txt") {
      setPhase("error");
      setFileName(file.name);
      setMessage("Only .pdf or .txt files are supported.");
      return;
    }
    setFileName(file.name);
    setMessage("");
    setProgress(0);
    setPhase("uploading");

    const { promise, abort } = ingestFile(file, {
      onProgress: setProgress,
      onUploaded: () => setPhase("indexing"),
    });
    abortRef.current = abort;

    promise
      .then((res) => {
        setPhase("done");
        setMessage(`Indexed — the store now holds ${res.chunks_indexed} chunks.`);
        onIngested(res);
        window.setTimeout(() => setPhase((p) => (p === "done" ? "idle" : p)), 4500);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          reset();
          return;
        }
        setPhase("error");
        setMessage(
          err instanceof ApiError ? err.message : "Upload failed. Check the backend logs.",
        );
      })
      .finally(() => {
        abortRef.current = null;
      });
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) start(file);
    e.target.value = ""; // allow re-selecting the same filename
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) start(file);
  };

  const busy = phase === "uploading" || phase === "indexing";

  return (
    <div>
      <input ref={inputRef} type="file" accept=".pdf,.txt" onChange={onPick} className="hidden" />

      {!busy ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed px-3 py-5 text-center transition-colors",
            dragging
              ? "border-accent bg-accent-soft"
              : "border-border-strong bg-surface hover:border-accent hover:bg-surface-2",
          )}
        >
          <IconUpload className="h-5 w-5 text-muted" />
          <span className="text-xs font-medium text-ink">Upload a document</span>
          <span className="text-[0.7rem] text-faint">Drop a PDF or .txt here, or click to browse</span>
        </button>
      ) : (
        <div className="rounded-xl border border-border bg-surface px-3 py-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="truncate text-xs font-medium text-ink" title={fileName}>
              {fileName}
            </span>
            {phase === "uploading" && (
              <button
                type="button"
                onClick={() => abortRef.current?.()}
                className="ml-auto text-faint transition-colors hover:text-ink"
                title="Cancel upload"
                aria-label="Cancel upload"
              >
                <IconX className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {phase === "uploading" ? (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-150"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <p className="mt-1.5 font-mono text-[0.68rem] text-faint">
                uploading · {Math.round(progress * 100)}%
              </p>
            </>
          ) : (
            <>
              <div className="shimmer h-1.5 w-full overflow-hidden rounded-full bg-surface-2" />
              <p className="mt-1.5 text-[0.68rem] text-faint">
                Indexing — parsing, chunking &amp; embedding via Gemini. This can take a few seconds.
              </p>
            </>
          )}
        </div>
      )}

      {phase === "done" && (
        <p className="mt-2 text-[0.7rem] text-ok">✓ {message}</p>
      )}
      {phase === "error" && <p className="mt-2 text-[0.7rem] text-warn">{message}</p>}
    </div>
  );
}
