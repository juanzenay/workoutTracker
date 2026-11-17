import { createCommands } from "@/server/commands";
import { getSql } from "@/server/db/client";
import { cronAuthorized } from "@/server/http/cron-auth";

/** Strava retries and posts can be slow on a cold free-tier database. */
export const maxDuration = 60;

/**
 * Daily job (vercel.json `crons`; Vercel sends `Authorization: Bearer $CRON_SECRET`):
 * re-plans for the new day — missed sessions and long runs move or drop, and
 * planned runs with no activity become missed (as far as Strava or imported
 * runs reach). With a Strava app configured it also retries Strava events that
 * failed and workouts not yet posted to Strava (both do nothing without one).
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const commands = createCommands({ sql: getSql(), actor: { kind: "service" } });
  const events = await commands.processStravaEvents({});
  await commands.refreshRunStatuses({});
  const workouts = await commands.postWorkoutsToStrava({});
  return Response.json({ events, workouts });
}
