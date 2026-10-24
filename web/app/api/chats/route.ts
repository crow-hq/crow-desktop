import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import type { Chat } from "@/lib/types";

// All chats, most recently updated first.
export async function GET() {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  const { data, error } = await db
    .from("chats")
    .select("id, title, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []) as Chat[]);
}

// A new, empty chat. The title defaults to "New chat" in the database.
export async function POST() {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  const { data, error } = await db.from("chats").insert({}).select("id, title, updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data as Chat);
}
