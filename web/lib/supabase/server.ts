import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// A Supabase client acting as the signed-in user, so row level security applies to every query.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component, where cookies are read-only; the proxy refreshes the session.
        }
      },
    },
  });
}

export type Db = Awaited<ReturnType<typeof supabaseServer>>;

export function isAllowedEmail(email: string | undefined | null): boolean {
  if (!email) return false;
  const allowed = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

// For API routes: the signed-in, allowed user, or null.
export async function requireUser() {
  const db = await supabaseServer();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user || !isAllowedEmail(user.email)) return null;
  return { db, user };
}
