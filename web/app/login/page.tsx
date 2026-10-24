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
    <div className="w-full max-w-sm text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.png" alt="" width={64} height={64} className="mx-auto rounded-2xl" />
      <h1 className="mt-5 text-2xl font-semibold">Crow</h1>
      <p className="mt-1 text-sm text-muted">Your private wiki. Sign in with a link sent to your email.</p>

      {denied && (
        <p className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          That account is not allowed to use this wiki. You have been signed out.
        </p>
      )}

      {sent ? (
        <div className="mt-8 rounded-2xl border border-line bg-panel p-6">
          <Mail className="mx-auto text-accent" size={28} />
          <h2 className="mt-3 font-medium">Check your email</h2>
          <p className="mt-1 text-sm text-muted">
            We sent a sign-in link to <span className="text-fg">{email}</span>. Open it on this device.
          </p>
          <button className="mt-4 text-sm text-accent hover:underline" onClick={() => setSent(false)}>
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-8 space-y-3 text-left">
          <label htmlFor="email" className="label">
            Email
          </label>
          <input id="email" type="email" required autoFocus autoComplete="email" className="input !py-2.5 text-base" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn btn-primary w-full !py-2.5" disabled={busy || !email.trim()}>
            {busy && <Loader2 size={16} className="animate-spin" />} Email me a link
          </button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="fixed inset-0 flex items-center justify-center overflow-y-auto p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
