"use client";
import { AlertCircle, Check, ChevronsRight, Copy, MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "./markdown";
import { Spinner } from "./modal";
import { useOnClickOutside } from "./hooks";
import type { UiMessage } from "./use-chat";
import { plainAnswer, timeAgo } from "./util";

type Props = {
  title: string | null;
  hasChat: boolean;
  messages: UiMessage[];
  loading: boolean;
  error: string | null;
  busy: boolean;
  resolveTitle: (id: string) => string | undefined;
  resolveWiki: (title: string) => string | undefined;
  onOpenNote: (id: string) => void;
  onHoverNote: (id: string | null) => void;
  onRegenerate: () => void;
  onCollapse: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onSuggest: (q: string) => void;
};

export function ChatPanel(p: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const menuRef = useOnClickOutside<HTMLDivElement>(() => {
    setMenu(false);
    setConfirm(false);
  }, menu);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [p.messages]);

  const lastAssistant = [...p.messages].reverse().find((m) => m.role === "assistant");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-line bg-white">
      <div className="relative flex items-center gap-2 border-b border-line px-4 py-3">
        {renaming ? (
          <input
            autoFocus
            defaultValue={p.title ?? ""}
            className="input !py-1"
            onBlur={() => setRenaming(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setRenaming(false);
              if (e.key === "Enter") {
                p.onRename((e.target as HTMLInputElement).value);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">{p.title ?? "New chat"}</h2>
        )}
        {p.hasChat && !renaming && (
          <div className="relative" ref={menuRef}>
            <button className="icon-btn" aria-label="Chat options" onClick={() => setMenu((m) => !m)}>
              <MoreHorizontal size={18} />
            </button>
            {menu && (
              <div className="anim-pop absolute right-0 top-9 z-30 w-40 overflow-hidden rounded-[10px] border border-line bg-white py-1">
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-hover"
                  onClick={() => {
                    setMenu(false);
                    setRenaming(true);
                  }}
                >
                  <Pencil size={14} /> Rename
                </button>
                <button
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-hover"
                  onClick={() => {
                    if (confirm) {
                      setMenu(false);
                      setConfirm(false);
                      p.onDelete();
                    } else setConfirm(true);
                  }}
                >
                  <Trash2 size={14} /> {confirm ? "Click to confirm" : "Delete chat"}
                </button>
              </div>
            )}
          </div>
        )}
        <button className="btn btn-ghost !px-3 !py-1.5" onClick={p.onCollapse}>
          <span className="hidden sm:inline">Collapse</span>
          <ChevronsRight size={16} className="sm:hidden" />
        </button>
      </div>

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {p.loading && (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        )}
        {p.error && (
          <div className="notice-error flex items-start gap-2 p-3 text-sm">
            <AlertCircle size={16} className="mt-0.5 shrink-0" /> {p.error}
          </div>
        )}
        {!p.loading && !p.error && p.messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-8 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/system1-symbol-on-white.svg" alt="" style={{ height: 44, width: "auto" }} />
            <div>
              <p className="text-2xl font-bold text-pink">Ask your wiki anything</p>
              <p className="mt-1 text-sm text-muted">Answers cite the notes they came from.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {["What is in my wiki?", "Summarise the most recent documents", "What deadlines are coming up?"].map((q) => (
                <button key={q} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs text-ink hover:border-pink hover:bg-pink-100" onClick={() => p.onSuggest(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-5">
          {p.messages.map((m) => (
            <MessageRow key={m.id} m={m} p={p} isLast={m === lastAssistant} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageRow({ m, p, isLast }: { m: UiMessage; p: Props; isLast: boolean }) {
  const [copied, setCopied] = useState(false);
  const user = m.role === "user";
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">
        {user ? (
          <div className="h-[22px] w-[22px] rounded-full bg-pink-100" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/brand/system1-symbol-on-white.svg" alt="" style={{ height: 20, width: "auto" }} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold">{user ? "You" : "Answer"}</span>
          <span className="text-xs text-muted">{timeAgo(m.created_at)}</span>
        </div>
        {!user && m.search_query && <p className="mt-1 flex items-center gap-2 text-[13px] leading-snug text-muted"><span className="tag">Searched</span><span className="min-w-0">{m.search_query}</span></p>}
        {user ? (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.content}</p>
        ) : (
          <>
            {m.content ? (
              <Markdown
                text={m.content}
                streaming={m.streaming}
                resolveTitle={p.resolveTitle}
                resolveWiki={p.resolveWiki}
                onOpenNote={p.onOpenNote}
                onHoverNote={p.onHoverNote}
              />
            ) : (
              m.streaming && (
                <div className="mt-2 flex gap-1" aria-label="Thinking">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              )
            )}
            {m.error && (
              <div className="notice-error mt-2 flex items-start gap-2 p-2.5 text-sm">
                <AlertCircle size={15} className="mt-0.5 shrink-0" /> {m.error}
              </div>
            )}
            {!m.streaming && (m.content || m.error) && (
              <div className="mt-2 flex items-center gap-1 text-muted">
                {m.content && (
                  <button
                    className="icon-btn h-7 w-7"
                    title="Copy"
                    aria-label="Copy answer"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(plainAnswer(m.content, p.resolveTitle));
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      } catch {}
                    }}
                  >
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                )}
                {isLast && (
                  <button className="icon-btn h-7 w-7" title="Regenerate" aria-label="Regenerate answer" onClick={p.onRegenerate} disabled={p.busy}>
                    <RefreshCw size={15} />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
