"use client";
import dynamic from "next/dynamic";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Graph } from "@/lib/types";
import { filesFromDataTransfer, hasFiles } from "./files";
import { folderSubtree, indexGraph, ROOT_COLOR } from "./util";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ForceGraph: any = dynamic(
  async () => {
    const mod = await import("react-force-graph-2d");
    const FG = mod.default as any;
    const Wrapped = ({ fgRef, ...props }: any) => <FG ref={fgRef} {...props} />;
    return Wrapped;
  },
  { ssr: false, loading: () => null },
);

type GNode = {
  id: string;
  kind: "root" | "folder" | "note";
  label: string;
  color: string;
  r: number;
  folderId?: string;
  noteId?: string;
  depth: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
};
type GLink = { source: string | GNode; target: string | GNode; kind: "tree" | "ref"; color: string };

const idOf = (v: string | GNode) => (typeof v === "string" ? v : v.id);

export type BrainProps = {
  graph: Graph | null;
  error: string | null;
  onRetry: () => void;
  focusFolderId: string | null;
  onFocusFolder: (id: string | null) => void;
  onOpenNote: (id: string) => void;
  highlightIds: Set<string>;
  /** Files dropped on the brain; folderId is the nearest folder node (or null). */
  onDropFiles: (files: File[], folderId: string | null) => void;
};

export function Brain({ graph, error, onRetry, focusFolderId, onFocusFolder, onOpenNote, highlightIds, onDropFiles }: BrainProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dropFolder, setDropFolder] = useState<string | null | undefined>(undefined); // undefined = not dragging
  const cache = useRef(new Map<string, GNode>());
  const fitted = useRef(false);
  const forcesSet = useRef(false);

  const idx = useMemo(() => indexGraph(graph), [graph]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => {
    const nodes: GNode[] = [];
    const links: GLink[] = [];
    if (!graph) return { nodes, links };
    const old = cache.current;
    const next = new Map<string, GNode>();
    const upsert = (n: GNode, near?: GNode) => {
      const prev = old.get(n.id);
      if (prev) {
        Object.assign(prev, n, { x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy });
        next.set(n.id, prev);
        nodes.push(prev);
      } else {
        if (near && near.x != null && near.y != null) {
          n.x = near.x + (Math.random() - 0.5) * 30;
          n.y = near.y + (Math.random() - 0.5) * 30;
        }
        next.set(n.id, n);
        nodes.push(n);
      }
      return next.get(n.id)!;
    };
    const root = upsert({ id: "root", kind: "root", label: "", color: ROOT_COLOR, r: 7, depth: 0, x: old.get("root")?.x ?? 0, y: old.get("root")?.y ?? 0 });
    const depthOf = (fid: string): number => {
      let d = 1;
      let cur = idx.folderById.get(fid);
      while (cur?.parent_id && idx.folderById.has(cur.parent_id) && d < 50) {
        d++;
        cur = idx.folderById.get(cur.parent_id);
      }
      return d;
    };
    // Parents before children so new nodes can spawn near them.
    const folders = [...graph.folders].sort((a, b) => depthOf(a.id) - depthOf(b.id));
    for (const f of folders) {
      const color = idx.colorByFolder.get(f.id) ?? ROOT_COLOR;
      const kids = (idx.childFolders.get(f.id)?.length ?? 0) + (idx.notesByFolder.get(f.id)?.length ?? 0);
      const parent = f.parent_id && idx.folderById.has(f.parent_id) ? next.get(`f:${f.parent_id}`) ?? root : root;
      upsert({ id: `f:${f.id}`, kind: "folder", label: f.name, color, r: 4.5 + Math.min(4, Math.sqrt(kids) * 0.8), folderId: f.id, depth: depthOf(f.id) }, parent);
      links.push({
        source: parent.id,
        target: `f:${f.id}`,
        kind: "tree",
        color: color,
      });
    }
    for (const n of graph.notes) {
      const fn = next.get(`f:${n.folder_id}`);
      if (!fn) continue;
      upsert({ id: `n:${n.id}`, kind: "note", label: n.title, color: fn.color, r: 2.4, noteId: n.id, folderId: n.folder_id, depth: 99 }, fn);
      links.push({ source: fn.id, target: `n:${n.id}`, kind: "tree", color: fn.color });
    }
    for (const l of graph.links) {
      if (next.has(`n:${l.from_note}`) && next.has(`n:${l.to_note}`) && l.from_note !== l.to_note) {
        links.push({ source: `n:${l.from_note}`, target: `n:${l.to_note}`, kind: "ref", color: "#9ca3af" });
      }
    }
    cache.current = next;
    return { nodes, links };
  }, [graph, idx]);

  // Everything the painter reads lives in a ref so callbacks stay stable.
  const view = useRef({ focus: null as Set<string> | null, highlight: highlightIds, dropFolder: dropFolder as string | null | undefined });
  view.current.focus = useMemo(() => (focusFolderId ? folderSubtree(idx, focusFolderId) : null), [focusFolderId, idx]);
  view.current.highlight = highlightIds;
  view.current.dropFolder = dropFolder;

  const alphaOf = useCallback((n: GNode): number => {
    const { focus, highlight } = view.current;
    if (focus) {
      if (n.kind === "folder") return focus.has(n.folderId!) ? 1 : 0.1;
      if (n.kind === "note") return focus.has(n.folderId!) ? 1 : 0.1;
      return 0.25;
    }
    if (highlight.size) return n.kind === "note" && highlight.has(n.noteId!) ? 1 : 0.35;
    return 1;
  }, []);

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, k: number) => {
      const { focus, highlight, dropFolder } = view.current;
      const a = alphaOf(node);
      const hl = node.kind === "note" && highlight.has(node.noteId!);
      const isDrop = node.kind === "folder" && dropFolder === node.folderId;
      const r = hl ? node.r * 2.2 : node.r;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = node.color;
      ctx.fill();
      if (hl || isDrop) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3 / Math.sqrt(k), 0, 2 * Math.PI);
        ctx.strokeStyle = isDrop ? "#3b82f6" : "#ffffff";
        ctx.lineWidth = 1.6 / k;
        ctx.stroke();
        if (isDrop) {
          ctx.beginPath();
          ctx.arc(x, y, r + 10 / Math.sqrt(k), 0, 2 * Math.PI);
          ctx.strokeStyle = "rgba(59,130,246,0.35)";
          ctx.lineWidth = 6 / k;
          ctx.stroke();
        }
      }
      let label = "";
      let size = 11;
      let color = "rgba(214,214,224,0.78)";
      if (node.kind === "folder") {
        const inFocus = !!focus && focus.has(node.folderId!);
        if (node.depth === 1 || k > 1.3 || inFocus || isDrop) label = node.label;
        size = node.depth === 1 ? 13 : 11.5;
        if (isDrop) color = "#93c5fd";
      } else if (node.kind === "note") {
        if (hl) {
          label = node.label;
          color = "#ffffff";
          size = 12;
        } else if (k > 2.4 && a > 0.5) {
          label = node.label.length > 40 ? node.label.slice(0, 39) + "…" : node.label;
          size = 10;
          color = "rgba(190,190,205,0.8)";
        }
      }
      if (label) {
        const fs = size / k;
        ctx.font = `${hl || isDrop ? 600 : 400} ${fs}px Inter, ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = color;
        ctx.fillText(label, x + r + 3 / k + 1, y);
      }
      ctx.globalAlpha = 1;
    },
    [alphaOf],
  );

  const paintPointer = useCallback((node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, node.r + 3, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const linkColor = useCallback((l: GLink) => {
    const s = typeof l.source === "string" ? cache.current.get(l.source) : l.source;
    const t = typeof l.target === "string" ? cache.current.get(l.target) : l.target;
    const a = Math.min(s ? alphaOf(s) : 1, t ? alphaOf(t) : 1);
    const hex = l.kind === "ref" ? "156,163,175" : hexToRgb(l.color);
    const base = l.kind === "ref" ? 0.1 : 0.38;
    const { highlight } = view.current;
    const hlLink = highlight.size && ((s?.noteId && highlight.has(s.noteId)) || (t?.noteId && highlight.has(t.noteId)));
    return `rgba(${hex},${hlLink ? 0.8 : base * a})`;
  }, [alphaOf]);

  const configureForces = useCallback(() => {
    const fg = fgRef.current;
    if (!fg || forcesSet.current) return;
    forcesSet.current = true;
    fg.d3Force("charge")?.strength((n: GNode) => (n.kind === "note" ? -14 : n.kind === "folder" ? -90 : -160));
    fg.d3Force("link")?.distance((l: GLink) => {
      const t = typeof l.target === "string" ? cache.current.get(l.target) : l.target;
      return l.kind === "ref" ? 90 : t?.kind === "note" ? 16 : 46;
    });
  }, []);

  // Camera follows folder focus.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !data.nodes.length) return;
    if (focusFolderId) {
      const n = cache.current.get(`f:${focusFolderId}`);
      if (n?.x != null && n.y != null) {
        fg.centerAt(n.x, n.y, 600);
        fg.zoom(2.2, 600);
      }
    } else if (fitted.current) {
      fg.zoomToFit(600, 70);
    }
  }, [focusFolderId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!data.nodes.length) fitted.current = false;
  }, [data.nodes.length]);

  const nearestFolder = (clientX: number, clientY: number): string | null => {
    const fg = fgRef.current;
    const el = wrapRef.current;
    if (!fg || !el) return null;
    const rect = el.getBoundingClientRect();
    const p = fg.screen2GraphCoords(clientX - rect.left, clientY - rect.top);
    const k = fg.zoom?.() ?? 1;
    let best: string | null = null;
    let bestD = 140 / k;
    for (const n of cache.current.values()) {
      if (n.kind !== "folder" || n.x == null || n.y == null) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = n.folderId!;
      }
    }
    return best;
  };

  const folderName = dropFolder ? graph?.folders.find((f) => f.id === dropFolder)?.path : null;

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 overflow-hidden"
      onDragOver={(e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setDropFolder(nearestFolder(e.clientX, e.clientY));
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropFolder(undefined);
      }}
      onDrop={async (e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        const target = nearestFolder(e.clientX, e.clientY);
        setDropFolder(undefined);
        const files = await filesFromDataTransfer(e.dataTransfer);
        if (files.length) onDropFiles(files, target);
      }}
    >
      {size.w > 0 && data.nodes.length > 0 && (
        <ForceGraph
          fgRef={fgRef}
          width={size.w}
          height={size.h}
          graphData={data}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={4}
          nodeLabel={() => ""}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintPointer}
          linkColor={linkColor}
          linkWidth={(l: GLink) => (l.kind === "ref" ? 0.5 : 0.9)}
          enableNodeDrag={true}
          cooldownTicks={160}
          d3AlphaDecay={0.03}
          d3VelocityDecay={0.35}
          minZoom={0.2}
          maxZoom={12}
          onEngineTick={configureForces}
          onEngineStop={() => {
            if (!fitted.current && !focusFolderId) {
              fitted.current = true;
              fgRef.current?.zoomToFit(500, 80);
            }
          }}
          onNodeClick={(n: GNode) => {
            if (n.kind === "note") onOpenNote(n.noteId!);
            else if (n.kind === "folder") onFocusFolder(focusFolderId === n.folderId ? null : n.folderId!);
            else onFocusFolder(null);
          }}
          onNodeHover={(n: GNode | null) => {
            if (wrapRef.current) wrapRef.current.style.cursor = n ? "pointer" : "default";
          }}
          onBackgroundClick={() => onFocusFolder(null)}
        />
      )}

      {!graph && !error && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted">
          <Loader2 className="animate-spin" size={16} /> Loading your wiki…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-xl border border-line bg-panel p-5 text-center">
            <p className="text-sm text-danger">{error}</p>
            <button className="btn btn-ghost mt-3" onClick={onRetry}>
              <RefreshCw size={14} /> Try again
            </button>
          </div>
        </div>
      )}

      {dropFolder !== undefined && (
        <div className="pointer-events-none absolute inset-3 flex items-start justify-center rounded-2xl border-2 border-dashed border-accent/60 bg-accent/5">
          <div className="mt-6 rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-white shadow-lg">
            {folderName ? `File into ${folderName}` : "Drop to add documents. Crow will pick the folders"}
          </div>
        </div>
      )}
    </div>
  );
}

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
