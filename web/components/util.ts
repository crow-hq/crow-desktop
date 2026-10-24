import type { Folder, Graph, NoteMeta } from "@/lib/types";

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const PALETTE = [
  "#3b82f6", "#f87171", "#fbbf24", "#34d399", "#a78bfa", "#f472b6", "#38bdf8", "#a3e635", "#fb923c", "#2dd4bf",
];
export const ROOT_COLOR = "#8b8f9a";

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function fmtUsd(n: number): string {
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(n < 100 ? 1 : 0)}`;
}

export const fmtPrice = (n: number) => `$${+n.toFixed(n < 1 ? 3 : 2)}`;

export type GraphIndex = {
  folderById: Map<string, Folder>;
  noteById: Map<string, NoteMeta>;
  noteIdByTitle: Map<string, string>;
  childFolders: Map<string, string[]>;
  notesByFolder: Map<string, string[]>;
  /** Colour of each folder: one per top-level folder, shared by everything under it. */
  colorByFolder: Map<string, string>;
  topOf: Map<string, string>;
};

export function indexGraph(g: Graph | null): GraphIndex {
  const folderById = new Map<string, Folder>();
  const noteById = new Map<string, NoteMeta>();
  const noteIdByTitle = new Map<string, string>();
  const childFolders = new Map<string, string[]>();
  const notesByFolder = new Map<string, string[]>();
  const colorByFolder = new Map<string, string>();
  const topOf = new Map<string, string>();
  if (!g) return { folderById, noteById, noteIdByTitle, childFolders, notesByFolder, colorByFolder, topOf };
  for (const f of g.folders) folderById.set(f.id, f);
  for (const n of g.notes) {
    noteById.set(n.id, n);
    const k = n.title.trim().toLowerCase();
    if (!noteIdByTitle.has(k)) noteIdByTitle.set(k, n.id);
    const arr = notesByFolder.get(n.folder_id) ?? [];
    arr.push(n.id);
    notesByFolder.set(n.folder_id, arr);
  }
  for (const f of g.folders) {
    const key = f.parent_id ?? "root";
    const arr = childFolders.get(key) ?? [];
    arr.push(f.id);
    childFolders.set(key, arr);
  }
  const tops = g.folders.filter((f) => !f.parent_id || !folderById.has(f.parent_id)).sort((a, b) => a.name.localeCompare(b.name));
  tops.forEach((f, i) => colorByFolder.set(f.id, PALETTE[i % PALETTE.length]));
  const top = (id: string): string => {
    const cached = topOf.get(id);
    if (cached) return cached;
    let cur = folderById.get(id);
    const seen = new Set<string>();
    while (cur && cur.parent_id && folderById.has(cur.parent_id) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = folderById.get(cur.parent_id);
    }
    const t = cur?.id ?? id;
    topOf.set(id, t);
    return t;
  };
  for (const f of g.folders) colorByFolder.set(f.id, colorByFolder.get(top(f.id)) ?? ROOT_COLOR);
  return { folderById, noteById, noteIdByTitle, childFolders, notesByFolder, colorByFolder, topOf };
}

/** Folder id plus every folder below it. */
export function folderSubtree(idx: GraphIndex, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (out.has(cur)) continue;
    out.add(cur);
    for (const c of idx.childFolders.get(cur) ?? []) stack.push(c);
  }
  return out;
}

export const CITE_RE = /\[\[note:([0-9a-fA-F-]{36})\]\]/g;

/** Plain text of an answer: citation markers replaced with the note titles. */
export function plainAnswer(text: string, title: (id: string) => string | undefined): string {
  return text.replace(CITE_RE, (_, id) => `[${title(id) ?? "note"}]`);
}
