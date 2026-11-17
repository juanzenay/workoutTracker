import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createCommands, type Actor, type Commands } from "../commands";
import { getSql } from "../db/client";
import { createSupabaseServerClient } from "./supabase";

/** The actor for the current request, from the verified Supabase session. */
export const getActor = cache(async (): Promise<Actor> => {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return sub ? { kind: "user", userId: sub } : { kind: "anon" };
});

/** The command layer for the signed-in owner; redirects to sign-in otherwise. Use in pages and server actions. */
export async function requireCommands(): Promise<Commands> {
  const actor = await getActor();
  if (actor.kind !== "user") redirect("/sign-in");
  return createCommands({ sql: getSql(), actor });
}
