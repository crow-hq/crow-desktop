import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import type { Chat, Message } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

// A chat with its messages, oldest first.
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  const [chatRes, messagesRes] = await Promise.all([
    db.from("chats").select("id, title, updated_at").eq("id", id).maybeSingle(),
    db
      .from("messages")
      .select("id, chat_id, role, content, search_query, cited_note_ids, created_at")
      .eq("chat_id", id)
      .order("created_at", { ascending: true }),
  ]);
  if (chatRes.error) return NextResponse.json({ error: chatRes.error.message }, { status: 500 });
  if (messagesRes.error) return NextResponse.json({ error: messagesRes.error.message }, { status: 500 });
  if (!chatRes.data) return NextResponse.json({ error: "Chat not found" }, { status: 404 });

  return NextResponse.json({
    chat: chatRes.data as Chat,
    messages: (messagesRes.data ?? []) as Message[],
  });
}

// Rename a chat.
export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  const body = (await req.json().catch(() => null)) as { title?: unknown } | null;
  if (!body || typeof body.title !== "string" || body.title.trim().length === 0) {
    return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
  }
  if (body.title.length > 200) {
    return NextResponse.json({ error: "title must be 200 characters or fewer" }, { status: 400 });
  }

  const { data, error } = await db
    .from("chats")
    .update({ title: body.title.trim() })
    .eq("id", id)
    .select("id, title, updated_at")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ chat: data as Chat });
}

// Delete a chat and its messages (the database cascades).
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  const { data, error } = await db.from("chats").delete().eq("id", id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
