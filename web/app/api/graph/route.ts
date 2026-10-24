import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { listFolders } from "@/lib/wiki";
import type { Graph, NoteMeta } from "@/lib/types";

export const dynamic = "force-dynamic";

// The whole wiki as a graph: folders, notes (without content) and the [[link]] edges between notes.
export async function GET() {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  try {
    const [folders, notesRes, linksRes] = await Promise.all([
      listFolders(db),
      db.from("notes").select("id, folder_id, title, summary, updated_at").order("title"),
      db.from("note_links").select("from_note, to_note"),
    ]);
    if (notesRes.error) throw notesRes.error;
    if (linksRes.error) throw linksRes.error;

    const body: Graph = {
      folders,
      notes: (notesRes.data ?? []) as NoteMeta[],
      links: linksRes.data ?? [],
    };
    return NextResponse.json(body);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load the graph";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
