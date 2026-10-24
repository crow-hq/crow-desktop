"use client";
import { FolderPlus, MessageSquare, PanelLeft, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Graph } from "@/lib/types";
import { AddDocuments, type Staged } from "./add-documents";
import { errMsg, get } from "./api";
import { Brain } from "./brain";
import { ChatPanel } from "./chat-panel";
import { Composer } from "./composer";
import { filesFromDataTransfer, filterFiles, fileKey, hasFiles } from "./files";
import { useMediaQuery } from "./hooks";
import { IngestPanel } from "./ingest-panel";
import { NoteModal } from "./note-modal";
import { Sidebar } from "./sidebar";
import { useChat } from "./use-chat";
import { useIngest } from "./use-ingest";
import { indexGraph } from "./util";

export default function CrowApp() {
  const desktop = useMediaQuery("(min-width: 768px)");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [focusFolderId, setFocusFolderId] = useState<string | null>(null);
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [staged, setStaged] = useState<Staged>({ files: [], skipped: [], folderId: null });
  const [windowDrag, setWindowDrag] = useState(false);

  const chat = useChat();
  const idx = useMemo(() => indexGraph(graph), [graph]);

  // Graph loading, coalescing overlapping refreshes.
  const loadingGraph = useRef(false);
  const again = useRef(false);
  const refreshGraph = useCallback(async () => {
    if (loadingGraph.current) {
      again.current = true;
      return;
    }
    loadingGraph.current = true;
    try {
      setGraph(await get<Graph>("/api/graph"));
      setGraphError(null);
    } catch (e) {
      setGraphError(errMsg(e));
    } finally {
      loadingGraph.current = false;
      if (again.current) {
        again.current = false;
        void refreshGraph();
      }
    }
  }, []);
  useEffect(() => {
    void refreshGraph();
  }, [refreshGraph]);

  const ingest = useIngest(refreshGraph);

  useEffect(() => {
    setSidebarOpen(window.matchMedia("(min-width: 768px)").matches);
  }, []);

  // Drag and drop anywhere on the window (the brain handles drops on itself).
  const stage = useCallback((raw: File[], folderId?: string | null) => {
    const { accepted, skipped } = filterFiles(raw);
    setStaged((s) => {
      const seen = new Set(s.files.map(fileKey));
      const files = [...s.files];
      for (const f of accepted) if (!seen.has(fileKey(f))) files.push(f);
      return { files, skipped: [...s.skipped, ...skipped], folderId: folderId !== undefined ? folderId : s.folderId };
    });
    setAddOpen(true);
  }, []);
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      depth++;
      setWindowDrag(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setWindowDrag(false);
    };
    const drop = async (e: DragEvent) => {
      depth = 0;
      setWindowDrag(false);
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      const files = await filesFromDataTransfer(e.dataTransfer!);
      if (files.length) stage(files);
    };
    // Brain drops stop propagation, so reset the overlay on any drop/dragend at capture time.
    const reset = () => {
      depth = 0;
      setWindowDrag(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    window.addEventListener("drop", reset, true);
    window.addEventListener("dragend", reset, true);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      window.removeEventListener("drop", reset, true);
      window.removeEventListener("dragend", reset, true);
    };
  }, [stage]);

  // Esc clears the folder focus when nothing else is open.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !openNoteId && !addOpen) setFocusFolderId(null);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [openNoteId, addOpen]);

  const resolveTitle = useCallback((id: string) => chat.titles[id] ?? idx.noteById.get(id)?.title, [chat.titles, idx]);
  const resolveWiki = useCallback((t: string) => idx.noteIdByTitle.get(t.trim().toLowerCase()), [idx]);
  const highlightIds = useMemo(() => new Set(hoverId ? [hoverId] : []), [hoverId]);
  const openNote = useCallback((id: string) => setOpenNoteId(id), []);

  const activeTitle = chat.chats?.find((c) => c.id === chat.activeId)?.title ?? null;
  const send = (t: string) => {
    setChatOpen(true);
    void chat.send(t);
  };

  const closeAdd = () => {
    setAddOpen(false);
    setStaged({ files: [], skipped: [], folderId: null });
  };
  const empty = !!graph && graph.notes.length === 0 && graph.folders.length === 0 && ingest.items.length === 0;

  return (
    <div className="fixed inset-0 flex bg-bg">
      {sidebarOpen && desktop && (
        <aside className="w-[270px] shrink-0 border-r border-line">
          <SidebarWithChat chat={chat} onClose={() => setSidebarOpen(false)} onPicked={() => setChatOpen(true)} />
        </aside>
      )}
      {sidebarOpen && !desktop && (
        <div className="anim-fade fixed inset-0 z-40 flex bg-black/60" onMouseDown={(e) => e.target === e.currentTarget && setSidebarOpen(false)}>
          <aside className="h-full w-[82%] max-w-[300px] border-r border-line shadow-2xl">
            <SidebarWithChat
              chat={chat}
              onClose={() => setSidebarOpen(false)}
              onPicked={() => {
                setChatOpen(true);
                setSidebarOpen(false);
              }}
            />
          </aside>
        </div>
      )}

      <main className="relative min-w-0 flex-1 overflow-hidden">
        <Brain
          graph={graph}
          error={graphError}
          onRetry={refreshGraph}
          focusFolderId={focusFolderId}
          onFocusFolder={setFocusFolderId}
          onOpenNote={openNote}
          highlightIds={highlightIds}
          onDropFiles={(files, folderId) => stage(files, folderId)}
        />

        {!sidebarOpen && (
          <button className="icon-btn absolute left-3 top-3 z-20 h-10 w-10 bg-panel/80 backdrop-blur" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
            <PanelLeft size={19} />
          </button>
        )}

        {focusFolderId && idx.folderById.get(focusFolderId) && (
          <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2">
            <button className="rounded-full border border-line bg-panel/90 px-3.5 py-1.5 text-xs text-zinc-300 backdrop-blur hover:bg-hover" onClick={() => setFocusFolderId(null)}>
              Focused on {idx.folderById.get(focusFolderId)!.path} · click to clear
            </button>
          </div>
        )}

        {empty && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="anim-pop max-w-md rounded-2xl border border-line bg-panel/95 p-7 text-center shadow-2xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.png" alt="" width={56} height={56} className="mx-auto rounded-xl" />
              <h1 className="mt-4 text-xl font-semibold">Your wiki is empty</h1>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Add documents and Crow reads each one, writes notes, and files them into folders. They appear here as a brain you can explore and chat with.
              </p>
              <ul className="mt-4 space-y-1.5 text-left text-sm text-zinc-300">
                <li>Drop files or a whole folder anywhere on this window.</li>
                <li>Or use the + next to the question box.</li>
                <li>You always see an estimated cost before anything starts.</li>
              </ul>
              <div className="mt-5 flex justify-center gap-2">
                <button className="btn btn-primary" onClick={() => setAddOpen(true)}>
                  <Upload size={16} /> Add documents
                </button>
              </div>
            </div>
          </div>
        )}

        {!chatOpen && (
          <button
            className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-full border border-line bg-panel/90 px-4 py-2 text-sm backdrop-blur hover:bg-hover"
            onClick={() => setChatOpen(true)}
          >
            <MessageSquare size={15} /> Chat
          </button>
        )}
        {chatOpen && (
          <div className="anim-pop absolute inset-x-3 bottom-[92px] top-3 z-30 md:inset-x-auto md:right-4 md:top-4 md:w-[420px] lg:w-[440px]">
            <ChatPanel
              title={activeTitle}
              hasChat={!!chat.activeId}
              messages={chat.messages}
              loading={chat.loadingChat}
              error={chat.chatError}
              busy={chat.busy}
              resolveTitle={resolveTitle}
              resolveWiki={resolveWiki}
              onOpenNote={openNote}
              onHoverNote={setHoverId}
              onRegenerate={chat.regenerate}
              onCollapse={() => setChatOpen(false)}
              onRename={(t) => chat.activeId && chat.rename(chat.activeId, t)}
              onDelete={() => chat.activeId && chat.remove(chat.activeId)}
              onSuggest={send}
            />
          </div>
        )}

        <div className="absolute inset-x-3 bottom-4 z-40 mx-auto max-w-2xl">
          <Composer busy={chat.busy} onSend={send} onStop={chat.stop} onAdd={() => setAddOpen(true)} />
        </div>

        {ingest.items.length > 0 && (
          <div className="absolute bottom-[92px] left-3 right-3 z-20 md:bottom-4 md:right-auto md:left-4">
            <IngestPanel
              items={ingest.items}
              paused={ingest.paused}
              limitMessage={ingest.limitMessage}
              onPause={ingest.pause}
              onResume={ingest.resume}
              onRetry={ingest.retryFailed}
              onDismiss={ingest.clear}
            />
          </div>
        )}

        {windowDrag && <div className="pointer-events-none absolute inset-2 z-10 rounded-2xl border-2 border-dashed border-accent/30" />}
      </main>

      {addOpen && (
        <AddDocuments
          staged={staged}
          folders={graph?.folders ?? []}
          onClose={closeAdd}
          onAddFiles={(files) => stage(files)}
          onRemoveFile={(f) => setStaged((s) => ({ ...s, files: s.files.filter((x) => x !== f) }))}
          onFolderChange={(id) => setStaged((s) => ({ ...s, folderId: id }))}
          onStart={() => {
            ingest.enqueue(staged.files, staged.folderId);
            closeAdd();
          }}
        />
      )}

      {openNoteId && (
        <NoteModal id={openNoteId} onClose={() => setOpenNoteId(null)} onOpenNote={openNote} resolveWiki={resolveWiki} onChanged={refreshGraph} />
      )}
    </div>
  );
}

function SidebarWithChat({ chat, onClose, onPicked }: { chat: ReturnType<typeof useChat>; onClose: () => void; onPicked: () => void }) {
  return (
    <Sidebar
      chats={chat.chats}
      error={chat.chatsError}
      activeId={chat.activeId}
      onSelect={(id) => {
        void chat.select(id);
        onPicked();
      }}
      onNew={() => {
        chat.newChat();
        onPicked();
      }}
      onRename={chat.rename}
      onDelete={chat.remove}
      onClose={onClose}
    />
  );
}
