"use client";
import { Loader2, Mail } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

function LoginForm() {
  const params = useSearchParams();
  const denied = params.get("denied") === "1";
  const urlError = params.get("error");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(urlError);

  useEffect(() => {
    // A signed-in but not allowed account must not stay signed in.
    if (denied) void supabaseBrowser().auth.signOut();
  }, [denied]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || busy) return;
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setError(error.message.toLowerCase().includes("signups not allowed") ? "That email is not registered for this wiki." : error.message);
    else setSent(true);
  }

  return (
    <div className="w-full max-w-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/system1-logo-pink.svg" alt="System1" style={{ height: 26, width: "auto" }} className="mb-8 md:hidden" />
      <h1 className="display text-4xl text-pink">Sign in</h1>
      <p className="mt-2 text-base text-muted">Your System1 wiki. We email you a sign-in link.</p>

      {denied && (
        <p className="notice-warn mt-6 p-3 text-sm">
          That account is not allowed to use this wiki. You have been signed out.
        </p>
      )}

      {sent ? (
        <div className="mt-8 rounded-[10px] border border-line bg-white p-6">
          <Mail className="text-pink" size={28} />
          <h2 className="mt-3 text-lg font-bold">Check your email</h2>
          <p className="mt-1 text-sm text-muted">
            We sent a sign-in link to <span className="font-bold text-ink">{email}</span>. Open it on this device.
          </p>
          <button className="link mt-4 text-sm" onClick={() => setSent(false)}>
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-3 text-left">
          <label htmlFor="email" className="label">
            Email
          </label>
          <input id="email" type="email" required autoFocus autoComplete="email" className="input !py-2.5 text-base" placeholder="you@system1.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p className="text-sm font-bold text-danger">{error}</p>}
          <button className="btn btn-primary w-full !py-3 text-base" disabled={busy || !email.trim()}>
            {busy && <Loader2 size={16} className="animate-spin" />} Email me a link
          </button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="fixed inset-0 flex flex-col bg-white md:flex-row">
      <aside className="hidden shrink-0 flex-col justify-between bg-pink p-12 md:flex md:w-[40%]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/system1-logo-white.svg" alt="System1" style={{ height: 34, width: "auto" }} className="self-start" />
        <h2 className="display max-w-[11ch] text-6xl text-white lg:text-7xl">Your second brain, filed for you.</h2>
        <p className="text-base font-bold text-white">System1 Wiki</p>
      </aside>
      <section className="flex flex-1 items-center justify-center overflow-y-auto p-6">
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
