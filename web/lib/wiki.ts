import type { Db } from "@/lib/supabase/server";
import type { Folder, Note } from "@/lib/types";

// Data helpers for the wiki. All of them run as the signed-in user (RLS applies).

export function normalizePath(path: string): string {
  return path
    .split("/")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("/");
}

export async function listFolders(db: Db): Promise<Folder[]> {
  const { data, error } = await db.from("folders").select("id, parent_id, name, path, summary").order("path");
  if (error) throw error;
  return data;
}

// Returns the folder at `path`, creating it and any missing parents.
export async function ensureFolder(db: Db, path: string): Promise<Folder> {
  const parts = normalizePath(path).split("/").filter(Boolean);
  if (parts.length === 0) throw new Error("A folder path is required");
  let parent = null as Folder | null;
  for (let i = 0; i < parts.length; i++) {
    const p = parts.slice(0, i + 1).join("/");
    const { data: existing } = await db
      .from("folders")
      .select("id, parent_id, name, path, summary")
      .eq("path", p)
      .maybeSingle();
    if (existing) {
      parent = existing;
      continue;
    }
    const parentId: string | null = parent ? parent.id : null;
    const { data: created, error } = await db
      .from("folders")
      .insert({ path: p, name: parts[i], parent_id: parentId })
      .select("id, parent_id, name, path, summary")
      .single();
    if (error) {
      // Another request created it first.
      const { data: raced } = await db
        .from("folders")
        .select("id, parent_id, name, path, summary")
        .eq("path", p)
        .single();
      if (!raced) throw error;
      parent = raced;
    } else {
      parent = created;
    }
  }
  return parent!;
}

// The folder tree as indented text, for prompts: "Trips/Japan 2026 (4 notes): summary".
export async function folderTreeText(db: Db): Promise<string> {
  const folders = await listFolders(db);
  if (folders.length === 0) return "(the wiki is empty: no folders yet)";
  const { data: counts } = await db.from("notes").select("folder_id");
  const perFolder = new Map<string, number>();
  for (const row of counts ?? []) perFolder.set(row.folder_id, (perFolder.get(row.folder_id) ?? 0) + 1);
  return folders
    .map((f) => {
      const depth = f.path.split("/").length - 1;
      const n = perFolder.get(f.id) ?? 0;
      return `${"  ".repeat(depth)}${f.path} (${n} notes)${f.summary ? `: ${f.summary}` : ""}`;
    })
    .join("\n");
}

export async function getNote(db: Db, id: string): Promise<Note | null> {
  const { data } = await db
    .from("notes")
    .select("id, folder_id, title, summary, content, updated_at")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function getNotes(db: Db, ids: string[]): Promise<Note[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("notes")
    .select("id, folder_id, title, summary, content, updated_at")
    .in("id", ids);
  if (error) throw error;
  return data;
}

export type SearchHit = { id: string; title: string; summary: string; folder_id: string; rank: number };

export async function searchNotes(db: Db, query: string, max = 12): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const { data, error } = await db.rpc("search_notes", { q: query, max_results: max });
  if (error) throw error;
  return data ?? [];
}

// The [[Title]] links in a note's Markdown. "[[Title|label]]" links to "Title".
export function extractLinks(markdown: string): string[] {
  const titles = new Set<string>();
  for (const m of markdown.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) titles.add(m[1].trim());
  return [...titles];
}

// Rewrites the note_links rows of a note from the [[links]] in its content.
export async function syncLinks(db: Db, noteId: string, content: string) {
  await db.from("note_links").delete().eq("from_note", noteId);
  const titles = extractLinks(content);
  if (titles.length === 0) return;
  const { data: targets } = await db.from("notes").select("id, title").in("title", titles);
  const rows = (targets ?? []).filter((t) => t.id !== noteId).map((t) => ({ from_note: noteId, to_note: t.id }));
  if (rows.length) await db.from("note_links").upsert(rows, { ignoreDuplicates: true });
}

// Creates the note, or updates the note with that id. Keeps links and source links in step.
export async function saveNote(
  db: Db,
  note: { id?: string; folder_id: string; title: string; summary: string; content: string },
  sourceId?: string,
): Promise<Note> {
  const row = {
    folder_id: note.folder_id,
    title: note.title.trim(),
    summary: note.summary.trim(),
    content: note.content,
    updated_at: new Date().toISOString(),
  };
  const query = note.id
    ? db.from("notes").update(row).eq("id", note.id)
    : db.from("notes").insert(row);
  const { data, error } = await query.select("id, folder_id, title, summary, content, updated_at").single();
  if (error) throw error;
  await syncLinks(db, data.id, data.content);
  if (!note.id) {
    // Older notes may already link to this title: [[Title]] or [[Title|label]].
    const { data: linking } = await db
      .from("notes")
      .select("id, content")
      .neq("id", data.id)
      .ilike("content", `%[[${data.title.replace(/[%_\\]/g, "\\$&")}%`);
    const rows = (linking ?? [])
      .filter((n) => extractLinks(n.content).includes(data.title))
      .map((n) => ({ from_note: n.id, to_note: data.id }));
    if (rows.length) await db.from("note_links").upsert(rows, { ignoreDuplicates: true });
  }
  if (sourceId) {
    await db.from("note_sources").upsert({ note_id: data.id, source_id: sourceId }, { ignoreDuplicates: true });
  }
  return data;
}

// A title not used by any other note: "Budget", then "Budget (2)", ...
export async function uniqueTitle(db: Db, title: string, exceptId?: string): Promise<string> {
  const base = title.trim() || "Untitled";
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base} (${i})`;
    let q = db.from("notes").select("id").eq("title", candidate);
    if (exceptId) q = q.neq("id", exceptId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
  }
  return `${base} (${Date.now()})`;
}
