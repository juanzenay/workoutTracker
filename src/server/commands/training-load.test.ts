import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

async function signedInOwner(options: { now?: Date } = {}) {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id }, options);
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

const LA = "America/Los_Angeles";

async function exerciseId(commands: Commands, name: string) {
  const { items } = await commands.listExercises({ query: name });
  const exercise = items.find((e) => e.name === name);
  if (!exercise) throw new Error(`No catalogue exercise ${name}`);
  return exercise.id;
}

type LoggedSet = { weight: number; reps: number; unit?: "lb" | "kg"; setType?: "normal" | "warmup"; completed?: boolean };

async function logWorkout(commands: Commands, exerciseId: string, startedAt: string, sets: LoggedSet[]) {
  const workoutId = crypto.randomUUID();
  const workoutExerciseId = crypto.randomUUID();
  await commands.applyWorkoutOps({
    ops: [
      { type: "startWorkout", id: workoutId, startedAt },
      { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId, position: 0 },
      ...sets.map((set, position) => ({
        type: "putSet" as const,
        id: crypto.randomUUID(),
        workoutExerciseId,
        position,
        setType: set.setType ?? "normal",
        weight: set.weight,
        unit: set.unit ?? "lb",
        reps: set.reps,
        completed: set.completed ?? true,
      })),
      { type: "finishWorkout", id: workoutId, finishedAt: startedAt },
    ],
  });
}

describe("training load", () => {
  it("sums lifting per Monday–Sunday week: workouts, working sets, volume in lb, sets per muscle and planned sessions done", async () => {
    const commands = await signedInOwner();
    const legPress = await exerciseId(commands, "Leg Press");
    const press = await exerciseId(commands, "Machine Bench Press");
    const exercise = (id: string) => ({ exerciseId: id, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight: 100 });
    await commands.createBlock({
      name: "Mon/Thu",
      startDate: "2026-01-05",
      weeks: 2,
      timeZone: LA,
      sessions: [
        { name: "Lower", weekday: 1, exercises: [exercise(legPress)] },
        { name: "Upper", weekday: 4, exercises: [exercise(press)] },
      ],
    });
    // Week 1: Monday's Lower (a warm-up and an unticked set don't count).
    await logWorkout(commands, legPress, "2026-01-05T16:00:00Z", [
      { weight: 90, reps: 10, setType: "warmup" },
      { weight: 270, reps: 12 },
      { weight: 270, reps: 12 },
      { weight: 270, reps: 10 },
      { weight: 270, reps: 8, completed: false },
    ]);
    // Week 2: Thursday's Upper, in kg.
    await logWorkout(commands, press, "2026-01-15T17:00:00Z", [{ weight: 80, reps: 10, unit: "kg" }]);

    const load = await commands.getTrainingLoad({ weeks: 3, through: "2026-01-18" });

    expect(load.unit).toBe("lb");
    expect(load.weeks.map((w) => [w.weekStart, w.weekEnd])).toEqual([
      ["2025-12-29", "2026-01-04"],
      ["2026-01-05", "2026-01-11"],
      ["2026-01-12", "2026-01-18"],
    ]);
    expect(load.weeks[0]!.lifting).toEqual({
      workouts: 0,
      workingSets: 0,
      volume: 0,
      setsByMuscle: {},
      plannedSessions: 0,
      completedSessions: 0,
      plannedVolume: 0,
    });
    expect(load.weeks[1]!.lifting).toMatchObject({
      workouts: 1,
      workingSets: 3,
      volume: 9180, // 270 × (12 + 12 + 10)
      setsByMuscle: { quadriceps: 3 },
      plannedSessions: 2,
      completedSessions: 1,
    });
    expect(load.weeks[2]!.lifting).toMatchObject({
      workouts: 1,
      workingSets: 1,
      volume: 1763.7, // 80 kg × 10 = 1763.7 lb
      setsByMuscle: { chest: 1 },
      plannedSessions: 2,
      completedSessions: 1,
    });
  });

  it("sums planned running per week", async () => {
    const commands = await signedInOwner();
    await commands.createRace({ name: "Far Marathon", date: "2030-05-05", distanceMeters: 42_195, priority: "A" });
    const content = JSON.stringify({
      runs: [
        { week: 1, day: "tue", type: "easy", distance_m: 5000 },
        { week: 1, day: "wed", type: "cross", duration_s: 2700 },
        { week: 1, day: "fri", type: "rest" },
        { week: 1, day: "sun", type: "long", distance_m: 16000 },
        { week: 2, day: "sun", type: "race" },
      ],
    });
    await commands.importRunPlan({ format: "json", content, timeZone: LA });

    const load = await commands.getTrainingLoad({ weeks: 2, through: "2030-05-05" });

    expect(load.weeks.map((w) => [w.weekStart, w.running])).toEqual([
      ["2030-04-22", { plannedRuns: 3, plannedDistanceMeters: 21_000, plannedDurationSeconds: 2700, runs: 0, distanceMeters: 0, movingSeconds: 0 }],
      ["2030-04-29", { plannedRuns: 1, plannedDistanceMeters: 42_195, plannedDurationSeconds: 0, runs: 0, distanceMeters: 0, movingSeconds: 0 }],
    ]);
  });

  it("sums planned lifting volume per week from the planned sessions' working sets, in lb", async () => {
    const commands = await signedInOwner();
    const legPress = await exerciseId(commands, "Leg Press");
    const press = await exerciseId(commands, "Machine Bench Press");
    await commands.createBlock({
      name: "One week",
      startDate: "2026-01-05",
      weeks: 1,
      timeZone: LA,
      sessions: [
        {
          name: "Lower",
          weekday: 1,
          exercises: [{ exerciseId: legPress, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight: 100 }],
        },
        {
          name: "Upper",
          weekday: 4,
          exercises: [{ exerciseId: press, sets: 2, repRangeStart: 8, repRangeEnd: 12, startWeight: 40, unit: "kg" }],
        },
      ],
    });

    const load = await commands.getTrainingLoad({ weeks: 2, through: "2026-01-11" });

    expect(load.weeks.map((w) => [w.weekStart, w.lifting.plannedVolume])).toEqual([
      ["2025-12-29", 0],
      // First time in the block: start weight × bottom of the range. 3 × 10 × 100 lb + 2 × 8 × 40 kg (1411.0 lb).
      ["2026-01-05", 4411],
    ]);
  });

  it("sums the week's run mileage from Strava activities (runs only) beside the planned distance", async () => {
    const now = new Date("2026-10-12T17:00:00Z");
    const owner = await db().signUp("owner@example.com");
    const commands = db().commandsAs({ kind: "user", userId: owner.id }, { now });
    await commands.connectStrava({ code: "auth-code-1", scope: "read,activity:write,activity:read_all" });
    const race = await commands.createRace({ name: "Tune-up 10K", date: "2026-10-11", distanceMeters: 10_000, priority: "B" });
    const content = JSON.stringify({
      runs: [
        { week: 1, day: "tue", type: "easy", distance_m: 8047 },
        { week: 1, day: "thu", type: "tempo", distance_m: 9656 },
        { week: 1, day: "sun", type: "long", distance_m: 16093 },
      ],
    });
    await commands.importRunPlan({ format: "json", content, raceId: race.id, timeZone: "America/Chicago" });
    const webhook = db().commandsAs({ kind: "service" }, { now });
    // Tue 10-06 easy run (6437.4 m, 38 min), Tue 10-06 weights (not a run), Sun 10-11 long run (16120.4 m, 92 min).
    for (const objectId of [16012345679, 16012345680, 16012345678]) {
      await webhook.receiveStravaEvent({
        aspect_type: "create",
        event_time: 1760206800,
        object_id: objectId,
        object_type: "activity",
        owner_id: 134815,
        subscription_id: 298765,
        updates: {},
      });
    }
    expect(await webhook.processStravaEvents({})).toMatchObject({ processed: 3 });

    const load = await commands.getTrainingLoad({ weeks: 2, through: "2026-10-12" });

    expect(load.weeks.map((w) => [w.weekStart, w.running])).toEqual([
      [
        "2026-10-05",
        {
          plannedRuns: 3,
          plannedDistanceMeters: 33_796,
          plannedDurationSeconds: 0,
          runs: 2,
          distanceMeters: 22_557.8, // 6437.4 + 16120.4
          movingSeconds: 7800, // 38 + 92 min
        },
      ],
      ["2026-10-12", { plannedRuns: 0, plannedDistanceMeters: 0, plannedDurationSeconds: 0, runs: 0, distanceMeters: 0, movingSeconds: 0 }],
    ]);
  });

  it("defaults to the 8 weeks through today", async () => {
    const commands = await signedInOwner();
    const load = await commands.getTrainingLoad({});
    expect(load.weeks).toHaveLength(8);
    expect(load.weeks.at(-1)!.weekEnd >= load.today).toBe(true);
    expect(load.weeks.at(-1)!.weekStart <= load.today).toBe(true);
  });
});
