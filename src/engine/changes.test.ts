import { describe, expect, it } from "vitest";
import { exerciseDiffs as ex } from "@/domain/plan-change";
import type { HistoryWorkout, IsoDate } from "@/domain/block";
import type { Race } from "@/domain/running";
import { planBlocks } from "./plan";
import { did, EX, rir0ThreeSessionsRunning, upperLower4Day } from "./scenarios";
import { readable } from "../../tests/readable";

/** The plan as persisted before `history` came in (what the command layer passes as `currentPlan`). */
const planWith = (history: HistoryWorkout[], today: IsoDate) =>
  planBlocks({ blocks: [upperLower4Day()], history, today }).plannedSessions;

/** Progression changes only (these fixtures log just Chest Press, so other sessions this week count as missed and move). */
const progression = <T extends { key: string }>(changes: T[]) => changes.filter((c) => c.key.startsWith("progression:"));

describe("engine: changes", () => {
  it("no current plan (a new block): no changes", () => {
    expect(planBlocks({ blocks: [upperLower4Day()], history: [], today: "2026-10-12" }).changes).toEqual([]);
  });

  it("a double-progression bump is one change across the upcoming sessions, with its reason", () => {
    const currentPlan = planWith([], "2026-10-13");
    const history = [did("2026-10-13", EX.chestPressOnRails, 180, [15, 15, 15])];

    const changes = progression(planBlocks({ blocks: [upperLower4Day()], history, today: "2026-10-14", currentPlan }).changes);

    expect(changes).toHaveLength(1);
    const [change] = changes;
    expect(readable(change)).toMatchObject({
      summary: "Machine Chest Press goes up to 185 lb",
      reasons: ["Hit 15 reps on all 3 sets at 180 lb, so next time is 185 lb"],
      requiresConfirmation: false,
    });
    expect(ex(change!).map((d) => [d.date, d.before.sets[0]!.weight, d.after.sets[0]!.weight])).toEqual([
      ["2026-10-20", 180, 185],
      ["2026-10-27", 180, 185],
      ["2026-11-03", 180, 185],
    ]);
    expect(ex(change!)[0]).toMatchObject({ type: "exercise", blockId: "block-ul", blockSessionId: "s-chest", blockExerciseId: "s-chest-0" });
  });

  it("rep targets moving while holding the load are not changes (they update silently)", () => {
    const currentPlan = planWith([], "2026-10-13");
    const history = [did("2026-10-13", EX.chestPressOnRails, 180, [12, 11, 9])];
    const out = readable(planBlocks({ blocks: [upperLower4Day()], history, today: "2026-10-14", currentPlan }));
    expect(progression(out.changes)).toEqual([]);
    const next = out.plannedSessions.find((s) => s.date === "2026-10-20")!;
    expect(next.exercises[0]!.sets.map((s) => s.reps)).toEqual([13, 12, 10]);
  });

  it("past sessions never produce changes", () => {
    const currentPlan = planWith([], "2026-10-13");
    const history = [did("2026-10-13", EX.chestPressOnRails, 180, [15, 15, 15])];
    const { changes } = readable(planBlocks({ blocks: [upperLower4Day()], history, today: "2026-10-28", currentPlan }));
    expect(ex(changes[0]!).map((d) => d.date)).toEqual(["2026-11-03"]);
  });

  it("a change already in the plan is not emitted again", () => {
    const history = [did("2026-10-13", EX.chestPressOnRails, 180, [15, 15, 15])];
    const currentPlan = planWith(history, "2026-10-14");
    expect(progression(planBlocks({ blocks: [upperLower4Day()], history, today: "2026-10-14", currentPlan }).changes)).toEqual(
      [],
    );
  });

  it("the same bump keeps its key as days pass; a new qualifying workout makes a new key", () => {
    const currentPlan = planWith([], "2026-10-13");
    const first = [did("2026-10-13", EX.chestPressOnRails, 180, [15, 15, 15])];
    const keyOn = (history: HistoryWorkout[], today: IsoDate) =>
      progression(planBlocks({ blocks: [upperLower4Day()], history, today, currentPlan }).changes).map((c) => c.key);

    expect(keyOn(first, "2026-10-22")).toEqual(keyOn(first, "2026-10-14"));
    const again = [...first, did("2026-10-20", EX.chestPressOnRails, 180, [15, 15, 15])];
    expect(keyOn(again, "2026-10-22")).not.toEqual(keyOn(first, "2026-10-22"));
  });

  it("an RIR-rule reduction after repeated grinders is a change too", () => {
    const { block, history } = rir0ThreeSessionsRunning();
    const currentPlan = planBlocks({ blocks: [block], history: history.slice(0, 2), today: "2026-10-01" }).plannedSessions;

    const { changes } = readable(planBlocks({ blocks: [block], history, today: "2026-10-07", currentPlan }));

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      summary: "Machine Chest Press eases back to 175 lb",
      reasons: ["RIR 0 on the last set 3 sessions running at 180 lb, so easing back to 175 lb"],
    });
  });

  it("a progression change waits for confirmation when its next session is in race week, not for the sessions after it", () => {
    const currentPlan = planWith([], "2026-10-13");
    const history = [did("2026-10-13", EX.chestPressOnRails, 180, [15, 15, 15])];
    const bump = (races: Race[]) =>
      progression(planBlocks({ blocks: [upperLower4Day()], history, today: "2026-10-14", currentPlan, races }).changes)[0]!;

    // The next Chest Upper (Tuesday 2026-10-20) is within the week; the later ones only carry the same target on.
    expect(bump([]).requiresConfirmation).toBe(false);
    // A race on Sunday 2026-10-25 makes 2026-10-20 a race-week session.
    const race: Race = { id: "race-10k", name: "Fall 10K", date: "2026-10-25", distanceMeters: 10_000, priority: "C" };
    expect(bump([race]).requiresConfirmation).toBe(true);
  });
});
