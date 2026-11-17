import { describe, expect, it } from "vitest";
import { planBlocks, type EngineInput } from "@/engine/plan";
import { setupTestDb } from "../../../tests/db/test-db";
import { readable } from "../../../tests/readable";

const db = setupTestDb();

/**
 * The clock is pinned (default: the morning the owner's block starts, Monday 2026-10-12, Los Angeles) so
 * planned sessions and the change policy's one-week horizon don't depend on the day the suite runs.
 * `today` overrides the engine's day for tests that need a later one.
 */
const PINNED_NOW = new Date("2026-10-12T08:00:00-07:00");

async function signedInOwner(today = "2026-10-12") {
  const owner = await db().signUp("owner@example.com");
  const engine = (input: EngineInput) => planBlocks({ ...input, today });
  return db().commandsAs({ kind: "user", userId: owner.id }, { engine, now: PINNED_NOW });
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

async function exerciseId(commands: Commands, name: string) {
  const { items } = await commands.listExercises({ query: name });
  const exercise = items.find((e) => e.name === name);
  if (!exercise) throw new Error(`No catalogue exercise ${name}`);
  return exercise.id;
}

/** The owner's 4-day upper/lower split (two exercises per session, 3 × 10–15), starting Monday 2026-10-12. */
async function createUpperLower(commands: Commands) {
  const [legPress, legCurl, chestPress, row] = await Promise.all([
    exerciseId(commands, "Leg Press"),
    exerciseId(commands, "Seated Leg Curl"),
    exerciseId(commands, "Machine Bench Press"),
    exerciseId(commands, "Seated Cable Rows"),
  ]);
  const exercise = (id: string, startWeight: number) => ({
    exerciseId: id,
    sets: 3,
    repRangeStart: 10,
    repRangeEnd: 15,
    startWeight,
  });
  const block = await commands.createBlock({
    name: "Upper/Lower",
    startDate: "2026-10-12",
    weeks: 4,
    timeZone: "America/Los_Angeles",
    sessions: [
      { name: "Lower Body A", weekday: 1, exercises: [exercise(legPress, 270)] },
      { name: "Chest Upper", weekday: 2, exercises: [exercise(chestPress, 180)] },
      { name: "Hamstring Lower", weekday: 4, exercises: [exercise(legCurl, 130)] },
      { name: "Back Upper", weekday: 5, exercises: [exercise(row, 180)] },
    ],
  });
  return { block, chestPress };
}

async function logWorkout(commands: Commands, exerciseId: string, startedAt: string, sets: [number, number][]) {
  const workoutId = crypto.randomUUID();
  const workoutExerciseId = crypto.randomUUID();
  await commands.applyWorkoutOps({
    ops: [
      { type: "startWorkout", id: workoutId, startedAt },
      { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId, position: 0 },
      ...sets.map(([weight, reps], position) => ({
        type: "putSet" as const,
        id: crypto.randomUUID(),
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
}

describe("blocks and planned sessions", () => {
  it("creating a block generates its dated planned sessions", async () => {
    const commands = await signedInOwner();
    const { block } = await createUpperLower(commands);

    expect(block).toMatchObject({ name: "Upper/Lower", startDate: "2026-10-12", weeks: 4 });
    expect(block.sessions.map((s) => [s.name, s.weekday])).toEqual([
      ["Lower Body A", 1],
      ["Chest Upper", 2],
      ["Hamstring Lower", 4],
      ["Back Upper", 5],
    ]);

    const { plannedSessions } = readable(await commands.getBlock({ id: block.id }));
    expect(plannedSessions).toHaveLength(16);
    expect(plannedSessions.slice(0, 2)).toMatchObject([
      { date: "2026-10-12", week: 1, name: "Lower Body A" },
      {
        date: "2026-10-13",
        week: 1,
        name: "Chest Upper",
        exercises: [{ name: "Machine Bench Press", repRangeStart: 10, repRangeEnd: 15, sets: [{ weight: 180, reps: 10 }, {}, {}] }],
      },
    ]);
    expect((await commands.listBlocks({})).blocks.map((b) => b.name)).toEqual(["Upper/Lower"]);
  });

  it("today shows the day's planned session, or a rest day with the next session", async () => {
    const commands = await signedInOwner();
    await createUpperLower(commands);

    const tuesday = readable(await commands.getToday({ date: "2026-10-13" }));
    expect(tuesday.session).toMatchObject({ date: "2026-10-13", name: "Chest Upper", week: 1 });
    expect(tuesday.block).toMatchObject({ name: "Upper/Lower", week: 1, weeks: 4 });

    const wednesday = readable(await commands.getToday({ date: "2026-10-14" }));
    expect(wednesday.session).toBeNull();
    expect(wednesday.next).toMatchObject({ date: "2026-10-15", name: "Hamstring Lower" });

    expect(readable(await commands.getToday({ date: "2026-12-01" })).block).toBeNull();
  });

  it("finishing a workout sets the next targets by double progression", async () => {
    const commands = await signedInOwner("2026-10-14"); // the morning after: next week's session is within the week
    const { chestPress } = await createUpperLower(commands);

    // Tuesday evening in Los Angeles (Wednesday in UTC): top of the range on every set.
    await logWorkout(commands, chestPress, "2026-10-13T19:30:00-07:00", [
      [180, 15],
      [180, 15],
      [180, 15],
    ]);

    const nextWeek = readable(await commands.getToday({ date: "2026-10-20" }));
    expect(nextWeek.session!.exercises[0]).toMatchObject({
      sets: [
        { weight: 185, reps: 10 },
        { weight: 185, reps: 10 },
        { weight: 185, reps: 10 },
      ],
      progression: { decision: "increase", reason: "Hit 15 reps on all 3 sets at 180 lb, so next time is 185 lb" },
    });
    // The session that was done keeps its own targets.
    expect(readable(await commands.getToday({ date: "2026-10-13" })).session!.exercises[0]!.sets[0]).toMatchObject({ weight: 180 });
  });

  it("progresses from imported Hevy history (owner's real Machine Chest Press: 180 lb × 11, then 9 to failure)", async () => {
    const commands = await signedInOwner();
    await commands.importFromHevy({ apiKey: "test-key" });
    const { items } = await commands.listWorkouts({ limit: 50, offset: 0 });
    const imported = items.find((w) => w.name === "Upper Body A")!.exercises[0]!;

    // Hevy's workout was on Friday 2026-10-09; the block starts the Monday after.
    await commands.createBlock({
      name: "Upper",
      startDate: "2026-10-12",
      weeks: 1,
      timeZone: "America/Los_Angeles",
      sessions: [
        {
          name: "Back Upper",
          weekday: 1,
          exercises: [{ exerciseId: imported.exerciseId, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight: 100 }],
        },
      ],
    });

    const { session } = readable(await commands.getToday({ date: "2026-10-12" }));
    expect(session!.exercises[0]).toMatchObject({
      sets: [
        { weight: 180, reps: 12 },
        { weight: 180, reps: 10 },
        { weight: 180, reps: 10 },
      ],
      progression: { decision: "hold", fromWeight: 180 },
    });
  });

  it("a planned session can be fetched by id (to start it in the logger)", async () => {
    const commands = await signedInOwner();
    await createUpperLower(commands);
    const { session } = readable(await commands.getToday({ date: "2026-10-13" }));

    expect(readable(await commands.getPlannedSession({ id: session!.id }))).toEqual(session);
    await expect(commands.getPlannedSession({ id: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
  });

  it("progression rules, set ramps and deload weeks are set per block and shape its planned sessions", async () => {
    const commands = await signedInOwner("2026-10-14");
    const [chestPress, row] = await Promise.all([
      exerciseId(commands, "Machine Bench Press"),
      exerciseId(commands, "Seated Cable Rows"),
    ]);
    const block = await commands.createBlock({
      name: "Upper",
      startDate: "2026-10-12",
      weeks: 4,
      timeZone: "America/Los_Angeles",
      deloadWeeks: [4],
      sessions: [
        {
          name: "Upper",
          weekday: 2,
          exercises: [
            { exerciseId: chestPress, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight: 180, rule: "rir" },
            { exerciseId: row, sets: 2, repRangeStart: 10, repRangeEnd: 15, startWeight: 180, rule: "ramp", rampTo: 4 },
          ],
        },
      ],
    });
    expect(block.deloadWeeks).toEqual([4]);
    expect(block.sessions[0]!.exercises.map((e) => [e.rule, e.rampTo])).toEqual([
      ["rir", null],
      ["ramp", 4],
    ]);

    // Grinder-free top set with reps in reserve: the RIR rule adds load below the top of the range.
    const workoutId = crypto.randomUUID();
    const workoutExerciseId = crypto.randomUUID();
    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id: workoutId, startedAt: "2026-10-13T18:00:00-07:00" },
        { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId: chestPress, position: 0 },
        ...[12, 11, 11].map((reps, position) => ({
          type: "putSet" as const,
          id: crypto.randomUUID(),
          workoutExerciseId,
          position,
          setType: "normal" as const,
          weight: 180,
          unit: "lb" as const,
          reps,
          rir: position === 2 ? 2 : null,
          completed: true,
        })),
        { type: "finishWorkout", id: workoutId, finishedAt: "2026-10-13T19:00:00-07:00" },
      ],
    });

    const { plannedSessions } = readable(await commands.getBlock({ id: block.id }));
    expect(
      plannedSessions.map((s) => [
        s.week,
        s.deload ?? false,
        s.exercises[0]!.sets[0]!.weight,
        s.exercises[1]!.sets.length,
      ]),
    ).toEqual([
      [1, false, 180, 2],
      [2, false, 185, 3],
      [3, false, 185, 4],
      [4, true, 165, 1],
    ]);
    expect(plannedSessions[1]!.exercises[0]!.progression.reason).toBe(
      "Last set at 180 lb had 2 reps in reserve, so next time is 185 lb",
    );
    expect(plannedSessions[3]!.exercises[0]!.progression.decision).toBe("deload");
  });

  it("finished blocks are archived and can be browsed", async () => {
    const commands = await signedInOwner();
    const chestPress = await exerciseId(commands, "Machine Bench Press");
    const create = (name: string, startDate: string) =>
      commands.createBlock({
        name,
        startDate,
        weeks: 4,
        timeZone: "America/Los_Angeles",
        sessions: [
          {
            name: "A",
            weekday: 1,
            exercises: [{ exerciseId: chestPress, sets: 3, repRangeStart: 10, repRangeEnd: 15 }],
          },
        ],
      });
    const og = await create("Archive", "2020-01-06");
    await create("Next", "2099-01-05");

    expect((await commands.listBlocks({})).blocks.map((b) => [b.name, b.archived])).toEqual([
      ["Next", false],
      ["Archive", true],
    ]);
    expect((await commands.listBlocks({ archived: true })).blocks.map((b) => b.name)).toEqual(["Archive"]);
    expect((await commands.listBlocks({ archived: false })).blocks.map((b) => b.name)).toEqual(["Next"]);

    const archived = readable(await commands.getBlock({ id: og.id }));
    expect(archived.block).toMatchObject({ name: "Archive", archived: true, endDate: "2020-02-02" });
    expect(archived.plannedSessions).toHaveLength(4);
  });

  it("rejects a set ramp without a target above its sets, and deload weeks outside the block", async () => {
    const commands = await signedInOwner();
    const chestPress = await exerciseId(commands, "Machine Bench Press");
    const block = (exercise: object, deloadWeeks: number[] = []) =>
      commands.createBlock({
        name: "Bad",
        startDate: "2026-10-12",
        weeks: 4,
        timeZone: "America/Los_Angeles",
        deloadWeeks,
        sessions: [
          {
            name: "A",
            weekday: 1,
            exercises: [{ exerciseId: chestPress, sets: 3, repRangeStart: 10, repRangeEnd: 15, ...exercise }],
          },
        ],
      });
    await expect(block({ rule: "ramp" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(block({ rule: "ramp", rampTo: 3 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(block({}, [5])).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects a block whose rep range ends before it starts", async () => {
    const commands = await signedInOwner();
    const chestPress = await exerciseId(commands, "Machine Bench Press");
    await expect(
      commands.createBlock({
        name: "Bad",
        startDate: "2026-10-12",
        weeks: 4,
        timeZone: "America/Los_Angeles",
        sessions: [
          { name: "A", weekday: 1, exercises: [{ exerciseId: chestPress, sets: 3, repRangeStart: 15, repRangeEnd: 10 }] },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("the current block", () => {
  const LA = "America/Los_Angeles";
  const todayInLA = () => new Intl.DateTimeFormat("en-CA", { timeZone: LA }).format(new Date());

  async function block(commands: Commands, name: string, startDate: string) {
    const legPress = await exerciseId(commands, "Leg Press");
    return commands.createBlock({
      name,
      startDate,
      weeks: 2,
      timeZone: LA,
      sessions: [{ name: "Lower", weekday: 1, exercises: [{ exerciseId: legPress, sets: 3, repRangeStart: 10, repRangeEnd: 15 }] }],
    });
  }

  it("getBlock without an id is the block running today, else the next one, else the last one", async () => {
    const commands = await signedInOwner();
    await expect(commands.getBlock({})).rejects.toMatchObject({ code: "not_found" });

    await block(commands, "Past", "2026-01-05");
    expect(readable(await commands.getBlock({})).block.name).toBe("Past");

    await block(commands, "Later", "2031-01-06");
    await block(commands, "Next", "2030-01-07");
    const next = readable(await commands.getBlock({}));
    expect(next.block.name).toBe("Next");
    expect(next.plannedSessions.map((s) => s.date)).toEqual(["2030-01-07", "2030-01-14"]);

    await block(commands, "Now", todayInLA());
    expect(readable(await commands.getBlock({})).block.name).toBe("Now");
  });
});
