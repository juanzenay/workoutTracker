import { getActor } from "@/server/auth/session";
import { createCommands } from "@/server/commands";
import { getSql } from "@/server/db/client";

/** Downloads everything workout tracker stores as one JSON file. */
export async function GET() {
  const actor = await getActor();
  if (actor.kind !== "user") return Response.json({ error: "unauthorized" }, { status: 401 });

  const data = await createCommands({ sql: getSql(), actor }).exportJson({});
  const day = data.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="workout-tracker-export-${day}.json"`,
      "cache-control": "no-store",
    },
  });
}
