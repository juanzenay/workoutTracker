import type { TransactionSql } from "postgres";
import type { NewStravaActivity } from "../strava/client";
import { z } from "zod";
import { getStrings } from "@/strings";
import { stravaActivityText } from "../strava/post";
import { planTimeZone } from "./blocks";
import { CommandError, defineCommand, defineSteps, type StepsContext } from "./define";
import { loadWorkoutSummary } from "./records";
import { withStravaTokenOutside } from "./strava";

/**
 * Finished workouts become Strava Weight Training activities (#17). Finishing
 * a workout (applyWorkoutOps) only queues the post, so a slow or failing
 * Strava never blocks the sync; postWorkoutsToStrava sends the queue after
 * the sync commits (the sync route runs it after replying) and the scheduled
 * job retries failures. One row per workout, so an outbox replayed after
 * offline logging can't post twice; how a post is sent keeps a retry from
 * posting twice either (`postWorkoutsToStrava`).
 */

/** Posts that failed this many times are left alone (still stored with their error). */
const MAX_ATTEMPTS = 5;
/** A post in flight this long was abandoned (its run died): another run may take it, looking on Strava first. */
const STALE_POST_MS = 10 * 60_000;
const DAY_SECONDS = 86_400;

/** Queues `workoutId` for posting if Strava is connected and it's finished. No-op if already queued. */
export async function queueStravaPost(tx: TransactionSql, workoutId: string): Promise<void> {
  await tx`
    insert into public.strava_workout_posts (workout_id)
    select w.id from public.workouts w
    where w.id = ${workoutId} and w.finished_at is not null and w.discarded_at is null
      and exists (select 1 from public.strava_connection)
    on conflict (workout_id) do nothing`;
}

/**
 * Sends queued workouts to Strava, oldest first, never twice:
 * 1. claim — each post is marked in flight (`posting_since`) and its attempt counted, and that commits;
 * 2. send — outside any transaction. A retry first looks on Strava for the activity (same name, start time
 *    and sport) in case an earlier attempt got through without its result being recorded (the response was
 *    lost, or the process died before recording it); only if there is none does it create one;
 * 3. record — the activity id, or the error, in a transaction of its own.
 * A post in flight is left alone by other runs until it has been in flight for `STALE_POST_MS` (its run died).
 * A failing post keeps its error and is retried on the next call (up to MAX_ATTEMPTS).
 */
export const postWorkoutsToStrava = defineSteps({
  input: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
  async run({ transaction, actor, strava, now }, { limit }) {
    if (actor.kind === "anon") throw new CommandError("unauthorized", "Sign in first");
    if (!strava.configured) return { posted: 0, failed: 0 };
    const s = getStrings();
    let failed = 0;
    const claimed = await transaction(async (tx) => {
      const [connected] = await tx`select 1 from public.strava_connection`;
      if (!connected) return [];
      const queued = await tx<{ workout_id: string; attempts: number }[]>`
        select workout_id, attempts from public.strava_workout_posts p
        where activity_id is null and attempts < ${MAX_ATTEMPTS}
          -- A discarded workout waits in the queue (untouched) until it is restored.
          and not exists (select 1 from public.workouts w where w.id = p.workout_id and w.discarded_at is not null)
          and (posting_since is null or posting_since < ${new Date(now().getTime() - STALE_POST_MS)})
        order by queued_at, workout_id limit ${limit}
        for update skip locked`;
      const zone = await planTimeZone(tx);
      const posts: ClaimedPost[] = [];
      for (const { workout_id: workoutId, attempts } of queued) {
        const summary = await loadWorkoutSummary(tx, workoutId);
        if (!summary) {
          failed++;
          await tx`
            update public.strava_workout_posts set attempts = attempts + 1, error = ${"The workout isn't finished"}
            where workout_id = ${workoutId}`;
          continue;
        }
        const [start] = await tx<{ local: string }[]>`
          select to_char(${summary.startedAt}::timestamptz at time zone ${zone}, 'YYYY-MM-DD"T"HH24:MI:SS') as local`;
        const { name, description } = stravaActivityText(summary, s);
        const startedAt = Date.parse(summary.startedAt);
        const elapsedSeconds = Math.max(1, Math.round((Date.parse(summary.finishedAt) - startedAt) / 1000));
        await tx`
          update public.strava_workout_posts set posting_since = ${now()}, attempts = attempts + 1
          where workout_id = ${workoutId}`;
        posts.push({
          workoutId,
          retry: attempts > 0,
          startedAt: Math.floor(startedAt / 1000),
          activity: { name, sportType: "WeightTraining", startDateLocal: start!.local, elapsedSeconds, description },
        });
      }
      return posts;
    });

    let posted = 0;
    for (const post of claimed) {
      try {
        const activityId = await send({ transaction, strava, now }, post);
        await transaction(
          (tx) => tx`
            update public.strava_workout_posts
            set activity_id = ${activityId}, posted_at = now(), posting_since = null, error = null
            where workout_id = ${post.workoutId}`,
        );
        posted++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        await transaction(
          (tx) => tx`
            update public.strava_workout_posts set posting_since = null, error = ${message.slice(0, 500)}
            where workout_id = ${post.workoutId}`,
        );
      }
    }
    return { posted, failed };
  },
});

interface ClaimedPost {
  workoutId: string;
  /** An earlier attempt was made: it may have reached Strava. */
  retry: boolean;
  /** Epoch seconds. */
  startedAt: number;
  activity: NewStravaActivity;
}

/** The activity's id on Strava: the one an earlier attempt created, else a new one. */
async function send(ctx: Pick<StepsContext, "transaction" | "strava" | "now">, post: ClaimedPost): Promise<number> {
  const { strava } = ctx;
  if (post.retry) {
    // A day either side covers any difference between the plan's zone and the athlete's.
    const window = { after: post.startedAt - DAY_SECONDS, before: post.startedAt + DAY_SECONDS };
    const listed = await withStravaTokenOutside(ctx, (token) => strava.listActivities(token, window));
    const earlier = listed.find(
      (a) =>
        (a.sport_type ?? a.type) === post.activity.sportType &&
        a.name === post.activity.name &&
        a.start_date_local.replace(/Z$/, "") === post.activity.startDateLocal,
    );
    if (earlier) return earlier.id;
  }
  return (await withStravaTokenOutside(ctx, (token) => strava.createActivity(token, post.activity))).id;
}

export type WorkoutStravaPost =
  | { status: "posted"; activityId: number; error: null }
  /** Queued, or failed and still to be retried (`error` says why). */
  | { status: "pending"; activityId: null; error: string | null }
  /** Gave up after MAX_ATTEMPTS. */
  | { status: "failed"; activityId: null; error: string | null };

/** Where a workout's Strava post stands; null = not queued (Strava wasn't connected when it was finished). */
export const getWorkoutStravaPost = defineCommand({
  input: z.object({ workoutId: z.uuid() }),
  async run({ tx }, { workoutId }): Promise<WorkoutStravaPost | null> {
    const [row] = await tx<{ activity_id: string | null; attempts: number; error: string | null }[]>`
      select activity_id::text, attempts, error from public.strava_workout_posts where workout_id = ${workoutId}`;
    if (!row) return null;
    if (row.activity_id !== null) return { status: "posted", activityId: Number(row.activity_id), error: null };
    return { status: row.attempts >= MAX_ATTEMPTS ? "failed" : "pending", activityId: null, error: row.error };
  },
});
