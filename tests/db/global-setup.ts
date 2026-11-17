import { buildMigratedDatabase, TEMPLATE_DB } from "./database";

/**
 * Runs once per `vitest run`: builds a fresh template database from the
 * migrations. Each test then clones it (see test-db.ts), so tests never share state.
 */
export default async function setup() {
  await buildMigratedDatabase(TEMPLATE_DB);
}
