import type { Sql, TransactionSql } from "postgres";

/**
 * Who a command runs as. Every database call happens inside a transaction that
 * takes on the matching Supabase role and JWT claims, so row-level security
 * applies exactly as it would through Supabase's API.
 */
export type Actor =
  | { kind: "anon" }
  | { kind: "user"; userId: string }
  /** Trusted server jobs (webhooks, cron). Bypasses RLS like Supabase's service_role. */
  | { kind: "service" };

const ROLE: Record<Actor["kind"], string> = {
  anon: "anon",
  user: "authenticated",
  service: "service_role",
};

function claims(actor: Actor): Record<string, string> {
  switch (actor.kind) {
    case "anon":
      return { role: "anon" };
    case "user":
      return { role: "authenticated", sub: actor.userId };
    case "service":
      return { role: "service_role" };
  }
}

export async function withActor<T>(
  sql: Sql,
  actor: Actor,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims(actor))}, true)`;
    await tx.unsafe(`set local role ${ROLE[actor.kind]}`);
    return fn(tx);
  });
  return result as T;
}
