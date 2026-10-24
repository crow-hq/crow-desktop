import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Magic-link landing: swap the one-time code for a session cookie, then go home.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const fail = (msg: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, url.origin));
  if (!code) return fail(url.searchParams.get("error_description") ?? "That sign-in link is missing its code. Request a new one.");
  const db = await supabaseServer();
  const { error } = await db.auth.exchangeCodeForSession(code);
  if (error) return fail("That sign-in link has expired or was already used. Request a new one.");
  return NextResponse.redirect(new URL("/", url.origin));
}
