import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getNote, saveNote, uniqueTitle } from "@/lib/wiki";

type Params = { params: Promise<{ id: string }> };

// One note with its folder, the sources it came from and the notes that link to it.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  try {
    const note = await getNote(db, id);
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

    const [folderRes, sourceRes, backlinkRes] = await Promise.all([
      db.from("folders").select("path").eq("id", note.folder_id).maybeSingle(),
      db.from("note_sources").select("sources(id, filename)").eq("note_id", id),
      db.from("note_links").select("from_note").eq("to_note", id),
    ]);
    if (sourceRes.error) throw sourceRes.error;
    if (backlinkRes.error) throw backlinkRes.error;

    // The embedded source is a single row; the untyped client may report it as an array.
    const sources = ((sourceRes.data ?? []) as unknown as { sources: unknown }[])
      .flatMap((row) => (Array.isArray(row.sources) ? row.sources : [row.sources]))
      .filter((s): s is { id: string; filename: string } => Boolean(s));

    const fromIds = (backlinkRes.data ?? []).map((row) => row.from_note as string);
    let backlinks: { id: string; title: string }[] = [];
    if (fromIds.length) {
      const { data, error } = await db.from("notes").select("id, title").in("id", fromIds).order("title");
      if (error) throw error;
      backlinks = data ?? [];
    }

    return NextResponse.json({
      note,
      folder_path: folderRes.data?.path ?? "",
      sources,
      backlinks,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load the note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Edit the title and/or the Markdown content. A new title that is taken gets " (2)" and so on.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  const body = (await req.json().catch(() => null)) as { title?: unknown; content?: unknown } | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  if (body.title !== undefined && (typeof body.title !== "string" || body.title.trim().length === 0)) {
    return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
  }
  if (body.content !== undefined && typeof body.content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }

  try {
    const note = await getNote(db, id);
    if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

    let title = note.title;
    if (typeof body.title === "string" && body.title.trim() !== note.title) {
      title = await uniqueTitle(db, body.title, id);
    }

    const saved = await saveNote(db, {
      id,
      folder_id: note.folder_id,
      title,
      summary: note.summary,
      content: typeof body.content === "string" ? body.content : note.content,
    });
    return NextResponse.json({ note: saved });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save the note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  const { data, error } = await db.from("notes").delete().eq("id", id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Note not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
