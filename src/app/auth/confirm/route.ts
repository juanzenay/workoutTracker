import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/server/auth/supabase";

/**
 * Where the owner's sign-up confirmation email lands (the claim flow on /sign-in). Accepts both
 * Supabase link styles: `?code=` (PKCE, the default template) and `?token_hash=&type=`.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const supabase = await createSupabaseServerClient();
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("missing code") };

  const url = request.nextUrl.clone();
  url.search = "";
  url.pathname = error ? "/sign-in" : "/";
  if (error) url.searchParams.set("confirm", "failed");
  return NextResponse.redirect(url);
}
