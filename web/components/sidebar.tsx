"use client";
import { MoreHorizontal, PanelLeft, Pencil, Plus, Settings, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Chat } from "@/lib/types";
import { useOnClickOutside } from "./hooks";
import { cn } from "./util";

type Props = {
  chats: Chat[] | null;
  error: string | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export function Sidebar({ chats, error, activeId, onSelect, onNew, onRename, onDelete, onClose }: Props) {
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const menuRef = useOnClickOutside<HTMLDivElement>(() => {
    setMenuId(null);
    setConfirmId(null);
  }, menuId !== null);

  return (
    <div className="flex h-full w-full flex-col bg-bg">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={22} height={22} className="rounded" />
          <span className="text-sm font-semibold tracking-wide">Crow</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Collapse sidebar" title="Collapse sidebar">
          <PanelLeft size={18} />
        </button>
      </div>
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <span className="label">Chats</span>
        <button className="icon-btn -mr-1.5" onClick={onNew} aria-label="New chat" title="New chat">
          <Plus size={18} />
        </button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {chats === null && (
          <div className="space-y-2 px-2.5 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-raised" style={{ width: `${85 - i * 12}%` }} />
            ))}
          </div>
        )}
        {error && <p className="px-2.5 py-2 text-xs text-danger">{error}</p>}
        {chats?.length === 0 && !error && <p className="px-2.5 py-2 text-sm text-muted">No chats yet. Ask the wiki something.</p>}
        {chats?.map((c) => {
          const active = c.id === activeId;
          if (renaming === c.id)
            return (
              <RenameInput
                key={c.id}
                initial={c.title}
                onDone={(v) => {
                  setRenaming(null);
                  if (v && v !== c.title) onRename(c.id, v);
                }}
              />
            );
          return (
            <div key={c.id} className="group relative">
              <button
                onClick={() => onSelect(c.id)}
                className={cn(
                  "w-full truncate rounded-lg px-3 py-2 pr-9 text-left text-sm transition-colors",
                  active ? "bg-raised text-fg" : "text-zinc-300 hover:bg-hover",
                )}
                title={c.title}
              >
                {c.title || "Untitled chat"}
              </button>
              <button
                className={cn(
                  "icon-btn absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2",
                  menuId === c.id ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100",
                )}
                aria-label="Chat options"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmId(null);
                  setMenuId(menuId === c.id ? null : c.id);
                }}
              >
                <MoreHorizontal size={16} />
              </button>
              {menuId === c.id && (
                <div ref={menuRef} className="anim-pop absolute right-1 top-9 z-30 w-40 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-xl">
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-hover"
                    onClick={() => {
                      setMenuId(null);
                      setRenaming(c.id);
                    }}
                  >
                    <Pencil size={14} /> Rename
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-hover"
                    onClick={() => {
                      if (confirmId === c.id) {
                        setMenuId(null);
                        setConfirmId(null);
                        onDelete(c.id);
                      } else setConfirmId(c.id);
                    }}
                  >
                    <Trash2 size={14} /> {confirmId === c.id ? "Click to confirm" : "Delete"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-line p-2.5">
        <Link href="/settings" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-hover hover:text-fg">
          <Settings size={18} /> Settings
        </Link>
      </div>
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      defaultValue={initial}
      className="input my-0.5 !py-1.5"
      maxLength={120}
      onBlur={(e) => onDone(e.target.value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onDone((e.target as HTMLInputElement).value.trim() || null);
        if (e.key === "Escape") onDone(null);
      }}
    />
  );
}
