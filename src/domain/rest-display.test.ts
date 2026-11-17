import { describe, expect, it } from "vitest";
import { restDisplay, restTargetSeconds, type RestTimer, type WorkoutExercise } from "./workout";

// A 2:00 rest that started at 07:00:00 (ends 07:02:00), for an exercise whose rest length is 2:00.
const timer: RestTimer = {
  workoutExerciseId: "bench",
  startedAt: "2026-10-11T07:00:00.000Z",
  endsAt: "2026-10-11T07:02:00.000Z",
};
const target = 120;

describe("restDisplay, count down", () => {
  it("shows the time left while the rest runs", () => {
    expect(restDisplay(timer, new Date("2026-10-11T07:00:40.000Z"), "down", target)).toEqual({ seconds: 80, done: false });
  });

  it("stops at zero and is done, with no overtime", () => {
    expect(restDisplay(timer, new Date("2026-10-11T07:03:00.000Z"), "down", target)).toEqual({ seconds: 0, done: true });
  });

  it("is empty when there is no timer", () => {
    expect(restDisplay(null, new Date("2026-10-11T07:00:40.000Z"), "down", target)).toEqual({ seconds: 0, done: false });
  });
});

describe("restDisplay, count up", () => {
  it("shows the elapsed time, which keeps increasing", () => {
    expect(restDisplay(timer, new Date("2026-10-11T07:00:40.000Z"), "up", target)).toEqual({ seconds: 40, done: false });
  });

  it("is done once elapsed reaches the target length", () => {
    expect(restDisplay(timer, new Date("2026-10-11T07:02:00.000Z"), "up", target)).toEqual({ seconds: 120, done: true });
  });

  it("keeps counting past the target, still done", () => {
    expect(restDisplay(timer, new Date("2026-10-11T07:02:30.000Z"), "up", target)).toEqual({ seconds: 150, done: true });
  });

  it("ignores the end time, so moving it does not change the count", () => {
    const extended = { ...timer, endsAt: "2026-10-11T07:02:15.000Z" };
    expect(restDisplay(extended, new Date("2026-10-11T07:00:40.000Z"), "up", target)).toEqual({ seconds: 40, done: false });
  });

  it("is empty when there is no timer", () => {
    expect(restDisplay(null, new Date("2026-10-11T07:00:40.000Z"), "up", target)).toEqual({ seconds: 0, done: false });
  });
});

describe("restTargetSeconds", () => {
  const exercise = (id: string, restSeconds: number | null) =>
    ({ id, restSeconds }) as WorkoutExercise;

  it("is the timer's exercise rest length", () => {
    expect(restTargetSeconds([exercise("squat", 180), exercise("bench", 120)], timer)).toBe(120);
  });

  it("falls back to the default when the exercise has no rest of its own", () => {
    expect(restTargetSeconds([exercise("bench", null)], timer)).toBe(90);
  });

  it("is the default when there is no timer", () => {
    expect(restTargetSeconds([exercise("bench", 120)], null)).toBe(90);
  });
});
