import { describe, expect, it } from "vitest";
import { livePrs, type BestsByExercise } from "./records";
import type { Workout, WorkoutSet } from "./workout";

const BENCH = "bench";

const baseline: BestsByExercise = new Map([
  [
    BENCH,
    {
      heaviestWeight: { setId: "old", workoutId: "w0", achievedAt: "2026-09-01T07:00:00.000Z", weight: 185, unit: "lb", reps: 8, value: 185 },
    },
  ],
]);

function set(id: string, position: number, patch: Partial<WorkoutSet>): WorkoutSet {
  return { id, position, setType: "normal", weight: 100, unit: "lb", reps: 5, rir: null, completed: true, ...patch };
}

function workoutWith(sets: WorkoutSet[]): Workout {
  return {
    id: "w1",
    name: null,
    startedAt: "2026-09-04T07:00:00.000Z",
    finishedAt: null,
    notes: null,
    exercises: [{ id: "we1", exerciseId: BENCH, machineId: null, position: 0, supersetGroup: null, restSeconds: null, notes: null, sets }],
  };
}

describe("live PR flags in the logger", () => {
  it("flags a ticked set that beats the previous best", () => {
    const prs = livePrs(baseline, workoutWith([set("a", 0, { weight: 190, reps: 3 })]));
    expect(prs.get("a")).toEqual(["heaviestWeight"]);
  });

  it("does not flag unticked sets, warm-ups or ties", () => {
    const prs = livePrs(
      baseline,
      workoutWith([
        set("a", 0, { weight: 200, completed: false }),
        set("b", 1, { weight: 200, setType: "warmup" }),
        set("c", 2, { weight: 185 }),
      ]),
    );
    expect(prs.size).toBe(0);
  });

  it("measures later sets against earlier sets of the same workout", () => {
    const prs = livePrs(
      baseline,
      workoutWith([set("a", 0, { weight: 190 }), set("b", 1, { weight: 190 }), set("c", 2, { weight: 195 })]),
    );
    expect([...prs.keys()]).toEqual(["a", "c"]);
  });

  it("flags nothing for an exercise with no history", () => {
    expect(livePrs(new Map(), workoutWith([set("a", 0, { weight: 300 })])).size).toBe(0);
  });
});
