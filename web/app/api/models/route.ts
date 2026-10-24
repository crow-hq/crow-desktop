import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import type { ModelInfo } from "@/lib/types";

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number | null;
  pricing?: { prompt?: string | number | null; completion?: string | number | null };
  architecture?: { output_modalities?: string[] };
};

// The OpenRouter models a role can use, with prices per million tokens. Cached for an hour.
export async function GET() {
  const auth = await requireUser();
  if (!auth) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}` },
      next: { revalidate: 3600 },
    });
  } catch {
    return NextResponse.json({ error: "Could not reach OpenRouter" }, { status: 502 });
  }
  if (!res.ok) {
    return NextResponse.json({ error: `OpenRouter returned ${res.status}` }, { status: 502 });
  }

  const json = (await res.json()) as { data?: OpenRouterModel[] };
  const models: ModelInfo[] = (json.data ?? [])
    .filter((m) => {
      const out = m.architecture?.output_modalities;
      return !out || out.includes("text");
    })
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      context_length: m.context_length ?? 0,
      prompt_usd_per_mtok: Number(m.pricing?.prompt ?? 0) * 1e6,
      completion_usd_per_mtok: Number(m.pricing?.completion ?? 0) * 1e6,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json(models);
}
