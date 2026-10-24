import type { Db } from "@/lib/supabase/server";
import type { ModelRole, Settings } from "@/lib/types";

// Every LLM call goes through here: it picks the model for the role, enforces the spending limit
// and records what OpenRouter says the call cost.
//
// Roles:
//   planner  answers questions and plans the wiki (default Claude Opus 5.5)
//   writer   writes and merges notes (default Claude Sonnet 5.5)
//   router   cheap, fast decisions: which folder, which notes to search (default Claude Haiku 5.5)

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_SETTINGS: Settings = {
  planner_model: "anthropic/claude-opus-5.5",
  writer_model: "anthropic/claude-sonnet-5.5",
  router_model: "anthropic/claude-haiku-5.5",
  spend_limit_usd: 10,
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class SpendLimitError extends Error {
  constructor(spent: number, limit: number) {
    super(`Spending limit reached: $${spent.toFixed(2)} of $${limit.toFixed(2)}. Raise it in Settings to continue.`);
  }
}

export async function getSettings(db: Db): Promise<Settings> {
  const { data } = await db
    .from("settings")
    .select("planner_model, writer_model, router_model, spend_limit_usd")
    .maybeSingle();
  if (data) return { ...data, spend_limit_usd: Number(data.spend_limit_usd) };
  await db.from("settings").insert({});
  return DEFAULT_SETTINGS;
}

export function modelFor(settings: Settings, role: ModelRole): string {
  return settings[`${role}_model`];
}

async function checkSpend(db: Db, settings: Settings) {
  const { data } = await db.rpc("total_spend");
  const spent = Number(data ?? 0);
  if (spent >= settings.spend_limit_usd) throw new SpendLimitError(spent, settings.spend_limit_usd);
}

type Usage = { prompt_tokens?: number; completion_tokens?: number; cost?: number };

async function recordUsage(db: Db, role: ModelRole, model: string, usage: Usage | undefined) {
  if (!usage) return;
  await db.from("usage").insert({
    role,
    model,
    prompt_tokens: usage.prompt_tokens ?? 0,
    completion_tokens: usage.completion_tokens ?? 0,
    cost_usd: usage.cost ?? 0,
  });
}

function headers() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.APP_URL ?? "https://crow-web.vercel.app",
    "X-Title": "Crow web",
  };
}

type CallOptions = {
  db: Db;
  settings: Settings;
  role: ModelRole;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

async function post(opts: CallOptions, stream: boolean) {
  await checkSpend(opts.db, opts.settings);
  const model = modelFor(opts.settings, opts.role);
  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.2,
      stream,
      usage: { include: true },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter ${res.status} for ${model}: ${body.slice(0, 500)}`);
  }
  return { res, model };
}

// One completion, returned whole.
export async function complete(opts: CallOptions): Promise<string> {
  const { res, model } = await post(opts, false);
  const data = await res.json();
  await recordUsage(opts.db, opts.role, model, data.usage);
  if (data.error) throw new Error(`OpenRouter: ${data.error.message ?? JSON.stringify(data.error)}`);
  return data.choices?.[0]?.message?.content ?? "";
}

// A completion whose reply must be a JSON object. Asks once more if the first reply doesn't parse.
export async function completeJson<T>(opts: CallOptions): Promise<T> {
  const text = await complete(opts);
  try {
    return parseJsonObject<T>(text);
  } catch {
    const retry = await complete({
      ...opts,
      messages: [
        ...opts.messages,
        { role: "assistant", content: text },
        { role: "user", content: "That was not valid JSON. Reply with the JSON object only, nothing else." },
      ],
    });
    return parseJsonObject<T>(retry);
  }
}

export function parseJsonObject<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object in reply");
  return JSON.parse(body.slice(start, end + 1)) as T;
}

// A streamed completion: yields text as it arrives and records usage when the stream ends.
export async function* streamCompletion(opts: CallOptions): AsyncGenerator<string> {
  const { res, model } = await post(opts, true);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: Usage | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        // OpenRouter sends ": OPENROUTER PROCESSING" comments to keep the connection open.
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        const chunk = JSON.parse(payload);
        if (chunk.error) throw new Error(`OpenRouter: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
        if (chunk.usage) usage = chunk.usage;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  } finally {
    await recordUsage(opts.db, opts.role, model, usage);
  }
}
