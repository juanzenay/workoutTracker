import { describe, expect, it } from "vitest";
import type { WorkoutOpInput } from "@/domain/workout";
import { setupTestDb } from "../../../tests/db/test-db";
import type { RecordedRequest } from "../../../tests/fixtures/recorded-fetch";

const db = setupTestDb();

const BENCH = "Barbell Bench Press - Medium Grip";

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

async function exerciseId(commands: Commands, name: string) {
  const { items } = await commands.listExercises({ query: name });
  const exercise = items.find((e) => e.name === name);
  if (!exercise) throw new Error(`No catalogue exercise ${name}`);
  return exercise.id;
}

/** A bench session on `day`, one top set of `weight` × 5; finished unless `finish` is false. */
function session(benchId: string, day: string, weight: number, { finish = true } = {}) {
  const workoutId = crypto.randomUUID();
  const exercise = crypto.randomUUID();
  const ops: WorkoutOpInput[] = [
    { type: "startWorkout", id: workoutId, startedAt: `${day}T07:00:00.000Z` },
    { type: "addExercise", id: exercise, workoutId, exerciseId: benchId, position: 0 },
    {
      type: "putSet", id: crypto.randomUUID(), workoutExerciseId: exercise, position: 0, setType: "normal",
      weight, unit: "lb", reps: 5, completed: true,
    },
  ];
  if (finish) ops.push({ type: "finishWorkout", id: workoutId, finishedAt: `${day}T08:00:00.000Z` });
  return { workoutId, ops };
}

describe("discarding a workout", () => {
  it("takes it out of history, and restoring puts it back with its original finish time", async () => {
    const commands = await signedInOwner();
    const { workoutId, ops } = session(await exerciseId(commands, BENCH), "2026-10-11", 185);
    await commands.applyWorkoutOps({ ops });

    await commands.applyWorkoutOps({ ops: [{ type: "discardWorkout", id: workoutId, discardedAt: "2026-10-11T09:00:00.000Z" }] });
    expect((await commands.listWorkouts({})).items).toEqual([]);

    await commands.applyWorkoutOps({
      ops: [{ type: "restoreWorkout", id: workoutId, finishedAt: "2026-10-12T09:00:00.000Z" }],
    });
    const { items } = await commands.listWorkouts({});
    expect(items.map((w) => [w.id, w.finishedAt])).toEqual([[workoutId, "2026-10-11T08:00:00.000Z"]]);
  });
});

const discard = (id: string, discardedAt = "2026-10-11T09:00:00.000Z"): WorkoutOpInput => ({
  type: "discardWorkout", id, discardedAt,
});
const restore = (id: string, finishedAt = "2026-10-20T09:00:00.000Z"): WorkoutOpInput => ({
  type: "restoreWorkout", id, finishedAt,
});

describe("replaying discard and restore", () => {
  it("replaying the outbox any number of times converges on the same state", async () => {
    const commands = await signedInOwner();
    const { workoutId, ops } = session(await exerciseId(commands, BENCH), "2026-10-11", 185);
    const outbox = [...ops, discard(workoutId)];

    await commands.applyWorkoutOps({ ops: outbox });
    await commands.applyWorkoutOps({ ops: outbox });
    await commands.applyWorkoutOps({ ops: outbox.slice(-1) });
    expect((await commands.listWorkouts({})).items).toEqual([]);
    expect((await commands.listDiscardedWorkouts({})).items.map((w) => w.id)).toEqual([workoutId]);

    const withRestore = [...outbox, restore(workoutId)];
    await commands.applyWorkoutOps({ ops: withRestore });
    await commands.applyWorkoutOps({ ops: withRestore.slice(-1) });
    expect((await commands.listWorkouts({})).items.map((w) => w.id)).toEqual([workoutId]);
    expect((await commands.listDiscardedWorkouts({})).items).toEqual([]);
  });

  it("restoring a workout that was never discarded changes nothing", async () => {
    const commands = await signedInOwner();
    const { workoutId, ops } = session(await exerciseId(commands, BENCH), "2026-10-11", 185);
    await commands.applyWorkoutOps({ ops });

    await commands.applyWorkoutOps({ ops: [restore(workoutId)] });

    expect((await commands.listWorkouts({})).items.map((w) => w.finishedAt)).toEqual(["2026-10-11T08:00:00.000Z"]);
  });

  it("restoring a workout discarded mid-session finishes it", async () => {
    const commands = await signedInOwner();
    const { workoutId, ops } = session(await exerciseId(commands, BENCH), "2026-10-11", 185, { finish: false });
    await commands.applyWorkoutOps({ ops: [...ops, discard(workoutId)] });
    expect((await commands.listDiscardedWorkouts({})).items.map((w) => [w.id, w.finishedAt])).toEqual([[workoutId, null]]);

    await commands.applyWorkoutOps({ ops: [restore(workoutId, "2026-10-11T08:30:00.000Z")] });

    expect((await commands.listWorkouts({})).items.map((w) => [w.id, w.finishedAt])).toEqual([
      [workoutId, "2026-10-11T08:30:00.000Z"],
    ]);
  });
});

describe("the discarded archive", () => {
  it("lists discarded workouts, most recently discarded first", async () => {
    const commands = await signedInOwner();
    const benchId = await exerciseId(commands, BENCH);
    const a = session(benchId, "2026-10-09", 175);
    const b = session(benchId, "2026-10-10", 180);
    const kept = session(benchId, "2026-10-11", 185);
    await commands.applyWorkoutOps({
      ops: [
        ...a.ops, ...b.ops, ...kept.ops,
        discard(b.workoutId, "2026-10-12T09:00:00.000Z"),
        discard(a.workoutId, "2026-10-13T09:00:00.000Z"),
      ],
    });

    expect((await commands.listDiscardedWorkouts({})).items.map((w) => w.id)).toEqual([a.workoutId, b.workoutId]);
    expect((await commands.listWorkouts({})).items.map((w) => w.id)).toEqual([kept.workoutId]);
  });

  it("reads one discarded workout with its exercises and sets, and nothing for a workout in history", async () => {
    const commands = await signedInOwner();
    const { workoutId, ops } = session(await exerciseId(commands, BENCH), "2026-10-11", 185);
    await commands.applyWorkoutOps({ ops: [...ops, discard(workoutId)] });

    const workout = await commands.getDiscardedWorkout({ id: workoutId });
    expect(workout.exercises.map((e) => [e.name, e.sets.map((s) => [s.weight, s.reps])])).toEqual([
      [BENCH, [[185, 5]]],
    ]);

    await commands.applyWorkoutOps({ ops: [restore(workoutId)] });
    await expect(commands.getDiscardedWorkout({ id: workoutId })).rejects.toMatchObject({ code: "not_found" });
  });

  it("is private to the owner", async () => {
    const commands = await signedInOwner();
    const { workoutId, ops } = session(await exerciseId(commands, BENCH), "2026-10-11", 185);
    await commands.applyWorkoutOps({ ops: [...ops, discard(workoutId)] });

    expect((await db().commandsAs({ kind: "anon" }).listDiscardedWorkouts({})).items).toEqual([]);
  });
});

describe("a discarded workout is not a finished workout", () => {
  it("does not set records, PRs or the history of an exercise, and counts again once restored", async () => {
    const commands = await signedInOwner();
    const benchId = await exerciseId(commands, BENCH);
    const light = session(benchId, "2026-10-01", 135);
    const heavy = session(benchId, "2026-10-08", 225);
    await commands.applyWorkoutOps({ ops: [...light.ops, ...heavy.ops, discard(heavy.workoutId)] });

    const bestWeight = async () =>
      (await commands.listRecords({})).items[0]!.bests.heaviestWeight?.weight;
    expect(await bestWeight()).toBe(135);
    expect((await commands.getExerciseHistory({ exerciseId: benchId })).sessions).toHaveLength(1);
    expect((await commands.listRecentPrs({ limit: 10 })).items.every((pr) => pr.workoutId === light.workoutId)).toBe(true);
    await expect(commands.getWorkoutSummary({ workoutId: heavy.workoutId })).rejects.toMatchObject({
      code: "not_found",
    });

    await commands.applyWorkoutOps({ ops: [restore(heavy.workoutId)] });
    expect(await bestWeight()).toBe(225);
    expect((await commands.getExerciseHistory({ exerciseId: benchId })).sessions).toHaveLength(2);
  });

  it("is not a PR baseline: a later lighter session is still a PR against what really counts", async () => {
    const commands = await signedInOwner();
    const benchId = await exerciseId(commands, BENCH);
    const base = session(benchId, "2026-09-24", 135);
    const heavy = session(benchId, "2026-10-01", 225);
    const later = session(benchId, "2026-10-08", 185);
    await commands.applyWorkoutOps({ ops: [...base.ops, ...heavy.ops, discard(heavy.workoutId), ...later.ops] });

    const prs = (await commands.listRecentPrs({ limit: 10 })).items;
    expect(prs.filter((pr) => pr.workoutId === later.workoutId).length).toBeGreaterThan(0);
  });

  it("is not a \"Previous\" value, and is again once restored", async () => {
    const commands = await signedInOwner();
    const benchId = await exerciseId(commands, BENCH);
    const older = session(benchId, "2026-10-01", 135);
    const newer = session(benchId, "2026-10-08", 225);
    await commands.applyWorkoutOps({ ops: [...older.ops, ...newer.ops, discard(newer.workoutId)] });

    const previousWeight = async () => (await commands.getPreviousSets({})).previous[benchId]![0]!.weight;
    expect(await previousWeight()).toBe(135);

    await commands.applyWorkoutOps({ ops: [restore(newer.workoutId)] });
    expect(await previousWeight()).toBe(225);
  });

  it("is out of the muscle heatmap, training load, calendar and home, and back in once restored", async () => {
    const commands = await signedInOwner();
    const { workoutId, ops } = session(await exerciseId(commands, BENCH), "2026-10-14", 185);
    const range = { from: "2026-10-12", to: "2026-10-18" };
    const read = async () => ({
      heatmap: await commands.getMuscleHeatmap({ days: 14, through: "2026-10-18" }),
      load: await commands.getTrainingLoad({ weeks: 2, through: "2026-10-18" }),
      calendar: await commands.getCalendar(range),
      home: await commands.getHome({ date: "2026-10-18" }),
    });
    const empty = await read();

    await commands.applyWorkoutOps({ ops: [...ops, discard(workoutId)] });
    expect(await read()).toEqual(empty);

    await commands.applyWorkoutOps({ ops: [restore(workoutId)] });
    const restored = await read();
    expect(restored.heatmap).not.toEqual(empty.heatmap);
    expect(restored.load).not.toEqual(empty.load);
    expect(restored.calendar.days.flatMap((d) => d.workouts).map((w) => w.id)).toEqual([workoutId]);
  });
});

describe("exports", () => {
  it("the JSON export keeps discarded workouts, flagged; the CSV export is history only", async () => {
    const commands = await signedInOwner();
    const benchId = await exerciseId(commands, BENCH);
    const kept = session(benchId, "2026-10-10", 180);
    const gone = session(benchId, "2026-10-11", 185);
    await commands.applyWorkoutOps({ ops: [...kept.ops, ...gone.ops, discard(gone.workoutId)] });

    const { tables } = await commands.exportJson({});
    const flagged = tables.workouts!.map((w) => [w.id, w.discarded_at !== null]).sort();
    expect(flagged).toEqual([[kept.workoutId, false], [gone.workoutId, true]].sort());

    const { csv } = await commands.exportWorkoutsCsv({ timeZone: "UTC" });
    expect(csv).toContain("10 Oct 2026");
    expect(csv).not.toContain("11 Oct 2026");
  });
});

describe("Strava", () => {
  const SCOPE = "read,activity:write,activity:read_all";
  const posts = (requests: RecordedRequest[]) =>
    requests.filter((r) => r.method === "POST" && r.path === "/api/v3/activities");

  async function connectedOwner() {
    const user = await db().signUp("owner@example.com");
    const requests: RecordedRequest[] = [];
    const commands = db().commandsAs({ kind: "user", userId: user.id }, { stravaRequests: requests });
    await commands.connectStrava({ code: "auth-code-1", scope: SCOPE });
    return { commands, requests };
  }

  it("a workout discarded before it was posted is never posted, until it is restored", async () => {
    const { commands, requests } = await connectedOwner();
    const { workoutId, ops } = session(await exerciseId(commands, BENCH), "2026-10-11", 185);
    await commands.applyWorkoutOps({ ops });
    expect(await commands.getWorkoutStravaPost({ workoutId })).toMatchObject({ status: "pending" });

    await commands.applyWorkoutOps({ ops: [discard(workoutId)] });
    expect(await commands.postWorkoutsToStrava({})).toEqual({ posted: 0, failed: 0 });
    expect(posts(requests)).toHaveLength(0);

    await commands.applyWorkoutOps({ ops: [restore(workoutId)] });
    expect(await commands.postWorkoutsToStrava({})).toEqual({ posted: 1, failed: 0 });
    expect(posts(requests)).toHaveLength(1);
  });

  it("discarding does not queue a post, and restoring queues one the way a finish does", async () => {
    const { commands } = await connectedOwner();
    const benchId = await exerciseId(commands, BENCH);
    const midSession = session(benchId, "2026-10-11", 185, { finish: false });
    await commands.applyWorkoutOps({ ops: [...midSession.ops, discard(midSession.workoutId)] });
    expect(await commands.getWorkoutStravaPost({ workoutId: midSession.workoutId })).toBeNull();

    await commands.applyWorkoutOps({ ops: [restore(midSession.workoutId, "2026-10-11T08:30:00.000Z")] });
    expect(await commands.getWorkoutStravaPost({ workoutId: midSession.workoutId })).toMatchObject({
      status: "pending",
    });
  });

  it("replaying a restore on a workout that is not discarded queues nothing", async () => {
    const user = await db().signUp("owner@example.com");
    const commands = db().commandsAs({ kind: "user", userId: user.id });
    const { workoutId, ops } = session(await exerciseId(commands, BENCH), "2026-10-11", 185);
    // Finished while Strava was not connected, so never queued.
    await commands.applyWorkoutOps({ ops });
    await commands.connectStrava({ code: "auth-code-1", scope: SCOPE });

    await commands.applyWorkoutOps({ ops: [restore(workoutId)] });

    expect(await commands.getWorkoutStravaPost({ workoutId })).toBeNull();
  });
});
