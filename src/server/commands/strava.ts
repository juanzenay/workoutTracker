import type { TransactionSql } from "postgres";
import { z } from "zod";
import { REQUIRED_STRAVA_SCOPES, StravaAuthError, type StravaActivity } from "../strava/client";
import { CommandError, defineCommand, type CommandContext, type StepsContext } from "./define";
import { replan } from "./replan";

/**
 * Strava integration (single-athlete mode, optional: only with a Strava app
 * configured): OAuth connection, webhook ingestion and run matching. Completed
 * runs can also come from activity files (./activity-imports.ts). An event
 * only says "activity X changed", so every create/update
 * re-fetches the activity with the owner's token, stores it, and re-matches
 * runs. See notes/research/strava-api.md.
 */

export type StravaConnection =
  | { connected: false }
  | {
      connected: true;
      athleteId: number;
      athleteName: string | null;
      scope: string[];
      connectedAt: string;
      /** The app's webhook subscription; null = Strava won't push new activities yet. */
      subscription: { id: number; callbackUrl: string } | null;
    };

interface ConnectionRow {
  athlete_id: string;
  athlete_name: string | null;
  scope: string[];
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  connected_at: Date;
}

async function loadConnection(tx: TransactionSql): Promise<ConnectionRow | undefined> {
  const [row] = await tx<ConnectionRow[]>`
    select athlete_id::text, athlete_name, scope, access_token, refresh_token, expires_at, connected_at
    from public.strava_connection`;
  return row;
}

async function connectionView(tx: TransactionSql): Promise<StravaConnection> {
  const row = await loadConnection(tx);
  if (!row) return { connected: false };
  const [webhook] = await tx<{ subscription_id: string; callback_url: string }[]>`
    select subscription_id::text, callback_url from public.strava_webhook`;
  return {
    connected: true,
    athleteId: Number(row.athlete_id),
    athleteName: row.athlete_name,
    scope: row.scope,
    connectedAt: row.connected_at.toISOString(),
    subscription: webhook ? { id: Number(webhook.subscription_id), callbackUrl: webhook.callback_url } : null,
  };
}

function requireSignedIn(actor: { kind: string }) {
  if (actor.kind === "anon") throw new CommandError("unauthorized", "Sign in first");
}

/**
 * Where completed runs come from: Strava when the deployment has a Strava app (`configured`) and the owner
 * connected it; activity file imports always. Screens show Strava only when it is configured.
 */
export const getActivitySources = defineCommand({
  input: z.object({}),
  async run({ tx, strava }) {
    const connected = strava.configured && !!(await loadConnection(tx));
    return { strava: { configured: strava.configured, connected } };
  },
});

/** Whether Strava is connected, and as whom. Never returns tokens. */
export const getStravaConnection = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    return connectionView(tx);
  },
});

/**
 * Finishes the OAuth flow: exchanges the code from Strava's callback and
 * stores the tokens. `scope` is the callback's `scope` parameter — the owner
 * can untick scopes on Strava's consent screen, and workout tracker needs the activity
 * ones.
 */
export const connectStrava = defineCommand({
  input: z.object({ code: z.string().min(1).max(200), scope: z.string().max(500) }),
  async run({ tx, actor, strava }, { code, scope }) {
    requireSignedIn(actor);
    const granted = scope.split(",").map((s) => s.trim()).filter(Boolean);
    const missing = REQUIRED_STRAVA_SCOPES.filter((s) => !granted.includes(s));
    if (missing.length > 0) {
      throw new CommandError("invalid_input", `Strava needs access to your activities (missing ${missing.join(", ")})`, {
        missing,
      });
    }
    const grant = await strava.exchangeCode(code);
    const name = [grant.athlete.firstname, grant.athlete.lastname].filter(Boolean).join(" ") || grant.athlete.username || null;
    await tx`
      insert into public.strava_connection (athlete_id, athlete_name, scope, access_token, refresh_token, expires_at)
      values (${grant.athlete.id}, ${name}, ${tx.array(granted)}::text[], ${grant.access_token}, ${grant.refresh_token},
        to_timestamp(${grant.expires_at}))
      on conflict (id) do update set athlete_id = excluded.athlete_id, athlete_name = excluded.athlete_name,
        scope = excluded.scope, access_token = excluded.access_token, refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at, connected_at = now(), updated_at = now()`;
    return connectionView(tx);
  },
});

/** Revokes workout tracker's access at Strava (best effort) and forgets the tokens. Stored activities stay. */
export const disconnectStrava = defineCommand({
  input: z.object({}),
  async run({ tx, actor, strava }) {
    requireSignedIn(actor);
    const row = await loadConnection(tx);
    if (row) await strava.deauthorize(row.access_token);
    await tx`delete from public.strava_connection`;
    return connectionView(tx);
  },
});

/** A valid access token, refreshed (and the new refresh token persisted) when it expires within the hour. */
async function accessToken(ctx: StravaContext, force = false): Promise<string | null> {
  const { tx, strava, now } = ctx;
  const row = await loadConnection(tx);
  if (!row) return null;
  if (!force && row.expires_at.getTime() - now().getTime() > 3600_000) return row.access_token;
  const fresh = await strava.refresh(row.refresh_token);
  await tx`
    update public.strava_connection
    set access_token = ${fresh.access_token}, refresh_token = ${fresh.refresh_token},
      expires_at = to_timestamp(${fresh.expires_at}), updated_at = now()`;
  return fresh.access_token;
}

type StravaContext = Pick<CommandContext, "tx" | "strava" | "now">;

/**
 * `withStravaToken` for a multi-step command: the token is read (or refreshed) in a transaction of its own and
 * `call` runs outside any, so nothing is held open while Strava answers.
 */
export async function withStravaTokenOutside<T>(
  ctx: Pick<StepsContext, "transaction" | "strava" | "now">,
  call: (token: string) => Promise<T>,
): Promise<T> {
  const token = (force: boolean) => ctx.transaction((tx) => accessToken({ tx, strava: ctx.strava, now: ctx.now }, force));
  const first = await token(false);
  if (!first) throw new CommandError("invalid_input", "Connect Strava first");
  try {
    return await call(first);
  } catch (error) {
    if (!(error instanceof StravaAuthError)) throw error;
    return call((await token(true))!);
  }
}

/**
 * Calls Strava with the owner's token (refreshed first when it expires within
 * the hour; on a 401 refreshed once more and retried). Wrap every API call in this.
 */
export async function withStravaToken<T>(ctx: StravaContext, call: (token: string) => Promise<T>): Promise<T> {
  const token = await accessToken(ctx);
  if (!token) throw new CommandError("invalid_input", "Connect Strava first");
  try {
    return await call(token);
  } catch (error) {
    if (!(error instanceof StravaAuthError)) throw error;
    return call((await accessToken(ctx, true))!);
  }
}

// ---- Webhook subscription ----

/**
 * Creates the app's webhook subscription pointing at `callbackUrl` (Strava
 * runs the verification handshake against it before answering). Strava allows
 * one per app: an existing one for the same URL is adopted, one for another
 * URL is replaced.
 */
export const subscribeStravaWebhook = defineCommand({
  input: z.object({ callbackUrl: z.url(), verifyToken: z.string().min(1) }),
  async run({ tx, actor, strava }, { callbackUrl, verifyToken }) {
    requireSignedIn(actor);
    const existing = await strava.listSubscriptions();
    let subscription = existing.find((s) => s.callbackUrl === callbackUrl);
    if (!subscription) {
      for (const old of existing) await strava.deleteSubscription(old.id);
      subscription = await strava.createSubscription(callbackUrl, verifyToken);
    }
    await tx`
      insert into public.strava_webhook (subscription_id, callback_url) values (${subscription.id}, ${subscription.callbackUrl})
      on conflict (id) do update set subscription_id = excluded.subscription_id, callback_url = excluded.callback_url,
        created_at = now()`;
    return { subscriptionId: subscription.id, callbackUrl: subscription.callbackUrl };
  },
});

// ---- Webhook events ----

const stravaEvent = z.object({
  object_type: z.enum(["activity", "athlete"]),
  object_id: z.number().int().positive(),
  aspect_type: z.enum(["create", "update", "delete"]),
  owner_id: z.number().int(),
  subscription_id: z.number().int(),
  event_time: z.number().int(),
  updates: z.record(z.string(), z.unknown()).default({}),
});

export type StravaEvent = z.input<typeof stravaEvent>;

/**
 * Records a webhook event (the POST body Strava sends). Fast — the route must
 * answer within 2 s — so it only checks the event is for the connected athlete
 * and our subscription and stores it (retries are no-ops; without a Strava app nothing is taken); processStravaEvents
 * does the fetching. Events are unsigned, so nothing in the payload is trusted
 * beyond "look at activity X". An athlete event revoking access drops the tokens.
 */
export const receiveStravaEvent = defineCommand({
  input: stravaEvent,
  async run({ tx, actor, strava }, event) {
    requireSignedIn(actor);
    if (!strava.configured) return { accepted: false, reason: "not_configured" } as const;
    const connection = await loadConnection(tx);
    if (!connection) return { accepted: false, reason: "not_connected" } as const;
    if (Number(connection.athlete_id) !== event.owner_id) return { accepted: false, reason: "unknown_athlete" } as const;
    const [webhook] = await tx<{ subscription_id: string }[]>`select subscription_id::text from public.strava_webhook`;
    if (webhook && Number(webhook.subscription_id) !== event.subscription_id) {
      return { accepted: false, reason: "unknown_subscription" } as const;
    }
    if (event.object_type === "athlete") {
      if (String(event.updates.authorized) === "false") await tx`delete from public.strava_connection`;
      return { accepted: true } as const;
    }
    await tx`
      insert into public.strava_events (object_type, object_id, aspect_type, owner_id, subscription_id, event_time, updates)
      values (${event.object_type}, ${event.object_id}, ${event.aspect_type}, ${event.owner_id}, ${event.subscription_id},
        ${event.event_time}, ${tx.json(event.updates as Record<string, string>)})
      on conflict (object_type, object_id, aspect_type, event_time) do nothing`;
    return { accepted: true } as const;
  },
});

/** Events that failed this many times are left alone (still stored with their error). */
const MAX_ATTEMPTS = 5;

/**
 * Processes recorded events oldest first: create/update re-fetch the activity
 * from Strava and store it (gone at Strava → removed), delete removes it. Then
 * re-plans (re-matching runs: a short or missed run moves or drops a long run).
 * A failing event is kept with its error and retried on the
 * next call (up to MAX_ATTEMPTS). Run after receiveStravaEvent (the webhook
 * route does, after replying) and from the scheduled job.
 */
export const processStravaEvents = defineCommand({
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  async run({ tx, actor, strava, now, engine, push }, { limit }) {
    requireSignedIn(actor);
    if (!strava.configured) return { processed: 0, failed: 0 };
    const events = await tx<{ id: string; object_id: string; aspect_type: "create" | "update" | "delete" }[]>`
      select id::text, object_id::text, aspect_type from public.strava_events
      where processed_at is null and attempts < ${MAX_ATTEMPTS} and object_type = 'activity'
      order by id limit ${limit}`;
    let processed = 0;
    let failed = 0;
    for (const event of events) {
      try {
        await tx.savepoint(async (sp) => {
          await ingestActivity({ tx: sp, strava, now }, Number(event.object_id), event.aspect_type);
          await sp`
            update public.strava_events set processed_at = now(), attempts = attempts + 1, error = null
            where id = ${event.id}`;
        });
        processed++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        await tx`
          update public.strava_events set attempts = attempts + 1, error = ${message.slice(0, 500)} where id = ${event.id}`;
      }
    }
    if (events.length > 0) await replan(tx, engine, push, now()); // re-matches runs; a short or missed run re-plans
    return { processed, failed };
  },
});

async function ingestActivity(ctx: StravaContext, id: number, aspect: "create" | "update" | "delete"): Promise<void> {
  const { tx, strava } = ctx;
  const activity = aspect === "delete" ? null : await withStravaToken(ctx, (token) => strava.getActivity(token, id));
  const connection = await loadConnection(tx);
  if (!activity || (connection && activity.athlete.id !== Number(connection.athlete_id))) {
    await tx`delete from public.activities where strava_id = ${id}`;
    return;
  }
  await upsertActivity(tx, activity);
}

async function upsertActivity(tx: TransactionSql, a: StravaActivity): Promise<void> {
  const local = a.start_date_local.replace(/Z$/, "");
  await tx`
    insert into public.activities
      (source, strava_id, name, sport_type, start_date, start_date_local, local_date, distance_meters, moving_seconds, elapsed_seconds,
        manual, device_name, raw)
    values ('strava', ${a.id}, ${a.name ?? null}, ${a.sport_type ?? a.type ?? "Workout"}, ${a.start_date}, ${local},
      ${local.slice(0, 10)}, ${a.distance ?? 0}, ${a.moving_time ?? null}, ${a.elapsed_time ?? null}, ${a.manual ?? false},
      ${a.device_name ?? null}, ${tx.json(a.raw as Record<string, never>)})
    on conflict (strava_id) do update set name = excluded.name, sport_type = excluded.sport_type, start_date = excluded.start_date,
      start_date_local = excluded.start_date_local, local_date = excluded.local_date,
      distance_meters = excluded.distance_meters, moving_seconds = excluded.moving_seconds,
      elapsed_seconds = excluded.elapsed_seconds, manual = excluded.manual, device_name = excluded.device_name,
      raw = excluded.raw, fetched_at = now()`;
}

// ---- Reads and the end-of-day job ----

export interface StoredStravaActivity {
  id: number;
  name: string | null;
  sportType: string;
  startDate: string;
  localDate: string;
  distanceMeters: number;
  movingSeconds: number | null;
  elapsedSeconds: number | null;
  manual: boolean;
  /** The planned run it counts toward, if any. */
  plannedRunId: string | null;
}

interface ActivityRow {
  id: string;
  name: string | null;
  sport_type: string;
  start_date: Date;
  local_date: string;
  distance_meters: string;
  moving_seconds: number | null;
  elapsed_seconds: number | null;
  manual: boolean;
  planned_run_id: string | null;
}

/** Activities stored from Strava, newest first (listActivities has file imports too). */
export const listStravaActivities = defineCommand({
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  async run({ tx }, { limit }) {
    const rows = await tx<ActivityRow[]>`
      select strava_id::text as id, name, sport_type, start_date, to_char(local_date, 'YYYY-MM-DD') as local_date,
        distance_meters::text, moving_seconds, elapsed_seconds, manual, planned_run_id
      from public.activities where source = 'strava' order by start_date desc, strava_id desc limit ${limit}`;
    const activities: StoredStravaActivity[] = rows.map((r) => ({
      id: Number(r.id),
      name: r.name,
      sportType: r.sport_type,
      startDate: r.start_date.toISOString(),
      localDate: r.local_date,
      distanceMeters: Number(r.distance_meters),
      movingSeconds: r.moving_seconds,
      elapsedSeconds: r.elapsed_seconds,
      manual: r.manual,
      plannedRunId: r.planned_run_id,
    }));
    return { activities };
  },
});

/**
 * The daily re-plan: closes finished days — a planned run with no activity
 * once its day is over (plan time zone) becomes missed, and missed sessions and
 * long runs move or drop (src/engine/replan.ts). For the scheduled
 * job; ingestion and re-plans do the same as they go.
 */
export const refreshRunStatuses = defineCommand({
  input: z.object({}),
  async run({ tx, actor, now, engine, push }) {
    requireSignedIn(actor);
    await replan(tx, engine, push, now());
    return {};
  },
});
