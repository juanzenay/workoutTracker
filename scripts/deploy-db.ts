/**
 * Applies supabase/migrations to the deployment's database. Runs before `next build` on Vercel
 * (package.json "vercel-build"); run it by hand with `npm run db:deploy`.
 * See src/server/deploy/target.ts for when it migrates, skips or fails.
 */
import { join } from "node:path";
import postgres from "postgres";
import { deployDatabase } from "../src/server/deploy/migrate";
import { migrationTarget } from "../src/server/deploy/target";

const target = migrationTarget(process.env);
if (target.kind === "skip") {
  console.log(`Workout tracker: not applying migrations (${target.reason}).`);
} else if (target.kind === "error") {
  console.error(`Workout tracker: ${target.message}`);
  process.exit(1);
} else {
  const sql = postgres(target.url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const { applied } = await deployDatabase({
      sql,
      migrationsDir: join(import.meta.dirname, "..", "supabase", "migrations"),
      ownerEmail: target.ownerEmail,
    });
    console.log(applied.length ? `Workout tracker: applied migrations ${applied.join(", ")}.` : "Workout tracker: database is up to date.");
    console.log(target.ownerEmail ? "Workout tracker: only OWNER_EMAIL can claim this deployment." : "Workout tracker: OWNER_EMAIL not set; the first sign-up claims this deployment.");
  } catch (error) {
    console.error(`Workout tracker: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}
