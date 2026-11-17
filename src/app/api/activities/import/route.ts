import { getActor } from "@/server/auth/session";
import { createCommands } from "@/server/commands";
import { getSql } from "@/server/db/client";
import { commandErrorResponse } from "@/server/http/command-error";

/**
 * Activity file upload (the Completed runs screen): multipart form data with
 * one or more `files` (FIT, GPX, TCX). Answers with each file's outcome
 * (importActivityFiles). The screen sends large selections in several
 * requests, so each stays under the platform's request size limit.
 */
export async function POST(request: Request) {
  const actor = await getActor();
  if (actor.kind !== "user") return Response.json({ error: "unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length === 0) return Response.json({ error: "invalid_input" }, { status: 400 });
  const files = await Promise.all(uploads.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));

  try {
    const commands = createCommands({ sql: getSql(), actor });
    return Response.json(await commands.importActivityFiles({ files }));
  } catch (error) {
    return commandErrorResponse(error);
  }
}
