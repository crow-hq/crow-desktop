import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { getSettings } from "@/lib/openrouter";
import type { Db } from "@/lib/supabase/server";

const modelId = z.string().min(1).max(200);

const SettingsPatch = z.object({
  planner_model: modelId.optional(),
  writer_model: modelId.optional(),
  router_model: modelId.optional(),
  spend_limit_usd: z.number().min(0).max(100000).optional(),
});

// Settings plus the total spent so far, which the spending limit is checked against.
async function settingsWithSpend(db: Db) {
  const settings = await getSettings(db);
  const { data, error } = await db.rpc("total_spend");
  if (error) throw error;
  return { ...settings, spent_usd: Number(data ?? 0) };
}

export async function GET() {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  try {
    return NextResponse.json(await settingsWithSpend(db));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Change any of the settings. Only the fields sent are changed.
export async function PUT(req: Request) {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { db, user } = auth;

  const json = await req.json().catch(() => null);
  const parsed = SettingsPatch.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid settings" }, { status: 400 });
  }

  try {
    const { error } = await db
      .from("settings")
      .upsert(
        { ...parsed.data, user_id: user.id, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) throw error;
    return NextResponse.json(await settingsWithSpend(db));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save settings";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
