"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { createCommands } from "@/server/commands";
import { getSql } from "@/server/db/client";

export type SignInState = { failed: boolean; resent?: boolean };

/**
 * Password sign-in through Supabase Auth. Only the owner account can exist
 * (see the owner_lock migration), so any successful sign-in is the owner.
 */
export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { failed: true };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error?.code === "email_not_confirmed") {
    // The owner claimed the deployment but hasn't clicked the confirmation link yet: send a fresh one.
    await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${await requestOrigin()}/auth/confirm` } });
    return { failed: false, resent: true };
  }
  if (error) return { failed: true };
  redirect(safeNext(formData.get("next")));
}

export type ClaimState = { status: "idle" | "check-email" | "refused" | "failed" };

/**
 * Claims an unowned deployment: creates the first Supabase Auth account, which the owner_lock
 * trigger makes the owner (only OWNER_EMAIL, when the deploy set one). Once claimed, every
 * other sign-up is refused by the database, whatever calls Supabase Auth.
 */
export async function claimDeployment(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || password.length < 8) return { status: "failed" };

  const anon = createCommands({ sql: getSql(), actor: { kind: "anon" } });
  if ((await anon.getDeploymentStatus({})).claimed) return { status: "refused" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await requestOrigin()}/auth/confirm` },
  });
  if (error) {
    // The owner_lock trigger's refusal surfaces from Supabase Auth as a database error.
    return { status: /database|locked|reserved/i.test(error.message) ? "refused" : "failed" };
  }
  if (data.session) redirect("/");
  return { status: "check-email" };
}

async function requestOrigin(): Promise<string> {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/** Only same-site paths ("/x", not "//host" or "/\\host"), so sign-in can't bounce the owner to another site. */
function safeNext(next: FormDataEntryValue | null): string {
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/";
}
