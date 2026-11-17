import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../tests/db/test-db";
import { openWorkoutStore, type SyncTransport } from "./workout-store";

const db = setupTestDb();

describe("starting a workout from a routine", () => {
  it("pre-fills exercises and sets offline, then syncs them like any workout", async () => {
    const owner = await db().signUp("owner@example.com");
    const commands = db().commandsAs({ kind: "user", userId: owner.id });
    const idOf = async (name: string) =>
      (await commands.listExercises({ query: name })).items.find((e) => e.name === name)!.id;
    const bench = await idOf("Barbell Bench Press - Medium Grip");
    const row = await idOf("Seated Cable Rows");
    const routine = await commands.createRoutine({
      name: "Chest Upper",
      exercises: [
        {
          exerciseId: bench,
          sets: [
            { setType: "warmup", weight: 95, unit: "lb", reps: 10 },
            { weight: 182.5, unit: "lb", repRangeStart: 8, repRangeEnd: 12 },
          ],
        },
        { exerciseId: row, sets: [{ weight: 60, unit: "kg", reps: 12 }] },
      ],
    });

    let online = false;
    const transport: SyncTransport = async (ops) => {
      if (!online) throw new TypeError("Failed to fetch");
      await commands.applyWorkoutOps({ ops });
    };
    const store = await openWorkoutStore({ dbName: `workout-tracker-test-${crypto.randomUUID()}`, transport });

    await store.startFromRoutine(routine);

    const active = store.active()!;
    expect(active.name).toBe("Chest Upper");
    expect(active.exercises.map((e) => [e.exerciseId, e.sets])).toEqual([
      [
        bench,
        [
          expect.objectContaining({ setType: "warmup", weight: 95, unit: "lb", reps: 10, completed: false }),
          expect.objectContaining({ setType: "normal", weight: 182.5, unit: "lb", reps: null, completed: false }),
        ],
      ],
      [row, [expect.objectContaining({ setType: "normal", weight: 60, unit: "kg", reps: 12, completed: false })]],
    ]);

    // Starting again while a workout is in progress keeps that workout.
    await store.startFromRoutine(routine);
    expect(store.active()!.id).toBe(active.id);

    const warmup = active.exercises[0]!.sets[0]!;
    await store.updateSet(warmup.id, { completed: true });
    await store.finish();
    online = true;
    await store.sync();

    const { items } = await commands.listWorkouts({});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "Chest Upper" });
    expect(items[0]!.exercises.map((e) => e.sets.length)).toEqual([2, 1]);
  });

  it("keeps the routine's supersets (as imported from Hevy, where 0 is a group)", async () => {
    const owner = await db().signUp("owner@example.com");
    const commands = db().commandsAs({ kind: "user", userId: owner.id });
    await commands.importFromHevy({ apiKey: "0f6c1a52-2f7d-4b8e-9c55-6a1f4b0d3e21" });
    const routine = (await commands.listRoutines({})).routines.find((r) => r.name === "Upper Body A")!;
    const store = await openWorkoutStore({
      dbName: `workout-tracker-test-${crypto.randomUUID()}`,
      transport: async (ops) => void (await commands.applyWorkoutOps({ ops })),
    });

    await store.startFromRoutine(routine);

    const groups = store.active()!.exercises.map((e) => e.supersetGroup);
    expect(groups[0]).toBeNull();
    expect(groups[1]).not.toBeNull();
    expect(groups[2]).toBe(groups[1]);
  });
});
