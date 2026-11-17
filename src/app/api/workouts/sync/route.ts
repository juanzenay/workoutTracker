import { after } from "next/server";
import { getActor } from "@/server/auth/session";
import { createCommands, type CommandInput } from "@/server/commands";
import { getSql } from "@/server/db/client";
import { commandErrorResponse } from "@/server/http/command-error";

/**
 * Outbox endpoint for the local-first logger (src/client/workout-store.ts).
 * Body: { ops: WorkoutOp[] }. 200 means every op is committed; anything else
 * leaves the ops queued on the device for the next attempt. A finished
 * workout is posted to Strava after the response (a failure there never
 * fails the sync; the daily cron retries).
 */
export async function POST(request: Request) {
  const actor = await getActor();
  if (actor.kind !== "user") return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }

  try {
    const commands = createCommands({ sql: getSql(), actor });
    const result = await commands.applyWorkoutOps(body as CommandInput<"applyWorkoutOps">);
    if (result.finished > 0) {
      after(async () => {
        await commands.postWorkoutsToStrava({}).catch((error: unknown) => console.error("Strava post failed", error));
      });
    }
    return Response.json(result);
  } catch (error) {
    return commandErrorResponse(error);
  }
}
