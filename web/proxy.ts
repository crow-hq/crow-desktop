import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/supabase/server";

// Refreshes the Supabase session on every request and keeps everyone but the allowed emails out.
export async function proxy(request: NextRequest) {
  if (process.env.NODE_ENV === "development" && request.nextUrl.pathname.startsWith("/preview")) {
    return NextResponse.next({ request });
  }
  let response = NextResponse.next({ request });
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const {
    data: { user },
  } = await db.auth.getUser();

  const path = request.nextUrl.pathname;
  // /preview is a local design preview with mock data: open in `next dev` only, never in production.
  const isDevPreview = process.env.NODE_ENV === "development" && path.startsWith("/preview");
  const isPublic = path.startsWith("/login") || path.startsWith("/auth/") || isDevPreview;
  if (isPublic) return response;

  if (!user || !isAllowedEmail(user.email)) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = user ? "?denied=1" : "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|brand/).*)"],
};
