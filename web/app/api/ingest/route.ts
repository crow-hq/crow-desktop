import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { fileSource } from "@/lib/file";

export const maxDuration = 300;
export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const sourceId = typeof body?.source_id === "string" ? body.source_id : "";
  if (!sourceId) return NextResponse.json({ error: "source_id is required" }, { status: 400 });
  try {
    return NextResponse.json(await fileSource(auth.db, sourceId));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
