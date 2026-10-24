import JSZip from "jszip";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { listFolders } from "@/lib/wiki";
import type { Folder } from "@/lib/types";

export const runtime = "nodejs";

// Makes a name safe as a file or folder name on every common system.
function safe(name: string): string {
  return name.replace(/[\/\\:*?"<>|]/g, "-").trim() || "untitled";
}

// A folder path such as "Trips/Japan 2026" as a relative directory path.
function safePath(path: string): string {
  return path.split("/").map(safe).join("/");
}

// Quotes a value as a YAML string.
function yamlString(value: string): string {
  return JSON.stringify(value);
}

type NoteRow = {
  id: string;
  folder_id: string;
  title: string;
  summary: string;
  content: string;
  updated_at: string;
};

// Builds a zip of the whole wiki as Markdown files, laid out like an Obsidian vault.
export async function GET() {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  try {
    const folders = await listFolders(db);
    const [notesRes, sourcesRes] = await Promise.all([
      db.from("notes").select("id, folder_id, title, summary, content, updated_at").order("title"),
      db.from("note_sources").select("note_id, sources(filename)"),
    ]);
    if (notesRes.error) throw notesRes.error;
    if (sourcesRes.error) throw sourcesRes.error;

    const notes = (notesRes.data ?? []) as NoteRow[];

    const sourcesByNote = new Map<string, string[]>();
    for (const row of sourcesRes.data ?? []) {
      // The embedded source is a single row; the untyped client may report it as an array.
      const raw = row.sources as unknown;
      const sources = (Array.isArray(raw) ? raw : [raw]) as ({ filename: string } | null)[];
      const list = sourcesByNote.get(row.note_id as string) ?? [];
      for (const source of sources) if (source) list.push(source.filename);
      sourcesByNote.set(row.note_id as string, list);
    }

    const folderById = new Map<string, Folder>(folders.map((f) => [f.id, f]));
    const childFolders = new Map<string | null, Folder[]>();
    for (const f of folders) {
      const list = childFolders.get(f.parent_id) ?? [];
      list.push(f);
      childFolders.set(f.parent_id, list);
    }
    const notesByFolder = new Map<string, NoteRow[]>();
    for (const n of notes) {
      const list = notesByFolder.get(n.folder_id) ?? [];
      list.push(n);
      notesByFolder.set(n.folder_id, list);
    }

    const zip = new JSZip();

    // Root index: the top-level folders.
    const rootLines = ["# Crow wiki", ""];
    for (const f of childFolders.get(null) ?? []) {
      rootLines.push(`- [${f.name}](${encodeURI(safePath(f.path))}/index.md)`);
    }
    zip.file("index.md", rootLines.join("\n") + "\n");

    for (const folder of folders) {
      const dir = safePath(folder.path);

      const lines = [`# ${folder.name}`, ""];
      if (folder.summary) lines.push(folder.summary, "");

      const subfolders = childFolders.get(folder.id) ?? [];
      const folderNotes = notesByFolder.get(folder.id) ?? [];
      if (subfolders.length) {
        lines.push("## Folders", "");
        for (const sub of subfolders) lines.push(`- [${sub.name}](${encodeURI(safe(sub.name))}/index.md)`);
        lines.push("");
      }
      if (folderNotes.length) {
        lines.push("## Notes", "");
        for (const n of folderNotes) lines.push(`- [[${n.title}]]`);
        lines.push("");
      }
      zip.file(`${dir}/index.md`, lines.join("\n"));
    }

    for (const note of notes) {
      const folder = folderById.get(note.folder_id);
      if (!folder) continue;
      const sources = sourcesByNote.get(note.id) ?? [];
      const frontmatter = [
        "---",
        `title: ${yamlString(note.title)}`,
        `summary: ${yamlString(note.summary)}`,
        `updated: ${yamlString(note.updated_at)}`,
        sources.length ? "sources:" : "sources: []",
        ...sources.map((s) => `  - ${yamlString(s)}`),
        "---",
        "",
      ];
      zip.file(`${safePath(folder.path)}/${safe(note.title)}.md`, frontmatter.join("\n") + note.content + "\n");
    }

    const bytes = await zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="crow-wiki-${date}.zip"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not build the export";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
