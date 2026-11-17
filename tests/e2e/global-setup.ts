import postgres from "postgres";
import { buildMigratedDatabase } from "../db/database";
import { E2E_DATABASE_URL, E2E_DB, E2E_OWNER } from "./owner";

/** Fresh migrated database with the owner's account, before every e2e run. */
export default async function globalSetup() {
  await buildMigratedDatabase(E2E_DB);
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`insert into auth.users (id, email) values (${E2E_OWNER.id}, ${E2E_OWNER.email})`;
  } finally {
    await sql.end();
  }
}
