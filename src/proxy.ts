import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Public pages, plus endpoints that authenticate themselves: the MCP endpoint and its OAuth
 * metadata (bearer tokens), the Strava webhook (called without a session) and Vercel Cron (CRON_SECRET).
 */
const PUBLIC_PATHS = ["/sign-in", "/auth/confirm", "/offline", "/api/mcp", "/.well-known/", "/api/strava/webhook", "/api/cron/"];

/**
 * Refreshes the Supabase session cookie on every request and sends anyone
 * without a session to /sign-in. Data access is still enforced by RLS.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    // Come back here after signing in (e.g. the OAuth consent page Claude sent the owner to).
    const back = request.nextUrl.pathname === "/" ? "" : request.nextUrl.pathname + request.nextUrl.search;
    url.search = back ? `?next=${encodeURIComponent(back)}` : "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, PWA files and icons.
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/|images/).*)",
  ],
};
