import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { CommandError, createCommands } from "@/server/commands";
import { getSql } from "@/server/db/client";
import { publicOrigin } from "@/server/http/origin";
import { STRAVA_STATE_COOKIE as STATE_COOKIE } from "@/server/strava/client";

/** Strava redirects here after the consent screen: ?state&code&scope, or ?error=access_denied. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = publicOrigin(request);
  const back = (query: string) => NextResponse.redirect(new URL(`/strava?${query}`, origin));
  const actor = await getActor();
  if (actor.kind !== "user") return NextResponse.redirect(new URL("/sign-in", origin));

  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/api/strava" });
  if (!expected || url.searchParams.get("state") !== expected) return back("error=state");
  if (url.searchParams.get("error")) return back("error=denied");
  const code = url.searchParams.get("code");
  if (!code) return back("error=denied");

  try {
    await createCommands({ sql: getSql(), actor }).connectStrava({ code, scope: url.searchParams.get("scope") ?? "" });
  } catch (error) {
    if (error instanceof CommandError) return back(`error=${error.code === "invalid_input" ? "scope" : error.code}`);
    throw error;
  }
  return back("connected=1");
}
