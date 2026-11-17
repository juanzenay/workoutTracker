import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "postgres";

export interface DeployDatabaseOptions {
  /** A superuser-ish connection to the project's database (Supabase's `postgres` role; session mode, not the transaction pooler). */
  sql: Sql;
  /** supabase/migrations: `<version>_<name>.sql`, applied in filename order. */
  migrationsDir: string;
  /**
   * The only email allowed to claim the deployment (OWNER_EMAIL). Unset: whoever signs up first claims it.
   * Either way, once claimed every other account is refused (the owner_lock migration).
   */
  ownerEmail?: string;
}

/**
 * Brings a Supabase project's database up to date on deploy: applies every migration in
 * `migrationsDir` not yet recorded in `supabase_migrations.schema_migrations` (the Supabase CLI's
 * own history table, so `supabase db push` and this agree), one transaction each, then records
 * the owner email. Safe to run on every build and from concurrent builds.
 */
export async function deployDatabase({ sql, migrationsDir, ownerEmail }: DeployDatabaseOptions): Promise<{ applied: string[] }> {
  await sql.unsafe(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);

  const applied: string[] = [];
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const match = /^(\d+)_(.+)\.sql$/.exec(file);
    if (!match) throw new Error(`Migration file name must be <version>_<name>.sql: ${file}`);
    const [, version, name] = match as unknown as [string, string, string];
    const ran = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('workout tracker: deploy migrations'))`;
      // A migration applied by the Supabase CLI or the dashboard may carry another version; match its name too.
      const [done] = await tx`
        select 1 from supabase_migrations.schema_migrations where version = ${version} or name = ${name} limit 1`;
      if (done) return false;
      try {
        await tx.unsafe(readFileSync(join(migrationsDir, file), "utf8"));
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
      await tx`insert into supabase_migrations.schema_migrations (version, name) values (${version}, ${name})`;
      return true;
    });
    if (ran) applied.push(version);
  }

  const email = ownerEmail?.trim().toLowerCase();
  if (email) {
    await sql`
      insert into public.owner_email (email) values (${email})
      on conflict (singleton) do update set email = excluded.email`;
  } else {
    await sql`delete from public.owner_email`;
  }
  return { applied };
}
