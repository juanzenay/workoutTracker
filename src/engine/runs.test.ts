import { describe, expect, it } from "vitest";
import { planBlocks } from "./plan";
import { marathon18Weeks, springMarathon } from "./run-scenarios";

const plan = (input: Partial<Parameters<typeof planBlocks>[0]> = {}) =>
  planBlocks({ blocks: [], history: [], today: "2026-10-12", races: [springMarathon()], runPlans: [marathon18Weeks()], ...input });

describe("engine: run plan anchored to the A race", () => {
  it("18-week plan to a Sunday marathon: week 18 is the race week, week 1 starts 17 weeks of Mondays earlier", () => {
    const { plannedRuns } = plan();

    expect(plannedRuns).toHaveLength(18 * 7);
    expect(plannedRuns.slice(0, 3).map((r) => [r.date, r.week, r.type])).toEqual([
      ["2026-12-21", 1, "cross"],
      ["2026-12-22", 1, "easy"],
      ["2026-12-23", 1, "easy"],
    ]);
    expect(plannedRuns.at(-1)).toMatchObject({ date: "2027-04-25", week: 18, type: "race", distanceMeters: 42_195 });
    expect(plannedRuns.find((r) => r.date === "2027-04-24")).toMatchObject({ week: 18, type: "rest" });
  });

  it("carries type, distance or duration and pace target onto the dated run", () => {
    const { plannedRuns } = plan();

    expect(plannedRuns.find((r) => r.date === "2026-12-26")).toMatchObject({
      week: 1,
      type: "race_pace",
      distanceMeters: 8045,
      durationSeconds: null,
      paceTarget: { perKmSeconds: [326, 336] },
    });
    expect(plannedRuns.find((r) => r.date === "2026-12-21")).toMatchObject({ type: "cross", distanceMeters: null, durationSeconds: 2700 });
  });

  it("moving the race moves the whole plan with it", () => {
    const { plannedRuns } = plan({ races: [springMarathon({ date: "2027-05-09" })] });

    expect(plannedRuns[0]!.date).toBe("2027-01-04");
    expect(plannedRuns.at(-1)).toMatchObject({ date: "2027-05-09", type: "race" });
  });

  it("a race on a different weekday than the plan's race row: the race run lands on the race date", () => {
    const { plannedRuns } = plan({ races: [springMarathon({ date: "2027-04-24" })] }); // Saturday

    const raceWeek = plannedRuns.filter((r) => r.week === 18);
    expect(raceWeek.find((r) => r.type === "race")!.date).toBe("2027-04-24");
    expect(plannedRuns[0]!.date).toBe("2026-12-21");
  });

  it("a plan whose race is gone plans no runs", () => {
    expect(plan({ races: [] }).plannedRuns).toEqual([]);
    expect(plan({ runPlans: [marathon18Weeks({ raceId: null })] }).plannedRuns).toEqual([]);
  });

  it("without races or run plans the engine plans no runs (lifting-only input still works)", () => {
    expect(planBlocks({ blocks: [], history: [], today: "2026-10-12" }).plannedRuns).toEqual([]);
  });
});
