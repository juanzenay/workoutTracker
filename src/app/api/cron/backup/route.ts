import { createCommands } from "@/server/commands";
import { getSql } from "@/server/db/client";
import { cronAuthorized } from "@/server/http/cron-auth";

/** Backups can take a while on a cold free-tier database. */
export const maxDuration = 60;

/**
 * Nightly backup, called by Vercel Cron (vercel.json) with `Authorization: Bearer $CRON_SECRET`.
 * The command records the run and raises the inbox item; a failure also answers 500 so it shows in Vercel's logs.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const run = await createCommands({ sql: getSql(), actor: { kind: "service" } }).runBackup({});
  return Response.json(
    { status: run.status, target: run.target, location: run.location, error: run.error },
    { status: run.status === "succeeded" ? 200 : 500, headers: { "cache-control": "no-store" } },
  );
}
