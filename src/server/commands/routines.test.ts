import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

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

describe("previous values", () => {
  /** Logs (and optionally finishes) a one-exercise workout; sets are [weight, reps, completed?]. */
  async function logWorkout(
    commands: Commands,
    exerciseId: string,
    { startedAt, finished = true, sets }: { startedAt: string; finished?: boolean; sets: [number, number, boolean?][] },
  ) {
    const workoutId = crypto.randomUUID();
    const workoutExerciseId = crypto.randomUUID();
    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id: workoutId, startedAt },
        { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId, position: 0 },
        ...sets.map(([weight, reps, completed = true], position) => ({
          type: "putSet" as const,
          id: crypto.randomUUID(),
          workoutExerciseId,
          position,
          setType: "normal" as const,
          weight,
          unit: "lb" as const,
          reps,
          completed,
        })),
        ...(finished ? [{ type: "finishWorkout" as const, id: workoutId, finishedAt: startedAt }] : []),
      ],
    });
  }

  it("gives each exercise's sets from the last finished workout that included it, by set position", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const row = await exerciseId(commands, "Seated Cable Rows");
    const squat = await exerciseId(commands, "Barbell Squat");

    await logWorkout(commands, bench, { startedAt: "2026-10-01T07:00:00Z", sets: [[175, 8], [175, 7]] });
    await logWorkout(commands, bench, { startedAt: "2026-10-08T07:00:00Z", sets: [[180, 8], [182.5, 6], [100, 1, false]] });
    await logWorkout(commands, row, { startedAt: "2026-10-09T07:00:00Z", sets: [[150, 12]] });
    // The workout in progress is not "previous".
    await logWorkout(commands, bench, { startedAt: "2026-10-11T07:00:00Z", finished: false, sets: [[999, 1]] });

    const { previous } = await commands.getPreviousSets({ exerciseIds: [bench, squat] });

    expect(previous).toEqual({
      [bench]: [
        { position: 0, setType: "normal", weight: 180, unit: "lb", reps: 8 },
        { position: 1, setType: "normal", weight: 182.5, unit: "lb", reps: 6 },
      ],
    });
    // Without a filter: every exercise ever done (the logger ships this so it works offline).
    expect(Object.keys((await commands.getPreviousSets({})).previous).sort()).toEqual([bench, row].sort());
  });
});

describe("routine folders", () => {
  it("creates, renames, reorders and deletes folders", async () => {
    const commands = await signedInOwner();

    const current = await commands.createRoutineFolder({ name: "Current" });
    const archive = await commands.createRoutineFolder({ name: "Archive" });
    await commands.renameRoutineFolder({ id: archive.id, name: "Archive" });

    expect((await commands.listRoutines({})).folders.map((f) => f.name)).toEqual(["Current", "Archive"]);

    await commands.reorderRoutineFolders({ ids: [archive.id, current.id] });
    expect((await commands.listRoutines({})).folders.map((f) => f.name)).toEqual(["Archive", "Current"]);

    await commands.deleteRoutineFolder({ id: archive.id });
    expect((await commands.listRoutines({})).folders.map((f) => f.name)).toEqual(["Current"]);
  });
});

describe("routines", () => {
  it("creates a routine with exercises and target sets in a folder", async () => {
    const commands = await signedInOwner();
    const folder = await commands.createRoutineFolder({ name: "Current" });
    const bench = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const row = await exerciseId(commands, "Seated Cable Rows");

    const created = await commands.createRoutine({
      name: "Chest Upper",
      folderId: folder.id,
      exercises: [
        {
          exerciseId: bench,
          restSeconds: 120,
          sets: [
            { setType: "warmup", weight: 95, unit: "lb", reps: 10 },
            { weight: 182.5, unit: "lb", repRangeStart: 8, repRangeEnd: 12 },
          ],
        },
        { exerciseId: row, notes: "Seat 3", sets: [{ weight: 140, unit: "lb", reps: 12 }] },
      ],
    });

    expect(await commands.getRoutine({ id: created.id })).toEqual({
      id: created.id,
      folderId: folder.id,
      name: "Chest Upper",
      notes: null,
      position: 0,
      exercises: [
        {
          exerciseId: bench,
          name: "Barbell Bench Press - Medium Grip",
          position: 0,
          restSeconds: 120,
          supersetGroup: null,
          notes: null,
          sets: [
            { position: 0, setType: "warmup", weight: 95, unit: "lb", reps: 10, repRangeStart: null, repRangeEnd: null },
            { position: 1, setType: "normal", weight: 182.5, unit: "lb", reps: null, repRangeStart: 8, repRangeEnd: 12 },
          ],
        },
        {
          exerciseId: row,
          name: "Seated Cable Rows",
          position: 1,
          restSeconds: null,
          supersetGroup: null,
          notes: "Seat 3",
          sets: [
            { position: 0, setType: "normal", weight: 140, unit: "lb", reps: 12, repRangeStart: null, repRangeEnd: null },
          ],
        },
      ],
    });
  });

  it("edits a routine, replacing its exercises and sets", async () => {
    const commands = await signedInOwner();
    const bench = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const row = await exerciseId(commands, "Seated Cable Rows");
    const routine = await commands.createRoutine({
      name: "Upper",
      exercises: [{ exerciseId: bench, sets: [{ weight: 180, unit: "lb", reps: 8 }] }],
    });

    await commands.updateRoutine({
      id: routine.id,
      name: "Back Upper",
      notes: "Rows first",
      exercises: [
        { exerciseId: row, sets: [{ weight: 150, unit: "lb", reps: 10 }] },
        { exerciseId: bench, sets: [{ weight: 185, unit: "lb", reps: 8 }, { weight: 185, unit: "lb", reps: 8 }] },
      ],
    });

    const edited = await commands.getRoutine({ id: routine.id });
    expect(edited).toMatchObject({ name: "Back Upper", notes: "Rows first", folderId: null });
    expect(edited.exercises.map((e) => [e.name, e.sets.map((s) => `${s.weight}×${s.reps}`)])).toEqual([
      ["Seated Cable Rows", ["150×10"]],
      ["Barbell Bench Press - Medium Grip", ["185×8", "185×8"]],
    ]);
  });

  it("reorders routines, moves them between folders and deletes them", async () => {
    const commands = await signedInOwner();
    const current = await commands.createRoutineFolder({ name: "Current" });
    const archive = await commands.createRoutineFolder({ name: "Archive" });
    const make = (name: string) => commands.createRoutine({ name, folderId: current.id, exercises: [] });
    const quad = await make("Lower Body A");
    const chest = await make("Chest Upper");
    const strength = await make("Strength A");

    const names = async () => {
      const { folders, routines } = await commands.listRoutines({});
      return Object.fromEntries([
        ...folders.map((f) => [f.name, routines.filter((r) => r.folderId === f.id).map((r) => r.name)]),
        ["unfiled", routines.filter((r) => r.folderId === null).map((r) => r.name)],
      ]);
    };

    await commands.reorderRoutines({ folderId: archive.id, ids: [strength.id] });
    await commands.reorderRoutines({ folderId: current.id, ids: [chest.id, quad.id] });
    expect(await names()).toEqual({
      Current: ["Chest Upper", "Lower Body A"],
      "Archive": ["Strength A"],
      unfiled: [],
    });

    await commands.deleteRoutine({ id: chest.id });
    await commands.deleteRoutineFolder({ id: archive.id });
    expect(await names()).toEqual({ Current: ["Lower Body A"], unfiled: ["Strength A"] });
    await expect(commands.getRoutine({ id: chest.id })).rejects.toMatchObject({ code: "not_found" });
  });

  it("only the owner can see or change routines", async () => {
    const commands = await signedInOwner();
    await commands.createRoutine({ name: "Secret split", exercises: [] });
    const anon = db().commandsAs({ kind: "anon" });

    expect((await anon.listRoutines({})).routines).toEqual([]);
    await expect(anon.createRoutine({ name: "Spam", exercises: [] })).rejects.toMatchObject({ code: "unauthorized" });
  });
});
