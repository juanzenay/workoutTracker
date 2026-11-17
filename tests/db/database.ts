import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

/**
 * Local Postgres used as "local Supabase" for tests.
 * Override with TEST_DATABASE_URL (must point at a role allowed to CREATE DATABASE).
 */
export const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/postgres";

const ROOT = join(import.meta.dirname, "..", "..");

/**
 * One template per checkout, so test runs in parallel worktrees (each with its
 * own migrations) never drop or clone each other's template.
 */
export const TEMPLATE_DB = `workout_tracker_test_template_${createHash("sha1").update(ROOT).digest("hex").slice(0, 10)}`;
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const BOOTSTRAP = join(ROOT, "supabase", "tests", "bootstrap.sql");

export function urlFor(database: string): string {
  const url = new URL(ADMIN_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

export function adminSql() {
  return postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

/** Drops and recreates `database` as an empty "fresh Supabase project": the Supabase shim, no migrations. */
export async function buildBootstrappedDatabase(database: string): Promise<void> {
  const admin = adminSql();
  try {
    await admin.unsafe(`drop database if exists "${database}" with (force)`);
    await admin.unsafe(`create database "${database}"`);
  } finally {
    await admin.end();
  }
  const db = postgres(urlFor(database), { max: 1, onnotice: () => {} });
  try {
    await db.unsafe(readFileSync(BOOTSTRAP, "utf8"));
  } finally {
    await db.end();
  }
}

export async function dropDatabase(database: string): Promise<void> {
  const admin = adminSql();
  try {
    await admin.unsafe(`drop database if exists "${database}" with (force)`);
  } finally {
    await admin.end();
  }
}

/** Drops and recreates `database`, then applies the Supabase shim and every migration in order. */
export async function buildMigratedDatabase(database: string): Promise<void> {
  await buildBootstrappedDatabase(database);
  const db = postgres(urlFor(database), { max: 1, onnotice: () => {} });
  try {
    for (const file of migrationFiles()) {
      try {
        await db.unsafe(readFileSync(file, "utf8"));
      } catch (error) {
        throw new Error(`Migration failed: ${file}\n${(error as Error).message}`);
      }
    }
  } finally {
    await db.end();
  }
}
