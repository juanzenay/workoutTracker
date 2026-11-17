import { CommandError } from "@/server/commands";

const STATUS: Record<CommandError["code"], number> = {
  invalid_input: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  unavailable: 503,
};

/** The JSON response for a failed command; anything that isn't a CommandError is rethrown. */
export function commandErrorResponse(error: unknown): Response {
  if (error instanceof CommandError) {
    return Response.json({ error: error.code, message: error.message }, { status: STATUS[error.code] });
  }
  throw error;
}
