import { requireUser } from "@/lib/supabase/server";
import { completeJson, getSettings, SpendLimitError, streamCompletion, type ChatMessage } from "@/lib/openrouter";
import { getNotes, listFolders, searchNotes, type SearchHit } from "@/lib/wiki";
import type { ChatEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_NOTES = 8;
const MAX_NOTE_CHARS = 6000;
const HISTORY_MESSAGES = 12;

const QUERY_PROMPT = `You turn the user's latest message in a conversation into a search query for their personal wiki of notes.
The query runs against Postgres full-text search over note titles, summaries and bodies, so use the concrete words
a note on the subject would contain: names, places, products, amounts, dates. Resolve pronouns and follow-ups from the
earlier messages ("and the hotel?" after a question on a Japan trip → "Japan trip hotel booking"). Six to twelve words.
Reply with JSON only: {"query": "..."}`;

const ANSWER_PROMPT = `You answer questions from the user's personal wiki: notes written from their own documents.

Rules:
- Answer only from the notes provided. If they don't contain the answer, say so plainly, and say what the notes do
  cover that comes closest. Never invent facts, figures or dates.
- Cite the notes you use as [N1], [N2]… right after the sentence that relies on them. Cite every factual sentence.
  Only cite notes from the list.
- Lead with the answer itself, then the detail that supports it. Be concise: short paragraphs or a short list,
  a table when comparing things. No preamble, no "Based on your notes".
- When notes disagree, prefer the most recent information and mention the discrepancy.
- Answer in the language of the question.`;

// Answers stream as `[[note:<uuid>]]` markers in place of the model's [N1] references.
const REF = /\[(N\d+(?:\s*,\s*N\d+)*)\]/g;

function stripMarkers(text: string) {
  return text.replace(/\s*\[\[note:[0-9a-f-]+\]\]/g, "");
}

function defaultTitle(message: string) {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length <= 60) return oneLine;
  const cut = oneLine.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}…`;
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if (!auth) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { db } = auth;

  const body = (await req.json()) as { chat_id?: string; message?: string; regenerate?: boolean };
  const message = body.message?.trim();
  if (!message) return Response.json({ error: "Empty message" }, { status: 400 });

  // The chat, or a new one titled after the first question.
  let chatId = body.chat_id;
  let chatTitle: string;
  if (chatId) {
    const { data: chat } = await db.from("chats").select("id, title").eq("id", chatId).maybeSingle();
    if (!chat) return Response.json({ error: "Chat not found" }, { status: 404 });
    chatTitle = chat.title;
  } else {
    const { data: chat, error } = await db
      .from("chats")
      .insert({ title: defaultTitle(message) })
      .select("id, title")
      .single();
    if (error) return Response.json({ error: error.message }, { status: 500 });
    chatId = chat.id;
    chatTitle = chat.title;
  }

  if (body.regenerate) {
    // Answer the last question again: remove it and what came after; it is stored again below.
    const { data: last } = await db
      .from("messages")
      .select("created_at")
      .eq("chat_id", chatId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last) await db.from("messages").delete().eq("chat_id", chatId).gte("created_at", last.created_at);
  }

  const { data: earlier } = await db
    .from("messages")
    .select("role, content")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_MESSAGES);
  const history: ChatMessage[] = (earlier ?? [])
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: stripMarkers(m.content) }));

  await db.from("messages").insert({ chat_id: chatId, role: "user", content: message });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        const settings = await getSettings(db);

        // 1. A search query that stands on its own, from the router model.
        let query = message;
        try {
          const transcript = [...history.slice(-6), { role: "user", content: message }]
            .map((m) => `${m.role}: ${m.content.slice(0, 1500)}`)
            .join("\n");
          const out = await completeJson<{ query?: string }>({
            db,
            settings,
            role: "router",
            maxTokens: 200,
            messages: [
              { role: "system", content: QUERY_PROMPT },
              { role: "user", content: transcript },
            ],
          });
          if (out.query?.trim()) query = out.query.trim();
        } catch (e) {
          if (e instanceof SpendLimitError) throw e;
          // Otherwise search with the message as typed.
        }

        // 2. The notes: the rewritten query first, then the message as typed for anything it missed.
        const hits = new Map<string, SearchHit>();
        for (const q of [query, message]) {
          for (const hit of await searchNotes(db, q, MAX_NOTES)) if (!hits.has(hit.id)) hits.set(hit.id, hit);
        }
        const ranked = [...hits.values()].slice(0, MAX_NOTES);
        const notes = await getNotes(
          db,
          ranked.map((h) => h.id),
        );
        const byId = new Map(notes.map((n) => [n.id, n]));
        const ordered = ranked.map((h) => byId.get(h.id)).filter((n) => n !== undefined);
        const folders = new Map((await listFolders(db)).map((f) => [f.id, f.path]));
        send({
          type: "search",
          query,
          notes: ordered.map((n) => ({ id: n.id, title: n.title, folder_path: folders.get(n.folder_id) ?? "" })),
        });

        // 3. The answer, streamed from the planner model.
        const refs = new Map(ordered.map((n, i) => [`N${i + 1}`, n.id]));
        const context = ordered.length
          ? ordered
              .map(
                (n, i) =>
                  `[N${i + 1}] ${n.title} (folder: ${folders.get(n.folder_id) ?? ""}; updated ${n.updated_at.slice(0, 10)})\n` +
                  n.content.slice(0, MAX_NOTE_CHARS),
              )
              .join("\n\n---\n\n")
          : "(no notes matched this question)";

        const toMarkers = (text: string) =>
          text.replace(REF, (whole, list: string) => {
            const ids = list
              .split(",")
              .map((r) => refs.get(r.trim()))
              .filter((id): id is string => Boolean(id));
            return ids.length ? ids.map((id) => `[[note:${id}]]`).join("") : whole;
          });

        let answer = "";
        let pending = "";
        const flush = (final: boolean) => {
          // Hold back a trailing "[N1, N" that the next chunk may complete.
          let cut = pending.length;
          if (!final) {
            const open = pending.lastIndexOf("[");
            if (open >= 0 && pending.indexOf("]", open) < 0 && pending.length - open < 24) cut = open;
          }
          const ready = toMarkers(pending.slice(0, cut));
          pending = pending.slice(cut);
          if (ready) {
            answer += ready;
            send({ type: "delta", text: ready });
          }
        };

        for await (const delta of streamCompletion({
          db,
          settings,
          role: "planner",
          maxTokens: 2500,
          temperature: 0.3,
          messages: [
            { role: "system", content: ANSWER_PROMPT },
            ...history,
            { role: "user", content: `Notes from my wiki:\n\n${context}\n\n---\n\nMy question: ${message}` },
          ],
        })) {
          pending += delta;
          flush(false);
        }
        flush(true);

        const cited = [...new Set([...answer.matchAll(/\[\[note:([0-9a-f-]+)\]\]/g)].map((m) => m[1]))];
        const { data: saved, error } = await db
          .from("messages")
          .insert({ chat_id: chatId, role: "assistant", content: answer, search_query: query, cited_note_ids: cited })
          .select("id")
          .single();
        if (error) throw error;
        await db.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chatId);
        send({ type: "done", message_id: saved.id, cited_note_ids: cited, chat_id: chatId!, chat_title: chatTitle });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
