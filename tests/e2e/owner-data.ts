import postgres from "postgres";
import { E2E_DATABASE_URL } from "./owner";

/**
 * Specs share one e2e database, so a spec that depends on what the owner has
 * (blocks, workouts, plan revisions, inbox items…) starts and ends with
 * `resetOwnerData()`: every owner table emptied, whichever spec wrote it. Keeps
 * the owner's account and the seeded exercise catalogue; drops custom/imported
 * exercises. New owner tables are covered without touching this list.
 */
const KEEP = ["owner", "exercises"];

export async function resetOwnerData(): Promise<void> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const tables = await sql<{ name: string }[]>`
      select format('public.%I', tablename) as name from pg_tables
      where schemaname = 'public' and tablename::text not in ${sql(KEEP)}`;
    await sql.begin(async (tx) => {
      await tx.unsafe(`truncate ${tables.map((t) => t.name).join(", ")} cascade`);
      await tx`delete from public.exercises where source in ('custom', 'hevy')`;
    });
  } finally {
    await sql.end();
  }
}
