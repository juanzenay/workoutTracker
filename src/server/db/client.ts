import "server-only";
import postgres, { type Sql } from "postgres";
import { postgresUrl } from "./url";

let sql: Sql | undefined;

/**
 * The app's Postgres connection (Supabase's pooled connection string in
 * production). Commands never use it directly as a superuser: withActor()
 * switches role and JWT claims per transaction so RLS applies.
 */
export function getSql(): Sql {
  if (!sql) {
    const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL (or POSTGRES_URL) is not set");
    // prepare: false — required by Supabase's transaction pooler.
    sql = postgres(postgresUrl(url), { prepare: false, max: 5, onnotice: () => {} });
  }
  return sql;
}
