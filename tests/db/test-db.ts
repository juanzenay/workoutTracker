import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterEach, beforeEach } from "vitest";
import {
  createCommands,
  type Actor,
  type Commands,
  type Engine,
} from "@/server/commands";
import { createHevyClient } from "@/server/hevy/client";
import type { BackupTargets } from "@/server/backup/targets";
import { createStravaClient } from "@/server/strava/client";
import type { PushSender } from "@/server/push/sender";
import { createWgerClient } from "@/server/wger/client";
import {
  HEVY_FIXTURES,
  recordedFetch,
  type RecordedRequest,
  STRAVA_FIXTURES,
  WGER_FIXTURES,
} from "../fixtures/recorded-fetch";
import { adminSql, TEMPLATE_DB, urlFor } from "./database";

export interface TestDb {
  /** Superuser connection to this test's database. For harness helpers only — tests assert through commands. */
  sql: Sql;
  /** Simulates Supabase Auth creating an account (an insert into auth.users). */
  signUp(email: string): Promise<{ id: string; email: string }>;
  /**
   * The command layer as seen by `actor`, wired to this test's database and to recorded wger and Hevy
   * responses (no network). `hevyFixtures` picks another recorded Hevy account state (default tests/fixtures/hevy).
   * `stravaFixtures` likewise for Strava (default tests/fixtures/strava; sequenced routes advance per Commands instance).
   * `stravaRequests` collects every request sent to Strava (to assert what was posted, and how often).
   * `stravaConfigured: false` is a deployment without a Strava app (no client id / secret; default: configured).
   * `now` pins the clock (when a day is over, token expiry).
   * `engine` wraps the real engine (e.g. pin `today`, or flag fixture changes as requiring confirmation).
   * `push` receives Web Push sends (default: discards them); see tests/fixtures/fake-push.ts.
   * `backup` are the backup targets (default: none configured); see tests/fixtures/fake-backup.ts.
   */
  commandsAs(
    actor: Actor,
    options?: {
      hevyFixtures?: string;
      stravaFixtures?: string;
      stravaRequests?: RecordedRequest[];
      stravaConfigured?: boolean;
      engine?: Engine;
      now?: Date;
      push?: PushSender;
      backup?: BackupTargets;
    },
  ): Commands;
}

/**
 * Gives every test its own database cloned from the migrated template.
 *
 *   const db = setupTestDb();
 *   it("...", async () => {
 *     const owner = await db().signUp("owner@example.com");
 *     const commands = db().commandsAs({ kind: "user", userId: owner.id });
 *   });
 */
/** Default push sender in tests: accepts and drops every message (no network). */
const discardPush: PushSender = { send: async () => "sent" };
/** Default backup targets in tests: none configured (never the environment's live ones). */
const noBackup: BackupTargets = { github: null, storage: null };

export function setupTestDb(): () => TestDb {
  let current: { name: string; sql: Sql } | undefined;

  beforeEach(async () => {
    const name = `workout_tracker_test_${randomUUID().replaceAll("-", "")}`;
    const admin = adminSql();
    try {
      await admin.unsafe(`create database "${name}" template "${TEMPLATE_DB}"`);
    } finally {
      await admin.end();
    }
    current = {
      name,
      sql: postgres(urlFor(name), { max: 4, onnotice: () => {} }),
    };
  });

  afterEach(async () => {
    if (!current) return;
    const { name, sql } = current;
    current = undefined;
    await sql.end();
    const admin = adminSql();
    try {
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
    } finally {
      await admin.end();
    }
  });

  return () => {
    if (!current)
      throw new Error(
        "setupTestDb(): database is only available inside a test",
      );
    const { sql } = current;
    return {
      sql,
      async signUp(email) {
        const [row] = await sql<{ id: string; email: string }[]>`
          insert into auth.users (email) values (${email}) returning id, email`;
        return row!;
      },
      commandsAs(
        actor,
        {
          hevyFixtures = HEVY_FIXTURES,
          stravaFixtures = STRAVA_FIXTURES,
          stravaRequests,
          stravaConfigured = true,
          engine,
          now,
          push = discardPush,
          backup = noBackup,
        } = {},
      ) {
        const wger = createWgerClient({
          fetch: recordedFetch(WGER_FIXTURES),
          baseUrl: "https://wger.de",
        });
        const hevy = createHevyClient({
          fetch: recordedFetch(hevyFixtures),
          baseUrl: "https://api.hevyapp.com",
          sleep: async () => {},
        });
        const strava = createStravaClient({
          fetch: recordedFetch(stravaFixtures, stravaRequests),
          apiBaseUrl: "https://www.strava.com/api/v3",
          oauthBaseUrl: "https://www.strava.com",
          clientId: stravaConfigured ? "12345" : "",
          clientSecret: stravaConfigured ? "test-client-secret" : "",
        });
        return createCommands({
          sql,
          actor,
          wger,
          hevy,
          strava,
          engine,
          now: now ? () => now : undefined,
          push,
          backup,
        });
      },
    };
  };
}
