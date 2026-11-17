import { getActor } from "@/server/auth/session";
import { CommandError, createCommands } from "@/server/commands";
import { getSql } from "@/server/db/client";

/** Downloads workouts as Hevy-format CSV. Query: `tz` (IANA zone, default UTC), `unit` (lb | kg, default lb). */
export async function GET(request: Request) {
  const actor = await getActor();
  if (actor.kind !== "user") return Response.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const unit = params.get("unit") === "kg" ? "kg" : "lb";
  try {
    const { filename, csv } = await createCommands({
      sql: getSql(),
      actor,
    }).exportWorkoutsCsv({
      timeZone: params.get("tz") ?? "UTC",
      unit,
    });
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") {
      return Response.json({ error: error.code, message: error.message }, { status: 400 });
    }
    throw error;
  }
}
