import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();
const API_KEY = "0f6c1a52-2f7d-4b8e-9c55-6a1f4b0d3e21";

async function signedInOwner(hevyFixtures?: string) {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id }, { hevyFixtures });
}

const lbSet = (setType: string, weight: number | null, reps: number) =>
  expect.objectContaining({ setType, weight, unit: "lb", reps, completed: true });

describe("Hevy import: workouts", () => {
  it("imports every workout with its sets, set types, supersets and notes, in lb", async () => {
    const commands = await signedInOwner();

    await commands.importFromHevy({ apiKey: API_KEY });

    const { items } = await commands.listWorkouts({});
    expect(items).toHaveLength(2);
    const [upper, lower] = items;
    expect(upper).toMatchObject({
      name: "Upper Body A",
      notes: "Felt strong",
      startedAt: "2026-10-09T22:27:32.000Z",
      finishedAt: "2026-10-10T00:01:13.000Z",
    });
    expect(upper!.exercises).toEqual([
      expect.objectContaining({
        name: "Machine Chest Press",
        position: 0,
        notes: "Seat 3",
        supersetGroup: null,
        sets: [lbSet("warmup", 135, 10), lbSet("normal", 180, 11), lbSet("failure", 180, 9), lbSet("drop", 130, 8)],
      }),
      expect.objectContaining({ name: "Face Pull", notes: null, supersetGroup: 0, sets: [lbSet("normal", 90, 16)] }),
      expect.objectContaining({
        name: "Lateral Raise (Machine)",
        notes: null,
        supersetGroup: 0,
        sets: [lbSet("normal", 124, 12)],
      }),
    ]);
    expect(lower).toMatchObject({ name: "Lower Body A", notes: null });
    expect(lower!.exercises.map((e) => [e.supersetGroup, e.sets.map((s) => [s.weight, s.reps])])).toEqual([
      [null, [[290, 12], [180, 12]]], // 81.6 kg = 179.897 lb → nearest 0.5 lb
      [1, [[170, 15]]],
      [1, [[50, 10]]],
      [null, [[null, 8]]], // bodyweight
      [null, [[40, 10]]],
      [null, [[120, 12]]],
    ]);
  });
});

async function exerciseNamed(commands: Awaited<ReturnType<typeof signedInOwner>>, name: string) {
  const { items } = await commands.listExercises({ query: name, limit: 2000 });
  const found = items.filter((e) => e.name === name);
  expect(found).toHaveLength(1);
  return found[0]!;
}

async function historyExerciseIds(commands: Awaited<ReturnType<typeof signedInOwner>>) {
  const { items } = await commands.listWorkouts({});
  return new Map(items.flatMap((w) => w.exercises.map((e) => [e.name, e.exerciseId] as const)));
}

describe("Hevy import: exercises", () => {
  it("attaches history to catalogue exercises it matches with certainty by name and equipment", async () => {
    const commands = await signedInOwner();

    const result = await commands.importFromHevy({ apiKey: API_KEY });

    const { items } = await commands.listWorkouts({});
    const lower = items.find((w) => w.name === "Lower Body A")!;
    expect(lower.exercises.map((e) => e.name)).toEqual([
      "Leg Press", // Leg Press (Machine)
      "Leg Extensions", // Leg Extension (Machine)
      "Barbell Bench Press - Medium Grip", // Bench Press (Barbell)
      "Pullups", // Pull Up
      "Old Squat Variation", // custom exercise since deleted in Hevy
      "Lat Pulldown (Cable)", // uncertain: awaiting review
    ]);
    for (const name of ["Leg Press", "Leg Extensions", "Barbell Bench Press - Medium Grip", "Pullups", "Face Pull"]) {
      expect((await exerciseNamed(commands, name)).source).toBe("free-exercise-db");
    }
    // + Seated Leg Curl (Machine), used only by a routine.
    expect(result.exercises).toEqual({ matched: 6, review: 1, custom: 3 });
  });

  it("imports custom Hevy exercises with their history as `hevy` exercises", async () => {
    const commands = await signedInOwner();

    await commands.importFromHevy({ apiKey: API_KEY });

    const rails = await exerciseNamed(commands, "Machine Chest Press");
    expect(rails).toMatchObject({
      source: "hevy",
      hevyTemplateId: "29036bf8-6e5b-484a-acc3-ad8a25f62d6b",
      primaryMuscles: ["chest"],
      secondaryMuscles: ["triceps", "shoulders"],
      category: "strength",
    });
    expect((await historyExerciseIds(commands)).get("Machine Chest Press")).toBe(rails.id);
    expect((await exerciseNamed(commands, "Old Squat Variation")).source).toBe("hevy");
  });

  it("makes unmatched Hevy exercises custom `hevy` exercises, keeping Hevy's equipment", async () => {
    const commands = await signedInOwner();

    await commands.importFromHevy({ apiKey: API_KEY });

    // The catalogue only has dumbbell, cable and band lateral raises.
    const lateral = await exerciseNamed(commands, "Lateral Raise (Machine)");
    expect(lateral).toMatchObject({
      source: "hevy",
      hevyTemplateId: "D5D0354D",
      equipment: "machine",
      primaryMuscles: ["shoulders"],
    });
    expect((await historyExerciseIds(commands)).get("Lateral Raise (Machine)")).toBe(lateral.id);
    expect((await commands.getHevyImport({})).reviews.map((r) => r.hevyTitle)).toEqual(["Lat Pulldown (Cable)"]);
  });

  it("sends uncertain matches to review with catalogue suggestions, history kept meanwhile", async () => {
    const commands = await signedInOwner();

    const result = await commands.importFromHevy({ apiKey: API_KEY });

    expect(result.pendingReview).toBe(1);
    const { reviews } = await commands.getHevyImport({});
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({
      hevyTemplateId: "6A6C31A5",
      hevyTitle: "Lat Pulldown (Cable)",
      exercise: { name: "Lat Pulldown (Cable)", source: "hevy", equipment: "cable" },
    });
    // The catalogue only has grip/stance variants, so the owner picks.
    const suggestions = reviews[0]!.candidates.map((c) => c.name);
    expect(suggestions).toContain("Wide-Grip Lat Pulldown");
    expect(reviews[0]!.candidates.every((c) => c.equipment === "cable" || c.equipment === null)).toBe(true);
    expect((await historyExerciseIds(commands)).get("Lat Pulldown (Cable)")).toBe(reviews[0]!.exercise.id);
  });

  it("choosing a catalogue exercise in review moves the history there, and later imports keep that choice", async () => {
    const commands = await signedInOwner();
    await commands.importFromHevy({ apiKey: API_KEY });
    const [review] = (await commands.getHevyImport({})).reviews;
    const wideGrip = review!.candidates.find((c) => c.name === "Wide-Grip Lat Pulldown")!;

    await commands.resolveHevyMatch({ hevyTemplateId: "6A6C31A5", exerciseId: wideGrip.id });

    const lowerNames = async () =>
      (await commands.listWorkouts({})).items.find((w) => w.name === "Lower Body A")!.exercises.map((e) => e.name);
    expect(await lowerNames()).toContain("Wide-Grip Lat Pulldown");
    expect((await commands.listExercises({ query: "Lat Pulldown (Cable)" })).items).toEqual([]);
    expect((await commands.getHevyImport({})).reviews).toEqual([]);

    const again = await commands.importFromHevy({});

    expect(again.pendingReview).toBe(0);
    expect(again.exercises).toEqual({ matched: 0, review: 0, custom: 0 });
    expect(await lowerNames()).toContain("Wide-Grip Lat Pulldown");
  });

  it("keeping an uncertain match as its own exercise also persists across imports", async () => {
    const commands = await signedInOwner();
    await commands.importFromHevy({ apiKey: API_KEY });
    const [review] = (await commands.getHevyImport({})).reviews;

    await commands.resolveHevyMatch({ hevyTemplateId: "6A6C31A5", exerciseId: null });
    await commands.importFromHevy({});

    expect((await commands.getHevyImport({})).reviews).toEqual([]);
    expect((await exerciseNamed(commands, "Lat Pulldown (Cable)")).id).toBe(review!.exercise.id);
  });

  it("only resolves matches that are awaiting review", async () => {
    const commands = await signedInOwner();
    await commands.importFromHevy({ apiKey: API_KEY });

    await expect(commands.resolveHevyMatch({ hevyTemplateId: "BE640BA0", exerciseId: null })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

const fixtures = (name: string) => join(import.meta.dirname, "../../../tests/fixtures", name);

describe("Hevy import: re-runs", () => {
  it("re-running the import creates no duplicates", async () => {
    const commands = await signedInOwner();
    await commands.importFromHevy({ apiKey: API_KEY });
    const before = await commands.listWorkouts({});
    const exercisesBefore = (await commands.listExercises({ limit: 2000 })).items.length;

    const again = await commands.importFromHevy({});

    expect(again.workouts).toEqual({ imported: 0, updated: 0, unchanged: 2 });
    expect(again.exercises).toEqual({ matched: 0, review: 0, custom: 0 });
    expect(await commands.listWorkouts({})).toEqual(before);
    expect((await commands.listExercises({ limit: 2000 })).items).toHaveLength(exercisesBefore);
  });

  it("picks up new workouts and changes made in Hevy since the last run", async () => {
    const owner = await db().signUp("owner@example.com");
    const first = db().commandsAs({ kind: "user", userId: owner.id });
    await first.importFromHevy({ apiKey: API_KEY });
    const later = db().commandsAs({ kind: "user", userId: owner.id }, { hevyFixtures: fixtures("hevy-later") });

    const result = await later.importFromHevy({});

    expect(result.workouts).toEqual({ imported: 1, updated: 1, unchanged: 1 });
    const { items } = await later.listWorkouts({});
    expect(items.map((w) => [w.name, w.notes])).toEqual([
      ["Lower Body A", null],
      ["Upper Body A", "Felt strong, edited later"],
      ["Lower Body A", null],
    ]);
    expect(items[0]!.exercises).toEqual([
      expect.objectContaining({ name: "Leg Press", sets: [lbSet("normal", 295, 12)] }),
    ]);
    expect(items[1]!.exercises).toEqual([
      expect.objectContaining({ name: "Machine Chest Press", sets: [lbSet("normal", 180, 12)] }),
    ]);
  });
});

describe("Hevy import: API key", () => {
  it("needs an API key the first time, then remembers it", async () => {
    const commands = await signedInOwner();
    expect((await commands.getHevyImport({})).connected).toBe(false);

    await expect(commands.importFromHevy({})).rejects.toMatchObject({ code: "invalid_input" });
    await commands.importFromHevy({ apiKey: API_KEY });

    const status = await commands.getHevyImport({});
    expect(status.connected).toBe(true);
    expect(status.lastImportedAt).not.toBeNull();
    expect(status.lastResult?.workouts.imported).toBe(2);
    expect(await commands.importFromHevy({})).toMatchObject({ workouts: { unchanged: 2 } });
  });

  it("never puts the saved key in the data export", async () => {
    const commands = await signedInOwner();
    await commands.importFromHevy({ apiKey: API_KEY });

    const exported = await commands.exportJson({});

    expect(exported.tables.hevy_connection).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain(API_KEY);
  });

  it("reports a key Hevy rejects as invalid input", async () => {
    const commands = await signedInOwner(fixtures("hevy-rejected"));

    await expect(commands.importFromHevy({ apiKey: "not-a-pro-key" })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("reports Hevy as unavailable when it keeps rate-limiting", async () => {
    const commands = await signedInOwner(fixtures("hevy-down"));

    await expect(commands.importFromHevy({ apiKey: API_KEY })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("is owner-only", async () => {
    await db().signUp("owner@example.com");
    const anon = db().commandsAs({ kind: "anon" });

    await expect(anon.importFromHevy({ apiKey: API_KEY })).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("Hevy import: body measurements", () => {
  it("imports every dated entry, weights in lb and girths in cm", async () => {
    const commands = await signedInOwner();

    const result = await commands.importFromHevy({ apiKey: API_KEY });

    const { items } = await commands.listBodyMeasurements({});
    expect(items).toEqual([
      {
        id: expect.any(String),
        date: "2026-09-30",
        weightUnit: "lb",
        lengthUnit: "cm",
        // 84 kg = 185.188 lb
        values: {
          weight: 185.2,
          fatPercent: 17.5,
          shoulders: 121.9,
          chest: 104,
          leftBicep: 38,
          rightBicep: 38.5,
          waist: 86,
          leftThigh: 61.5,
        },
      },
      {
        id: expect.any(String),
        date: "2026-06-01",
        weightUnit: "lb",
        lengthUnit: "cm",
        values: { weight: 190, leanMass: 155, neck: 40, abdomen: 92.5, hips: 101, leftCalf: 39, rightCalf: 39.5 },
      },
      // 2025-01-01 measured nothing, so it isn't an entry.
    ]);
    expect(result.bodyMeasurements).toEqual({ imported: 2, updated: 0, unchanged: 0 });
    expect((await commands.getBodyMetricHistory({ metric: "weight" })).trend).toMatchObject({ changeSinceFirst: -4.8 });
  });

  it("re-running creates no duplicates and picks up entries added or changed in Hevy", async () => {
    const owner = await db().signUp("owner@example.com");
    const first = db().commandsAs({ kind: "user", userId: owner.id });
    await first.importFromHevy({ apiKey: API_KEY });
    expect((await first.importFromHevy({})).bodyMeasurements).toEqual({ imported: 0, updated: 0, unchanged: 2 });
    const later = db().commandsAs({ kind: "user", userId: owner.id }, { hevyFixtures: fixtures("hevy-later") });

    const result = await later.importFromHevy({});

    expect(result.bodyMeasurements).toEqual({ imported: 1, updated: 1, unchanged: 1 });
    const { items } = await later.listBodyMeasurements({});
    expect(items.map((m) => [m.date, m.values.weight, m.values.waist])).toEqual([
      ["2026-10-10", 184.1, undefined],
      ["2026-09-30", 185.2, 85],
      ["2026-06-01", 190, undefined],
    ]);
  });

  it("never overwrites entries logged or edited in workout tracker", async () => {
    const owner = await db().signUp("owner@example.com");
    const commands = db().commandsAs({ kind: "user", userId: owner.id });
    await commands.logBodyMeasurement({ date: "2026-09-30", values: { weight: 186 } });
    await commands.importFromHevy({ apiKey: API_KEY });
    const june = (await commands.listBodyMeasurements({})).items.find((m) => m.date === "2026-06-01")!;
    await commands.updateBodyMeasurement({ ...june, values: { ...june.values, weight: 191 } });
    const later = db().commandsAs({ kind: "user", userId: owner.id }, { hevyFixtures: fixtures("hevy-later") });

    await later.importFromHevy({});

    const { items } = await later.listBodyMeasurements({});
    expect(items.map((m) => [m.date, m.values])).toEqual([
      ["2026-10-10", { weight: 184.1 }],
      ["2026-09-30", { weight: 186 }],
      ["2026-06-01", { ...june.values, weight: 191 }],
    ]);
  });
});

const routineSet = (setType: string, weight: number | null, reps: number | null, range: [number, number] | null = null) =>
  expect.objectContaining({
    setType,
    weight,
    unit: "lb",
    reps,
    repRangeStart: range?.[0] ?? null,
    repRangeEnd: range?.[1] ?? null,
  });

describe("Hevy import: routines and folders", () => {
  it("imports folders in Hevy's order and routines with their exercises and target sets, in lb", async () => {
    const commands = await signedInOwner();

    const result = await commands.importFromHevy({ apiKey: API_KEY });

    const { folders, routines } = await commands.listRoutines({});
    expect(folders.map((f) => f.name)).toEqual(["Current", "Archive"]);
    const folderName = new Map(folders.map((f) => [f.id, f.name]));
    expect(routines.map((r) => [r.name, r.folderId && folderName.get(r.folderId)])).toEqual([
      ["Upper Body A", "Current"],
      ["Lower Body A", "Current"],
      ["Old Push", "Archive"],
      ["Mobility", null],
    ]);
    const [upper] = routines;
    expect(upper!.notes).toBe("Slow negatives");
    expect(upper!.exercises).toEqual([
      expect.objectContaining({
        name: "Machine Chest Press",
        position: 0,
        restSeconds: 120,
        notes: "Seat 3",
        supersetGroup: null,
        sets: [routineSet("warmup", 135, 10), routineSet("normal", 180, null, [10, 15])],
      }),
      expect.objectContaining({
        name: "Face Pull",
        position: 1,
        notes: null,
        supersetGroup: 0,
        sets: [routineSet("normal", 90, 16), routineSet("drop", 50, 20)],
      }),
      expect.objectContaining({
        name: "Lateral Raise (Machine)",
        position: 2,
        restSeconds: 60,
        supersetGroup: 0,
        sets: [routineSet("normal", 130, null, [12, 15])],
      }),
    ]);
    const mobility = routines.find((r) => r.name === "Mobility")!;
    expect(mobility.notes).toBeNull();
    expect(mobility.exercises[0]!.sets).toEqual([routineSet("normal", null, null)]);
    expect(result.routines).toEqual({ imported: 4, updated: 0, unchanged: 0 });
    expect(result.routineFolders).toEqual({ imported: 2, updated: 0, unchanged: 0 });
  });

  it("puts routine exercises on the same exercises as the imported history", async () => {
    const commands = await signedInOwner();

    await commands.importFromHevy({ apiKey: API_KEY });

    const history = await historyExerciseIds(commands);
    const { routines } = await commands.listRoutines({});
    const routineIds = new Map(routines.flatMap((r) => r.exercises.map((e) => [e.name, e.exerciseId] as const)));
    for (const name of ["Machine Chest Press", "Face Pull", "Lateral Raise (Machine)", "Leg Press", "Pullups"]) {
      expect(routineIds.get(name), name).toBe(history.get(name));
    }
    expect(routineIds.get("Barbell Bench Press - Medium Grip")).toBe(history.get("Barbell Bench Press - Medium Grip"));
    expect(routineIds.get("Lat Pulldown (Cable)")).toBe(history.get("Lat Pulldown (Cable)"));
    // Only in a routine: still matched to the catalogue.
    expect((await exerciseNamed(commands, "Seated Leg Curl")).id).toBe(routineIds.get("Seated Leg Curl"));
  });

  it("re-running creates no duplicate folders or routines", async () => {
    const commands = await signedInOwner();
    await commands.importFromHevy({ apiKey: API_KEY });
    const before = await commands.listRoutines({});

    const again = await commands.importFromHevy({});

    expect(again.routines).toEqual({ imported: 0, updated: 0, unchanged: 4 });
    expect(again.routineFolders).toEqual({ imported: 0, updated: 0, unchanged: 2 });
    expect(await commands.listRoutines({})).toEqual(before);
  });

  it("keeps changes made in workout tracker to routines Hevy hasn't changed since", async () => {
    const commands = await signedInOwner();
    await commands.importFromHevy({ apiKey: API_KEY });
    const { folders, routines } = await commands.listRoutines({});
    const mobility = routines.find((r) => r.name === "Mobility")!;
    await commands.updateRoutine({ id: mobility.id, name: "Mobility + core", notes: null, exercises: [] });
    await commands.renameRoutineFolder({ id: folders[1]!.id, name: "Archive" });

    await commands.importFromHevy({});

    const after = await commands.listRoutines({});
    expect(after.folders.map((f) => f.name)).toEqual(["Current", "Archive"]);
    expect(after.routines.find((r) => r.id === mobility.id)).toMatchObject({ name: "Mobility + core", exercises: [] });
  });

  it("picks up routines added or changed in Hevy since the last run", async () => {
    const owner = await db().signUp("owner@example.com");
    await db().commandsAs({ kind: "user", userId: owner.id }).importFromHevy({ apiKey: API_KEY });
    const later = db().commandsAs({ kind: "user", userId: owner.id }, { hevyFixtures: fixtures("hevy-later") });

    const result = await later.importFromHevy({});

    expect(result.routines).toEqual({ imported: 1, updated: 1, unchanged: 2 });
    expect(result.routineFolders).toEqual({ imported: 0, updated: 1, unchanged: 1 });
    const { folders, routines } = await later.listRoutines({});
    expect(folders.map((f) => f.name)).toEqual(["Current split", "Archive"]);
    // Deleted in Hevy ("Old Push") is kept in workout tracker.
    expect(routines.map((r) => r.name)).toEqual([
      "Upper Body A",
      "Lower Body A",
      "Push Day",
      "Old Push",
      "Mobility",
    ]);
    expect(routines[0]!.exercises).toEqual([
      expect.objectContaining({
        name: "Machine Chest Press",
        supersetGroup: null,
        sets: [routineSet("normal", 185, null, [8, 12])],
      }),
    ]);
    expect(routines[2]!.exercises).toEqual([
      expect.objectContaining({ name: "Barbell Bench Press - Medium Grip", sets: [routineSet("normal", 225, 5)] }),
    ]);
  });

  it("resolving a review moves routine exercises along with the history", async () => {
    const commands = await signedInOwner();
    await commands.importFromHevy({ apiKey: API_KEY });
    const [review] = (await commands.getHevyImport({})).reviews;
    const wideGrip = review!.candidates.find((c) => c.name === "Wide-Grip Lat Pulldown")!;

    await commands.resolveHevyMatch({ hevyTemplateId: "6A6C31A5", exerciseId: wideGrip.id });

    const quad = (await commands.listRoutines({})).routines.find((r) => r.name === "Lower Body A")!;
    expect(quad.exercises.map((e) => e.name)).toEqual(["Leg Press", "Seated Leg Curl", "Wide-Grip Lat Pulldown"]);
    expect((await commands.listExercises({ query: "Lat Pulldown (Cable)" })).items).toEqual([]);
  });
});
