-- Crow web: a private LLM wiki. Every row belongs to one user and RLS keeps it that way.

create extension if not exists pg_trgm;

-- Folders form a tree. `path` is the full slash-separated path, e.g. "Trips/Japan 2026".
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  parent_id uuid references public.folders on delete cascade,
  name text not null,
  path text not null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, path)
);

-- Notes are Markdown. Links between notes are written [[Note title]] in `content`.
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  folder_id uuid not null references public.folders on delete cascade,
  title text not null,
  summary text not null default '',
  content text not null default '',
  search tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, title)
);
create index notes_search_idx on public.notes using gin (search);
create index notes_title_trgm_idx on public.notes using gin (title gin_trgm_ops);
create index notes_folder_idx on public.notes (folder_id);

-- Original documents, kept in the "sources" storage bucket at <user_id>/<sha256>/<filename>.
create type public.source_status as enum ('pending', 'processing', 'filed', 'skipped', 'failed');
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  filename text not null,
  storage_path text not null,
  mime text not null default '',
  size bigint not null default 0,
  sha256 text not null,
  status public.source_status not null default 'pending',
  error text,
  -- A folder the user dropped the file onto: filing goes there instead of being routed.
  target_folder_id uuid references public.folders on delete set null,
  created_at timestamptz not null default now(),
  filed_at timestamptz,
  unique (user_id, sha256)
);

create table public.note_sources (
  note_id uuid not null references public.notes on delete cascade,
  source_id uuid not null references public.sources on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (note_id, source_id)
);

-- Derived from the [[links]] in each note; rewritten whenever a note is saved.
create table public.note_links (
  from_note uuid not null references public.notes on delete cascade,
  to_note uuid not null references public.notes on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  primary key (from_note, to_note)
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- For answers: the query the wiki was searched with and the ids of the notes cited.
  search_query text,
  cited_note_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index messages_chat_idx on public.messages (chat_id, created_at);

-- One row per user. Models are OpenRouter ids.
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  planner_model text not null default 'anthropic/claude-opus-5.5',
  writer_model text not null default 'anthropic/claude-sonnet-5.5',
  router_model text not null default 'anthropic/claude-haiku-5.5',
  spend_limit_usd numeric(10, 2) not null default 10,
  updated_at timestamptz not null default now()
);

-- Every OpenRouter call, with the cost OpenRouter reports.
create table public.usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  role text not null,
  model text not null,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  created_at timestamptz not null default now()
);

-- Row level security: each user sees only their own rows.
do $$
declare t text;
begin
  foreach t in array array['folders','notes','sources','note_sources','note_links','chats','messages','settings','usage']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t);
  end loop;
end $$;

-- Full-text search over notes, ranked; falls back to title similarity for short or fuzzy queries.
create or replace function public.search_notes(q text, max_results int default 12)
returns table (id uuid, title text, summary text, folder_id uuid, rank real)
language sql stable security invoker as $$
  with qq as (
    select websearch_to_tsquery('simple', q) as strict_q,
           (select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' | '))
              from regexp_split_to_table(lower(q), '[^[:alnum:]]+') w
             where length(w) > 2) as loose_q
  ),
  scored as (
    select n.id, n.title, n.summary, n.folder_id,
           greatest(
             case when n.search @@ qq.strict_q then ts_rank_cd(n.search, qq.strict_q) else 0 end,
             case when qq.loose_q is not null and n.search @@ qq.loose_q
                  then ts_rank_cd(n.search, qq.loose_q) * 0.5 else 0 end,
             similarity(n.title, q) * 0.3
           )::real as rank
    from public.notes n, qq
  )
  select id, title, summary, folder_id, rank from scored
  where rank > 0.01
  order by rank desc
  limit max_results;
$$;

-- Spend so far, for the spending limit.
create or replace function public.total_spend()
returns numeric language sql stable security invoker as $$
  select coalesce(sum(cost_usd), 0) from public.usage;
$$;

-- Storage: a private bucket; each user reads and writes only under their own id.
insert into storage.buckets (id, name, public) values ('sources', 'sources', false)
on conflict (id) do nothing;

create policy "own source files" on storage.objects for all to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);
