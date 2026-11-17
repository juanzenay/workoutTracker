import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { publicOrigin } from "@/server/http/origin";
import { createStravaClient, STRAVA_STATE_COOKIE as STATE_COOKIE, StravaNotConfiguredError } from "@/server/strava/client";

/** Starts OAuth: sends the owner to Strava's consent screen with a CSRF state cookie. */
export async function GET(request: Request) {
  const actor = await getActor();
  const origin = publicOrigin(request);
  if (actor.kind !== "user") return NextResponse.redirect(new URL("/sign-in", origin));

  const state = randomBytes(16).toString("hex");
  let url: string;
  try {
    url = createStravaClient().authorizeUrl({ redirectUri: `${origin}/api/strava/callback`, state });
  } catch (error) {
    if (error instanceof StravaNotConfiguredError) return NextResponse.redirect(new URL("/strava?error=not_configured", origin));
    throw error;
  }
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: origin.startsWith("https:"),
    sameSite: "lax",
    path: "/api/strava",
    maxAge: 600,
  });
  return response;
}
