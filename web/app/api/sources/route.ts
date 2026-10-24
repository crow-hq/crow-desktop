import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const COLUMNS = "id, filename, storage_path, mime, size, sha256, status, error, target_folder_id, created_at, filed_at";

function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "")
    .slice(-120);
  return cleaned || "file";
}

export async function GET() {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await auth.db
    .from("sources")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
  const sha256 = typeof body?.sha256 === "string" ? body.sha256.trim().toLowerCase() : "";
  if (!filename || !/^[0-9a-f]{64}$/.test(sha256)) {
    return NextResponse.json({ error: "filename and a hex sha256 are required" }, { status: 400 });
  }
  const { db, user } = auth;

  const { data: existing } = await db.from("sources").select(COLUMNS).eq("sha256", sha256).maybeSingle();
  if (existing) {
    if (existing.status === "failed" || existing.status === "pending") {
      // Retry: reuse the row (sha256 is unique) and let the client upload again.
      const { data: reset } = await db
        .from("sources")
        .update({ status: "pending", error: null, target_folder_id: body.target_folder_id ?? existing.target_folder_id })
        .eq("id", existing.id)
        .select(COLUMNS)
        .single();
      return NextResponse.json({ source: reset ?? existing, duplicate: false });
    }
    return NextResponse.json({ source: existing, duplicate: true });
  }

  const { data: source, error } = await db
    .from("sources")
    .insert({
      filename,
      mime: typeof body.mime === "string" ? body.mime : "",
      size: Number.isFinite(Number(body.size)) ? Number(body.size) : 0,
      sha256,
      storage_path: `${user.id}/${sha256}/${sanitizeFilename(filename)}`,
      target_folder_id: typeof body.target_folder_id === "string" && body.target_folder_id ? body.target_folder_id : null,
    })
    .select(COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ source, duplicate: false });
}
