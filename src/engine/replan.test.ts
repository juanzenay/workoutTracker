import { describe, expect, it } from "vitest";
import type { PlannedRun } from "@/domain/running";
import type { RunDiff } from "@/domain/plan-change";
import { planBlocks, type EngineInput } from "./plan";
import { missedLongRunInWeek14, raceMovedTwoWeeksEarlier, ranEverythingBut, springMarathon } from "./run-scenarios";
import { did, EX, upperLower4Day } from "./scenarios";
import { readable } from "../../tests/readable";

const longRunOn = (runs: PlannedRun[], week: number) => runs.find((r) => r.week === week && r.type === "long")!;

describe("engine: re-plan triggers", () => {
  it("scenario: missed long run in week 14 — dropped rather than stacked onto Monday's Lower Body A", () => {
    const input = missedLongRunInWeek14();

    const { plannedRuns, changes } = readable(planBlocks(input));

    // Monday has Lower Body A, Tuesday follows it, Wednesday precedes Thursday's Hamstring Lower: no clear day.
    expect(longRunOn(plannedRuns, 14).date).toBe("2027-03-28");
    expect(plannedRuns.filter((r) => r.date === "2027-03-29").map((r) => r.type)).toEqual(["cross"]);
    expect(changes.filter((c) => c.key.startsWith("long-run"))).toEqual([
      {
        key: "long-run-drop:plan-marathon-18:97:2027-03-28",
        summary: "Missed long run dropped",
        reasons: [
          "The 16.5 mi long run on Sunday, Mar 28 was missed",
          "No day in the next 3 is clear of heavy leg sessions and hard runs, so it is dropped rather than stacked",
        ],
        requiresConfirmation: false,
        diff: [],
      },
    ]);
  });

  it("a missed long run moves to the first day clear of heavy leg sessions, and the easy day makes way", () => {
    const input = missedLongRunInWeek14();
    // Legs on Wednesday and Friday: Monday sits between an empty Sunday and Tuesday's Back Upper.
    const weekdays: Record<string, 1 | 2 | 3 | 5> = { "s-chest": 1, "s-back": 2, "s-quad": 3, "s-ham": 5 };
    const block = { ...input.blocks[0]!, sessions: input.blocks[0]!.sessions.map((s) => ({ ...s, weekday: weekdays[s.id]! })) };

    const { plannedRuns, plannedSessions, changes } = readable(planBlocks({ ...input, blocks: [block] }));

    expect(longRunOn(plannedRuns, 14).date).toBe("2027-03-29");
    expect(plannedRuns.filter((r) => r.date === "2027-03-29").map((r) => r.type)).toEqual(["long"]);
    expect(plannedSessions.find((s) => s.date === "2027-03-29")!.name).toBe("Chest Upper");

    const move = changes.find((c) => c.key.startsWith("long-run"))!;
    expect(move).toMatchObject({
      key: "long-run-move:plan-marathon-18:97:2027-03-28:2027-03-29",
      summary: "Missed long run moves to Monday",
      reasons: [
        "The 16.5 mi long run on Sunday, Mar 28 was missed",
        "It moves to Monday, Mar 29, the first day clear of heavy leg sessions and hard runs; the cross-training that day makes way",
      ],
      requiresConfirmation: false,
    });
    expect((move.diff as RunDiff[]).map((d) => [d.rowIndex, d.before?.date ?? null, d.after?.date ?? null])).toEqual([
      [97, "2027-03-28", "2027-03-29"],
      [98, "2027-03-29", null],
    ]);
  });

  it("a long run that came in short by more than half counts as missed; a bit short is left alone", () => {
    const input = missedLongRunInWeek14();
    const weekdays: Record<string, 1 | 2 | 3 | 5> = { "s-chest": 1, "s-back": 2, "s-quad": 3, "s-ham": 5 };
    const block = { ...input.blocks[0]!, sessions: input.blocks[0]!.sessions.map((s) => ({ ...s, weekday: weekdays[s.id]! })) };
    const ran = (miles: number) => [...input.runActivities!, { date: "2027-03-28", meters: miles * 1609, seconds: 3600 }];

    expect(longRunOn(planBlocks({ ...input, blocks: [block], runActivities: ran(6) }).plannedRuns, 14).date).toBe(
      "2027-03-29",
    );
    expect(longRunOn(planBlocks({ ...input, blocks: [block], runActivities: ran(14) }).plannedRuns, 14).date).toBe(
      "2027-03-28",
    );
  });

  it("a long run moved into the taper waits for the owner's confirmation", () => {
    const input = missedLongRunInWeek14();
    const weekdays: Record<string, 1 | 2 | 3 | 5> = { "s-chest": 1, "s-back": 2, "s-quad": 3, "s-ham": 5 };
    const block = { ...input.blocks[0]!, sessions: input.blocks[0]!.sessions.map((s) => ({ ...s, weekday: weekdays[s.id]! })) };
    // Week 15's long run (Sunday 2027-04-04) is missed; Monday 2027-04-05 starts week 16, the taper.
    const runActivities = ranEverythingBut(input.runPlans!, input.races!, "2027-04-05", ["2027-04-04"]);

    const { changes } = readable(planBlocks({ ...input, blocks: [block], runActivities, today: "2027-04-05" }));

    expect(changes.find((c) => c.key.startsWith("long-run"))).toMatchObject({
      key: "long-run-move:plan-marathon-18:104:2027-04-04:2027-04-05",
      requiresConfirmation: true,
    });
  });

  it("a just-imported plan's long run already over is not re-planned as missed, and the import itself is initial", () => {
    const input = missedLongRunInWeek14();

    const { plannedRuns, changes } = readable(planBlocks({ ...input, currentRuns: [], newRunPlans: [input.runPlans![0]!.id] }));

    expect(longRunOn(plannedRuns, 14).date).toBe("2027-03-28");
    expect(changes.filter((c) => c.key.startsWith("long-run"))).toEqual([]);
  });

  it("without run outcomes (no Strava) no run counts as missed", () => {
    const { plannedRuns, changes } = readable(planBlocks({ ...missedLongRunInWeek14(), runActivities: undefined }));
    expect(longRunOn(plannedRuns, 14).date).toBe("2027-03-28");
    expect(changes.filter((c) => c.key.startsWith("long-run"))).toEqual([]);
  });

  it("with imported runs, a long run is only missed once the imports reach a later day", () => {
    const input = missedLongRunInWeek14();
    const longRunChanges = (runOutcomesBefore: string) =>
      planBlocks({ ...input, runOutcomesBefore }).changes.filter((c) => c.key.startsWith("long-run"));

    // Imports reach Sunday at most: Sunday's run may still be on its way.
    expect(longRunChanges("2027-03-28")).toEqual([]);
    // An import with Monday's activities: Sunday is known, and missed.
    expect(longRunChanges("2027-03-29").map((c) => c.key)).toEqual(["long-run-drop:plan-marathon-18:97:2027-03-28"]);
  });

  it("scenario: race moved two weeks earlier — runs re-anchor and the race-week deload waits for confirmation", () => {
    const input = raceMovedTwoWeeksEarlier();

    const { plannedRuns, plannedSessions, changes } = readable(planBlocks(input));

    expect(plannedRuns.find((r) => r.type === "race")!.date).toBe("2027-04-11");
    expect(longRunOn(plannedRuns, 17).date).toBe("2027-04-04");
    // The engine's plan: race week (block week 3) and the week after (week 4, already the owner's deload).
    expect([...new Set(plannedSessions.filter((s) => s.deload).map((s) => s.week))]).toEqual([3, 4]);

    const deload = changes.find((c) => c.key.startsWith("deload-align:"))!;
    expect(deload).toMatchObject({
      key: "deload-align:block-ul:race-spring-marathon:2027-04-11",
      summary: "Week 3 becomes a deload to line up with Spring Marathon",
      reasons: [
        "Week 3 is Spring Marathon's race week, the end of the taper: lifting backs off so you start the race fresh",
        "Week 4 is the week after Spring Marathon: a recovery week",
      ],
      requiresConfirmation: true,
    });
  });

  it("scenario: sick until Thursday — Monday's and Tuesday's sessions move to the first free days after", () => {
    const block = upperLower4Day(); // Mon Lower Body A, Tue Chest Upper, Thu Hamstring Lower, Fri Back Upper from 2026-10-12
    const input: EngineInput = {
      blocks: [block],
      history: [],
      today: "2026-10-12",
      unavailable: [{ startDate: "2026-10-12", endDate: "2026-10-14" }],
    };
    const before = planBlocks({ ...input, unavailable: [] }).plannedSessions;

    const { plannedSessions, changes } = readable(planBlocks({ ...input, currentPlan: before }));

    expect(plannedSessions.filter((s) => s.week === 1).map((s) => [s.date, s.name])).toEqual([
      ["2026-10-15", "Hamstring Lower"],
      ["2026-10-16", "Back Upper"],
      ["2026-10-17", "Lower Body A"],
      ["2026-10-18", "Chest Upper"],
    ]);
    expect(plannedSessions.find((s) => s.date === "2026-10-17")!.exercises.map((e) => e.name)).toEqual([
      "Leg Press",
      "Leg Extension",
    ]);
    const moves = changes.filter((c) => c.key.startsWith("move-session:"));
    expect(moves.map((c) => [c.key, c.summary, c.reasons, c.requiresConfirmation])).toEqual([
      [
        "move-session:s-quad:2026-10-12:2026-10-17",
        "Lower Body A moves to Saturday",
        ["You're unavailable Monday, Oct 12 to Wednesday, Oct 14, so Lower Body A moves to Saturday, Oct 17, the first free day after"],
        false,
      ],
      [
        "move-session:s-chest:2026-10-13:2026-10-18",
        "Chest Upper moves to Sunday",
        ["You're unavailable Monday, Oct 12 to Wednesday, Oct 14, so Chest Upper moves to Sunday, Oct 18, the first free day after"],
        false,
      ],
    ]);
    expect(moves[0]!.diff).toMatchObject([
      { type: "session", blockSessionId: "s-quad", before: { date: "2026-10-12" }, after: { date: "2026-10-17" } },
    ]);
  });

  it("a session that can't fit in its week is dropped, and unavailability more than a week ahead waits for confirmation", () => {
    const { plannedSessions, changes } = readable(planBlocks({
      blocks: [upperLower4Day()],
      history: [],
      today: "2026-10-12",
      // Week 3, Wednesday to Sunday: Thursday's and Friday's sessions have nowhere to go.
      unavailable: [{ startDate: "2026-10-28", endDate: "2026-11-01" }],
      currentPlan: planBlocks({ blocks: [upperLower4Day()], history: [], today: "2026-10-12" }).plannedSessions,
    }));

    expect(plannedSessions.filter((s) => s.week === 3).map((s) => s.name)).toEqual(["Lower Body A", "Chest Upper"]);
    expect(changes.map((c) => [c.key, c.summary, c.requiresConfirmation])).toEqual([
      ["drop-session:s-ham:2026-10-29", "Hamstring Lower dropped this week", true],
      ["drop-session:s-back:2026-10-30", "Back Upper dropped this week", true],
    ]);
    expect(changes[0]!.reasons).toEqual([
      "You're unavailable Wednesday, Oct 28 to Sunday, Nov 1, and there is no free day left in week 3 for Hamstring Lower",
    ]);
  });

  it("a missed session moves to the next free day that week; a done one stays", () => {
    const block = upperLower4Day();
    const today = "2026-10-13"; // Tuesday: Monday's Lower Body A was not logged
    const currentPlan = planBlocks({ blocks: [block], history: [], today: "2026-10-12" }).plannedSessions;

    const missed = readable(planBlocks({ blocks: [block], history: [], today, currentPlan }));
    expect(missed.plannedSessions.filter((s) => s.week === 1).map((s) => [s.date, s.name])).toEqual([
      ["2026-10-13", "Chest Upper"],
      ["2026-10-14", "Lower Body A"],
      ["2026-10-15", "Hamstring Lower"],
      ["2026-10-16", "Back Upper"],
    ]);
    expect(missed.changes).toMatchObject([
      {
        key: "move-session:s-quad:2026-10-12:2026-10-14",
        summary: "Lower Body A moves to Wednesday",
        reasons: ["Lower Body A on Monday, Oct 12 was missed, so it moves to Wednesday, Oct 14, the next free day this week"],
        requiresConfirmation: false,
      },
    ]);

    const done = readable(planBlocks({ blocks: [block], history: [did("2026-10-12", EX.legPress, 270, [10, 10, 10])], today, currentPlan }));
    expect(done.plannedSessions.find((s) => s.date === "2026-10-12")!.name).toBe("Lower Body A");
    expect(done.changes.filter((c) => c.key.startsWith("move-session:"))).toEqual([]);

    // Once the day it moved to is over too (and not done), it is just missed: back on its own day, no new change.
    const later = readable(planBlocks({ blocks: [block], history: [], today: "2026-10-19", currentPlan }));
    expect(later.plannedSessions.find((s) => s.date === "2026-10-12")!.name).toBe("Lower Body A");
    expect(later.changes.filter((c) => c.key.startsWith("move-session:"))).toEqual([]);
  });

  it("unavailable days clear their runs; a long run on one moves like a missed one", () => {
    const race = springMarathon();
    const { runPlans, races } = { runPlans: missedLongRunInWeek14().runPlans!, races: [race] };
    const anchored = planBlocks({ blocks: [], history: [], today: "2027-03-01", races, runPlans }).plannedRuns;

    // Week 12, Friday to Sunday (Fri rest, Sat race pace, Sun long run); no lifting.
    const { plannedRuns, changes } = readable(planBlocks({
      blocks: [],
      history: [],
      today: "2027-03-01",
      races,
      runPlans,
      currentRuns: anchored,
      unavailable: [{ startDate: "2027-03-12", endDate: "2027-03-14" }],
    }));

    expect(plannedRuns.filter((r) => r.week === 12).map((r) => [r.date, r.type])).toEqual([
      ["2027-03-08", "cross"],
      ["2027-03-09", "easy"],
      ["2027-03-10", "easy"],
      ["2027-03-11", "easy"],
      ["2027-03-12", "rest"],
      ["2027-03-15", "long"],
    ]);
    expect(plannedRuns.filter((r) => r.date === "2027-03-15").map((r) => [r.week, r.type])).toEqual([[12, "long"]]); // week 13's cross made way
    expect(changes.map((c) => [c.key, c.summary, c.requiresConfirmation])).toEqual([
      ["unavailable-runs:plan-marathon-18:2027-03-12:2027-03-14", "1 run cleared while you're unavailable", true],
      ["long-run-move:plan-marathon-18:83:2027-03-14:2027-03-15", "Long run moves to Monday", true],
    ]);
  });
});
