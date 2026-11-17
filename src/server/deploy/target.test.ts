import { describe, expect, it } from "vitest";
import { migrationTarget } from "./target";

const DIRECT = "postgres://postgres.abc:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require&supa=base-pooler.x";
const POOLED = "postgres://postgres.abc:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x";

describe("where deploy migrations go", () => {
  it("uses the integration's session (non-pooling) connection on a production build, without pooler-only parameters", () => {
    expect(
      migrationTarget({ VERCEL: "1", VERCEL_ENV: "production", POSTGRES_URL: POOLED, POSTGRES_URL_NON_POOLING: DIRECT, OWNER_EMAIL: "me@x.com" }),
    ).toEqual({
      kind: "migrate",
      url: "postgres://postgres.abc:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require",
      ownerEmail: "me@x.com",
    });
  });

  it("falls back to DATABASE_URL then POSTGRES_URL", () => {
    expect(migrationTarget({ DATABASE_URL: "postgres://a@h/db", POSTGRES_URL: POOLED })).toMatchObject({ url: "postgres://a@h/db" });
    expect(migrationTarget({ POSTGRES_URL: POOLED })).toMatchObject({
      url: "postgres://postgres.abc:pw@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require",
    });
  });

  it("leaves preview builds alone (they may share the production database) unless asked", () => {
    expect(migrationTarget({ VERCEL: "1", VERCEL_ENV: "preview", POSTGRES_URL_NON_POOLING: DIRECT })).toMatchObject({ kind: "skip" });
    expect(
      migrationTarget({ VERCEL: "1", VERCEL_ENV: "preview", POSTGRES_URL_NON_POOLING: DIRECT, MIGRATE_PREVIEW: "1" }),
    ).toMatchObject({ kind: "migrate" });
  });

  it("can be switched off", () => {
    expect(migrationTarget({ SKIP_MIGRATIONS: "1", DATABASE_URL: "postgres://a@h/db" })).toMatchObject({ kind: "skip" });
  });

  it("skips a local build without a database, but fails a Vercel build that has none (the Supabase integration is missing)", () => {
    expect(migrationTarget({})).toMatchObject({ kind: "skip" });
    expect(migrationTarget({ VERCEL: "1", VERCEL_ENV: "production" })).toMatchObject({
      kind: "error",
      message: expect.stringMatching(/Supabase/),
    });
  });
});
