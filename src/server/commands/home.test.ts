import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

const LA = "America/Los_Angeles";

async function exerciseId(commands: Commands, name: string) {
  const { items } = await commands.listExercises({ query: name });
  const exercise = items.find((e) => e.name === name);
  if (!exercise) throw new Error(`No catalogue exercise ${name}`);
  return exercise.id;
}

/** Logs and finishes a one-exercise workout at `startedAt` (all sets ticked). */
async function logWorkout(commands: Commands, exercise: string, startedAt: string, sets: [number, number][]) {
  const workoutId = randomUUID();
  const workoutExerciseId = randomUUID();
  await commands.applyWorkoutOps({
    ops: [
      { type: "startWorkout", id: workoutId, startedAt },
      { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId: exercise, position: 0 },
      ...sets.map(([weight, reps], position) => ({
        type: "putSet" as const,
        id: randomUUID(),
        workoutExerciseId,
        position,
        setType: "normal" as const,
        weight,
        unit: "lb" as const,
        reps,
        completed: true,
      })),
      { type: "finishWorkout", id: workoutId, finishedAt: startedAt },
    ],
  });
  return workoutId;
}

describe("home dashboard", () => {
  it("strips the Monday–Sunday week around the day: each day's planned lifts and runs with their completion state", async () => {
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
    const race = await commands.createRace({ name: "Winter 10K", date: "2026-01-11", distanceMeters: 10_000, priority: "B" });
    const content = JSON.stringify({
      runs: [
        { week: 1, day: "tue", type: "easy", distance_m: 5000 },
        { week: 1, day: "sun", type: "race" },
      ],
    });
    await commands.importRunPlan({ format: "json", content, raceId: race.id, timeZone: LA });
    await logWorkout(commands, legPress, "2026-01-05T17:00:00Z", [[100, 10]]);

    const home = await commands.getHome({ date: "2026-01-07" });

    expect(home.date).toBe("2026-01-07");
    expect(
      home.week.map((day) => [
        day.date,
        day.sessions.map((s) => `${s.name}: ${s.status}`),
        day.runs.map((r) => `${r.type}: ${r.status}`),
      ]),
    ).toEqual([
      ["2026-01-05", ["Lower: completed"], []],
      // No Strava and no imports: past runs have no outcome yet.
      ["2026-01-06", [], ["easy: not_recorded"]],
      ["2026-01-07", [], []],
      ["2026-01-08", ["Upper: missed"], []],
      ["2026-01-09", [], []],
      ["2026-01-10", [], []],
      ["2026-01-11", [], ["race: not_recorded"]],
    ]);
  });

  it("counts down to the next A race with the current week of its run plan", async () => {
    const commands = await signedInOwner();
    await commands.createRace({ name: "Old Marathon", date: "2029-11-04", distanceMeters: 42_195, priority: "A" });
    await commands.createRace({ name: "Tune-up Half", date: "2030-04-07", distanceMeters: 21_097, priority: "B" });
    const goal = await commands.createRace({ name: "Spring Marathon", date: "2030-05-05", distanceMeters: 42_195, priority: "A" });
    const content = JSON.stringify({
      runs: [
        { week: 1, day: "sun", type: "long", distance_m: 16_000 },
        { week: 18, day: "sun", type: "race" },
      ],
    });
    const { plan } = await commands.importRunPlan({ format: "json", content, raceId: goal.id, timeZone: LA });

    // Wed 2030-03-13: 7 weeks before race week, so week 11 of 18; 53 days to go.
    const { countdown } = await commands.getHome({ date: "2030-03-13" });
    expect(countdown).toEqual({
      race: { id: goal.id, name: "Spring Marathon", date: "2030-05-05", distanceMeters: 42_195, priority: "A" },
      days: 53,
      plan: { id: plan.id, name: plan.name, week: 11, weeks: 18 },
    });

    // Before the plan starts there is no plan week yet; on race day the countdown reaches zero.
    expect((await commands.getHome({ date: "2029-12-01" })).countdown).toMatchObject({ days: 155, plan: null });
    expect((await commands.getHome({ date: "2030-05-05" })).countdown).toMatchObject({
      days: 0,
      plan: { week: 18, weeks: 18 },
    });
    // After the last A race: nothing to count down to.
    expect((await commands.getHome({ date: "2030-05-06" })).countdown).toBeNull();
  });

  it("has this week's lifting volume and mileage against plan", async () => {
    const commands = await signedInOwner();
    const legPress = await exerciseId(commands, "Leg Press");
    await commands.createBlock({
      name: "Monday",
      startDate: "2026-01-05",
      weeks: 1,
      timeZone: LA,
      sessions: [
        {
          name: "Lower",
          weekday: 1,
          exercises: [{ exerciseId: legPress, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight: 100 }],
        },
      ],
    });
    await logWorkout(commands, legPress, "2026-01-05T17:00:00Z", [
      [100, 12],
      [100, 12],
    ]);

    const { load } = await commands.getHome({ date: "2026-01-08" });

    expect(load.weekStart).toBe("2026-01-05");
    expect(load.lifting).toMatchObject({ volume: 2400, plannedVolume: 3000 });
    expect(load.running).toMatchObject({ distanceMeters: 0, plannedDistanceMeters: 0 });
  });

  it("lists the most recent PRs, newest first", async () => {
    const commands = await signedInOwner();
    const legPress = await exerciseId(commands, "Leg Press");
    await logWorkout(commands, legPress, "2026-01-05T17:00:00Z", [[100, 10]]);
    const second = await logWorkout(commands, legPress, "2026-01-12T17:00:00Z", [[120, 10]]);

    const { recentPrs } = await commands.getHome({ date: "2026-01-14" });

    expect(recentPrs.length).toBeGreaterThan(0);
    expect(recentPrs.length).toBeLessThanOrEqual(5);
    expect(recentPrs[0]).toMatchObject({ workoutId: second, exerciseId: legPress, name: "Leg Press" });
  });
});
