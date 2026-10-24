# Crow web

A private, single-user LLM wiki, hosted. It is a web take on [Crow](../README.md): you file documents in, an LLM turns them into linked Markdown notes in folders, and you ask questions that are answered from those notes.

## Architecture

- **Next.js** (App Router, TypeScript) on **Vercel**.
- **Supabase Postgres** holds notes, folders, chats and settings. Row level security means each signed-in user sees only their own rows.
- **Supabase Storage** bucket `sources` keeps the original documents.
- **OpenRouter** runs the models. The API key lives only on the server.
- Three model roles, each changeable in Settings to any OpenRouter model:
  - `planner` answers questions and plans the wiki (default `anthropic/claude-opus-5.5`).
  - `writer` writes and merges notes (default `anthropic/claude-sonnet-5.5`).
  - `router` makes quick decisions such as picking a folder (default `anthropic/claude-haiku-5.5`).

## Setup

### 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com).

### 2. Create the database

Run `supabase/migrations/0001_init.sql` in the SQL editor, or use `supabase db push` with the Supabase CLI. This creates the tables, row level security, the search function and the `sources` bucket.

### 3. Lock down sign-in

In the Supabase dashboard:

- **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". Only the people you add can sign in.
- **Authentication → Users → Add user**: add your email.
- **Authentication → URL Configuration**:
  - Site URL: your Vercel URL, e.g. `https://YOUR-APP.vercel.app`.
  - Redirect URLs: add `https://YOUR-APP.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`.

The app also checks signed-in emails against `ALLOWED_EMAILS`.

### 4. Get an OpenRouter key

Create a key at [openrouter.ai/keys](https://openrouter.ai/keys). You can set a credit limit on the key as a second safeguard.

### 5. Deploy on Vercel

1. Import this repository in Vercel.
2. Set **Root Directory** to `web`.
3. Add the environment variables from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ALLOWED_EMAILS` (your email)
   - `OPENROUTER_API_KEY`
   - `APP_URL` (your Vercel URL)
4. Deploy.

Filing a document can take up to a few minutes. The ingest route asks for a 300 second limit, which Vercel's Fluid compute (on by default for new projects) allows on the Hobby plan.

Optionally, turn on Vercel Deployment Protection as well, so the deployment itself is behind a login.

### 6. Run locally

```bash
cp .env.example .env.local   # then fill in the same values as above
npm install
npm run dev
```

Open http://localhost:3000.

## How filing works

1. The **router** picks a folder for the document and a search query.
2. The search finds related notes.
3. The router decides whether to merge the document into an existing note or create a new one.
4. The **writer** writes the note, with `[[links]]` to related notes.
5. When a folder grows too large, the **planner** splits it into subfolders.

## How answers work

1. The **router** writes a search query from the conversation.
2. Postgres full-text search finds matching notes.
3. The **planner** answers from those notes and cites them.

## Costs

- Settings shows what you have spent and holds a **spending limit**. Calls stop once the total reaches the limit.
- Every OpenRouter call is recorded in the `usage` table with the cost OpenRouter reports for it.

## Privacy

Your notes, sources and chats are stored in your Supabase project. Document text and questions are sent to the models you pick through OpenRouter, so treat OpenRouter's data policies as part of your setup. The app has no public pages; it is only reachable by signing in with an allowed email.

## Differences from the desktop app

- You upload documents instead of Crow scanning your disk.
- There is no Jev classifier. An LLM router and Postgres search do that job.
- Notes are stored in Supabase rather than as local files. To take them out, use the export, which downloads a `.zip` of Markdown files you can open as an Obsidian vault.

## License

The original Crow is licensed under AGPL-3.0. This is an independent reimplementation of its ideas, not a fork of its code.
