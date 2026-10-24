"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IngestResult, Source } from "@/lib/types";
import { supabaseBrowser } from "@/lib/supabase/client";
import { errMsg, post } from "./api";
import { fileKey, mimeOf, sha256Hex } from "./files";

export type ItemStatus = "queued" | "hashing" | "uploading" | "filing" | "done" | "failed";
export type QueueItem = {
  key: string;
  file: File;
  folderId: string | null;
  status: ItemStatus;
  note?: string; // e.g. "already filed", "skipped by the writer"
  error?: string;
};

const CONCURRENCY = 2;

export function useIngest(onFiled: () => void) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [paused, setPaused] = useState(false);
  const [limitMessage, setLimitMessage] = useState<string | null>(null);
  const itemsRef = useRef<QueueItem[]>([]);
  const pausedRef = useRef(false);
  const activeRef = useRef(0);
  const onFiledRef = useRef(onFiled);
  onFiledRef.current = onFiled;

  const commit = (fn: (xs: QueueItem[]) => QueueItem[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  };
  const update = (key: string, p: Partial<QueueItem>) => commit((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const run = async (item: QueueItem) => {
    try {
      update(item.key, { status: "hashing" });
      const sha256 = await sha256Hex(item.file);
      const mime = mimeOf(item.file);
      const { source, duplicate } = await post<{ source: Source; duplicate: boolean }>("/api/sources", {
        filename: item.file.name,
        mime,
        size: item.file.size,
        sha256,
        target_folder_id: item.folderId ?? undefined,
      });
      if (duplicate && (source.status === "filed" || source.status === "skipped" || source.status === "processing")) {
        update(item.key, { status: "done", note: source.status === "skipped" ? "already seen, skipped" : "already in your wiki" });
        return;
      }
      update(item.key, { status: "uploading" });
      const up = await supabaseBrowser().storage.from("sources").upload(source.storage_path, item.file, { upsert: true, contentType: mime });
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
      update(item.key, { status: "filing" });
      const r = await post<IngestResult>("/api/ingest", { source_id: source.id });
      if (r.status === "pending" && r.error) {
        // Spending limit hit: park this file and pause the queue.
        update(item.key, { status: "queued", error: undefined });
        pausedRef.current = true;
        setPaused(true);
        setLimitMessage(r.error);
      } else if (r.status === "failed") {
        update(item.key, { status: "failed", error: r.error ?? "Filing failed" });
      } else if (r.status === "skipped") {
        update(item.key, { status: "done", note: r.error ?? "nothing to file" });
      } else {
        update(item.key, { status: "done" });
        onFiledRef.current();
      }
    } catch (e) {
      update(item.key, { status: "failed", error: errMsg(e) });
    }
  };

  const pump = useCallback(() => {
    while (!pausedRef.current && activeRef.current < CONCURRENCY) {
      // Oldest file first.
      let next: QueueItem | undefined;
      for (const x of itemsRef.current) if (x.status === "queued" && (!next || x.file.lastModified < next.file.lastModified)) next = x;
      if (!next) return;
      activeRef.current++;
      const item = next;
      update(item.key, { status: "hashing" });
      void run(item).finally(() => {
        activeRef.current--;
        pump();
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const enqueue = useCallback(
    (files: File[], folderId: string | null) => {
      const have = new Set(itemsRef.current.filter((x) => x.status !== "failed").map((x) => `${x.key}|${x.folderId}`));
      const fresh: QueueItem[] = [];
      for (const f of files) {
        const key = `${fileKey(f)}|${Math.random().toString(36).slice(2, 7)}`;
        if (have.has(`${fileKey(f)}|${folderId}`)) continue;
        fresh.push({ key, file: f, folderId, status: "queued" });
      }
      // Finished runs are cleared when a new batch starts.
      commit((xs) => [...(xs.every((x) => x.status === "done") ? [] : xs), ...fresh.sort((a, b) => a.file.lastModified - b.file.lastModified)]);
      setLimitMessage(null);
      pausedRef.current = false;
      setPaused(false);
      pump();
    },
    [pump],
  );

  const pause = useCallback(() => {
    pausedRef.current = true;
    setPaused(true);
  }, []);
  const resume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    setLimitMessage(null);
    pump();
  }, [pump]);
  const retryFailed = useCallback(() => {
    commit((xs) => xs.map((x) => (x.status === "failed" ? { ...x, status: "queued", error: undefined } : x)));
    resume();
  }, [resume]);
  const clear = useCallback(() => {
    if (activeRef.current === 0) commit(() => []);
    else commit((xs) => xs.filter((x) => x.status !== "done" && x.status !== "failed"));
  }, []);

  const running = items.some((x) => x.status === "hashing" || x.status === "uploading" || x.status === "filing");
  const queued = items.some((x) => x.status === "queued");
  useEffect(() => {
    if (!running && !(queued && !paused)) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [running, queued, paused]);

  return { items, paused, limitMessage, enqueue, pause, resume, retryFailed, clear };
}
