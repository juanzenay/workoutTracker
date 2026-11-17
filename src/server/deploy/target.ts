import { postgresUrl } from "../db/url";

export type MigrationTarget =
  | { kind: "migrate"; url: string; ownerEmail?: string }
  | { kind: "skip"; reason: string }
  | { kind: "error"; message: string };

/**
 * Decides, from the build environment, whether and where `npm run db:deploy` applies migrations.
 *
 * - Prefers a session connection (`POSTGRES_URL_NON_POOLING`, set by Vercel's Supabase integration):
 *   migrations run DDL in transactions, which the transaction pooler doesn't suit.
 * - Vercel preview builds are skipped (they may point at the production database) unless `MIGRATE_PREVIEW=1`.
 * - `SKIP_MIGRATIONS=1` skips; a local build without a database skips; a Vercel build without one fails.
 */
export function migrationTarget(env: Record<string, string | undefined>): MigrationTarget {
  if (env.SKIP_MIGRATIONS === "1") return { kind: "skip", reason: "SKIP_MIGRATIONS=1" };
  const onVercel = Boolean(env.VERCEL);
  if (onVercel && env.VERCEL_ENV !== "production" && env.MIGRATE_PREVIEW !== "1") {
    return { kind: "skip", reason: `Vercel ${env.VERCEL_ENV ?? "unknown"} build (set MIGRATE_PREVIEW=1 to migrate)` };
  }
  const raw = env.MIGRATIONS_DATABASE_URL || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL || env.POSTGRES_URL;
  if (!raw) {
    return onVercel
      ? {
          kind: "error",
          message:
            "No database connection string (POSTGRES_URL_NON_POOLING). Add the Supabase integration to this Vercel project (Storage → Supabase) and redeploy.",
        }
      : { kind: "skip", reason: "no database connection string set" };
  }
  const ownerEmail = env.OWNER_EMAIL?.trim();
  return { kind: "migrate", url: postgresUrl(raw), ...(ownerEmail ? { ownerEmail } : {}) };
}
