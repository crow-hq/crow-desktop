"use client";
import { ChevronRight, FileText, Folder as FolderIcon, Link2, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Note } from "@/lib/types";
import { del, errMsg, get, patch } from "./api";
import { Markdown } from "./markdown";
import { Modal, Spinner } from "./modal";

type Detail = {
  note: Note;
  folder_path: string;
  sources: { id: string; filename: string }[];
  backlinks: { id: string; title: string }[];
};

export function NoteModal({
  id,
  onClose,
  onOpenNote,
  resolveWiki,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  resolveWiki: (title: string) => string | undefined;
  /** Called after a save or delete so the brain can refresh. */
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setDetail(null);
    setError(null);
    setEditing(false);
    setConfirmDelete(false);
    setSaveError(null);
    try {
      setDetail(await get<Detail>(`/api/notes/${id}`));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    if (!detail) return;
    setTitle(detail.note.title);
    setContent(detail.note.content);
    setSaveError(null);
    setEditing(true);
  };

  const save = async () => {
    if (!detail || !title.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await patch<{ note: Note }>(`/api/notes/${id}`, { title: title.trim(), content });
      setDetail({ ...detail, note: r.note });
      setEditing(false);
      onChanged();
    } catch (e) {
      setSaveError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await del(`/api/notes/${id}`);
      onChanged();
      onClose();
    } catch (e) {
      setSaveError(errMsg(e));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const crumbs = detail?.folder_path.split("/").filter(Boolean) ?? [];

  return (
    <Modal
      title={editing ? "Edit note" : (detail?.note.title ?? (error ? "Note" : "Loading…"))}
      onClose={onClose}
      footer={
        detail && (
          <>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">Delete this note for good?</span>
                <button className="btn btn-ghost !py-1.5" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Cancel
                </button>
                <button className="btn bg-red-500/90 text-white hover:bg-red-500 !py-1.5" onClick={remove} disabled={deleting}>
                  {deleting ? <Spinner size={14} /> : <Trash2 size={14} />} Delete
                </button>
              </div>
            ) : (
              <button className="btn btn-danger bg-raised" onClick={() => setConfirmDelete(true)} disabled={editing}>
                <Trash2 size={15} /> Delete note
              </button>
            )}
            {editing ? (
              <div className="flex gap-2">
                <button className="btn btn-ghost" onClick={() => setEditing(false)} disabled={saving}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={save} disabled={saving || !title.trim()}>
                  {saving && <Spinner size={14} />} Save
                </button>
              </div>
            ) : (
              <button className="btn btn-ghost" onClick={startEdit}>
                <Pencil size={14} /> Edit
              </button>
            )}
          </>
        )
      }
    >
      {!detail && !error && (
        <div className="flex justify-center py-16">
          <Spinner size={22} />
        </div>
      )}
      {error && (
        <div className="py-8 text-center">
          <p className="text-sm text-danger">{error}</p>
          <button className="btn btn-ghost mt-3" onClick={load}>
            Try again
          </button>
        </div>
      )}
      {detail && (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-1 text-sm text-muted">
            <FolderIcon size={15} className="mr-1" />
            {crumbs.length === 0 && <span>Wiki</span>}
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight size={13} />}
                {c}
              </span>
            ))}
          </div>
          {saveError && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-sm text-red-300">{saveError}</p>}
          {editing ? (
            <div className="space-y-3">
              <input className="input text-base" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" aria-label="Title" />
              <textarea
                className="input min-h-[42dvh] resize-y font-mono text-[13px] leading-relaxed"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
                aria-label="Markdown content"
              />
              <p className="text-xs text-muted">Markdown. Link to other notes with [[Note title]].</p>
            </div>
          ) : (
            <Markdown text={detail.note.content} resolveWiki={resolveWiki} onOpenNote={onOpenNote} />
          )}

          {!editing && detail.sources.length > 0 && (
            <section className="mt-7 border-t border-line pt-5">
              <h3 className="label mb-3">Filed from</h3>
              <ul className="space-y-1">
                {detail.sources.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <FileText size={16} className="shrink-0 text-muted" />
                      <span className="truncate">{s.filename}</span>
                    </span>
                    <a className="shrink-0 text-accent hover:underline" href={`/api/sources/${s.id}`} target="_blank" rel="noopener noreferrer">
                      Open
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!editing && detail.backlinks.length > 0 && (
            <section className="mt-6 border-t border-line pt-5">
              <h3 className="label mb-3">Linked from</h3>
              <div className="flex flex-wrap gap-2">
                {detail.backlinks.map((b) => (
                  <button key={b.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 py-1 text-sm text-zinc-200 hover:bg-hover" onClick={() => onOpenNote(b.id)}>
                    <Link2 size={13} className="text-muted" /> {b.title}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}
