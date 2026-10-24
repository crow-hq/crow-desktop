"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Chat, ChatEvent, Message } from "@/lib/types";
import { del, errMsg, errorFrom, get, patch } from "./api";

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  search_query: string | null;
  cited_note_ids: string[];
  created_at: string;
  streaming?: boolean;
  error?: string;
};

const tmpId = () => `tmp-${Math.random().toString(36).slice(2)}`;

export function useChat() {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  activeRef.current = activeId;

  const refreshChats = useCallback(async () => {
    try {
      setChats(await get<Chat[]>("/api/chats"));
      setChatsError(null);
    } catch (e) {
      setChatsError(errMsg(e));
      setChats((c) => c ?? []);
    }
  }, []);

  useEffect(() => {
    void refreshChats();
  }, [refreshChats]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setChatError(null);
  }, []);

  const select = useCallback(async (id: string) => {
    abortRef.current?.abort();
    setActiveId(id);
    setMessages([]);
    setChatError(null);
    setLoadingChat(true);
    try {
      const r = await get<{ chat: Chat; messages: Message[] }>(`/api/chats/${id}`);
      if (activeRef.current !== id) return;
      setMessages(r.messages.map((m) => ({ ...m, cited_note_ids: m.cited_note_ids ?? [] })));
    } catch (e) {
      if (activeRef.current === id) setChatError(errMsg(e));
    } finally {
      if (activeRef.current === id) setLoadingChat(false);
    }
  }, []);

  const send = useCallback(
    async (text: string, opts: { regenerate?: boolean } = {}) => {
      const message = text.trim();
      if (!message || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setChatError(null);
      const now = new Date().toISOString();
      const aId = tmpId();
      setMessages((m) => [
        ...m,
        { id: tmpId(), role: "user", content: message, search_query: null, cited_note_ids: [], created_at: now },
        { id: aId, role: "assistant", content: "", search_query: null, cited_note_ids: [], created_at: now, streaming: true },
      ]);
      const patchA = (p: Partial<UiMessage>) => setMessages((ms) => ms.map((m) => (m.id === aId ? { ...m, ...p } : m)));
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let acc = "";
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: activeRef.current ?? undefined, message, regenerate: opts.regenerate }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw await errorFrom(res);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        const handle = (line: string) => {
          if (!line.trim()) return;
          let ev: ChatEvent;
          try {
            ev = JSON.parse(line);
          } catch {
            return;
          }
          if (ev.type === "search") {
            setTitles((t) => {
              const n = { ...t };
              for (const x of ev.notes) n[x.id] = x.title;
              return n;
            });
            patchA({ search_query: ev.query });
          } else if (ev.type === "delta") {
            acc += ev.text;
            patchA({ content: acc });
          } else if (ev.type === "done") {
            patchA({ id: ev.message_id, cited_note_ids: ev.cited_note_ids, streaming: false });
            if (activeRef.current !== ev.chat_id) setActiveId(ev.chat_id);
            activeRef.current = ev.chat_id;
            void refreshChats();
          } else if (ev.type === "error") {
            patchA({ error: ev.message, streaming: false });
          }
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          lines.forEach(handle);
        }
        buf += dec.decode();
        handle(buf);
        patchA({ streaming: false });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") patchA({ streaming: false });
        else patchA({ error: errMsg(e), streaming: false });
      } finally {
        busyRef.current = false;
        setBusy(false);
        abortRef.current = null;
        void refreshChats();
      }
    },
    [refreshChats],
  );

  const regenerate = useCallback(() => {
    if (busyRef.current) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Drop the last question and its answer: send() adds the question back and the server replaces both.
    setMessages((ms) => ms.slice(0, ms.lastIndexOf(lastUser)));
    void send(lastUser.content, { regenerate: true });
  }, [messages, send]);

  const rename = useCallback(
    async (id: string, title: string) => {
      const t = title.trim();
      if (!t) return;
      setChats((cs) => cs?.map((c) => (c.id === id ? { ...c, title: t } : c)) ?? cs);
      try {
        await patch(`/api/chats/${id}`, { title: t });
      } catch (e) {
        setChatsError(errMsg(e));
        void refreshChats();
      }
    },
    [refreshChats],
  );

  const remove = useCallback(
    async (id: string) => {
      setChats((cs) => cs?.filter((c) => c.id !== id) ?? cs);
      if (activeRef.current === id) newChat();
      try {
        await del(`/api/chats/${id}`);
      } catch (e) {
        setChatsError(errMsg(e));
        void refreshChats();
      }
    },
    [newChat, refreshChats],
  );

  return { chats, chatsError, activeId, messages, loadingChat, chatError, busy, titles, send, stop, regenerate, select, newChat, rename, remove };
}
