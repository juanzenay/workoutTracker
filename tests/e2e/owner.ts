import { urlFor } from "../db/database";

/**
 * Fixed world for the end-to-end tests: one owner, one database, fixed ports.
 * E2E_DB / E2E_APP_PORT / E2E_AUTH_PORT env vars override them so parallel worktrees can run e2e side by side.
 */
export const E2E_OWNER = {
  id: "0e2e0000-0000-4000-8000-000000000001",
  email: "owner@workout-tracker.test",
  password: "correct horse battery staple",
};

export const E2E_DB = process.env.E2E_DB ?? "workout_tracker_e2e";
export const E2E_DATABASE_URL = urlFor(E2E_DB);
export const E2E_APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
export const E2E_AUTH_PORT = Number(process.env.E2E_AUTH_PORT ?? 54399);
