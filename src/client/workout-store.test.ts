import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { DEFAULT_REST_SECONDS, restElapsed, restRemaining, type WorkoutOp } from "@/domain/workout";
import { setupTestDb } from "../../tests/db/test-db";
import { openWorkoutStore, type SyncTransport } from "./workout-store";

const db = setupTestDb();

/** The owner's command layer, reachable only while `online` is true — like the PWA's sync endpoint. */
async function server() {
  const owner = await db().signUp("owner@example.com");
  const commands = db().commandsAs({ kind: "user", userId: owner.id });
  const { items } = await commands.listExercises({ query: "Barbell Bench Press - Medium Grip" });
  const benchId = items[0]!.id;
  const link = { online: true, batches: [] as WorkoutOp[][] };
  const transport: SyncTransport = async (ops) => {
    if (!link.online) throw new TypeError("Failed to fetch");
    link.batches.push(ops);
    await commands.applyWorkoutOps({ ops });
  };
  return { commands, benchId, link, transport };
}

const freshDbName = () => `workout-tracker-test-${crypto.randomUUID()}`;

describe("local-first workout store", () => {
  it("logs a whole workout offline, then syncs it exactly once when back online", async () => {
    const { commands, benchId, link, transport } = await server();
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });

    await store.start();
    const bench = await store.addExercise(benchId);
    const warmup = await store.addSet(bench);
    await store.updateSet(warmup, { setType: "warmup", weight: 95, reps: 10, completed: true });
    const working = await store.addSet(bench);
    await store.updateSet(working, { weight: 182.5, reps: 8, completed: true });
    await store.finish();
    await store.sync(); // fails quietly while offline

    expect(store.active()).toBeNull();
    expect(store.pendingCount()).toBeGreaterThan(0);
    expect((await commands.listWorkouts({})).items).toEqual([]);

    link.online = true;
    await store.sync();
    await store.sync();

    expect(store.pendingCount()).toBe(0);
    const { items } = await commands.listWorkouts({});
    expect(items).toHaveLength(1);
    expect(items[0]!.exercises[0]!.sets).toMatchObject([
      { setType: "warmup", weight: 95, unit: "lb", reps: 10, completed: true },
      { setType: "normal", weight: 182.5, unit: "lb", reps: 8, completed: true },
    ]);
  });

  it("keeps the active workout and its outbox across a reload", async () => {
    const { commands, benchId, link, transport } = await server();
    link.online = false;
    const dbName = freshDbName();
    const first = await openWorkoutStore({ dbName, transport });
    await first.start();
    const bench = await first.addExercise(benchId);
    const set = await first.addSet(bench);
    await first.updateSet(set, { weight: 135, reps: 12, completed: true });
    first.close();

    const reopened = await openWorkoutStore({ dbName, transport });

    expect(reopened.active()?.exercises[0]).toMatchObject({
      exerciseId: benchId,
      sets: [{ weight: 135, unit: "lb", reps: 12, completed: true }],
    });
    await reopened.finish();
    link.online = true;
    await reopened.sync();
    expect((await commands.listWorkouts({})).items).toHaveLength(1);
  });

  it("a new set copies the previous set's weight, reps and unit", async () => {
    const { benchId, link, transport } = await server();
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const bench = await store.addExercise(benchId);
    const first = await store.addSet(bench);
    await store.updateSet(first, { weight: 60, unit: "kg", reps: 5, completed: true });

    await store.addSet(bench);

    expect(store.active()!.exercises[0]!.sets[1]).toMatchObject({
      setType: "normal",
      weight: 60,
      unit: "kg",
      reps: 5,
      completed: false,
    });
  });

  it("a sync that is interrupted after the server committed resends without duplicating", async () => {
    const { commands, benchId, link, transport } = await server();
    let dropReply = true;
    const flaky: SyncTransport = async (ops) => {
      await transport(ops);
      if (dropReply) {
        dropReply = false;
        throw new TypeError("network connection was lost");
      }
    };
    link.online = true;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport: flaky });
    await store.start();
    const bench = await store.addExercise(benchId);
    const set = await store.addSet(bench);
    await store.updateSet(set, { weight: 225, reps: 3, completed: true });
    await store.finish();

    await store.sync();
    await store.sync();

    expect(link.batches.length).toBeGreaterThanOrEqual(2);
    expect(store.pendingCount()).toBe(0);
    const { items } = await commands.listWorkouts({});
    expect(items).toHaveLength(1);
    expect(items[0]!.exercises[0]!.sets).toHaveLength(1);
  });

  it("removes sets and exercises", async () => {
    const { benchId, link, transport } = await server();
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const bench = await store.addExercise(benchId);
    const keep = await store.addSet(bench);
    const drop = await store.addSet(bench);
    const other = await store.addExercise(benchId);

    await store.removeSet(drop);
    await store.removeExercise(other);

    expect(store.active()!.exercises).toHaveLength(1);
    expect(store.active()!.exercises[0]!.sets.map((s) => s.id)).toEqual([keep]);
  });

  it("keeps the remaining sets in order after removing a middle set or the last set", async () => {
    const { benchId, link, transport } = await server();
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const bench = await store.addExercise(benchId);
    const first = await store.addSet(bench);
    const middle = await store.addSet(bench);
    const last = await store.addSet(bench);
    const setIds = () => store.active()!.exercises[0]!.sets.map((s) => s.id);

    await store.removeSet(middle);
    expect(setIds()).toEqual([first, last]);

    await store.removeSet(last);
    expect(setIds()).toEqual([first]);

    const next = await store.addSet(bench);
    expect(setIds()).toEqual([first, next]);
  });

  it("queues a set removal made offline and syncs it later", async () => {
    const { commands, benchId, link, transport } = await server();
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const bench = await store.addExercise(benchId);
    const keep = await store.addSet(bench);
    const empty = await store.addSet(bench);
    await store.updateSet(keep, { weight: 100, reps: 5, completed: true });
    await store.removeSet(empty);
    await store.finish();
    await store.sync(); // fails quietly while offline

    expect(store.pendingCount()).toBeGreaterThan(0);

    link.online = true;
    await store.sync();

    expect(store.pendingCount()).toBe(0);
    const { items } = await commands.listWorkouts({});
    expect(items).toHaveLength(1);
    expect(items[0]!.exercises[0]!.sets.map((s) => s.id)).toEqual([keep]);
  });

  it("notifies subscribers on every change", async () => {
    const { benchId, link, transport } = await server();
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    let calls = 0;
    store.subscribe(() => calls++);

    await store.start();
    await store.addExercise(benchId);

    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("rapid edits without waiting all land, in order", async () => {
    const { commands, benchId, link, transport } = await server();
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const bench = await store.addExercise(benchId);
    const set = await store.addSet(bench);

    await Promise.all([
      store.updateSet(set, { weight: 185 }),
      store.updateSet(set, { reps: 9 }),
      store.updateSet(set, { completed: true }),
      store.finish(),
    ]);
    link.online = true;
    await store.sync();

    const { items } = await commands.listWorkouts({});
    expect(items[0]!.exercises[0]!.sets).toMatchObject([{ weight: 185, reps: 9, completed: true }]);
  });
});

describe("logger extras", () => {
  it("supersets, notes, RIR and warm-up sets logged offline all arrive on sync", async () => {
    const { commands, benchId, link, transport } = await server();
    const rowId = (await commands.listExercises({ query: "Bent Over Barbell Row" })).items[0]!.id;
    const curlId = (await commands.listExercises({ query: "Barbell Curl" })).items[0]!.id;
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });

    await store.start();
    await store.setWorkoutNotes("Slept 5 h");
    const bench = await store.addExercise(benchId);
    const row = await store.addExercise(rowId);
    await store.addExercise(curlId);
    await store.supersetWithNext(bench);
    await store.setExerciseNotes(bench, "Seat 3");
    for (const [weight, reps] of [
      [45, 10],
      [135, 5],
    ] as const) {
      const warmup = await store.addSet(bench);
      await store.updateSet(warmup, { setType: "warmup", weight, reps, completed: true });
    }
    const working = await store.addSet(bench);
    await store.updateSet(working, { weight: 185, reps: 8 });
    await store.updateSet(working, { completed: true, rir: 2 });
    await store.finish();

    link.online = true;
    await store.sync();

    const [workout] = (await commands.listWorkouts({})).items;
    expect(workout!.notes).toBe("Slept 5 h");
    expect(workout!.exercises.map((e) => [e.id, e.supersetGroup, e.notes])).toEqual([
      [bench, 1, "Seat 3"],
      [row, 1, null],
      [expect.any(String), null, null],
    ]);
    expect(workout!.exercises[0]!.sets.map(({ setType, weight, unit, reps, rir }) => ({ setType, weight, unit, reps, rir }))).toEqual([
      { setType: "warmup", weight: 45, unit: "lb", reps: 10, rir: null },
      { setType: "warmup", weight: 135, unit: "lb", reps: 5, rir: null },
      { setType: "normal", weight: 185, unit: "lb", reps: 8, rir: 2 },
    ]);
  });

  it("supersets grow by linking the next exercise, and a lone member leaves with the last partner", async () => {
    const { commands, benchId, link, transport } = await server();
    const rowId = (await commands.listExercises({ query: "Bent Over Barbell Row" })).items[0]!.id;
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const [a, b, c, d] = [
      await store.addExercise(benchId),
      await store.addExercise(rowId),
      await store.addExercise(benchId),
      await store.addExercise(rowId),
    ];
    const groups = () => store.active()!.exercises.map((e) => e.supersetGroup);

    await store.supersetWithNext(a);
    await store.supersetWithNext(b);
    expect(groups()).toEqual([1, 1, 1, null]);
    await store.supersetWithNext(d); // nothing after the last exercise
    expect(groups()).toEqual([1, 1, 1, null]);

    await store.leaveSuperset(c);
    await store.leaveSuperset(b);
    expect(groups()).toEqual([null, null, null, null]);
  });
});

describe("reordering exercises", () => {
  it("moves exercises locally, skips an unchanged order, and syncs the new order", async () => {
    const { commands, benchId, link, transport } = await server();
    const rowId = (await commands.listExercises({ query: "Bent Over Barbell Row" })).items[0]!.id;
    const curlId = (await commands.listExercises({ query: "Barbell Curl" })).items[0]!.id;
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const bench = await store.addExercise(benchId);
    const row = await store.addExercise(rowId);
    const curl = await store.addExercise(curlId);
    const order = () => store.active()!.exercises.map((e) => e.id);

    await store.reorderExercises([curl, bench, row]);
    expect(order()).toEqual([curl, bench, row]);

    const queued = store.pendingCount();
    await store.reorderExercises([curl, bench, row]);
    expect(store.pendingCount()).toBe(queued);

    await store.finish();
    link.online = true;
    await store.sync();
    const [workout] = (await commands.listWorkouts({})).items;
    expect(workout!.exercises.map((e) => e.id)).toEqual([curl, bench, row]);
  });
});

describe("swapping an exercise", () => {
  it("swaps locally at once, keeps the rest of the exercise, and syncs the swap so a replay changes nothing", async () => {
    const { commands, benchId, link, transport } = await server();
    const curlId = (await commands.listExercises({ query: "Barbell Curl" })).items[0]!.id;
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const bench = await store.addExercise(benchId);
    await store.setRestSeconds(bench, 120);
    const set = await store.addSet(bench);
    await store.updateSet(set, { weight: 80, reps: 5, completed: true });

    await store.swapExercise(bench, curlId);

    expect(store.active()!.exercises).toMatchObject([
      { id: bench, exerciseId: curlId, restSeconds: 120, sets: [{ id: set, weight: 80, reps: 5, completed: true }] },
    ]);
    await store.finish();
    link.online = true;
    await store.sync();
    const [once] = (await commands.listWorkouts({})).items;
    await commands.applyWorkoutOps({ ops: link.batches.flat().filter((op) => op.type === "swapExercise") });
    const [again] = (await commands.listWorkouts({})).items;

    expect(again).toEqual(once);
    expect(again!.exercises).toMatchObject([
      { id: bench, name: "Barbell Curl", restSeconds: 120, sets: [{ id: set, weight: 80, reps: 5, completed: true }] },
    ]);
  });
});

describe("swapping onto an exercise with other loads", () => {
  it("re-seeds sets not yet done from the new exercise's previous sets, and clears the weight with no history", async () => {
    const { benchId, transport } = await server();
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const ex = await store.addExercise(benchId);
    const done = await store.addSet(ex);
    await store.updateSet(done, { weight: 130, reps: 15, completed: true });
    const todo = await store.addSet(ex);
    await store.updateSet(todo, { weight: 130, reps: 15 });
    const extra = await store.addSet(ex);
    await store.updateSet(extra, { weight: 130, reps: 15 });
    const lat = { setType: "normal", weight: 60, unit: "lb", reps: 12 } as const;

    await store.swapExercise(ex, benchId, null, [{ position: 0, ...lat }, { position: 1, ...lat, reps: 13 }]);
    expect(store.active()!.exercises[0]!.sets).toMatchObject([
      { weight: 130, reps: 15, completed: true },
      { weight: 60, reps: 13 },
      { weight: 60, reps: 13 },
    ]);

    await store.swapExercise(ex, benchId);
    expect(store.active()!.exercises[0]!.sets.map((s) => s.weight)).toEqual([130, null, null]);
  });
});

describe("machines", () => {
  it("creates a machine and picks it offline, then syncs both; Previous follows the machine next time", async () => {
    const { commands, benchId, link, transport } = await server();
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const bench = await store.addExercise(benchId);

    const gym = await store.createGym("Planet Fitness");
    expect(await store.createGym(" planet fitness ")).toBe(gym);
    await store.setGym(gym);
    const machine = await store.createMachine(benchId, gym, "Hammer Strength Press");
    expect(await store.createMachine(benchId, gym, " hammer strength press ")).toBe(machine);
    await store.setMachine(bench, machine);
    await store.setMachineNotes(machine, "Seat 5, back pad 3");
    const set = await store.addSet(bench);
    await store.updateSet(set, { weight: 140, reps: 8, completed: true });

    expect(store.active()!.gymId).toBe(gym);
    expect(store.active()!.machines).toEqual([
      { id: machine, exerciseId: benchId, gymId: gym, name: "Hammer Strength Press", notes: null },
    ]);
    expect(store.active()!.exercises[0]!.machineId).toBe(machine);

    await store.finish();
    link.online = true;
    await store.sync();

    expect((await commands.listMachines({})).machines).toEqual([
      { id: machine, exerciseId: benchId, gymId: gym, name: "Hammer Strength Press", notes: "Seat 5, back pad 3" },
    ]);
    expect((await commands.listGyms({}))).toEqual({ gyms: [{ id: gym, name: "Planet Fitness" }], lastGymId: gym });
    const { previous, previousByMachine, lastMachinesByGym } = await commands.getPreviousSets({});
    const lastMachines = lastMachinesByGym[gym]!;
    expect(previous).toEqual({});
    expect(previousByMachine[machine]).toMatchObject([{ weight: 140, reps: 8 }]);
    expect(lastMachines[benchId]).toBe(machine);

    // The next workout starts on the machine it was last done on.
    await store.start({ gymId: gym });
    expect(store.active()!.gymId).toBe(gym);
    const next = await store.addExercise(benchId, lastMachines[benchId]);
    expect(store.active()!.exercises.find((e) => e.id === next)!.machineId).toBe(machine);
    // Swapping the exercise clears the machine, locally as on the server.
    const curlId = (await commands.listExercises({ query: "Barbell Curl" })).items[0]!.id;
    await store.swapExercise(next, curlId);
    expect(store.active()!.exercises.find((e) => e.id === next)!.machineId).toBeNull();
    // Or swap onto the machine the new exercise was last done on.
    const curlMachine = await store.createMachine(curlId, gym, "Preacher Curl");
    await store.swapExercise(next, curlId, curlMachine);
    expect(store.active()!.exercises.find((e) => e.id === next)!.machineId).toBe(curlMachine);
  });

  it("starts a routine with each exercise on the machine it was last done on", async () => {
    const { benchId, transport } = await server();
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    const machine = crypto.randomUUID();
    const routineExercise = { exerciseId: benchId, name: "Bench", position: 0, restSeconds: null, supersetGroup: null, notes: null, sets: [] };

    await store.startFromRoutine({ name: "Push", exercises: [routineExercise] }, { lastMachines: { [benchId]: machine } });

    expect(store.active()!.exercises).toMatchObject([{ exerciseId: benchId, machineId: machine }]);
  });

  it("upgrades a workout stored before machines existed", async () => {
    const { transport } = await server();
    const dbName = freshDbName();
    const db = await openDB(dbName, 2, {
      upgrade(database) {
        database.createObjectStore("active");
        database.createObjectStore("outbox", { autoIncrement: true });
        database.createObjectStore("rest");
      },
    });
    await db.put(
      "active",
      {
        id: crypto.randomUUID(),
        name: null,
        startedAt: "2026-10-11T07:00:00.000Z",
        finishedAt: null,
        exercises: [{ id: crypto.randomUUID(), exerciseId: crypto.randomUUID(), position: 0, sets: [] }],
      },
      "current",
    );
    db.close();

    const store = await openWorkoutStore({ dbName, transport });

    expect(store.active()!.machines).toEqual([]);
    expect(store.active()!.exercises[0]!.machineId).toBeNull();
  });
});

describe("rest timer", () => {
  /** A clock the test moves by hand. */
  function clock(start = "2026-10-11T07:00:00.000Z") {
    let t = Date.parse(start);
    return { now: () => new Date(t), advance: (seconds: number) => (t += seconds * 1000) };
  }

  it("completing a set starts the exercise's rest timer, which survives the app being closed and reopened", async () => {
    const { benchId, link, transport } = await server();
    link.online = false;
    const time = clock();
    const dbName = freshDbName();
    const store = await openWorkoutStore({ dbName, transport, now: time.now });
    await store.start();
    const bench = await store.addExercise(benchId);
    await store.setRestSeconds(bench, 120);
    const set = await store.addSet(bench);

    await store.updateSet(set, { weight: 185, reps: 8, completed: true });
    expect(store.restTimer()).toEqual({
      workoutExerciseId: bench,
      startedAt: "2026-10-11T07:00:00.000Z",
      endsAt: "2026-10-11T07:02:00.000Z",
    });

    // The owner switches apps; the page is discarded and reopened 45 s later.
    store.close();
    time.advance(45);
    const resumed = await openWorkoutStore({ dbName, transport, now: time.now });

    expect(resumed.restTimer()?.endsAt).toBe("2026-10-11T07:02:00.000Z");
    expect(restRemaining(resumed.restTimer(), time.now())).toBe(75);
    expect(restElapsed(resumed.restTimer(), time.now())).toBe(45);
    time.advance(100);
    expect(restRemaining(resumed.restTimer(), time.now())).toBe(0);
    expect(restElapsed(resumed.restTimer(), time.now())).toBe(145);
  });

  it("adjusting the rest moves what remains but not how long it has been running", async () => {
    const { benchId, link, transport } = await server();
    link.online = false;
    const time = clock();
    const store = await openWorkoutStore({ dbName: freshDbName(), transport, now: time.now });
    await store.start();
    const bench = await store.addExercise(benchId);
    const set = await store.addSet(bench);
    await store.updateSet(set, { completed: true });
    time.advance(20);

    await store.adjustRest(15);
    expect(restRemaining(store.restTimer(), time.now())).toBe(DEFAULT_REST_SECONDS - 20 + 15);
    expect(restElapsed(store.restTimer(), time.now())).toBe(20);
    await store.adjustRest(-15);
    expect(restElapsed(store.restTimer(), time.now())).toBe(20);
  });

  it("a timer saved before its start was recorded still loads, with elapsed derived from its length", async () => {
    const { benchId, link, transport } = await server();
    link.online = false;
    const time = clock();
    const dbName = freshDbName();
    const store = await openWorkoutStore({ dbName, transport, now: time.now });
    await store.start();
    const bench = await store.addExercise(benchId);
    store.close();

    // Written by the build before rest timers carried a start: only the end is stored.
    const raw = await openDB(dbName);
    await raw.put("rest", { workoutExerciseId: bench, endsAt: "2026-10-11T07:01:30.000Z" }, "current");
    raw.close();

    time.advance(30);
    const resumed = await openWorkoutStore({ dbName, transport, now: time.now });
    expect(restRemaining(resumed.restTimer(), time.now())).toBe(60);
    expect(restElapsed(resumed.restTimer(), time.now())).toBe(30);
  });

  it("uses the default rest when the exercise has none, and can be adjusted or skipped", async () => {
    const { benchId, link, transport } = await server();
    link.online = false;
    const time = clock();
    const store = await openWorkoutStore({ dbName: freshDbName(), transport, now: time.now });
    await store.start();
    const bench = await store.addExercise(benchId);
    const set = await store.addSet(bench);
    await store.updateSet(set, { completed: true });

    expect(restRemaining(store.restTimer(), time.now())).toBe(DEFAULT_REST_SECONDS);
    await store.adjustRest(15);
    expect(restRemaining(store.restTimer(), time.now())).toBe(DEFAULT_REST_SECONDS + 15);
    await store.skipRest();
    expect(store.restTimer()).toBeNull();
  });

  it("no timer when rest is off; in a superset, rest starts after the round's last exercise", async () => {
    const { benchId, link, transport } = await server();
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const [bench, row, curl] = [
      await store.addExercise(benchId),
      await store.addExercise(benchId),
      await store.addExercise(benchId),
    ];
    await store.supersetWithNext(bench);
    await store.setRestSeconds(curl, 0);
    const [benchSet, rowSet, curlSet] = [await store.addSet(bench), await store.addSet(row), await store.addSet(curl)];

    await store.updateSet(benchSet, { completed: true });
    expect(store.restTimer()).toBeNull();
    await store.updateSet(rowSet, { completed: true });
    expect(store.restTimer()?.workoutExerciseId).toBe(row);
    await store.skipRest();
    await store.updateSet(curlSet, { completed: true });
    expect(store.restTimer()).toBeNull();
  });
});

describe("discarding from the store", () => {
  it("ends the active workout offline; the discard syncs later and the workout stays out of history", async () => {
    const { commands, benchId, link, transport } = await server();
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    const bench = await store.addExercise(benchId);
    await store.addSet(bench);

    await store.discard();

    expect(store.active()).toBeNull();
    expect(store.pendingCount()).toBeGreaterThan(0);

    link.online = true;
    await store.sync();

    expect(store.pendingCount()).toBe(0);
    expect((await commands.listWorkouts({})).items).toEqual([]);
    expect((await commands.listDiscardedWorkouts({})).items).toHaveLength(1);
  });

  it("reopening after a discard with a pending outbox starts clean, and the next workout syncs after the discard", async () => {
    const { commands, benchId, link, transport } = await server();
    link.online = false;
    const dbName = freshDbName();
    const first = await openWorkoutStore({ dbName, transport });
    await first.start();
    await first.addExercise(benchId);
    await first.discard();
    first.close();

    const reopened = await openWorkoutStore({ dbName, transport });
    expect(reopened.active()).toBeNull();
    await reopened.start();
    const bench = await reopened.addExercise(benchId);
    const set = await reopened.addSet(bench);
    await reopened.updateSet(set, { weight: 100, reps: 5, completed: true });
    await reopened.finish();

    link.online = true;
    await reopened.sync();

    expect(link.batches.flat().map((op) => op.type)).toEqual([
      "startWorkout",
      "addExercise",
      "discardWorkout",
      "startWorkout",
      "addExercise",
      "putSet",
      "putSet",
      "finishWorkout",
    ]);
    expect((await commands.listWorkouts({})).items).toHaveLength(1);
    expect((await commands.listDiscardedWorkouts({})).items).toHaveLength(1);
  });
});

describe("discard with nothing in progress", () => {
  it("is a no-op, so a double confirm queues nothing", async () => {
    const { benchId, link, transport } = await server();
    link.online = false;
    const store = await openWorkoutStore({ dbName: freshDbName(), transport });
    await store.start();
    await store.addExercise(benchId);
    await store.discard();
    const pending = store.pendingCount();

    await expect(store.discard()).resolves.toBeUndefined();

    expect(store.pendingCount()).toBe(pending);
  });
});
