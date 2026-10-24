"use client";
import { ArrowUp, Plus, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function Composer({
  busy,
  onSend,
  onStop,
  onAdd,
  prefill,
}: {
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onAdd: () => void;
  prefill?: { text: string; n: number } | null;
}) {
  const [text, setText] = useState("");
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [text]);

  useEffect(() => {
    if (prefill) {
      setText(prefill.text);
      ta.current?.focus();
    }
  }, [prefill]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText("");
  };

  return (
    <div className="flex items-end gap-2 rounded-[28px] border border-line bg-panel/95 py-2 pl-2 pr-2 shadow-2xl shadow-black/50 backdrop-blur focus-within:border-zinc-600">
      <button className="icon-btn h-10 w-10 shrink-0 rounded-full" onClick={onAdd} aria-label="Add documents" title="Add documents">
        <Plus size={22} />
      </button>
      <textarea
        ref={ta}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Ask the wiki…"
        className="max-h-40 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-5 text-fg placeholder:text-muted focus:outline-none"
      />
      {busy ? (
        <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-raised text-fg hover:bg-hover" onClick={onStop} aria-label="Stop" title="Stop">
          <Square size={14} fill="currentColor" />
        </button>
      ) : (
        <button
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:bg-blue-500 disabled:opacity-40"
          onClick={submit}
          disabled={!text.trim()}
          aria-label="Send"
        >
          <ArrowUp size={20} />
        </button>
      )}
    </div>
  );
}
