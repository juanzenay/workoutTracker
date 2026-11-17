import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { WorkoutOpInput } from "@/domain/workout";
import { join } from "node:path";
import { setupTestDb } from "../../../tests/db/test-db";
import { STRAVA_FIXTURES, type RecordedRequest } from "../../../tests/fixtures/recorded-fetch";

const db = setupTestDb();

const SCOPE = "read,activity:write,activity:read_all";
const BENCH = "Barbell Bench Press - Medium Grip";
const PULLUP = "Pullups";
const POSTED_ACTIVITY = 16012345690;

type Commands = ReturnType<ReturnType<typeof db>["commandsAs"]>;

/** The signed-in owner; every request sent to Strava lands in `requests`. */
async function owner(options: { stravaFixtures?: string; connect?: boolean } = {}) {
  const user = await db().signUp("owner@example.com");
  const requests: RecordedRequest[] = [];
  const commands = db().commandsAs({ kind: "user", userId: user.id }, { stravaRequests: requests, ...options });
  if (options.connect !== false) await commands.connectStrava({ code: "auth-code-1", scope: SCOPE });
  return { commands, requests, userId: user.id };
}

async function exerciseId(commands: Commands, name: string) {
  const { items } = await commands.listExercises({ query: name });
  const exercise = items.find((e) => e.name === name);
  if (!exercise) throw new Error(`No catalogue exercise ${name}`);
  return exercise.id;
}

/** `[weight, reps, warm-up?]`; weight null = bodyweight. */
type SetSpec = [number | null, number, "warmup"?];

/** A finished workout's outbox as the logger queues it, on `day` 07:00–08:00 UTC. */
function workoutOps(
  day: string,
  exercises: Record<string, SetSpec[]>,
  { name = null }: { name?: string | null } = {},
): { workoutId: string; ops: WorkoutOpInput[] } {
  const workoutId = randomUUID();
  const ops: WorkoutOpInput[] = [{ type: "startWorkout", id: workoutId, name, startedAt: `${day}T07:00:00.000Z` }];
  Object.entries(exercises).forEach(([exercise, sets], position) => {
    const workoutExerciseId = randomUUID();
    ops.push({ type: "addExercise", id: workoutExerciseId, workoutId, exerciseId: exercise, position });
    sets.forEach(([weight, reps, setType = "normal" as const], i) =>
      ops.push({
        type: "putSet",
        id: randomUUID(),
        workoutExerciseId,
        position: i,
        setType,
        weight,
        unit: "lb",
        reps,
        completed: true,
      }),
    );
  });
  ops.push({ type: "finishWorkout", id: workoutId, finishedAt: `${day}T08:00:00.000Z` });
  return { workoutId, ops };
}

const posts = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.method === "POST" && r.path === "/api/v3/activities");

describe("posting finished workouts to Strava", () => {
  it("creates one Weight Training activity with the workout's summary", async () => {
    const { commands, requests } = await owner();
    const bench = await exerciseId(commands, BENCH);
    const pullups = await exerciseId(commands, PULLUP);
    // An earlier bench session, so this one sets PRs.
    await commands.applyWorkoutOps(workoutOps("2026-10-05", { [bench]: [[182.5, 8], [182.5, 6]] }));
    await commands.postWorkoutsToStrava({});
    requests.length = 0;

    const { workoutId, ops } = workoutOps("2026-10-08", {
      [bench]: [[95, 10, "warmup"], [190, 8], [190, 6]],
      [pullups]: [[null, 10], [null, 8]],
    });
    await commands.applyWorkoutOps({ ops });
    expect(await commands.postWorkoutsToStrava({})).toEqual({ posted: 1, failed: 0 });

    expect(posts(requests)).toHaveLength(1);
    expect(Object.fromEntries(new URLSearchParams(posts(requests)[0]!.body!))).toEqual({
      name: "Weight training",
      sport_type: "WeightTraining",
      type: "WeightTraining",
      start_date_local: "2026-10-08T07:00:00",
      elapsed_time: "3600",
      description: [
        "Barbell Bench Press - Medium Grip: 2 sets, 2,660 lb",
        "Pullups: 2 sets",
        "",
        "4 sets · 2,660 lb · 1 h 0 min",
        "PRs: Barbell Bench Press - Medium Grip (Heaviest weight 190 lb, Best est. 1RM 240.7 lb, Best set volume 1,520 lb)",
        "",
        "Logged with workout tracker",
      ].join("\n"),
    });
    expect(await commands.getWorkoutStravaPost({ workoutId })).toEqual({
      status: "posted",
      activityId: POSTED_ACTIVITY,
      error: null,
    });
  });

  it("posts a workout logged offline once it syncs, and never twice however often the outbox replays", async () => {
    const { commands, requests } = await owner();
    const bench = await exerciseId(commands, BENCH);
    const { workoutId, ops } = workoutOps("2026-10-08", { [bench]: [[185, 5], [185, 5]] });

    // Nothing reaches the server while offline; then the outbox flushes in two batches,
    // and the device (unsure the last response arrived) replays the whole outbox.
    await commands.applyWorkoutOps({ ops: ops.slice(0, 3) });
    await commands.postWorkoutsToStrava({});
    expect(posts(requests)).toHaveLength(0);
    expect(await commands.getWorkoutStravaPost({ workoutId })).toBeNull();

    await commands.applyWorkoutOps({ ops: ops.slice(3) });
    await commands.postWorkoutsToStrava({});
    await commands.applyWorkoutOps({ ops });
    await commands.applyWorkoutOps({ ops });
    await commands.postWorkoutsToStrava({});

    expect(posts(requests)).toHaveLength(1);
    expect(await commands.getWorkoutStravaPost({ workoutId })).toMatchObject({ status: "posted", activityId: POSTED_ACTIVITY });
  });

  it("doesn't post workouts finished while Strava wasn't connected", async () => {
    const { commands, requests } = await owner({ connect: false });
    const bench = await exerciseId(commands, BENCH);
    const { workoutId, ops } = workoutOps("2026-10-08", { [bench]: [[185, 5]] });
    await commands.applyWorkoutOps({ ops });
    await commands.connectStrava({ code: "auth-code-1", scope: SCOPE });
    expect(await commands.postWorkoutsToStrava({})).toEqual({ posted: 0, failed: 0 });
    expect(posts(requests)).toHaveLength(0);
    expect(await commands.getWorkoutStravaPost({ workoutId })).toBeNull();
  });

  it("retries a failed post later without holding up finishing the workout", async () => {
    const { commands, requests } = await owner({ stravaFixtures: join(STRAVA_FIXTURES, "../strava-post-flaky") });
    const bench = await exerciseId(commands, BENCH);
    const { workoutId, ops } = workoutOps("2026-10-08", { [bench]: [[185, 5]] });

    await commands.applyWorkoutOps({ ops });
    expect((await commands.listWorkouts({})).items.map((w) => w.id)).toEqual([workoutId]);

    expect(await commands.postWorkoutsToStrava({})).toEqual({ posted: 0, failed: 1 });
    expect(await commands.getWorkoutStravaPost({ workoutId })).toEqual({
      status: "pending",
      activityId: null,
      error: expect.stringContaining("503"),
    });

    expect(await commands.postWorkoutsToStrava({})).toEqual({ posted: 1, failed: 0 });
    expect(await commands.getWorkoutStravaPost({ workoutId })).toMatchObject({ status: "posted", activityId: POSTED_ACTIVITY });
    expect(posts(requests)).toHaveLength(2);
  });

  it("a retry finds the activity an earlier attempt created (its response was lost) instead of posting again", async () => {
    const { commands, requests } = await owner({ stravaFixtures: join(STRAVA_FIXTURES, "../strava-post-lost") });
    const bench = await exerciseId(commands, BENCH);
    const { workoutId, ops } = workoutOps("2026-10-08", { [bench]: [[185, 5]] });
    await commands.applyWorkoutOps({ ops });

    // Strava creates the activity, but workout tracker never reads the answer.
    expect(await commands.postWorkoutsToStrava({})).toEqual({ posted: 0, failed: 1 });
    expect(await commands.postWorkoutsToStrava({})).toEqual({ posted: 1, failed: 0 });

    expect(posts(requests)).toHaveLength(1);
    expect(await commands.getWorkoutStravaPost({ workoutId })).toMatchObject({ status: "posted", activityId: POSTED_ACTIVITY });
  });

  it("a post left in flight (its run died after sending) is not sent again: once abandoned, the retry finds it on Strava", async () => {
    const user = await db().signUp("owner@example.com");
    const requests: RecordedRequest[] = [];
    const at = (iso: string) =>
      db().commandsAs(
        { kind: "user", userId: user.id },
        { stravaRequests: requests, stravaFixtures: join(STRAVA_FIXTURES, "../strava-post-lost"), now: new Date(iso) },
      );
    const commands = at("2026-10-08T08:05:00Z");
    await commands.connectStrava({ code: "auth-code-1", scope: SCOPE });
    const bench = await exerciseId(commands, BENCH);
    const { workoutId, ops } = workoutOps("2026-10-08", { [bench]: [[185, 5]] });
    await commands.applyWorkoutOps({ ops });
    // Harness: a run claimed the post and sent it at 08:05, then died before recording what Strava answered.
    await db().sql`
      update public.strava_workout_posts set attempts = 1, posting_since = '2026-10-08T08:05:00Z'
      where workout_id = ${workoutId}`;

    // Two minutes later it may still be in flight: nobody sends it again.
    expect(await at("2026-10-08T08:07:00Z").postWorkoutsToStrava({})).toEqual({ posted: 0, failed: 0 });
    // Abandoned: the retry looks on Strava first, finds it, and records it.
    expect(await at("2026-10-08T08:30:00Z").postWorkoutsToStrava({})).toEqual({ posted: 1, failed: 0 });

    expect(posts(requests)).toHaveLength(0);
    expect(await commands.getWorkoutStravaPost({ workoutId })).toMatchObject({ status: "posted", activityId: POSTED_ACTIVITY });
  });

  it("gives up after repeated failures, keeping the error", async () => {
    const { commands, requests } = await owner({ stravaFixtures: join(STRAVA_FIXTURES, "../strava-post-down") });
    const bench = await exerciseId(commands, BENCH);
    const { workoutId, ops } = workoutOps("2026-10-08", { [bench]: [[185, 5]] });
    await commands.applyWorkoutOps({ ops });

    for (let i = 0; i < 7; i++) await commands.postWorkoutsToStrava({});

    expect(posts(requests)).toHaveLength(5);
    expect(await commands.getWorkoutStravaPost({ workoutId })).toEqual({
      status: "failed",
      activityId: null,
      error: expect.stringContaining("503"),
    });
  });

  it("starts the activity at the workout's wall-clock time in the plan's time zone, under the workout's name", async () => {
    const { commands, requests } = await owner();
    const race = await commands.createRace({ name: "Tune-up 10K", date: "2026-11-01", distanceMeters: 10_000, priority: "B" });
    await commands.importRunPlan({
      format: "json",
      content: JSON.stringify({ name: "Base", runs: [{ week: 1, day: "sun", type: "long", distance_m: 16093 }] }),
      raceId: race.id,
      timeZone: "America/Chicago",
    });
    const bench = await exerciseId(commands, BENCH);
    await commands.applyWorkoutOps(workoutOps("2026-10-08", { [bench]: [[185, 5]] }, { name: "Push A" }));

    await commands.postWorkoutsToStrava({});

    const sent = new URLSearchParams(posts(requests)[0]!.body!);
    expect(sent.get("start_date_local")).toBe("2026-10-08T02:00:00");
    expect(sent.get("name")).toBe("Push A");
  });
});
