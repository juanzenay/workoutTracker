import { describe, expect, it } from "vitest";
import { postgresUrl } from "./url";

describe("Postgres connection strings", () => {
  it("drops the query parameters Vercel's Supabase integration adds for other drivers", () => {
    expect(
      postgresUrl("postgres://u:p@h.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x&pgbouncer=true&workaround=supabase-pooler.vercel"),
    ).toBe("postgres://u:p@h.pooler.supabase.com:6543/postgres?sslmode=require");
  });

  it("leaves a plain connection string as it is", () => {
    expect(postgresUrl("postgres://postgres:postgres@127.0.0.1:5432/postgres")).toBe("postgres://postgres:postgres@127.0.0.1:5432/postgres");
  });
});
