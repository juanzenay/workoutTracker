import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBootstrappedDatabase, dropDatabase, migrationFiles, urlFor } from "../../../tests/db/database";
import { deployDatabase } from "./migrate";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "..", "supabase", "migrations");
const versions = () => migrationFiles().map((f) => basename(f).split("_")[0]!);

/** A fresh, empty Supabase project per test (the shim only, no migrations). */
let name: string;
let sql: Sql;
beforeEach(async () => {
  name = `workout_tracker_test_deploy_${randomUUID().replaceAll("-", "")}`;
  await buildBootstrappedDatabase(name);
  sql = postgres(urlFor(name), { max: 2, onnotice: () => {} });
});
afterEach(async () => {
  await sql.end();
  await dropDatabase(name);
});

const signUp = (email: string) => sql`insert into auth.users (email) values (${email})`;

describe("deploying the database", () => {
  it("applies every migration to a fresh project, then nothing on the next deploy", async () => {
    const first = await deployDatabase({ sql, migrationsDir: MIGRATIONS_DIR });
    expect(first.applied).toEqual(versions());

    const second = await deployDatabase({ sql, migrationsDir: MIGRATIONS_DIR });
    expect(second.applied).toEqual([]);

    // The schema is live: the first account claims the deployment, later ones are refused.
    await signUp("friend@example.com");
    await expect(signUp("stranger@example.com")).rejects.toThrow(/locked to its owner/);
  });

  it("skips migrations the Supabase CLI already applied, even under another version", async () => {
    const [firstFile] = migrationFiles();
    await sql.unsafe(readFileSync(firstFile!, "utf8"));
    const cliName = basename(firstFile!, ".sql").split("_").slice(1).join("_");
    await sql.unsafe(`
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
    await sql`insert into supabase_migrations.schema_migrations (version, name) values ('20990101000000', ${cliName})`;

    const { applied } = await deployDatabase({ sql, migrationsDir: MIGRATIONS_DIR });

    expect(applied).toEqual(versions().slice(1));
  });

  it("with an owner email, lets only that email claim the deployment", async () => {
    await deployDatabase({ sql, migrationsDir: MIGRATIONS_DIR, ownerEmail: "Friend@Example.com " });

    await expect(signUp("stranger@example.com")).rejects.toThrow(/reserved for its owner/);
    await signUp("friend@example.com");
    await expect(signUp("friend2@example.com")).rejects.toThrow(/locked to its owner/);
  });

  it("an owner email can be dropped again on a later deploy", async () => {
    await deployDatabase({ sql, migrationsDir: MIGRATIONS_DIR, ownerEmail: "friend@example.com" });
    await deployDatabase({ sql, migrationsDir: MIGRATIONS_DIR });

    await signUp("someone@example.com");
  });
});
