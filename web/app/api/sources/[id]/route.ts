import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const { data: source } = await auth.db.from("sources").select("filename, storage_path").eq("id", id).maybeSingle();
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data, error } = await auth.db.storage.from("sources").createSignedUrl(source.storage_path, 60, {
    download: source.filename,
  });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not sign URL" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl, 302);
}
