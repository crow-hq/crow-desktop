"use client";
import { ArrowRight, FileText, FolderOpen, Info, Upload, Wallet, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Folder, ModelInfo, Settings } from "@/lib/types";
import { get } from "./api";
import { estimatedTokens, type Skipped } from "./files";
import { Modal } from "./modal";
import { fmtBytes, fmtUsd } from "./util";

export type Staged = { files: File[]; skipped: Skipped[]; folderId: string | null };

type SettingsRes = Settings & { spent_usd: number };

// Rough estimate: writer reads the document (tokens) and writes ~30% of that back; the router makes a
// couple of short calls per document.
const OUTPUT_RATIO = 0.3;
const ROUTER_IN = 2500;
const ROUTER_OUT = 150;

export function estimateCost(files: { name: string; size: number }[], writer?: ModelInfo, router?: ModelInfo) {
  if (!writer || !router) return null;
  const tokens = files.reduce((s, f) => s + estimatedTokens(f), 0);
  const writerUsd = (tokens * writer.prompt_usd_per_mtok + tokens * OUTPUT_RATIO * writer.completion_usd_per_mtok) / 1e6;
  const routerUsd = (files.length * (ROUTER_IN * router.prompt_usd_per_mtok + ROUTER_OUT * router.completion_usd_per_mtok)) / 1e6;
  const mid = writerUsd + routerUsd;
  return { mid, low: mid * 0.6, high: mid * 1.7, tokens };
}

export function AddDocuments({
  staged,
  folders,
  onClose,
  onAddFiles,
  onRemoveFile,
  onFolderChange,
  onStart,
}: {
  staged: Staged;
  folders: Folder[];
  onClose: () => void;
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (f: File) => void;
  onFolderChange: (id: string | null) => void;
  onStart: () => void;
}) {
  const [settings, setSettings] = useState<SettingsRes | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    Promise.all([get<SettingsRes>("/api/settings"), get<ModelInfo[]>("/api/models")])
      .then(([s, m]) => {
        if (!live) return;
        setSettings(s);
        setModels(m);
      })
      .catch(() => live && setLoadError(true));
    return () => {
      live = false;
    };
  }, []);

  const files = staged.files;
  const total = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);
  const writer = models?.find((m) => m.id === settings?.writer_model);
  const router = models?.find((m) => m.id === settings?.router_model);
  const est = useMemo(() => estimateCost(files, writer, router), [files, writer, router]);
  const sortedFolders = useMemo(() => [...folders].sort((a, b) => a.path.localeCompare(b.path)), [folders]);
  const remaining = settings ? Math.max(0, settings.spend_limit_usd - settings.spent_usd) : null;
  const overLimit = est && remaining !== null && est.mid > remaining;

  const pick = (list: FileList | null) => {
    if (list?.length) onAddFiles(Array.from(list));
  };

  return (
    <Modal
      title="Add documents"
      onClose={onClose}
      className="sm:max-w-[620px]"
      footer={
        <>
          <p className="hidden text-xs text-muted sm:block">Oldest files are filed first.</p>
          <button className="btn btn-primary !px-6 !py-2.5 max-sm:w-full" disabled={!files.length} onClick={onStart}>
            Start creating <ArrowRight size={16} />
          </button>
        </>
      }
    >
      <input ref={filesInput} type="file" multiple hidden onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
      <input
        ref={(el) => {
          dirInput.current = el;
          el?.setAttribute("webkitdirectory", "");
        }}
        type="file"
        multiple
        hidden
        onChange={(e) => (pick(e.target.files), (e.target.value = ""))}
      />

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-ghost" onClick={() => filesInput.current?.click()}>
          <Upload size={15} /> Choose files
        </button>
        <button className="btn btn-ghost" onClick={() => dirInput.current?.click()}>
          <FolderOpen size={15} /> Choose a folder
        </button>
        <span className="self-center text-xs text-muted">or drop them anywhere on the window</span>
      </div>

      <div className="mt-5 divide-y divide-line rounded-[10px] border border-line bg-panel">
        <Row icon={<FileText size={20} />} title={`${files.length.toLocaleString()} document${files.length === 1 ? "" : "s"}`} sub={files.length ? fmtBytes(total) : "Nothing selected yet"} />
        <div className="flex items-center gap-4 px-4 py-3.5">
          <span className="text-muted">
            <FolderOpen size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <label htmlFor="dest" className="text-[15px]">
              File into
            </label>
            <select
              id="dest"
              value={staged.folderId ?? ""}
              onChange={(e) => onFolderChange(e.target.value || null)}
              className="mt-1 block w-full rounded-[10px] border border-line bg-white px-2 py-1.5 text-sm text-fg focus:border-pink focus:outline-none"
            >
              <option value="">Automatic: the wiki picks the folders</option>
              {sortedFolders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Row
          icon={<Wallet size={20} />}
          title={
            est ? (
              <>
                About {fmtUsd(est.mid)} <span className="text-sm font-normal text-muted">({fmtUsd(est.low)} to {fmtUsd(est.high)})</span>
              </>
            ) : loadError ? (
              "Cost unavailable"
            ) : files.length ? (
              settings && models ? "Price unknown for the selected models" : "Estimating…"
            ) : (
              "No cost yet"
            )
          }
          sub={
            <>
              {settings && (
                <>
                  We pause at {fmtUsd(settings.spend_limit_usd)} · {fmtUsd(settings.spent_usd)} spent so far ·{" "}
                </>
              )}
              <Link href="/settings" className="font-bold text-pink-dark underline-offset-2 hover:underline">
                Change
              </Link>
            </>
          }
        />
      </div>

      <p className="mt-3 flex gap-2 text-xs leading-relaxed text-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        <span>
          This is a rough estimate from file sizes ({writer ? writer.name : "the writer model"} writes, {router ? router.name : "the router"} decides folders). Real cost depends on how much text each document holds.
          {overLimit && <span className="rounded bg-warn-bg px-1 text-ink"> It may exceed your remaining budget of {fmtUsd(remaining!)}; filing will pause when the limit is reached.</span>}
        </span>
      </p>

      {staged.skipped.length > 0 && (
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer select-none">{staged.skipped.length} file{staged.skipped.length === 1 ? "" : "s"} skipped</summary>
          <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto pl-4">
            {staged.skipped.slice(0, 200).map((s, i) => (
              <li key={i} className="truncate">
                {s.name} <span className="opacity-70">({s.reason})</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {files.length > 0 && (
        <ul className="mt-4 max-h-44 divide-y divide-line overflow-y-auto rounded-[10px] border border-line text-sm">
          {files.slice(0, 100).map((f, i) => (
            <li key={`${f.name}-${i}`} className="group flex items-center gap-3 px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="shrink-0 text-xs text-muted">{fmtBytes(f.size)}</span>
              <button className="icon-btn h-6 w-6 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100" onClick={() => onRemoveFile(f)} aria-label={`Remove ${f.name}`}>
                <X size={14} />
              </button>
            </li>
          ))}
          {files.length > 100 && <li className="px-3 py-1.5 text-xs text-muted">and {files.length - 100} more</li>}
        </ul>
      )}
    </Modal>
  );
}

function Row({ icon, title, sub }: { icon: React.ReactNode; title: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <span className="text-muted">{icon}</span>
      <div className="min-w-0">
        <p className="text-[15px] font-bold">{title}</p>
        <p className="text-sm text-muted">{sub}</p>
      </div>
    </div>
  );
}
