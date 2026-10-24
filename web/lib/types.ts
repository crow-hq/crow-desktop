// Shapes shared by the API routes and the UI. Rows mirror supabase/migrations/0001_init.sql.

export type Folder = {
  id: string;
  parent_id: string | null;
  name: string;
  path: string;
  summary: string;
};

export type NoteMeta = {
  id: string;
  folder_id: string;
  title: string;
  summary: string;
  updated_at: string;
};

export type Note = NoteMeta & { content: string };

export type SourceStatus = "pending" | "processing" | "filed" | "skipped" | "failed";

export type Source = {
  id: string;
  filename: string;
  storage_path: string;
  mime: string;
  size: number;
  sha256: string;
  status: SourceStatus;
  error: string | null;
  target_folder_id: string | null;
  created_at: string;
  filed_at: string | null;
};

export type Chat = { id: string; title: string; updated_at: string };

export type Message = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  search_query: string | null;
  cited_note_ids: string[];
  created_at: string;
};

export type ModelRole = "planner" | "writer" | "router";

export type Settings = {
  planner_model: string;
  writer_model: string;
  router_model: string;
  spend_limit_usd: number;
};

// GET /api/graph
export type Graph = {
  folders: Folder[];
  notes: NoteMeta[];
  links: { from_note: string; to_note: string }[];
};

// POST /api/chat streams newline-delimited JSON, one ChatEvent per line.
export type ChatEvent =
  | { type: "search"; query: string; notes: { id: string; title: string; folder_path: string }[] }
  | { type: "delta"; text: string }
  | { type: "done"; message_id: string; cited_note_ids: string[]; chat_id: string; chat_title: string }
  | { type: "error"; message: string };

// POST /api/ingest returns this.
export type IngestResult = {
  source_id: string;
  status: SourceStatus;
  note_ids: string[];
  error?: string;
};

// GET /api/models
export type ModelInfo = {
  id: string;
  name: string;
  context_length: number;
  prompt_usd_per_mtok: number;
  completion_usd_per_mtok: number;
};
