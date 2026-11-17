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

/** A Monday/Thursday block. */
async function createBlock(commands: Commands, startDate: string, weeks = 2) {
  const legPress = await exerciseId(commands, "Leg Press");
  const press = await exerciseId(commands, "Machine Bench Press");
  const exercise = (id: string, startWeight: number) => ({ exerciseId: id, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight });
  const block = await commands.createBlock({
    name: "Mon/Thu",
    startDate,
    weeks,
    timeZone: LA,
    sessions: [
      { name: "Lower", weekday: 1, exercises: [exercise(legPress, 270)] },
      { name: "Upper", weekday: 4, exercises: [exercise(press, 180)] },
    ],
  });
  return { block, legPress, press };
}

async function logWorkout(commands: Commands, exerciseId: string, startedAt: string, sets: [number, number, ("lb" | "kg")?][]) {
  const workoutId = crypto.randomUUID();
  const workoutExerciseId = crypto.randomUUID();
  await commands.applyWorkoutOps({
    ops: [
      { type: "startWorkout", id: workoutId, startedAt, name: "Session" },
      { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId, position: 0 },
      ...sets.map(([weight, reps, unit = "lb"], position) => ({
        type: "putSet" as const,
        id: crypto.randomUUID(),
        workoutExerciseId,
        position,
        setType: "normal" as const,
        weight,
        unit,
        reps,
        completed: true,
      })),
      { type: "finishWorkout", id: workoutId, finishedAt: startedAt },
    ],
  });
  return workoutId;
}

describe("calendar", () => {
  it("lists every day in the range with planned sessions marked completed or missed by the workouts logged that day", async () => {
    const commands = await signedInOwner();
    const { legPress, press } = await createBlock(commands, "2026-01-05");
    // Monday 2026-01-05 done (16:00 UTC = 08:00 in LA), Thursday 2026-01-08 skipped.
    const workoutId = await logWorkout(commands, legPress, "2026-01-05T16:00:00Z", [[270, 12]]);
    await logWorkout(commands, press, "2026-01-15T17:00:00Z", [[180, 12]]);

    const calendar = await commands.getCalendar({ from: "2026-01-05", to: "2026-01-11" });

    expect(calendar.days.map((d) => d.date)).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      "2026-01-10",
      "2026-01-11",
    ]);
    const monday = calendar.days[0]!;
    expect(monday.sessions).toEqual([
      expect.objectContaining({ name: "Lower", blockName: "Mon/Thu", week: 1, status: "completed" }),
    ]);
    expect(monday.sessions[0]!.exercises[0]).toMatchObject({ exerciseId: legPress, name: "Leg Press" });
    expect(monday.workouts).toEqual([expect.objectContaining({ id: workoutId, name: "Session" })]);
    expect(calendar.days[3]!.sessions).toEqual([expect.objectContaining({ name: "Upper", status: "missed" })]);
    expect(calendar.days[1]).toMatchObject({ sessions: [], runs: [], workouts: [] });
  });

  it("sessions from today on are planned", async () => {
    const commands = await signedInOwner();
    await createBlock(commands, "2030-01-07");
    const calendar = await commands.getCalendar({ from: "2030-01-07", to: "2030-01-10" });
    expect(calendar.days.flatMap((d) => d.sessions.map((s) => [d.date, s.name, s.status]))).toEqual([
      ["2030-01-07", "Lower", "planned"],
      ["2030-01-10", "Upper", "planned"],
    ]);
  });

  it("includes planned runs with their plan, structure and pace targets", async () => {
    const commands = await signedInOwner();
    await commands.createRace({ name: "Far Marathon", date: "2030-05-05", distanceMeters: 42_195, priority: "A" });
    const content = JSON.stringify({
      name: "Two weeks",
      runs: [
        { week: 1, day: "tue", type: "easy", distance_m: 5000 },
        { week: 1, day: "wed", type: "rest" },
        {
          week: 1,
          day: "thu",
          type: "intervals",
          structure: {
            warmup: { distance_m: 1600 },
            repeats: [{ count: 6, steps: [{ kind: "work", distance_m: 800, intensity: { kind: "pace", pace: "7:00/mi" } }, { kind: "recovery", duration_s: 90 }] }],
            cooldown: { distance_m: 1600 },
          },
        },
        { week: 2, day: "sat", type: "race_pace", distance_m: 8047, pace_target: "8:20-8:40/mi" },
        { week: 2, day: "sun", type: "race" },
      ],
    });
    await commands.importRunPlan({ format: "json", content, timeZone: LA });

    // Race week is Mon 2030-04-29 – Sun 2030-05-05, so week 1 starts Mon 2030-04-22.
    const calendar = await commands.getCalendar({ from: "2030-04-23", to: "2030-04-25" });
    const runs = calendar.days.flatMap((d) => d.runs);
    expect(runs.map((r) => [r.date, r.type, r.planName, r.status])).toEqual([
      ["2030-04-23", "easy", "Two weeks", "planned"],
      ["2030-04-24", "rest", "Two weeks", "rest"],
      ["2030-04-25", "intervals", "Two weeks", "planned"],
    ]);
    expect(runs[2]!.structure?.repeats?.[0]).toMatchObject({ count: 6 });
  });

  it("defaults to two weeks from today and refuses ranges over 92 days", async () => {
    const commands = await signedInOwner();
    const calendar = await commands.getCalendar({});
    expect(calendar.days).toHaveLength(14);
    expect(calendar.days[0]!.date).toBe(calendar.today);
    await expect(commands.getCalendar({ from: "2026-01-01", to: "2026-06-01" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(commands.getCalendar({ from: "2026-02-01", to: "2026-01-01" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("anonymous callers see an empty calendar", async () => {
    const commands = await signedInOwner();
    await createBlock(commands, "2026-01-05");
    const anon = db().commandsAs({ kind: "anon" });
    const calendar = await anon.getCalendar({ from: "2026-01-05", to: "2026-01-11" });
    expect(calendar.days.flatMap((d) => d.sessions)).toEqual([]);
  });
});
