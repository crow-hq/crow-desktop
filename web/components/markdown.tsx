"use client";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useMemo } from "react";

type Props = {
  text: string;
  /** Title of a cited note (`[[note:<uuid>]]`). */
  resolveTitle?: (id: string) => string | undefined;
  /** Note id for a `[[Title]]` wiki link. */
  resolveWiki?: (title: string) => string | undefined;
  onOpenNote?: (id: string) => void;
  onHoverNote?: (id: string | null) => void;
  streaming?: boolean;
};

const esc = (s: string) => s.replace(/[[\]\\]/g, "\\$&");

function preprocess(text: string, streaming: boolean): string {
  let t = text;
  // Hide a half-streamed marker like "[[note:3f2" until it completes.
  if (streaming) t = t.replace(/\[\[[^\]\n]{0,60}$/, "").replace(/\[$/, "");
  t = t.replace(/\[\[note:([0-9a-fA-F-]{36})\]\]/g, (_, id) => `[note](#note:${id})`);
  t = t.replace(/\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/g, (_, title: string, alias?: string) => {
    return `[${esc((alias ?? title).trim())}](#wiki:${encodeURIComponent(title.trim())})`;
  });
  return t;
}

export function Markdown({ text, resolveTitle, resolveWiki, onOpenNote, onHoverNote, streaming = false }: Props) {
  const source = useMemo(() => preprocess(text, streaming), [text, streaming]);
  const components: Components = useMemo(
    () => ({
      a({ href, children }) {
        const h = href ?? "";
        if (h.startsWith("#note:")) {
          const id = h.slice(6);
          const title = resolveTitle?.(id);
          return (
            <button
              type="button"
              className="chip"
              title={title ?? "Open note"}
              onMouseEnter={() => onHoverNote?.(id)}
              onMouseLeave={() => onHoverNote?.(null)}
              onFocus={() => onHoverNote?.(id)}
              onBlur={() => onHoverNote?.(null)}
              onClick={() => onOpenNote?.(id)}
            >
              {title ?? "Note"}
            </button>
          );
        }
        if (h.startsWith("#wiki:")) {
          const title = decodeURIComponent(h.slice(6));
          const id = resolveWiki?.(title);
          if (!id) return <span className="wiki-missing" title="No note with this title">{children}</span>;
          return (
            <a
              className="wiki"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onOpenNote?.(id);
              }}
            >
              {children}
            </a>
          );
        }
        if (/^(https?:|mailto:)/i.test(h)) {
          return (
            <a className="ext" href={h} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        }
        return <span>{children}</span>;
      },
      table({ children }) {
        return (
          <div className="table-wrap">
            <table>{children}</table>
          </div>
        );
      },
    }),
    [resolveTitle, resolveWiki, onOpenNote, onHoverNote],
  );
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={(u) => u}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
