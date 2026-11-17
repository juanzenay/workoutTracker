import { describe, expect, it } from "vitest";
import { getStrings } from "@/strings";
import { workoutFields, workoutPlainText } from "./workout-text";
import type { Workout, WorkoutExercise, WorkoutSet } from "./workout";

const s = getStrings();
const UTC = "UTC";
const names = new Map([
  ["bench", "Bench Press"],
  ["dips", "Dips"],
  ["curl", "Curl"],
]);

function set(id: string, position: number, patch: Partial<WorkoutSet>): WorkoutSet {
  return { id, position, setType: "normal", weight: 185, unit: "lb", reps: 5, rir: null, completed: true, ...patch };
}

function exercise(id: string, exerciseId: string, position: number, sets: WorkoutSet[]): WorkoutExercise {
  return { id, exerciseId, machineId: null, position, supersetGroup: null, restSeconds: null, notes: null, sets };
}

function finished(patch: Partial<Workout> = {}): Workout & { finishedAt: string } {
  return {
    id: "w1",
    name: "Push day",
    startedAt: "2026-10-16T17:00:00.000Z",
    finishedAt: "2026-10-16T17:55:00.000Z",
    notes: null,
    exercises: [],
    ...patch,
  } as Workout & { finishedAt: string };
}

describe("workoutPlainText", () => {
  it("lists the title, date, duration, then each exercise with its sets in the order performed", () => {
    const workout = finished({
      exercises: [
        exercise("we2", "dips", 1, [set("d1", 0, { weight: null, reps: 8 })]),
        // Stored out of order: the output must follow `position`.
        exercise("we1", "bench", 0, [set("b2", 1, { weight: 205, reps: 3 }), set("b1", 0, { weight: 185, reps: 5 })]),
      ],
    });

    expect(workoutPlainText(workout, names, s, UTC)).toBe(
      [
        "Push day",
        "October 16, 2026 · 55 min",
        "",
        "Bench Press",
        "185 lb × 5",
        "205 lb × 3",
        "",
        "Dips",
        "BW × 8",
      ].join("\n"),
    );
  });

  it("keeps the exercise name when it has no completed sets", () => {
    const workout = finished({
      exercises: [exercise("we1", "curl", 0, [set("c1", 0, { weight: 20, reps: 10, completed: false })])],
    });

    expect(workoutPlainText(workout, names, s, UTC)).toBe(["Push day", "October 16, 2026 · 55 min", "", "Curl"].join("\n"));
  });

  it("keeps the exercise name when it has no sets at all", () => {
    const workout = finished({ exercises: [exercise("we1", "curl", 0, [])] });

    expect(workoutPlainText(workout, names, s, UTC)).toBe(["Push day", "October 16, 2026 · 55 min", "", "Curl"].join("\n"));
  });

  it("falls back to the untitled label when the workout has no title", () => {
    expect(workoutPlainText(finished({ name: null }), names, s, UTC).split("\n")[0]).toBe(s.workout.untitled);
    expect(workoutPlainText(finished({ name: "   " }), names, s, UTC).split("\n")[0]).toBe(s.workout.untitled);
  });

  it("shows weights with up to one decimal place, in their own unit", () => {
    const workout = finished({
      exercises: [exercise("we1", "curl", 0, [set("c1", 0, { weight: 22.56, unit: "kg", reps: 12 })])],
    });

    expect(workoutPlainText(workout, names, s, UTC)).toContain("22.6 kg × 12");
  });

  it("contains no markdown or HTML markup", () => {
    const workout = finished({
      exercises: [exercise("we1", "bench", 0, [set("b1", 0, {})])],
    });

    expect(workoutPlainText(workout, names, s, UTC)).not.toMatch(/[*_#`<>[\]]|^- /m);
  });
});

describe("workoutFields", () => {
  it("gives the title, the start date as M/D/YYYY and the elapsed time as h:mm:ss", () => {
    expect(workoutFields(finished(), s, UTC)).toEqual({ title: "Push day", date: "10/16/2026", duration: "0:55:00" });
  });

  it("uses the viewer's time zone for the date", () => {
    // 01:30 UTC on the 17th is still the 16th in Los Angeles.
    const workout = finished({ startedAt: "2026-10-17T01:30:00.000Z", finishedAt: "2026-10-17T02:00:00.000Z" });

    expect(workoutFields(workout, s, "America/Los_Angeles").date).toBe("10/16/2026");
  });

  it("carries hours into the duration", () => {
    const workout = finished({ finishedAt: "2026-10-16T18:05:20.000Z" });

    expect(workoutFields(workout, s, UTC).duration).toBe("1:05:00");
  });

  it("falls back to the untitled label when the workout has no title", () => {
    expect(workoutFields(finished({ name: "  " }), s, UTC).title).toBe(s.workout.untitled);
  });
});
