import { describe, expect, it } from "vitest";
import { restElapsed, type RestTimer } from "./workout";

const timer: RestTimer = {
  workoutExerciseId: "bench",
  startedAt: "2026-10-11T07:00:00.000Z",
  endsAt: "2026-10-11T07:02:00.000Z",
};

describe("restElapsed", () => {
  it("counts whole seconds since the rest started", () => {
    expect(restElapsed(timer, new Date("2026-10-11T07:00:40.900Z"))).toBe(40);
  });

  it("is 0 when there is no timer", () => {
    expect(restElapsed(null, new Date("2026-10-11T07:00:40.000Z"))).toBe(0);
  });

  it("ignores moves of the end time, which only change what remains", () => {
    const extended = { ...timer, endsAt: "2026-10-11T07:02:15.000Z" };
    expect(restElapsed(extended, new Date("2026-10-11T07:00:40.000Z"))).toBe(40);
  });
});
