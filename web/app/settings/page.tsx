"use client";
import { ArrowLeft, Check, Download, LogOut, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IngestResult, ModelInfo, ModelRole, Settings, Source, SourceStatus } from "@/lib/types";
import { errMsg, get, post, put } from "@/components/api";
import { Spinner } from "@/components/modal";
import { ModelPicker } from "@/components/model-picker";
import { cn, fmtBytes, fmtUsd, timeAgo } from "@/components/util";
import { supabaseBrowser } from "@/lib/supabase/client";

type SettingsRes = Settings & { spent_usd: number };

const ROLES: { role: ModelRole; key: keyof Settings; label: string; description: string }[] = [
  { role: "planner", key: "planner_model", label: "Planner", description: "Answers questions, reorganises folders" },
  { role: "writer", key: "writer_model", label: "Writer", description: "Writes the notes" },
  { role: "router", key: "router_model", label: "Router", description: "Quick decisions: which folder, what to search" },
];

const STATUS_STYLE: Record<SourceStatus, string> = {
  filed: "bg-[#E8F3E9] text-success",
  processing: "bg-pink-100 text-pink-dark",
  pending: "bg-warn-bg text-ink",
  failed: "bg-danger-bg text-danger",
  skipped: "bg-grey-50 text-muted",
};

export default function SettingsPage() {
  useEffect(() => {
    document.body.classList.add("scrollable");
    return () => document.body.classList.remove("scrollable");
  }, []);

  const [settings, setSettings] = useState<SettingsRes | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [limit, setLimit] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    get<SettingsRes>("/api/settings")
      .then((s) => {
        setSettings(s);
        setLimit(String(s.spend_limit_usd));
      })
      .catch((e) => setError(errMsg(e)));
    get<ModelInfo[]>("/api/models").then(setModels).catch((e) => setModelsError(errMsg(e)));
    supabaseBrowser().auth.getUser().then((r: { data: { user: { email?: string } | null } }) => setEmail(r.data.user?.email ?? null));
  }, []);

  const save = async (patch: Partial<Settings>) => {
    setSaveError(null);
    try {
      const s = await put<SettingsRes>("/api/settings", patch);
      setSettings(s);
      setLimit(String(s.spend_limit_usd));
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setSaveError(errMsg(e));
    }
  };

  const commitLimit = () => {
    const n = parseFloat(limit);
    if (!settings) return;
    if (!Number.isFinite(n) || n < 0) {
      setLimit(String(settings.spend_limit_usd));
      return;
    }
    if (n !== settings.spend_limit_usd) void save({ spend_limit_usd: n });
  };

  const signOut = async () => {
    await supabaseBrowser().auth.signOut();
    location.href = "/login";
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-24 pt-6">
      <div className="flex items-center justify-between">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold text-pink-dark hover:underline">
          <ArrowLeft size={16} /> Back to the brain
        </Link>
        <span className={cn("flex items-center gap-1 text-xs font-bold text-success transition-opacity", saved ? "opacity-100" : "opacity-0")}>
          <Check size={13} /> Saved
        </span>
      </div>
      <h1 className="display mb-8 mt-5 text-4xl text-pink">Settings</h1>

      {error && <p className="notice-error mb-6 p-3 text-sm">{error}</p>}
      {saveError && <p className="notice-error mb-6 p-3 text-sm">{saveError}</p>}

      <Section title="Models" hint="Pick any model OpenRouter offers. Prices are USD per million tokens.">
        {!settings && !error && <Spinner />}
        {modelsError && <p className="notice-warn p-3 text-sm">Could not load the model list ({modelsError}). You can still type a model id after retrying.</p>}
        {settings && (
          <div className="space-y-5">
            {ROLES.map((r) => (
              <ModelPicker
                key={r.role}
                label={`${r.label} (${r.description})`}
                value={settings[r.key] as string}
                models={models ?? []}
                disabled={!models && !modelsError}
                onChange={(id) => save({ [r.key]: id })}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Spending limit" hint="Filing pauses when the wiki has spent this much. You can raise it and resume.">
        {settings && (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-line bg-white p-4">
            <div>
              <p className="text-sm font-bold">Pause indexing at</p>
              <p className="mt-1 text-xs text-muted">
                <span className="text-2xl font-bold text-pink">{fmtUsd(settings.spent_usd)}</span> spent so far{settings.spend_limit_usd > 0 ? ` · ${fmtUsd(Math.max(0, settings.spend_limit_usd - settings.spent_usd))} left` : ""}
              </p>
            </div>
            <label className="flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1.5 focus-within:border-pink">
              <span className="text-muted">$</span>
              <input
                inputMode="decimal"
                className="w-20 bg-transparent text-right text-sm focus:outline-none"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                onBlur={commitLimit}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                aria-label="Spending limit in USD"
              />
            </label>
          </div>
        )}
      </Section>

      <Section title="Your wiki" hint="Everything as Markdown files in folders. Opens in Obsidian.">
        <a className="btn btn-ghost" href="/api/export" download>
          <Download size={15} /> Download wiki (.zip)
        </a>
      </Section>

      <DocumentsSection />

      <Section title="Account">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-line bg-white p-4">
          <p className="min-w-0 truncate text-sm text-muted">{email ? <>Signed in as <span className="text-fg">{email}</span></> : "Signed in"}</p>
          <button className="btn btn-ghost" onClick={signOut}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-bold">{title}</h2>
      {hint && <p className="mb-3 mt-0.5 text-sm text-muted">{hint}</p>}
      {!hint && <div className="h-3" />}
      {children}
    </section>
  );
}

function DocumentsSection() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<{ done: number; total: number; message?: string } | null>(null);
  const [retrying, setRetrying] = useState(false);

  const load = useCallback(async () => {
    try {
      setSources(await get<Source[]>("/api/sources"));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const todo = sources?.filter((s) => s.status === "failed" || s.status === "pending") ?? [];

  const retryAll = async () => {
    const list = [...todo];
    setRetrying(true);
    setRetry({ done: 0, total: list.length });
    let done = 0;
    let stop = false;
    let message: string | undefined;
    const worker = async () => {
      while (!stop) {
        const s = list.shift();
        if (!s) return;
        try {
          const r = await post<IngestResult>("/api/ingest", { source_id: s.id });
          if (r.status === "pending" && r.error) {
            stop = true;
            message = r.error;
          }
        } catch (e) {
          message = errMsg(e);
        }
        done++;
        setRetry({ done, total: done + list.length, message });
      }
    };
    await Promise.all([worker(), worker()]);
    setRetry({ done, total: done + list.length, message });
    setRetrying(false);
    await load();
  };

  return (
    <Section title="Documents" hint="Every file you have added and what happened to it.">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost" disabled={!todo.length || retrying} onClick={retryAll}>
          {retrying ? <Spinner size={14} /> : <RotateCcw size={14} />} Retry failed{todo.length ? ` (${todo.length})` : ""}
        </button>
        {retry && (
          <span className={cn("text-sm", retry.message ? "font-bold text-ink" : "text-muted")}>
            {retry.done} of {retry.total} retried{retry.message ? `: ${retry.message}` : ""}
          </span>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {!sources && !error && <Spinner />}
      {sources && sources.length === 0 && <p className="rounded-[10px] border border-line bg-white p-4 text-sm text-muted">No documents yet.</p>}
      {sources && sources.length > 0 && (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-white">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b-2 border-pink text-xs text-ink">
                <th className="px-3 py-2 font-bold">File</th>
                <th className="px-3 py-2 font-bold">Status</th>
                <th className="px-3 py-2 text-right font-bold">Size</th>
                <th className="px-3 py-2 text-right font-bold">Added</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b border-line align-top last:border-0">
                  <td className="max-w-[260px] px-3 py-2">
                    <a href={`/api/sources/${s.id}`} target="_blank" rel="noopener noreferrer" className="block truncate hover:text-pink-dark hover:underline" title={s.filename}>
                      {s.filename}
                    </a>
                    {s.error && <p className="mt-0.5 text-xs leading-snug text-danger">{s.error}</p>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", STATUS_STYLE[s.status])}>{s.status}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{fmtBytes(s.size)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-muted">{timeAgo(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
