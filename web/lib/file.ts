import type { Db } from "@/lib/supabase/server";
import type { Folder, IngestResult } from "@/lib/types";
import { complete, completeJson, getSettings, SpendLimitError } from "@/lib/openrouter";
import { extractText } from "@/lib/extract";
import { ensureFolder, folderTreeText, getNotes, normalizePath, saveNote, searchNotes, uniqueTitle } from "@/lib/wiki";

// The filing pipeline: read an uploaded document once, decide where it belongs, and write it into the
// wiki as a Markdown note, merging into an existing note when it is about the same subject.

const WRITER_CHARS = 80_000;
const ROUTER_CHARS = 6_000;
const MAX_NOTES_PER_FOLDER = 15;

// ---------------------------------------------------------------- prompts

const ROUTE_PROMPT = `You are the librarian of a private personal wiki. A new document has arrived and you decide where it is filed.

You are given the current folder tree (path, note count, one-line summary), the file name, the section name and an excerpt of the document.

Reply with a JSON object only:
{"folder_path": "Finance/Taxes", "title": "Income tax return 2025", "search_query": "income tax return 2025 declaration"}

Rules for folder_path:
- Prefer an existing folder from the tree whenever the document plausibly belongs there. Copy its path exactly.
- Create a new folder only when nothing fits. A new top-level folder is for a genuinely new subject area; otherwise create a subfolder under the closest existing folder.
- Paths have 1 to 3 levels, separated by "/". Names are short, human, Title Case nouns in the language the user's existing folders use ("Finance/Taxes", "Health", "Trips/Japan 2026"). No dates in folder names unless a trip/project/event is named by one. Never use names like "Documents", "Misc", "Other", "Uploads" or the file type.
- Organise by subject (what the document is about), never by format or origin.

Rules for title:
- A specific, human, descriptive note title for the subject, 2 to 8 words, no file extension, no quotes. Name the subject, not the file: "Lease agreement - Rue Lafayette apartment", not "scan_0042".
- If the document is a new version/period of something likely already in the wiki (a later invoice, a newer report), title it by the subject so it can be merged into the existing note.

search_query: 3 to 8 keywords (names, organisations, product, subject, year) that would find an existing note about the same specific subject. No punctuation or operators.`;

const FORCED_ROUTE_PROMPT = `You are the librarian of a private personal wiki. A new document has arrived and the user has already chosen the folder, so do not choose one.

You are given the file name, the section name and an excerpt of the document.

Reply with a JSON object only:
{"title": "Income tax return 2025", "search_query": "income tax return 2025 declaration"}

- title: a specific, human, descriptive note title for the subject, 2 to 8 words, no file extension, no quotes. Name the subject, not the file.
- search_query: 3 to 8 keywords (names, organisations, product, subject, year) that would find an existing note about the same specific subject. No punctuation or operators.`;

const MERGE_PROMPT = `You are the librarian of a private personal wiki. A new document is about to be filed. Decide whether it should be merged into one of the existing notes listed, or become a new note.

Merge ONLY if a candidate is about the very same specific subject as the document (the same contract, the same trip, the same person's record, the same ongoing project, a newer version or later period of the same thing). Being in the same general topic is NOT enough: two different invoices from different companies, or two different trips, are separate notes. When unsure, do not merge.

Reply with a JSON object only: {"merge_into_note_id": "<id of the candidate>"} or {"merge_into_note_id": null}.
The id must be copied exactly from the candidate list.`;

const WRITER_PROMPT = `You are the writer of a private personal wiki that is maintained entirely by you. The user will never read the original document again: your note must preserve every fact worth keeping, so that questions can later be answered from the note alone.

Output format, exactly (no code fences, no preamble):
TITLE: <note title>
SUMMARY: <one sentence saying what this note covers and its most important facts>
---
<note body in Markdown>

Body rules:
- Do NOT start with an H1 heading; the title is stored separately. Use ## and ### for structure when the note is long enough to need it.
- Concise but complete: keep all concrete facts (names, dates, amounts, quantities, identifiers, deadlines, decisions, conditions, figures, quotes that matter). Drop boilerplate, filler, repetition, legal fine print with no consequence, page headers and footers, OCR noise.
- Use tables for tabular or comparable data, bullet lists for enumerations, short paragraphs for explanation. Never invent facts; if something is unclear in the source, say it is unclear.
- Write in the language of the document. Dates in ISO or unambiguous form.
- Link related notes with [[Exact Title]], using ONLY titles from the "Notes you may link to" list, copied exactly, and only where the relation is real. Do not link to the note itself. Do not invent links.
- Do not mention the file name, the upload, or "this document says"; write the note as knowledge, not as a report about a file. You may attribute facts to their source in the text (e.g. "per the 2025 invoice").`;

const MERGE_WRITER_PROMPT = `${WRITER_PROMPT}

You are UPDATING an existing note with a new document about the same subject. Produce the full updated note, not a diff.
- Keep every existing fact unless the new document contradicts or supersedes it. Where facts conflict, the more recent dated fact wins; if dates are unknown, prefer the new document but record the discrepancy.
- Integrate the new information in the right place instead of appending a blob. Merge duplicate facts. Keep a coherent structure.
- Say what changed: add a short "## Changes" section at the end (or extend it) with dated one-line entries such as "2026-03: rent raised from 900 to 950 (new amendment)". Use today's date given below if the document has no date. Keep the section short; trim old entries if it grows beyond about 10 lines.
- Keep the existing TITLE unless it is clearly wrong or too narrow now. Update the SUMMARY so it describes the whole updated note.`;

const FOLDER_SUMMARY_PROMPT = `You write the one-line description of a folder in a personal wiki. You are given the folder path and the titles and summaries of notes in it. Reply with a JSON object only: {"summary": "..."}. The summary is ONE sentence, under 25 words, saying what kind of notes belong in this folder (the subject area, not a list of the notes).`;

const REORGANIZE_PROMPT = `You are the planner of a personal wiki. A folder has grown too large, with too many notes directly inside it. Propose 2 to 6 subfolders that group these notes by subject so each is easy to browse.

You are given the folder path and each note's id, title and summary. Reply with a JSON object only:
{"subfolders": [{"name": "Short Name", "summary": "One sentence on what belongs here.", "note_ids": ["..."]}]}

Rules:
- Names are short, human, Title Case, with no slashes. Group by subject, not by format or date, unless the notes are naturally a time series.
- Each subfolder should hold at least 3 notes. Do not create catch-all folders such as "Misc" or "Other".
- Notes that do not clearly belong to a group must be left out of every list: they stay where they are. A note id appears at most once. Copy ids exactly.
- Do not reuse the name of an existing subfolder unless the notes belong there; existing subfolders are listed.`;

// ---------------------------------------------------------------- helpers

type Hit = { id: string; title: string; summary: string };

function clip(text: string, n: number): string {
  return text.length <= n ? text : text.slice(0, n) + "\n\n[... truncated ...]";
}

function cleanName(name: string): string {
  return name.replace(/[\/\\]/g, "-").replace(/\s+/g, " ").trim().slice(0, 60);
}

function parseWriter(raw: string, fallbackTitle: string): { title: string; summary: string; content: string } {
  let text = raw.trim();
  const fence = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) text = fence[1].trim();
  const sep = text.search(/^\s*---\s*$/m);
  const head = sep >= 0 ? text.slice(0, sep) : "";
  const afterSep = sep >= 0 ? text.slice(sep).replace(/^\s*---\s*\n?/, "") : text;
  const title = head.match(/^\s*TITLE:\s*(.+)$/im)?.[1]?.trim();
  const summary = head.match(/^\s*SUMMARY:\s*(.+)$/im)?.[1]?.trim();
  let content = afterSep.trim();
  // If the model skipped the delimiter, drop any TITLE/SUMMARY lines at the top.
  if (sep < 0) content = content.replace(/^\s*TITLE:.*\n/i, "").replace(/^\s*SUMMARY:.*\n/i, "").trim();
  // The title is stored separately: strip a leading H1.
  content = content.replace(/^#\s+.+\n+/, "").trim();
  return {
    title: (title || fallbackTitle).replace(/^["'*#\s]+|["'*\s]+$/g, "") || fallbackTitle,
    summary: summary || "",
    content,
  };
}

async function folderById(db: Db, id: string): Promise<Folder | null> {
  const { data } = await db.from("folders").select("id, parent_id, name, path, summary").eq("id", id).maybeSingle();
  return data;
}

async function notesInFolder(db: Db, folderId: string) {
  const { data } = await db.from("notes").select("id, title, summary").eq("folder_id", folderId).order("title");
  return (data ?? []) as Hit[];
}

// ---------------------------------------------------------------- one section -> one note

async function fileSection(
  db: Db,
  settings: Awaited<ReturnType<typeof getSettings>>,
  source: { id: string; filename: string; target_folder_id: string | null },
  section: { name: string; text: string },
): Promise<{ noteId: string; folderId: string }> {
  const excerpt = clip(section.text, ROUTER_CHARS);
  const forced = source.target_folder_id ? await folderById(db, source.target_folder_id) : null;

  // 1. Route.
  const docInfo = `File name: ${source.filename}\nSection: ${section.name}\n\nExcerpt:\n${excerpt}`;
  let route: { folder_path?: string; title?: string; search_query?: string };
  if (forced) {
    route = await completeJson({
      db, settings, role: "router", maxTokens: 400,
      messages: [
        { role: "system", content: FORCED_ROUTE_PROMPT },
        { role: "user", content: docInfo },
      ],
    });
  } else {
    const tree = await folderTreeText(db);
    route = await completeJson({
      db, settings, role: "router", maxTokens: 400,
      messages: [
        { role: "system", content: ROUTE_PROMPT },
        { role: "user", content: `Folder tree:\n${tree}\n\n${docInfo}` },
      ],
    });
  }
  const title = (route.title || section.name).trim();
  const query = `${route.search_query ?? ""} ${title}`.trim();

  // 2. Look for a note to merge into.
  const hits = await searchNotes(db, query, 8);
  let mergeId: string | null = null;
  if (hits.length > 0) {
    const list = hits.map((h) => `- id: ${h.id}\n  title: ${h.title}\n  summary: ${h.summary}`).join("\n");
    const decision = await completeJson<{ merge_into_note_id?: string | null }>({
      db, settings, role: "router", maxTokens: 200,
      messages: [
        { role: "system", content: MERGE_PROMPT },
        { role: "user", content: `New document: "${title}" (${source.filename}, ${section.name})\n\nExcerpt:\n${excerpt}\n\nCandidate notes:\n${list}` },
      ],
    });
    const id = decision.merge_into_note_id;
    if (id && hits.some((h) => h.id === id)) mergeId = id;
  }

  const existing = mergeId ? (await getNotes(db, [mergeId]))[0] ?? null : null;

  // 3. Where does it live?
  let folder: Folder;
  if (existing) {
    const f = await folderById(db, existing.folder_id);
    folder = f ?? (await ensureFolder(db, forced?.path ?? route.folder_path ?? "Inbox"));
  } else if (forced) {
    folder = forced;
  } else {
    const path = normalizePath(route.folder_path ?? "").split("/").slice(0, 3).map(cleanName).filter(Boolean).join("/");
    folder = await ensureFolder(db, path || "Inbox");
  }

  // 4. Titles the writer may link to: candidates plus other notes from the same folder.
  const linkable = new Map<string, string>();
  for (const h of hits) if (h.id !== existing?.id) linkable.set(h.id, h.title);
  const siblings = await notesInFolder(db, folder.id);
  for (const s of siblings) {
    if (linkable.size >= hits.length + 30) break;
    if (s.id !== existing?.id && !linkable.has(s.id)) linkable.set(s.id, s.title);
  }
  const linkList = linkable.size ? [...linkable.values()].map((t) => `- ${t}`).join("\n") : "(none)";

  // 5. Write.
  const today = new Date().toISOString().slice(0, 10);
  const docBody = clip(section.text, WRITER_CHARS);
  const userMsg = existing
    ? `Today: ${today}\nFolder: ${folder.path}\n\nNotes you may link to:\n${linkList}\n\nEXISTING NOTE\nTITLE: ${existing.title}\nSUMMARY: ${existing.summary}\n---\n${existing.content}\n\nNEW DOCUMENT (file: ${source.filename}, section: ${section.name})\n${docBody}`
    : `Today: ${today}\nFolder: ${folder.path}\nSuggested title: ${title}\n\nNotes you may link to:\n${linkList}\n\nDOCUMENT (file: ${source.filename}, section: ${section.name})\n${docBody}`;
  const raw = await complete({
    db, settings, role: "writer", maxTokens: 12000,
    messages: [
      { role: "system", content: existing ? MERGE_WRITER_PROMPT : WRITER_PROMPT },
      { role: "user", content: userMsg },
    ],
  });
  const parsed = parseWriter(raw, existing?.title ?? title);
  if (!parsed.content) throw new Error("The writer returned an empty note");
  const summary = parsed.summary || parsed.content.replace(/[#*|\-\n]+/g, " ").trim().slice(0, 200);

  // 6. Save.
  const saved = existing
    ? await saveNote(db, { id: existing.id, folder_id: existing.folder_id, title: await uniqueTitle(db, parsed.title, existing.id), summary, content: parsed.content }, source.id)
    : await saveNote(db, { folder_id: folder.id, title: await uniqueTitle(db, parsed.title), summary, content: parsed.content }, source.id);
  return { noteId: saved.id, folderId: saved.folder_id };
}

// ---------------------------------------------------------------- folder upkeep

async function tendFolder(db: Db, settings: Awaited<ReturnType<typeof getSettings>>, folderId: string) {
  const folder = await folderById(db, folderId);
  if (!folder) return;
  let notes = await notesInFolder(db, folder.id);

  if (!folder.summary.trim() && notes.length > 0) {
    const list = notes.slice(0, 20).map((n) => `- ${n.title}: ${n.summary}`).join("\n");
    const r = await completeJson<{ summary?: string }>({
      db, settings, role: "router", maxTokens: 200,
      messages: [
        { role: "system", content: FOLDER_SUMMARY_PROMPT },
        { role: "user", content: `Folder: ${folder.path}\n\nNotes:\n${list}` },
      ],
    });
    if (r.summary?.trim()) {
      await db.from("folders").update({ summary: r.summary.trim() }).eq("id", folder.id);
      folder.summary = r.summary.trim();
    }
  }

  if (notes.length <= MAX_NOTES_PER_FOLDER) return;
  const { data: subs } = await db.from("folders").select("name").eq("parent_id", folder.id);
  const existingSubs = (subs ?? []).map((s) => s.name).join(", ") || "(none)";
  const list = notes.map((n) => `- id: ${n.id} | ${n.title}: ${n.summary}`).join("\n");
  const plan = await completeJson<{ subfolders?: { name?: string; summary?: string; note_ids?: string[] }[] }>({
    db, settings, role: "planner", maxTokens: 4000,
    messages: [
      { role: "system", content: REORGANIZE_PROMPT },
      { role: "user", content: `Folder: ${folder.path}\nExisting subfolders: ${existingSubs}\n\nNotes:\n${list}` },
    ],
  });
  const valid = new Set(notes.map((n) => n.id));
  const used = new Set<string>();
  let made = 0;
  for (const sub of plan.subfolders ?? []) {
    if (made >= 6) break;
    const name = cleanName(sub.name ?? "");
    const ids = [...new Set(sub.note_ids ?? [])].filter((id) => valid.has(id) && !used.has(id));
    if (!name || ids.length < 2) continue;
    const child = await ensureFolder(db, `${folder.path}/${name}`);
    if (!child.summary.trim() && sub.summary?.trim()) {
      await db.from("folders").update({ summary: sub.summary.trim() }).eq("id", child.id);
    }
    await db.from("notes").update({ folder_id: child.id }).in("id", ids);
    ids.forEach((id) => used.add(id));
    made++;
  }
  notes = notes.filter((n) => !used.has(n.id));
}

// ---------------------------------------------------------------- the pipeline

export async function fileSource(db: Db, sourceId: string): Promise<IngestResult> {
  const { data: source, error: loadError } = await db
    .from("sources")
    .select("id, filename, storage_path, mime, target_folder_id, status")
    .eq("id", sourceId)
    .single();
  if (loadError || !source) throw new Error("Source not found");
  // Already filed or skipped: filing again would only spend money.
  if (source.status === "filed" || source.status === "skipped") {
    const { data: links } = await db.from("note_sources").select("note_id").eq("source_id", sourceId);
    return { source_id: sourceId, status: source.status, note_ids: (links ?? []).map((l) => l.note_id) };
  }

  const setStatus = (status: string, extra: Record<string, unknown> = {}) =>
    db.from("sources").update({ status, ...extra }).eq("id", sourceId);

  await setStatus("processing", { error: null });
  const noteIds: string[] = [];

  try {
    const { data: blob, error: dlError } = await db.storage.from("sources").download(source.storage_path);
    if (dlError || !blob) throw new Error(`Could not download the file: ${dlError?.message ?? "not found"}`);
    const buf = Buffer.from(await blob.arrayBuffer());

    const extracted = await extractText(buf, source.filename, source.mime);
    if (extracted.kind === "skip") {
      await setStatus("skipped", { error: extracted.reason });
      return { source_id: sourceId, status: "skipped", note_ids: [], error: extracted.reason };
    }

    const settings = await getSettings(db);
    const folderIds = new Set<string>();
    for (const section of extracted.sections) {
      const { noteId, folderId } = await fileSection(db, settings, source, section);
      if (!noteIds.includes(noteId)) noteIds.push(noteId);
      folderIds.add(folderId);
    }

    for (const id of folderIds) {
      try {
        await tendFolder(db, settings, id);
      } catch (e) {
        if (e instanceof SpendLimitError) throw e;
        // Upkeep is best effort: the notes are already filed.
        console.error("folder upkeep failed", e);
      }
    }

    await setStatus("filed", { error: null, filed_at: new Date().toISOString() });
    return { source_id: sourceId, status: "filed", note_ids: noteIds };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof SpendLimitError) {
      await setStatus("pending", { error: message });
      return { source_id: sourceId, status: "pending", note_ids: noteIds, error: message };
    }
    await setStatus("failed", { error: message });
    return { source_id: sourceId, status: "failed", note_ids: noteIds, error: message };
  }
}
