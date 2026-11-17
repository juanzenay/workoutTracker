import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SetType, WeightUnit, WorkoutOpInput } from "@/domain/workout";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

type Commands = ReturnType<ReturnType<typeof db>["commandsAs"]>;

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

async function exerciseId(commands: Commands, name: string) {
  const { items } = await commands.listExercises({ query: name });
  const exercise = items.find((e) => e.name === name);
  if (!exercise) throw new Error(`No catalogue exercise ${name}`);
  return exercise.id;
}

/** `[weight, reps]` or `[weight, reps, setType]`, optionally `[weight, reps, setType, unit]`; weight null = bodyweight. */
type SetSpec = [number | null, number, SetType?, WeightUnit?];

interface LoggedSession {
  workoutId: string;
  /** Set ids per exercise, in the order given. */
  setIds: Record<string, string[]>;
}

/** Logs and finishes a workout the way the logger's outbox would, on `day` (YYYY-MM-DD). */
async function logWorkout(
  commands: Commands,
  day: string,
  exercises: Record<string, SetSpec[]>,
  { finish = true }: { finish?: boolean } = {},
): Promise<LoggedSession> {
  const workoutId = randomUUID();
  const ops: WorkoutOpInput[] = [{ type: "startWorkout", id: workoutId, startedAt: `${day}T07:00:00.000Z` }];
  const setIds: Record<string, string[]> = {};
  Object.entries(exercises).forEach(([exercise, sets], position) => {
    const workoutExerciseId = randomUUID();
    ops.push({ type: "addExercise", id: workoutExerciseId, workoutId, exerciseId: exercise, position });
    setIds[exercise] = sets.map(([weight, reps, setType = "normal", unit = "lb"], i) => {
      const id = randomUUID();
      ops.push({ type: "putSet", id, workoutExerciseId, position: i, setType, weight, unit, reps, completed: true });
      return id;
    });
  });
  if (finish) ops.push({ type: "finishWorkout", id: workoutId, finishedAt: `${day}T08:00:00.000Z` });
  await commands.applyWorkoutOps({ ops });
  return { workoutId, setIds };
}

const BENCH = "Barbell Bench Press - Medium Grip";
const SQUAT = "Barbell Squat";
const PULLUP = "Pullups";

describe("records", () => {
  it("lists each exercise's bests, ignoring warm-ups and unticked sets", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, BENCH);
    const squat = await exerciseId(commands, SQUAT);

    const first = await logWorkout(commands, "2026-09-01", {
      [bench]: [[225, 1, "warmup"], [185, 8], [195, 5]],
      [squat]: [[225, 5]],
    });
    const second = await logWorkout(commands, "2026-09-04", { [bench]: [[175, 12]] });
    // An unfinished workout's sets don't count yet.
    await logWorkout(commands, "2026-09-06", { [bench]: [[300, 10]] }, { finish: false });

    const { items } = await commands.listRecords({});

    expect(items.map((i) => i.name)).toEqual([BENCH, SQUAT]);
    const benchRecords = items[0]!;
    expect(benchRecords.exerciseId).toBe(bench);
    expect(benchRecords.bests.heaviestWeight).toMatchObject({
      weight: 195,
      unit: "lb",
      reps: 5,
      value: 195,
      workoutId: first.workoutId,
      setId: first.setIds[bench]![2],
      achievedAt: "2026-09-01T07:00:00.000Z",
    });
    // Epley: 175 × (1 + 12/30) = 245 beats 185 × (1 + 8/30) ≈ 234.3 and 195 × (1 + 5/30) = 227.5.
    expect(benchRecords.bests.bestEstimated1rm).toMatchObject({
      weight: 175,
      reps: 12,
      value: 245,
      workoutId: second.workoutId,
    });
    // 175 × 12 = 2100 beats 185 × 8 = 1480.
    expect(benchRecords.bests.bestSetVolume).toMatchObject({ weight: 175, reps: 12, value: 2100 });
    expect(benchRecords.bests.mostReps).toBeUndefined();
  });

  it("tracks most reps for bodyweight sets", async () => {
    const commands = await signedInOwner();
    const pullup = await exerciseId(commands, PULLUP);

    await logWorkout(commands, "2026-09-01", { [pullup]: [[null, 8], [null, 11], [null, 15, "warmup"]] });

    const { items } = await commands.listRecords({});

    expect(items).toHaveLength(1);
    expect(items[0]!.bests).toEqual({
      mostReps: expect.objectContaining({ weight: null, reps: 11, value: 11 }),
    });
  });

  it("compares sets logged in different units by their real weight", async () => {
    const commands = await signedInOwner();
    const squat = await exerciseId(commands, SQUAT);

    // 100 kg ≈ 220.5 lb beats 220 lb; the record keeps the unit it was entered in.
    await logWorkout(commands, "2026-09-01", { [squat]: [[220, 3], [100, 3, "normal", "kg"]] });

    const { items } = await commands.listRecords({});
    expect(items[0]!.bests.heaviestWeight).toMatchObject({ weight: 100, unit: "kg", value: 100 });
  });
});

describe("PRs and workout summaries", () => {
  it("flags sets that beat a previous best, ignoring warm-ups", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, BENCH);
    const squat = await exerciseId(commands, SQUAT);

    await logWorkout(commands, "2026-09-01", { [bench]: [[185, 8]], [squat]: [[225, 5]] });
    const today = await logWorkout(commands, "2026-09-04", {
      // The warm-up is heavier than anything before but never counts.
      [bench]: [[205, 1, "warmup"], [190, 8], [180, 6]],
      // A first squat set below the old best, then a tie: no PR.
      [squat]: [[215, 5], [225, 5]],
    });

    const summary = await commands.getWorkoutSummary({ workoutId: today.workoutId });

    expect(summary.prs).toEqual([
      {
        exerciseId: bench,
        name: BENCH,
        kind: "heaviestWeight",
        set: expect.objectContaining({ setId: today.setIds[bench]![1], weight: 190, reps: 8, value: 190 }),
        previous: expect.objectContaining({ weight: 185, reps: 8, value: 185 }),
      },
      expect.objectContaining({ exerciseId: bench, kind: "bestEstimated1rm", set: expect.objectContaining({ value: 240.7 }) }),
      expect.objectContaining({ exerciseId: bench, kind: "bestSetVolume", set: expect.objectContaining({ value: 1520 }) }),
    ]);
  });

  it("does not count a first-ever session as PRs", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, BENCH);

    const { workoutId } = await logWorkout(commands, "2026-09-01", { [bench]: [[135, 10]] });

    expect((await commands.getWorkoutSummary({ workoutId })).prs).toEqual([]);
  });

  it("reports only a workout's final best per record when a set is beaten again in the same session", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, BENCH);

    await logWorkout(commands, "2026-09-01", { [bench]: [[185, 5]] });
    const { workoutId, setIds } = await logWorkout(commands, "2026-09-04", { [bench]: [[190, 5], [195, 5]] });

    const { prs } = await commands.getWorkoutSummary({ workoutId });
    expect(prs.filter((p) => p.kind === "heaviestWeight")).toEqual([
      expect.objectContaining({
        set: expect.objectContaining({ setId: setIds[bench]![1], value: 195 }),
        previous: expect.objectContaining({ value: 185 }),
      }),
    ]);
  });

  it("summarises exercises, working sets and volume for the share card", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, BENCH);
    const pullup = await exerciseId(commands, PULLUP);

    const { workoutId } = await logWorkout(commands, "2026-09-01", {
      [bench]: [[95, 10, "warmup"], [185, 8], [185, 7, "failure"]],
      [pullup]: [[null, 10], [null, 8]],
    });

    const summary = await commands.getWorkoutSummary({ workoutId });

    expect(summary).toMatchObject({
      workoutId,
      name: null,
      startedAt: "2026-09-01T07:00:00.000Z",
      finishedAt: "2026-09-01T08:00:00.000Z",
      durationMinutes: 60,
      // Warm-ups are not counted as sets or volume.
      totalSets: 4,
      volume: { value: 185 * 8 + 185 * 7, unit: "lb" },
      exercises: [
        { exerciseId: bench, name: BENCH, sets: 2, volume: { value: 2775, unit: "lb" }, bestSet: { weight: 185, reps: 8, unit: "lb" } },
        { exerciseId: pullup, name: PULLUP, sets: 2, volume: null, bestSet: { weight: null, reps: 10, unit: "lb" } },
      ],
      prs: [],
    });
  });

  it("is not_found for an unknown or unfinished workout", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, BENCH);
    const { workoutId } = await logWorkout(commands, "2026-09-01", { [bench]: [[135, 10]] }, { finish: false });

    await expect(commands.getWorkoutSummary({ workoutId })).rejects.toMatchObject({ code: "not_found" });
    await expect(commands.getWorkoutSummary({ workoutId: randomUUID() })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("exercise history", () => {
  it("gives estimated 1RM, best set and volume per session, oldest first, with current records", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, BENCH);
    const squat = await exerciseId(commands, SQUAT);

    const first = await logWorkout(commands, "2026-09-01", {
      [bench]: [[95, 10, "warmup"], [185, 8], [185, 6]],
      [squat]: [[225, 5]],
    });
    await logWorkout(commands, "2026-09-03", { [squat]: [[235, 5]] });
    const second = await logWorkout(commands, "2026-09-04", { [bench]: [[190, 8], [200, 3, "failure"]] });

    const history = await commands.getExerciseHistory({ exerciseId: bench });

    expect(history).toEqual({
      exerciseId: bench,
      name: BENCH,
      unit: "lb",
      sessions: [
        {
          workoutId: first.workoutId,
          date: "2026-09-01T07:00:00.000Z",
          // 185 × (1 + 8/30) = 234.3
          estimated1rm: 234.3,
          bestSet: { weight: 185, reps: 8, unit: "lb" },
          volume: 185 * 8 + 185 * 6,
          sets: [
            { weight: 95, reps: 10, unit: "lb", setType: "warmup" },
            { weight: 185, reps: 8, unit: "lb", setType: "normal" },
            { weight: 185, reps: 6, unit: "lb", setType: "normal" },
          ],
        },
        {
          workoutId: second.workoutId,
          date: "2026-09-04T07:00:00.000Z",
          // 190 × (1 + 8/30) = 240.7 beats 200 × 1.1 = 220
          estimated1rm: 240.7,
          bestSet: { weight: 190, reps: 8, unit: "lb" },
          volume: 190 * 8 + 200 * 3,
          sets: [
            { weight: 190, reps: 8, unit: "lb", setType: "normal" },
            { weight: 200, reps: 3, unit: "lb", setType: "failure" },
          ],
        },
      ],
      bests: expect.objectContaining({
        heaviestWeight: expect.objectContaining({ weight: 200, reps: 3 }),
        bestEstimated1rm: expect.objectContaining({ value: 240.7 }),
      }),
    });
  });

  it("is empty for an exercise never logged, and not_found for an unknown exercise", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, BENCH);

    expect(await commands.getExerciseHistory({ exerciseId: bench })).toEqual({
      exerciseId: bench,
      name: BENCH,
      unit: "lb",
      sessions: [],
      bests: {},
    });
    await expect(commands.getExerciseHistory({ exerciseId: randomUUID() })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("recent PRs", () => {
  it("lists PRs newest first across workouts", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, BENCH);
    const pullup = await exerciseId(commands, PULLUP);

    await logWorkout(commands, "2026-09-01", { [bench]: [[185, 5]], [pullup]: [[null, 8]] });
    const second = await logWorkout(commands, "2026-09-04", { [bench]: [[190, 5]] });
    const third = await logWorkout(commands, "2026-09-07", { [pullup]: [[null, 10]] });

    const { items } = await commands.listRecentPrs({ limit: 10 });

    expect(items.map((pr) => [pr.workoutId, pr.name, pr.kind, pr.set.value])).toEqual([
      [third.workoutId, PULLUP, "mostReps", 10],
      [second.workoutId, BENCH, "heaviestWeight", 190],
      [second.workoutId, BENCH, "bestEstimated1rm", 221.7],
      [second.workoutId, BENCH, "bestSetVolume", 950],
    ]);
    expect((await commands.listRecentPrs({ limit: 2 })).items).toHaveLength(2);
  });
});
