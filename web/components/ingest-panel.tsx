"use client";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Pause, Play, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Spinner } from "./modal";
import type { QueueItem } from "./use-ingest";

type Props = {
  items: QueueItem[];
  paused: boolean;
  limitMessage: string | null;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onDismiss: () => void;
};

const LABEL: Record<string, string> = { hashing: "Reading", uploading: "Uploading", filing: "Filing" };

export function IngestPanel({ items, paused, limitMessage, onPause, onResume, onRetry, onDismiss }: Props) {
  const [open, setOpen] = useState(true);
  if (!items.length) return null;
  const done = items.filter((x) => x.status === "done").length;
  const failed = items.filter((x) => x.status === "failed");
  const active = items.filter((x) => x.status === "hashing" || x.status === "uploading" || x.status === "filing");
  const waiting = items.filter((x) => x.status === "queued").length;
  const finished = active.length === 0 && waiting === 0;
  const pct = Math.round(((done + failed.length) / items.length) * 100);

  return (
    <div className="anim-pop w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-panel/95 shadow-2xl shadow-black/50 backdrop-blur">
      <div className="flex items-center gap-2 px-4 py-3">
        {finished ? <CheckCircle2 size={18} className="text-emerald-400" /> : paused ? <Pause size={18} className="text-amber-400" /> : <Spinner />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {finished ? "Finished" : paused ? "Paused" : "Building your wiki"} · {done} of {items.length}
          </p>
        </div>
        {!finished && (paused ? (
          <button className="icon-btn" onClick={onResume} aria-label="Resume" title="Resume">
            <Play size={16} />
          </button>
        ) : (
          <button className="icon-btn" onClick={onPause} aria-label="Pause" title="Pause">
            <Pause size={16} />
          </button>
        ))}
        <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={open ? "Hide details" : "Show details"}>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {finished && (
          <button className="icon-btn" onClick={onDismiss} aria-label="Dismiss">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="h-0.5 bg-raised">
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      {open && (
        <div className="max-h-64 space-y-3 overflow-y-auto px-4 py-3 text-sm">
          {limitMessage && (
            <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-amber-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{limitMessage} Raise the limit in Settings, then resume.</span>
            </div>
          )}
          {active.map((x) => (
            <div key={x.key} className="flex items-center justify-between gap-3">
              <span className="truncate">{x.file.name}</span>
              <span className="shrink-0 text-xs text-muted">{LABEL[x.status]}…</span>
            </div>
          ))}
          {waiting > 0 && <p className="text-xs text-muted">{waiting} waiting</p>}
          {failed.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="label !text-red-300">{failed.length} failed</span>
                <button className="flex items-center gap-1 text-xs text-accent hover:underline" onClick={onRetry}>
                  <RotateCcw size={12} /> Retry
                </button>
              </div>
              <ul className="space-y-1.5">
                {failed.map((x) => (
                  <li key={x.key}>
                    <p className="truncate">{x.file.name}</p>
                    <p className="text-xs leading-snug text-red-300/90">{x.error}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {finished && failed.length === 0 && <p className="text-xs text-muted">Everything is filed.</p>}
        </div>
      )}
    </div>
  );
}
