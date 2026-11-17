import { describe, expect, it } from "vitest";
import { exerciseDiffs as ex } from "@/domain/plan-change";
import { planBlocks } from "./plan";
import {
  deloadAlignsWithTaper,
  hamstringsBeforeLongRun,
  marathon18Weeks,
  peakMileageBlock,
  springMarathon,
} from "./run-scenarios";
import { did, EX, upperLower4Day } from "./scenarios";
import { readable } from "../../tests/readable";

describe("engine: running/lifting interaction rules", () => {
  it("scenario: deload aligns with taper — the deload shifts into race week, and the week after is a recovery deload", () => {
    const { block, races, runPlans } = deloadAlignsWithTaper();
    // The plan as persisted before the race (and its run plan) came in.
    const currentPlan = planBlocks({ blocks: [block], history: [], today: "2027-03-15" }).plannedSessions;

    const { plannedSessions, changes } = readable(planBlocks({
      blocks: [block],
      history: [],
      today: "2027-03-15",
      races,
      runPlans,
      currentPlan,
    }));

    const deloadWeeks = [...new Set(plannedSessions.filter((s) => s.deload).map((s) => s.week))];
    expect(deloadWeeks).toEqual([5, 6]);
    expect(plannedSessions.find((s) => s.date === "2027-04-19")).toMatchObject({ week: 5, deload: true });
    expect(plannedSessions.find((s) => s.date === "2027-04-12")!.deload).toBeUndefined();

    const deloadChanges = changes.filter((c) => c.key.startsWith("deload-align:"));
    expect(deloadChanges).toHaveLength(1);
    expect(deloadChanges[0]).toMatchObject({
      key: "deload-align:block-ul:race-spring-marathon:2027-04-25",
      summary: "Deload moves from week 4 to weeks 5–6 to line up with Spring Marathon",
      reasons: [
        "Week 5 is Spring Marathon's race week, the end of the taper: lifting backs off so you start the race fresh",
        "Week 6 is the week after Spring Marathon: a recovery week",
        "Week 4 was set as a deload; it moves so recovery lines up with the race",
      ],
      // It touches race week (and is more than a week ahead): the owner confirms it.
      requiresConfirmation: true,
    });
    // Week 4 sessions go back to training; weeks 5–6 become deload sessions.
    const byDate = (date: string) => ex(deloadChanges[0]!).filter((d) => d.date === date);
    expect(byDate("2027-04-12").map((d) => [d.before.progression.decision, d.after.progression.decision])).toEqual([
      ["deload", "start"],
      ["deload", "start"],
    ]);
    expect(byDate("2027-04-19").map((d) => [d.before.sets.length, d.after.sets.length])).toEqual([
      [3, 2],
      [3, 2],
    ]);
    expect(ex(deloadChanges[0]!).map((d) => d.date)).toContain("2027-04-30");
  });

  it("only A races move deloads, and an owner deload well before the race stays", () => {
    const { block, runPlans } = deloadAlignsWithTaper();
    const deloadWeeks = (races: ReturnType<typeof springMarathon>[], weeks = [4]) => {
      const out = readable(planBlocks({
        blocks: [{ ...block, deloadWeeks: weeks }],
        history: [],
        today: "2027-03-15",
        races,
        runPlans,
      }));
      return [...new Set(out.plannedSessions.filter((s) => s.deload).map((s) => s.week))];
    };
    expect(deloadWeeks([springMarathon({ priority: "B" })])).toEqual([4]);
    expect(deloadWeeks([])).toEqual([4]);
    expect(deloadWeeks([springMarathon()], [1, 4])).toEqual([1, 5, 6]);
  });

  it("scenario: peak-mileage week cuts lower volume — lower-body exercises lose a third of their sets, upper body untouched", () => {
    const { block, races, runPlans } = peakMileageBlock();
    // The plan as persisted before the run plan came in.
    const currentPlan = planBlocks({ blocks: [block], history: [], today: "2027-02-22", races }).plannedSessions;

    const { plannedSessions, changes } = readable(planBlocks({
      blocks: [block],
      history: [],
      today: "2027-02-22",
      races,
      runPlans,
      currentPlan,
    }));

    const setCounts = (date: string) =>
      plannedSessions.find((s) => s.date === date)!.exercises.map((e) => [e.name, e.sets.length]);
    // Week 2 (plan week 12) is not a peak week.
    expect(setCounts("2027-03-08")).toEqual([
      ["Leg Press", 3],
      ["Leg Extension", 3],
    ]);
    // Weeks 3–4 (plan weeks 13–14) are.
    expect(setCounts("2027-03-15")).toEqual([
      ["Leg Press", 2],
      ["Leg Extension", 2],
    ]);
    expect(setCounts("2027-03-25")).toEqual([
      ["Seated Leg Curl", 2],
      ["Romanian Deadlift", 2],
    ]);
    expect(setCounts("2027-03-16")).toEqual([
      ["Machine Chest Press", 3],
      ["Lateral Raise (Machine)", 3],
    ]);

    const peak = changes.filter((c) => c.key.startsWith("peak-lower:"));
    expect(peak.map((c) => [c.key, c.summary, c.reasons, c.requiresConfirmation])).toEqual([
      [
        "peak-lower:block-ul:2027-03-15",
        "Less leg volume in week 3: peak mileage",
        [
          "Week 3 is a peak-mileage week in Synthetic marathon 18 (31.7 mi), so lower-body exercises drop a third of their sets to save your legs for running",
        ],
        // More than a week ahead: the owner confirms it.
        true,
      ],
      [
        "peak-lower:block-ul:2027-03-22",
        "Less leg volume in week 4: peak mileage",
        [
          "Week 4 is a peak-mileage week in Synthetic marathon 18 (32.5 mi), so lower-body exercises drop a third of their sets to save your legs for running",
        ],
        true,
      ],
    ]);
    expect(ex(peak[0]!).map((d) => [d.date, d.after.name, d.before.sets.length, d.after.sets.length])).toEqual([
      ["2027-03-15", "Leg Press", 3, 2],
      ["2027-03-15", "Leg Extension", 3, 2],
      ["2027-03-18", "Seated Leg Curl", 3, 2],
      ["2027-03-18", "Romanian Deadlift", 3, 2],
    ]);
    expect(ex(peak[0]!)[0]!.after.adjustments).toEqual(["Peak-mileage week: 2 of 3 sets"]);
  });

  it("scenario: no heavy legs before long run — the Saturday lower session is lightened, with its reason", () => {
    const { block, races, runPlans } = hamstringsBeforeLongRun();
    const currentPlan = planBlocks({ blocks: [block], history: [], today: "2027-01-11", races }).plannedSessions;

    const { plannedSessions, changes } = readable(planBlocks({
      blocks: [block],
      history: [],
      today: "2027-01-11",
      races,
      runPlans,
      currentPlan,
    }));

    const loads = (date: string) =>
      plannedSessions.find((s) => s.date === date)!.exercises.map((e) => [e.name, e.sets.map((x) => x.weight)]);
    // Saturday 2027-01-23, the day before a 9.7 mi long run: ~85% load, rounded down to 5 lb.
    expect(loads("2027-01-23")).toEqual([
      ["Seated Leg Curl", [110, 110, 110]],
      ["Romanian Deadlift", [110, 110, 110]],
    ]);
    // Monday's Lower Body A is nowhere near a long run.
    expect(loads("2027-01-18")).toEqual([
      ["Leg Press", [270, 270, 270]],
      ["Leg Extension", [150, 150, 150]],
    ]);

    const eve = changes.filter((c) => c.key.startsWith("long-run-eve:"));
    expect(eve).toHaveLength(4);
    expect(eve[0]).toMatchObject({
      key: "long-run-eve:s-ham:2027-01-23",
      summary: "Hamstring Lower lightened before the long run",
      reasons: [
        "The 9.7 mi long run is the next day, so lower-body loads come down to about 85% to keep your legs fresh for it",
      ],
      // 12 days ahead: the owner confirms it.
      requiresConfirmation: true,
    });
    expect(ex(eve[0]!).map((d) => [d.date, d.after.name, d.before.sets[0]!.weight, d.after.sets[0]!.weight])).toEqual([
      ["2027-01-23", "Seated Leg Curl", 130, 110],
      ["2027-01-23", "Romanian Deadlift", 135, 110],
    ]);
    // The planned exercise says why, beside its progression reason.
    expect(plannedSessions.find((s) => s.date === "2027-01-23")!.exercises[0]!.adjustments).toEqual([
      "Long run tomorrow: about 85% load",
    ]);
    expect(plannedSessions.find((s) => s.date === "2027-01-18")!.exercises[0]!.adjustments).toBeUndefined();
  });

  it("an adjustment is not mistaken for a progression change (the plan was progressed already)", () => {
    const { block, races, runPlans } = hamstringsBeforeLongRun();
    const history = [did("2027-01-16", EX.seatedLegCurl, 130, [15, 15, 15])];
    const today = "2027-01-17";
    // The plan as persisted before the run plan came in: Seated Leg Curl already up to 135 lb.
    const currentPlan = planBlocks({ blocks: [block], history, today }).plannedSessions;

    const { changes } = readable(planBlocks({ blocks: [block], history, today, races, runPlans, currentPlan }));

    expect(changes.filter((c) => c.key.startsWith("progression:"))).toEqual([]);
    expect(ex(changes.find((c) => c.key === "long-run-eve:s-ham:2027-01-23")!)[0]).toMatchObject({
      before: { name: "Seated Leg Curl", sets: [{ weight: 135 }, { weight: 135 }, { weight: 135 }] },
      after: { sets: [{ weight: 110 }, { weight: 110 }, { weight: 110 }] },
    });
  });

  it("lightening a session within the week applies automatically", () => {
    const { block, races, runPlans } = hamstringsBeforeLongRun();
    const today = "2027-01-17";
    const currentPlan = planBlocks({ blocks: [block], history: [], today, races }).plannedSessions;

    const { changes } = readable(planBlocks({ blocks: [block], history: [], today, races, runPlans, currentPlan }));

    expect(changes.filter((c) => c.key.startsWith("long-run-eve:")).map((c) => [c.key, c.requiresConfirmation])).toEqual([
      ["long-run-eve:s-ham:2027-01-23", false],
      ["long-run-eve:s-ham:2027-01-30", true],
      ["long-run-eve:s-ham:2027-02-06", true],
      ["long-run-eve:s-ham:2027-02-13", true],
    ]);
  });

  it("scenario: the session the day before a race is lightened only once the owner confirms (race week)", () => {
    // A B race (no deload alignment): Saturday's Hamstring Lower is the race's eve, five days from today.
    const races = [springMarathon({ priority: "B" })];
    const runPlans = [marathon18Weeks()];
    const block = upperLower4Day({ startDate: "2027-04-12", weeks: 2 });
    block.sessions = block.sessions.map((s) => (s.id === "s-ham" ? { ...s, weekday: 6 } : s));
    const today = "2027-04-19";
    const currentPlan = planBlocks({ blocks: [block], history: [], today, races }).plannedSessions;

    const { changes } = readable(planBlocks({ blocks: [block], history: [], today, races, runPlans, currentPlan }));

    expect(changes.find((c) => c.key === "long-run-eve:s-ham:2027-04-24")).toMatchObject({
      summary: "Hamstring Lower lightened before the race",
      requiresConfirmation: true,
    });
  });

  it("a new block is planned with every adjustment already in it: initial, nothing to confirm or announce", () => {
    const { block, races, runPlans } = deloadAlignsWithTaper();

    const { plannedSessions, changes } = readable(planBlocks({
      blocks: [block],
      history: [],
      today: "2027-03-15",
      races,
      runPlans,
      currentPlan: [],
    }));

    expect([...new Set(plannedSessions.filter((s) => s.deload).map((s) => s.week))]).toEqual([5, 6]);
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) expect(change).toMatchObject({ initial: true, requiresConfirmation: false });
  });

  it("scenario: importing a run plan into a running block — lifting fits around it as part of the plan, nothing to confirm", () => {
    const { block, races, runPlans } = hamstringsBeforeLongRun();
    const today = "2027-01-11";
    const currentPlan = planBlocks({ blocks: [block], history: [], today, races }).plannedSessions;

    const { plannedSessions, changes } = readable(planBlocks({
      blocks: [block],
      history: [],
      today,
      races,
      runPlans,
      newRunPlans: [runPlans[0]!.id],
      currentPlan,
    }));

    expect(plannedSessions.find((s) => s.date === "2027-01-23")!.exercises[0]!.sets[0]!.weight).toBe(110);
    const eve = changes.filter((c) => c.key.startsWith("long-run-eve:"));
    expect(eve).toHaveLength(4);
    for (const change of eve) expect(change).toMatchObject({ initial: true, requiresConfirmation: false });
  });

  it("re-planning the same inputs against the plan it produced emits no new changes", () => {
    const { block, races, runPlans } = peakMileageBlock();
    const today = "2027-02-22";
    const first = planBlocks({ blocks: [block], history: [], today, races, runPlans });

    const { changes } = readable(planBlocks({ blocks: [block], history: [], today, races, runPlans, currentPlan: first.plannedSessions }));

    expect(changes).toEqual([]);
  });
});
