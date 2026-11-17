import { describe, expect, it } from "vitest";
import type { WorkoutOpInput } from "@/domain/workout";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

async function exerciseId(commands: Awaited<ReturnType<typeof signedInOwner>>, name: string) {
  const { items } = await commands.listExercises({ query: name });
  const exercise = items.find((e) => e.name === name);
  if (!exercise) throw new Error(`No catalogue exercise ${name}`);
  return exercise.id;
}

const ids = {
  workout: "00000000-0000-4000-8000-000000000001",
  bench: "00000000-0000-4000-8000-000000000011",
  set1: "00000000-0000-4000-8000-000000000101",
  set2: "00000000-0000-4000-8000-000000000102",
  set3: "00000000-0000-4000-8000-000000000103",
};

/** The outbox of a short bench session, as the client would queue it. */
function benchSession(benchId: string): WorkoutOpInput[] {
  const set = { workoutExerciseId: ids.bench, unit: "lb", completed: true } as const;
  return [
    { type: "startWorkout", id: ids.workout, startedAt: "2026-10-11T07:00:00.000Z" },
    { type: "addExercise", id: ids.bench, workoutId: ids.workout, exerciseId: benchId, position: 0 },
    { type: "putSet", id: ids.set1, position: 0, setType: "warmup", weight: 95, reps: 10, ...set },
    { type: "putSet", id: ids.set2, position: 1, setType: "normal", weight: 182.5, reps: 8, ...set },
    { type: "putSet", id: ids.set3, position: 2, setType: "failure", weight: 182.5, reps: 6, ...set },
    { type: "finishWorkout", id: ids.workout, finishedAt: "2026-10-11T08:00:00.000Z" },
  ];
}

describe("logging a workout", () => {
  it("logs sets and finishes the workout, which then appears in history", async () => {
    const commands = await signedInOwner();
    const benchId = await exerciseId(commands, "Barbell Bench Press - Medium Grip");

    await commands.applyWorkoutOps({ ops: benchSession(benchId) });

    const { items } = await commands.listWorkouts({});
    expect(items).toEqual([
      {
        id: ids.workout,
        name: null,
        startedAt: "2026-10-11T07:00:00.000Z",
        finishedAt: "2026-10-11T08:00:00.000Z",
        notes: null,
        exercises: [
          {
            id: ids.bench,
            exerciseId: benchId,
            machineId: null,
            name: "Barbell Bench Press - Medium Grip",
            position: 0,
            supersetGroup: null,
            restSeconds: null,
            notes: null,
            sets: [
              { id: ids.set1, position: 0, setType: "warmup", weight: 95, unit: "lb", reps: 10, rir: null, completed: true },
              { id: ids.set2, position: 1, setType: "normal", weight: 182.5, unit: "lb", reps: 8, rir: null, completed: true },
              { id: ids.set3, position: 2, setType: "failure", weight: 182.5, unit: "lb", reps: 6, rir: null, completed: true },
            ],
          },
        ],
      },
    ]);
  });

  it("replaying the same outbox twice creates no duplicates", async () => {
    const commands = await signedInOwner();
    const outbox = benchSession(await exerciseId(commands, "Barbell Bench Press - Medium Grip"));

    await commands.applyWorkoutOps({ ops: outbox });
    await commands.applyWorkoutOps({ ops: outbox });
    // A sync that died after the server committed but before the client heard back
    // resends a tail of the outbox along with the rest.
    await commands.applyWorkoutOps({ ops: outbox.slice(2) });

    const { items } = await commands.listWorkouts({});
    expect(items).toHaveLength(1);
    expect(items[0]!.exercises).toHaveLength(1);
    expect(items[0]!.exercises[0]!.sets.map((s) => s.id)).toEqual([ids.set1, ids.set2, ids.set3]);
  });

  it("editing a set replaces it; removing a set drops it", async () => {
    const commands = await signedInOwner();
    const outbox = benchSession(await exerciseId(commands, "Barbell Bench Press - Medium Grip"));
    await commands.applyWorkoutOps({ ops: outbox });

    await commands.applyWorkoutOps({
      ops: [
        { type: "putSet", id: ids.set2, workoutExerciseId: ids.bench, position: 1, setType: "drop",
          weight: 160, unit: "lb", reps: 12, completed: true },
        { type: "removeSet", id: ids.set3 },
      ],
    });

    const sets = (await commands.listWorkouts({})).items[0]!.exercises[0]!.sets;
    expect(sets.map(({ id, setType, weight, reps }) => ({ id, setType, weight, reps }))).toEqual([
      { id: ids.set1, setType: "warmup", weight: 95, reps: 10 },
      { id: ids.set2, setType: "drop", weight: 160, reps: 12 },
    ]);
  });

  it("stores weights exactly as entered, with their unit", async () => {
    const commands = await signedInOwner();
    const benchId = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const weights = [
      { weight: 182.5, unit: "lb" },
      { weight: 47.5, unit: "lb" },
      { weight: 2.25, unit: "lb" },
      { weight: 100, unit: "kg" },
      { weight: 0, unit: "lb" },
      { weight: null, unit: "lb" },
    ] as const;

    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id: ids.workout, startedAt: "2026-10-11T07:00:00.000Z" },
        { type: "addExercise", id: ids.bench, workoutId: ids.workout, exerciseId: benchId, position: 0 },
        ...weights.map((w, i) => ({
          type: "putSet" as const, id: crypto.randomUUID(), workoutExerciseId: ids.bench, position: i,
          setType: "normal" as const, reps: 5, completed: true, ...w,
        })),
        { type: "finishWorkout", id: ids.workout, finishedAt: "2026-10-11T08:00:00.000Z" },
      ],
    });

    const sets = (await commands.listWorkouts({})).items[0]!.exercises[0]!.sets;
    expect(sets.map(({ weight, unit }) => ({ weight, unit }))).toEqual(weights);
  });

  it("an unfinished workout is not in history", async () => {
    const commands = await signedInOwner();
    const outbox = benchSession(await exerciseId(commands, "Barbell Bench Press - Medium Grip"));

    await commands.applyWorkoutOps({ ops: outbox.slice(0, -1) });

    expect((await commands.listWorkouts({})).items).toEqual([]);
  });

  it("finishing again keeps the first finish time", async () => {
    const commands = await signedInOwner();
    const outbox = benchSession(await exerciseId(commands, "Barbell Bench Press - Medium Grip"));
    await commands.applyWorkoutOps({ ops: outbox });

    await commands.applyWorkoutOps({
      ops: [{ type: "finishWorkout", id: ids.workout, finishedAt: "2026-10-11T09:30:00.000Z" }],
    });

    expect((await commands.listWorkouts({})).items[0]!.finishedAt).toBe("2026-10-11T08:00:00.000Z");
  });

  it("lists history newest first", async () => {
    const commands = await signedInOwner();
    const benchId = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const older = crypto.randomUUID();
    const newer = crypto.randomUUID();

    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id: older, startedAt: "2026-10-09T07:00:00.000Z", name: "Lower Body A" },
        { type: "finishWorkout", id: older, finishedAt: "2026-10-09T08:00:00.000Z" },
        { type: "startWorkout", id: newer, startedAt: "2026-10-10T07:00:00.000Z", name: "Chest Upper" },
        { type: "addExercise", id: crypto.randomUUID(), workoutId: newer, exerciseId: benchId, position: 0 },
        { type: "finishWorkout", id: newer, finishedAt: "2026-10-10T08:00:00.000Z" },
      ],
    });

    const { items } = await commands.listWorkouts({});
    expect(items.map((w) => w.name)).toEqual(["Chest Upper", "Lower Body A"]);
  });

  it("rejects malformed ops", async () => {
    const commands = await signedInOwner();

    await expect(
      commands.applyWorkoutOps({
        ops: [{ type: "putSet", id: "not-a-uuid", workoutExerciseId: ids.bench, position: 0,
          setType: "heavy" as never, weight: -5, unit: "stone" as never, reps: 1.5, completed: true }],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("unauthenticated callers cannot log workouts", async () => {
    const owner = await signedInOwner();
    const outbox = benchSession(await exerciseId(owner, "Barbell Bench Press - Medium Grip"));
    const anon = db().commandsAs({ kind: "anon" });

    await expect(anon.applyWorkoutOps({ ops: outbox })).rejects.toMatchObject({ code: "unauthorized" });
    expect((await owner.listWorkouts({})).items).toEqual([]);
  });
});

describe("logger extras", () => {
  it("workout and exercise notes persist through sync, and can be cleared", async () => {
    const commands = await signedInOwner();
    const outbox = benchSession(await exerciseId(commands, "Barbell Bench Press - Medium Grip"));
    const squat = crypto.randomUUID();

    await commands.applyWorkoutOps({
      ops: [
        ...outbox.slice(0, -1),
        { type: "addExercise", id: squat, workoutId: ids.workout,
          exerciseId: await exerciseId(commands, "Barbell Squat"), position: 1 },
        { type: "setWorkoutNotes", id: ids.workout, notes: "Felt flat after the long run" },
        { type: "setExerciseNotes", id: ids.bench, notes: "Seat 3, arch more" },
        { type: "setExerciseNotes", id: squat, notes: "temporary" },
        { type: "setExerciseNotes", id: squat, notes: null },
        outbox.at(-1)!,
      ],
    });

    const [workout] = (await commands.listWorkouts({})).items;
    expect(workout!.notes).toBe("Felt flat after the long run");
    expect(workout!.exercises.map((e) => e.notes)).toEqual(["Seat 3, arch more", null]);
  });

  it("RIR is optional and persists on the set it was tapped on", async () => {
    const commands = await signedInOwner();
    const outbox = benchSession(await exerciseId(commands, "Barbell Bench Press - Medium Grip"));
    const lastSet = outbox[4] as Extract<WorkoutOpInput, { type: "putSet" }>;

    await commands.applyWorkoutOps({ ops: [...outbox.slice(0, -1), { ...lastSet, rir: 0 }, outbox.at(-1)!] });

    const sets = (await commands.listWorkouts({})).items[0]!.exercises[0]!.sets;
    expect(sets.map((s) => s.rir)).toEqual([null, null, 0]);
  });

  it("superset groups persist through sync, and an exercise can leave its group", async () => {
    const commands = await signedInOwner();
    const [bench, row, curl] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const add = async (id: string, name: string, position: number): Promise<WorkoutOpInput> => ({
      type: "addExercise", id, workoutId: ids.workout, exerciseId: await exerciseId(commands, name), position,
    });

    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id: ids.workout, startedAt: "2026-10-11T07:00:00.000Z" },
        await add(bench, "Barbell Bench Press - Medium Grip", 0),
        await add(row, "Bent Over Barbell Row", 1),
        await add(curl, "Barbell Curl", 2),
        { type: "setSupersetGroup", id: bench, group: 1 },
        { type: "setSupersetGroup", id: row, group: 1 },
        { type: "setSupersetGroup", id: curl, group: 1 },
        { type: "setSupersetGroup", id: curl, group: null },
        { type: "finishWorkout", id: ids.workout, finishedAt: "2026-10-11T08:00:00.000Z" },
      ],
    });

    const exercises = (await commands.listWorkouts({})).items[0]!.exercises;
    expect(exercises.map((e) => e.supersetGroup)).toEqual([1, 1, null]);
  });

  it("an exercise's rest duration persists through sync", async () => {
    const commands = await signedInOwner();
    const outbox = benchSession(await exerciseId(commands, "Barbell Bench Press - Medium Grip"));

    await commands.applyWorkoutOps({
      ops: [...outbox.slice(0, -1), { type: "setRestSeconds", id: ids.bench, seconds: 150 }, outbox.at(-1)!],
    });

    expect((await commands.listWorkouts({})).items[0]!.exercises[0]!.restSeconds).toBe(150);
  });

  it("rejects an RIR outside 0–3", async () => {
    const commands = await signedInOwner();
    const outbox = benchSession(await exerciseId(commands, "Barbell Bench Press - Medium Grip"));
    const set = outbox[4] as Extract<WorkoutOpInput, { type: "putSet" }>;

    await expect(commands.applyWorkoutOps({ ops: [{ ...set, rir: 4 }] })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});

describe("reordering exercises", () => {
  const exercise = {
    bench: "Barbell Bench Press - Medium Grip",
    row: "Bent Over Barbell Row",
    curl: "Barbell Curl",
  } as const;

  /** A workout with bench, row and curl in that order; `group` is each one's superset group. */
  async function workoutWith(group: { bench: number | null; row: number | null; curl: number | null }) {
    const commands = await signedInOwner();
    const [bench, row, curl] = [ids.bench, crypto.randomUUID(), crypto.randomUUID()];
    const add = async (id: string, name: keyof typeof exercise, position: number): Promise<WorkoutOpInput> => ({
      type: "addExercise", id, workoutId: ids.workout, exerciseId: await exerciseId(commands, exercise[name]), position,
    });
    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id: ids.workout, startedAt: "2026-10-11T07:00:00.000Z" },
        await add(bench, "bench", 0),
        await add(row, "row", 1),
        await add(curl, "curl", 2),
        ...(group.bench ? [{ type: "setSupersetGroup" as const, id: bench, group: group.bench }] : []),
        ...(group.row ? [{ type: "setSupersetGroup" as const, id: row, group: group.row }] : []),
        ...(group.curl ? [{ type: "setSupersetGroup" as const, id: curl, group: group.curl }] : []),
      ],
    });
    return { commands, bench, row, curl };
  }

  /**
   * The workout's exercises as (name, position, superset group) rows, in position order. History only lists finished
   * workouts, so this finishes it first; finishing is idempotent and keeps the first finish time.
   */
  async function layout(commands: Awaited<ReturnType<typeof signedInOwner>>) {
    await commands.applyWorkoutOps({
      ops: [{ type: "finishWorkout", id: ids.workout, finishedAt: "2026-10-11T08:00:00.000Z" }],
    });
    const [workout] = (await commands.listWorkouts({})).items;
    return workout!.exercises.map((e) => ({ name: e.name, position: e.position, supersetGroup: e.supersetGroup }));
  }

  it("puts exercises in the order given, with positions to match", async () => {
    const { commands, bench, row, curl } = await workoutWith({ bench: null, row: null, curl: null });

    await commands.applyWorkoutOps({
      ops: [{ type: "reorderExercises", workoutId: ids.workout, ids: [curl, bench, row] }],
    });

    expect(await layout(commands)).toEqual([
      { name: exercise.curl, position: 0, supersetGroup: null },
      { name: exercise.bench, position: 1, supersetGroup: null },
      { name: exercise.row, position: 2, supersetGroup: null },
    ]);
  });

  it("an exercise moved out of a superset leaves it, and a lone member left behind is ungrouped", async () => {
    const { commands, bench, row, curl } = await workoutWith({ bench: 1, row: 1, curl: null });

    await commands.applyWorkoutOps({
      ops: [{ type: "reorderExercises", workoutId: ids.workout, ids: [row, curl, bench] }],
    });

    expect(await layout(commands)).toEqual([
      { name: exercise.row, position: 0, supersetGroup: null },
      { name: exercise.curl, position: 1, supersetGroup: null },
      { name: exercise.bench, position: 2, supersetGroup: null },
    ]);
  });

  it("a superset that keeps two or more members keeps its group", async () => {
    const { commands, bench, row, curl } = await workoutWith({ bench: 1, row: 1, curl: 1 });

    await commands.applyWorkoutOps({
      ops: [{ type: "reorderExercises", workoutId: ids.workout, ids: [row, curl, bench] }],
    });

    expect((await layout(commands)).map((e) => e.supersetGroup)).toEqual([1, 1, null]);
  });

  it("replaying the same reorder changes nothing further", async () => {
    const { commands, bench, row, curl } = await workoutWith({ bench: 1, row: 1, curl: 1 });
    const op = { type: "reorderExercises" as const, workoutId: ids.workout, ids: [row, curl, bench] };

    await commands.applyWorkoutOps({ ops: [op] });
    const once = await layout(commands);
    await commands.applyWorkoutOps({ ops: [op, op] });

    expect(await layout(commands)).toEqual(once);
  });

  it("ignores unknown and removed exercise ids; exercises not listed follow the listed ones", async () => {
    const { commands, bench, curl } = await workoutWith({ bench: null, row: null, curl: null });
    const removed = crypto.randomUUID();
    await commands.applyWorkoutOps({
      ops: [
        { type: "addExercise", id: removed, workoutId: ids.workout,
          exerciseId: await exerciseId(commands, "Barbell Squat"), position: 3 },
        { type: "removeExercise", id: removed },
        { type: "reorderExercises", workoutId: ids.workout, ids: [curl, crypto.randomUUID(), removed, bench] },
      ],
    });

    expect((await layout(commands)).map((e) => e.name)).toEqual([exercise.curl, exercise.bench, exercise.row]);
  });
});

describe("swapping an exercise", () => {
  it("replaces the exercise and keeps its place, superset group, rest, notes and logged sets; a replay changes nothing", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const curl = await exerciseId(commands, "Barbell Curl");
    const swap = { type: "swapExercise" as const, id: ids.bench, exerciseId: curl };
    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id: ids.workout, startedAt: "2026-10-11T07:00:00.000Z" },
        { type: "addExercise", id: ids.bench, workoutId: ids.workout, exerciseId: bench, position: 0 },
        { type: "setSupersetGroup", id: ids.bench, group: 1 },
        { type: "setRestSeconds", id: ids.bench, seconds: 120 },
        { type: "setExerciseNotes", id: ids.bench, notes: "pause at the chest" },
        { type: "putSet", id: ids.set1, workoutExerciseId: ids.bench, position: 0, setType: "normal", weight: 182.5, unit: "lb", reps: 8, rir: 2, completed: true },
        { type: "finishWorkout", id: ids.workout, finishedAt: "2026-10-11T08:00:00.000Z" },
      ],
    });

    await commands.applyWorkoutOps({ ops: [swap] });
    const [once] = (await commands.listWorkouts({})).items;
    await commands.applyWorkoutOps({ ops: [swap, swap] });
    const [again] = (await commands.listWorkouts({})).items;

    expect(again).toEqual(once);
    expect(again!.exercises).toEqual([
      expect.objectContaining({
        id: ids.bench,
        exerciseId: curl,
        name: "Barbell Curl",
        position: 0,
        supersetGroup: 1,
        restSeconds: 120,
        notes: "pause at the chest",
        sets: [expect.objectContaining({ id: ids.set1, weight: 182.5, reps: 8, rir: 2, completed: true })],
      }),
    ]);
  });
});

describe("reading one finished workout", () => {
  it("returns a finished workout with its exercises and sets, in the order performed", async () => {
    const commands = await signedInOwner();
    await commands.applyWorkoutOps({ ops: benchSession(await exerciseId(commands, "Barbell Bench Press - Medium Grip")) });

    const workout = await commands.getWorkout({ workoutId: ids.workout });

    expect(workout.finishedAt).toBe("2026-10-11T08:00:00.000Z");
    expect(workout.exercises).toHaveLength(1);
    expect(workout.exercises[0]!.name).toBe("Barbell Bench Press - Medium Grip");
    expect(workout.exercises[0]!.sets.map((s) => [s.weight, s.reps])).toEqual([
      [95, 10],
      [182.5, 8],
      [182.5, 6],
    ]);
  });

  it("returns a finished workout with no sets as an empty exercise list", async () => {
    const commands = await signedInOwner();
    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id: ids.workout, startedAt: "2026-10-11T07:00:00.000Z" },
        { type: "finishWorkout", id: ids.workout, finishedAt: "2026-10-11T07:05:00.000Z" },
      ],
    });

    expect(await commands.getWorkout({ workoutId: ids.workout })).toMatchObject({ exercises: [] });
  });

  it("is not_found for an unfinished, discarded or unknown workout", async () => {
    const commands = await signedInOwner();
    const outbox = benchSession(await exerciseId(commands, "Barbell Bench Press - Medium Grip"));
    await commands.applyWorkoutOps({ ops: outbox.slice(0, -1) });

    await expect(commands.getWorkout({ workoutId: ids.workout })).rejects.toMatchObject({ code: "not_found" });

    await commands.applyWorkoutOps({ ops: [outbox.at(-1)!, { type: "discardWorkout", id: ids.workout, discardedAt: "2026-10-11T09:00:00.000Z" }] });
    await expect(commands.getWorkout({ workoutId: ids.workout })).rejects.toMatchObject({ code: "not_found" });

    await expect(commands.getWorkout({ workoutId: "00000000-0000-4000-8000-0000000000ff" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
