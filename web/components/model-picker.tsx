"use client";
import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo } from "@/lib/types";
import { useOnClickOutside } from "./hooks";
import { cn, fmtPrice } from "./util";

type Props = {
  label: string;
  description?: string;
  value: string;
  models: ModelInfo[];
  onChange: (id: string) => void;
  disabled?: boolean;
};

export function ModelPicker({ label, description, value, models, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const ref = useOnClickOutside<HTMLDivElement>(() => setOpen(false), open);
  const listRef = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? models.filter((m) => m.id.toLowerCase().includes(t) || m.name.toLowerCase().includes(t)) : models;
    return list.slice(0, 80);
  }, [q, models]);
  const custom = q.trim() && !models.some((m) => m.id === q.trim()) ? q.trim() : null;
  const rows = custom ? [{ custom }, ...filtered] : filtered;

  useEffect(() => setCursor(0), [q, open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="relative" ref={ref}>
      <p className="text-sm font-bold">{label}</p>
      {description && <p className="mb-2 text-xs text-muted">{description}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-[10px] border border-line bg-white px-3 py-2.5 text-left hover:border-pink disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="block truncate text-sm">{current?.name ?? value}</span>
          <span className="block truncate text-xs text-muted">
            {current ? `${current.id} · ${fmtPrice(current.prompt_usd_per_mtok)} in / ${fmtPrice(current.completion_usd_per_mtok)} out per M` : "Custom model id"}
          </span>
        </span>
        <ChevronDown size={16} className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="anim-pop absolute left-0 right-0 z-30 mt-1.5 overflow-hidden rounded-[10px] border border-line bg-white">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search size={15} className="text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search models, or type any model id"
              className="w-full bg-transparent py-2.5 text-sm placeholder:text-muted focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setCursor((c) => Math.min(rows.length - 1, c + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setCursor((c) => Math.max(0, c - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const r = rows[cursor];
                  if (r) pick("custom" in r ? r.custom : r.id);
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setOpen(false);
                }
              }}
            />
          </div>
          <div ref={listRef} className="max-h-72 overflow-y-auto py-1" role="listbox">
            {rows.length === 0 && <p className="px-3 py-3 text-sm text-muted">No models match.</p>}
            {rows.map((r, i) => {
              if ("custom" in r)
                return (
                  <button key="custom" data-i={i} role="option" aria-selected={false} className={cn("block w-full px-3 py-2 text-left text-sm", cursor === i ? "bg-hover" : "")} onMouseEnter={() => setCursor(i)} onClick={() => pick(r.custom)}>
                    Use <span className="font-mono font-bold text-pink-dark">{r.custom}</span> as a custom id
                  </button>
                );
              const sel = r.id === value;
              return (
                <button key={r.id} data-i={i} role="option" aria-selected={sel} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left", cursor === i && "bg-hover")} onMouseEnter={() => setCursor(i)} onClick={() => pick(r.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{r.name}</span>
                    <span className="block truncate font-mono text-[11px] text-muted">{r.id}</span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] leading-tight text-muted">
                    {fmtPrice(r.prompt_usd_per_mtok)} in
                    <br />
                    {fmtPrice(r.completion_usd_per_mtok)} out
                  </span>
                  {sel && <Check size={15} className="shrink-0 text-pink" />}
                </button>
              );
            })}
          </div>
          <p className="border-t border-line px-3 py-1.5 text-[11px] text-muted">USD per million tokens{models.length > 80 && !q ? ` · showing 80 of ${models.length}, search for more` : ""}</p>
        </div>
      )}
    </div>
  );
}
