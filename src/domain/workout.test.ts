import { describe, expect, it } from "vitest";
import { applyWorkoutOp, isEmptySet, planExerciseReorder, workoutOpSchema, type ActiveWorkout, type WorkoutExercise, type WorkoutSet } from "./workout";

function set(overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: "s",
    position: 0,
    setType: "normal",
    weight: null,
    unit: "lb",
    reps: null,
    rir: null,
    completed: false,
    ...overrides,
  };
}

describe("isEmptySet", () => {
  it("is true for a set with nothing logged, whatever its type", () => {
    expect(isEmptySet(set())).toBe(true);
    expect(isEmptySet(set({ setType: "warmup" }))).toBe(true);
  });

  it("is false once a weight, reps or completion is logged", () => {
    expect(isEmptySet(set({ weight: 0 }))).toBe(false);
    expect(isEmptySet(set({ reps: 8 }))).toBe(false);
    expect(isEmptySet(set({ completed: true }))).toBe(false);
    expect(isEmptySet(set({ rir: 0 }))).toBe(false);
  });
});

function exercise(id: string, supersetGroup: number | null = null): WorkoutExercise {
  return { id, exerciseId: `ex-${id}`, machineId: null, position: 0, supersetGroup, restSeconds: null, notes: null, sets: [] };
}

describe("planExerciseReorder", () => {
  const current = [
    { id: "bench", supersetGroup: null },
    { id: "row", supersetGroup: null },
    { id: "curl", supersetGroup: null },
  ];

  it("orders the listed exercises as given", () => {
    expect(planExerciseReorder(current, ["curl", "bench", "row"])).toEqual({
      order: ["curl", "bench", "row"],
      ungroup: [],
    });
  });

  it("drops unknown ids and keeps unlisted exercises after the listed ones", () => {
    expect(planExerciseReorder(current, ["curl", "ghost", "curl", "bench"]).order).toEqual(["curl", "bench", "row"]);
  });

  it("ungroups an exercise moved out of place, and a lone member left in its superset", () => {
    const grouped = [
      { id: "bench", supersetGroup: 1 },
      { id: "row", supersetGroup: 1 },
      { id: "curl", supersetGroup: null },
    ];

    expect(planExerciseReorder(grouped, ["row", "curl", "bench"])).toEqual({
      order: ["row", "curl", "bench"],
      ungroup: ["bench", "row"],
    });
  });

  it("leaves a superset that keeps two members grouped", () => {
    const grouped = [
      { id: "bench", supersetGroup: 1 },
      { id: "row", supersetGroup: 1 },
      { id: "curl", supersetGroup: 1 },
    ];

    expect(planExerciseReorder(grouped, ["row", "curl", "bench"]).ungroup).toEqual(["bench"]);
  });

  it("finds no move when the order already matches, so replays are no-ops", () => {
    const grouped = [
      { id: "row", supersetGroup: 1 },
      { id: "curl", supersetGroup: 1 },
      { id: "bench", supersetGroup: null },
    ];

    expect(planExerciseReorder(grouped, ["row", "curl", "bench"])).toEqual({
      order: ["row", "curl", "bench"],
      ungroup: [],
    });
  });
});

describe("applyWorkoutOp: swapExercise", () => {
  const set = { id: "s1", position: 0, setType: "normal" as const, weight: 80, unit: "kg" as const, reps: 5, rir: null, completed: true };
  const workout: ActiveWorkout = {
    id: "w",
    name: null,
    startedAt: "2026-10-11T07:00:00.000Z",
    finishedAt: null,
    notes: null,
    gymId: null,
    gyms: [],
    machines: [],
    machineNotes: {},
    exercises: [
      { ...exercise("bench", 1), position: 0, restSeconds: 120, notes: "pause at the chest", sets: [set] },
      { ...exercise("row", 1), position: 1 },
    ],
  };

  it("replaces the exercise but keeps its position, superset group, rest, notes and logged sets", () => {
    const next = applyWorkoutOp(workout, { type: "swapExercise", id: "bench", exerciseId: "ex-dip" });

    expect(next!.exercises[0]).toEqual({ ...workout.exercises[0], exerciseId: "ex-dip" });
    expect(next!.exercises[1]).toEqual(workout.exercises[1]);
  });

  it("applying the same swap again changes nothing further", () => {
    const swap = { type: "swapExercise" as const, id: "bench", exerciseId: "ex-dip" };
    const once = applyWorkoutOp(workout, swap);

    expect(applyWorkoutOp(once, swap)).toEqual(once);
  });

  it("ignores a swap of an exercise that is not in the workout", () => {
    expect(applyWorkoutOp(workout, { type: "swapExercise", id: "curl", exerciseId: "ex-dip" })).toEqual(workout);
  });
});

describe("applyWorkoutOp: reorderExercises", () => {
  const workout: ActiveWorkout = {
    id: "w",
    name: null,
    startedAt: "2026-10-11T07:00:00.000Z",
    finishedAt: null,
    notes: null,
    gymId: null,
    gyms: [],
    machines: [],
    machineNotes: {},
    exercises: [
      { ...exercise("bench", 1), position: 0 },
      { ...exercise("row", 1), position: 1 },
      { ...exercise("curl"), position: 2 },
    ],
  };

  it("reassigns positions and applies the superset rule to the local copy", () => {
    const next = applyWorkoutOp(workout, { type: "reorderExercises", workoutId: "w", ids: ["row", "curl", "bench"] });

    expect(next!.exercises.map(({ id, position, supersetGroup }) => ({ id, position, supersetGroup }))).toEqual([
      { id: "row", position: 0, supersetGroup: null },
      { id: "curl", position: 1, supersetGroup: null },
      { id: "bench", position: 2, supersetGroup: null },
    ]);
  });

  it("ignores a reorder for another workout", () => {
    expect(applyWorkoutOp(workout, { type: "reorderExercises", workoutId: "other", ids: ["curl", "bench"] })).toBe(workout);
  });
});

describe("applyWorkoutOp: machines", () => {
  const rowId = "00000000-0000-4000-8000-0000000000a1";
  const machineA = "00000000-0000-4000-8000-0000000000b1";
  const machineB = "00000000-0000-4000-8000-0000000000b2";
  const workout: ActiveWorkout = {
    id: "w",
    name: null,
    startedAt: "2026-10-11T07:00:00.000Z",
    finishedAt: null,
    notes: null,
    gymId: null,
    gyms: [],
    machines: [],
    machineNotes: {},
    exercises: [exercise("bench"), exercise("row")],
  };

  it("creates a machine under an exercise once; a replay or the same name again changes nothing", () => {
    const create = { type: "createMachine", id: machineA, exerciseId: rowId, gymId: null, name: "Leverage Iso Low Row, Gym A" } as const;
    const once = applyWorkoutOp(workout, create)!;
    expect(once.machines).toEqual([{ id: machineA, exerciseId: rowId, gymId: null, name: "Leverage Iso Low Row, Gym A", notes: null }]);
    expect(applyWorkoutOp(once, create)).toEqual(once);
    expect(applyWorkoutOp(once, { ...create, id: machineB, name: " leverage iso low row, gym a " })).toEqual(once);
    // The same name under another exercise is a different machine.
    expect(applyWorkoutOp(once, { ...create, id: machineB, exerciseId: "00000000-0000-4000-8000-0000000000a2" })!.machines).toHaveLength(2);
  });

  it("picks and clears the machine an exercise is done on", () => {
    const picked = applyWorkoutOp(workout, { type: "setMachine", id: "row", machineId: machineA })!;
    expect(picked.exercises.map((e) => e.machineId)).toEqual([null, machineA]);
    expect(applyWorkoutOp(picked, { type: "setMachine", id: "row", machineId: null })!.exercises[1]!.machineId).toBeNull();
  });

  it("swapping an exercise clears its machine", () => {
    const picked = applyWorkoutOp(workout, { type: "setMachine", id: "row", machineId: machineA })!;
    const swapped = applyWorkoutOp(picked, { type: "swapExercise", id: "row", exerciseId: "ex-dip" })!;
    expect(swapped.exercises[1]).toMatchObject({ exerciseId: "ex-dip", machineId: null });
  });

  it("sets and clears a machine's notes", () => {
    const noted = applyWorkoutOp(workout, { type: "setMachineNotes", id: machineA, notes: "Seat 3, pad 2" })!;
    expect(noted.machineNotes).toEqual({ [machineA]: "Seat 3, pad 2" });
    // Blank text is cleared when the op is parsed (the server does this on sync).
    const blank = workoutOpSchema.parse({ type: "setMachineNotes", id: machineA, notes: "  " });
    expect(applyWorkoutOp(noted, blank)!.machineNotes).toEqual({ [machineA]: null });
  });
});

describe("applyWorkoutOp: gyms", () => {
  const rowId = "00000000-0000-4000-8000-0000000000a1";
  const gymA = "00000000-0000-4000-8000-0000000000c1";
  const gymB = "00000000-0000-4000-8000-0000000000c2";
  const workout: ActiveWorkout = {
    id: "00000000-0000-4000-8000-0000000000d1",
    name: null,
    startedAt: "2026-10-11T07:00:00.000Z",
    finishedAt: null,
    notes: null,
    gymId: null,
    gyms: [],
    machines: [],
    machineNotes: {},
    exercises: [],
  };

  it("creates a gym once; a replay or the same name again changes nothing", () => {
    const create = { type: "createGym", id: gymA, name: "Planet Fitness" } as const;
    const once = applyWorkoutOp(workout, create)!;
    expect(once.gyms).toEqual([{ id: gymA, name: "Planet Fitness" }]);
    expect(applyWorkoutOp(once, create)).toEqual(once);
    expect(applyWorkoutOp(once, { ...create, id: gymB, name: " planet fitness " })).toEqual(once);
  });

  it("sets the gym of the workout, and only that workout", () => {
    expect(applyWorkoutOp(workout, { type: "setGym", id: workout.id, gymId: gymA })!.gymId).toBe(gymA);
    expect(applyWorkoutOp(workout, { type: "setGym", id: gymB, gymId: gymA })).toBe(workout);
  });

  it("allows the same machine name at different gyms, but not twice at one", () => {
    const at = (gymId: string | null, id: string) =>
      ({ type: "createMachine", id, exerciseId: rowId, gymId, name: "Cable Row" }) as const;
    let next = applyWorkoutOp(workout, at(gymA, "00000000-0000-4000-8000-0000000000e1"))!;
    next = applyWorkoutOp(next, at(gymB, "00000000-0000-4000-8000-0000000000e2"))!;
    next = applyWorkoutOp(next, at(gymA, "00000000-0000-4000-8000-0000000000e3"))!;
    expect(next.machines.map((m) => m.gymId)).toEqual([gymA, gymB]);
  });
});
