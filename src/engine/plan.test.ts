import { describe, expect, it } from "vitest";
import type { Block, BlockExercise, HistoryWorkout } from "@/domain/block";
import { planBlocks } from "./plan";
import { deloadInWeek4, did, EX, rir0ThreeSessionsRunning, upperLower4Day } from "./scenarios";
import { readable, text } from "../../tests/readable";

describe("engine: dated planned sessions", () => {
  it("4-day upper/lower block: one session per split day for each week of the block", () => {
    const { plannedSessions } = planBlocks({ blocks: [upperLower4Day()], history: [], today: "2026-10-12" });

    expect(plannedSessions).toHaveLength(16);
    expect(plannedSessions.slice(0, 5).map((s) => [s.date, s.week, s.name])).toEqual([
      ["2026-10-12", 1, "Lower Body A"],
      ["2026-10-13", 1, "Chest Upper"],
      ["2026-10-15", 1, "Hamstring Lower"],
      ["2026-10-16", 1, "Back Upper"],
      ["2026-10-19", 2, "Lower Body A"],
    ]);
    expect(plannedSessions.at(-1)).toMatchObject({ date: "2026-11-06", week: 4, name: "Back Upper" });
  });

  it("a block ended early (replaced by the next block) plans nothing after its end date, missed sessions included", () => {
    // Ends Tuesday of week 2 (today): Monday's missed Lower Body A has no free day left before the end, so it stays missed.
    const block = { ...upperLower4Day(), endDate: "2026-10-20" };
    const { plannedSessions } = planBlocks({ blocks: [block], history: [], today: "2026-10-20" });

    expect(plannedSessions.map((s) => [s.date, s.name])).toEqual([
      ["2026-10-12", "Lower Body A"],
      ["2026-10-13", "Chest Upper"],
      ["2026-10-15", "Hamstring Lower"],
      ["2026-10-16", "Back Upper"],
      ["2026-10-19", "Lower Body A"],
      ["2026-10-20", "Chest Upper"],
    ]);
  });
});

/** The planned Machine Chest Press in the first Chest Upper session on or after `from`. */
function chestPress(history: Parameters<typeof planBlocks>[0]["history"], from = "2026-10-13") {
  const { plannedSessions } = planBlocks({ blocks: [upperLower4Day()], history, today: from });
  const session = plannedSessions.find((s) => s.name === "Chest Upper" && s.date >= from)!;
  return session.exercises.find((e) => e.exerciseId === EX.chestPressOnRails)!;
}

const targets = (exercise: ReturnType<typeof chestPress>) => exercise.sets.map((s) => [s.weight, s.reps]);

describe("engine: double progression", () => {
  it("no history: starts at the block's start weight, bottom of the rep range", () => {
    const exercise = chestPress([]);
    expect(targets(exercise)).toEqual([
      [180, 10],
      [180, 10],
      [180, 10],
    ]);
    expect(exercise.progression).toMatchObject({ decision: "start", fromWeight: null });
  });

  it("owner's real Machine Chest Press (180 lb × 12, 11, 9): holds 180 lb and aims one rep past each set", () => {
    const exercise = chestPress([did("2026-10-06", EX.chestPressOnRails, 180, [12, 11, 9])]);
    expect(targets(exercise)).toEqual([
      [180, 13],
      [180, 12],
      [180, 10],
    ]);
    expect(readable(exercise.progression)).toEqual({
      decision: "hold",
      fromWeight: 180,
      reason: "Not yet 15 reps on every set at 180 lb, so staying at 180 lb",
    });
  });

  it("top of the range on every set: adds the increment and drops back to the bottom of the range", () => {
    const exercise = chestPress([did("2026-10-06", EX.chestPressOnRails, 180, [15, 15, 16])]);
    expect(targets(exercise)).toEqual([
      [185, 10],
      [185, 10],
      [185, 10],
    ]);
    expect(readable(exercise.progression)).toEqual({
      decision: "increase",
      fromWeight: 180,
      reason: "Hit 15 reps on all 3 sets at 180 lb, so next time is 185 lb",
    });
  });

  it("top of the range on only some sets: holds", () => {
    expect(chestPress([did("2026-10-06", EX.chestPressOnRails, 180, [15, 15, 14])]).progression.decision).toBe("hold");
    expect(chestPress([did("2026-10-06", EX.chestPressOnRails, 180, [15, 15])]).progression.decision).toBe("hold");
  });

  it("owner's real Hevy session shape: warm-ups and drop sets are ignored, failure sets count", () => {
    const exercise = chestPress([
      did("2026-10-06", EX.chestPressOnRails, 180, [
        [10, { weight: 135, setType: "warmup" }],
        11,
        [9, { setType: "failure" }],
        [8, { weight: 130, setType: "drop" }],
      ]),
    ]);
    expect(targets(exercise)).toEqual([
      [180, 12],
      [180, 10],
      [180, 10],
    ]);
  });

  it("uses the most recent session only", () => {
    const exercise = chestPress([
      did("2026-10-06", EX.chestPressOnRails, 185, [10, 10, 9]),
      did("2026-09-29", EX.chestPressOnRails, 180, [15, 15, 15]),
    ]);
    expect(targets(exercise)[0]).toEqual([185, 11]);
  });

  it("reps-only when RIR is absent; with RIR, a grinder (RIR 0) at the top of the range holds", () => {
    const top = (rir?: number) =>
      chestPress([did("2026-10-06", EX.chestPressOnRails, 180, [15, 15, rir === undefined ? 15 : [15, { rir }]])]);

    expect(top().progression.decision).toBe("increase");
    expect(top(2).progression.decision).toBe("increase");
    expect(readable(top(0).progression)).toEqual({
      decision: "hold",
      fromWeight: 180,
      reason: "Hit 15 reps on every set at 180 lb but the last set was RIR 0, so staying at 180 lb",
    });
  });

  it("each session's targets come from workouts before its date, so later sessions reflect what was done", () => {
    const history = [did("2026-10-13", EX.chestPressOnRails, 180, [15, 15, 15])];
    const { plannedSessions } = planBlocks({ blocks: [upperLower4Day()], history, today: "2026-10-14" });
    const chest = plannedSessions
      .filter((s) => s.name === "Chest Upper")
      .map((s) => [s.date, s.exercises[0]!.sets[0]!.weight, s.exercises[0]!.progression.decision]);
    expect(chest).toEqual([
      ["2026-10-13", 180, "start"],
      ["2026-10-20", 185, "increase"],
      ["2026-10-27", 185, "increase"],
      ["2026-11-03", 185, "increase"],
    ]);
  });

  it("history logged in kg is read in the block's unit", () => {
    const history = did("2026-10-06", EX.chestPressOnRails, 0, [11, 11, 11]);
    for (const set of history.exercises[0]!.sets) Object.assign(set, { weight: 81.65, unit: "kg" });
    expect(targets(chestPress([history]))[0]).toEqual([180, 12]);
  });
});

/** The upper/lower block with Machine Chest Press patched (e.g. its rule), and block fields overridable. */
function withChestPress(patch: Partial<BlockExercise>, blockPatch: Partial<Block> = {}): Block {
  const block = upperLower4Day(blockPatch);
  for (const session of block.sessions)
    for (const exercise of session.exercises)
      if (exercise.exerciseId === EX.chestPressOnRails) Object.assign(exercise, patch);
  return block;
}

function chestPressIn(block: Block, history: HistoryWorkout[], from = "2026-10-13") {
  const { plannedSessions } = planBlocks({ blocks: [block], history, today: from });
  const session = plannedSessions.find((s) => s.name === "Chest Upper" && s.date >= from)!;
  return session.exercises.find((e) => e.exerciseId === EX.chestPressOnRails)!;
}

describe("engine: deload weeks", () => {
  it("scenario: deload week — sessions in the configured week are lighter: half the sets at ~90% load", () => {
    const { block, history } = deloadInWeek4();
    const { plannedSessions } = planBlocks({ blocks: [block], history, today: "2026-11-01" });

    expect(plannedSessions.map((s) => [s.week, !!s.deload])).toEqual(
      [1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4].map((week) => [week, week === 4]),
    );
    const chest = plannedSessions.find((s) => s.week === 4 && s.name === "Chest Upper")!.exercises[0]!;
    expect(targets(chest)).toEqual([
      [160, 10],
      [160, 10],
    ]);
    expect(readable(chest.progression)).toEqual({
      decision: "deload",
      fromWeight: 180,
      reason: "Deload week: 2 sets at 160 lb (about 90% of 180 lb) to recover",
    });
    const legPress = plannedSessions.find((s) => s.week === 4 && s.name === "Lower Body A")!.exercises[0]!;
    expect(targets(legPress)).toEqual([
      [240, 10],
      [240, 10],
    ]);
  });

  it("after a deload, progression picks up from the last training week, not the light deload sessions", () => {
    const { block, history } = deloadInWeek4();
    block.weeks = 5;
    const deloadDone = did("2026-11-03", EX.chestPressOnRails, 160, [10, 10]);
    const week5 = chestPressIn(block, [...history, deloadDone], "2026-11-10");
    expect(targets(week5)[0]).toEqual([180, 14]);
    expect(week5.progression.decision).toBe("hold");
  });

  it("deload placement is the owner's: any weeks, none by default", () => {
    const placed = (deloadWeeks?: number[]) =>
      planBlocks({ blocks: [upperLower4Day(deloadWeeks ? { deloadWeeks } : {})], history: [], today: "2026-10-12" })
        .plannedSessions.filter((s) => s.deload)
        .map((s) => s.week);
    expect(placed()).toEqual([]);
    expect(placed([2])).toEqual([2, 2, 2, 2]);
  });

  it("a set ramp spans the training weeks and skips the deload week", () => {
    const block = withChestPress({ rule: "ramp", sets: 3, rampTo: 5 }, { weeks: 5, deloadWeeks: [4] });
    const { plannedSessions } = planBlocks({ blocks: [block], history: [], today: "2026-10-12" });
    const sets = plannedSessions.filter((s) => s.name === "Chest Upper").map((s) => s.exercises[0]!.sets.length);
    expect(sets).toEqual([3, 4, 4, 2, 5]);
  });
});

describe("engine: set ramp", () => {
  const ramp = withChestPress({ rule: "ramp", sets: 3, rampTo: 5 });

  it("set count climbs from the block's sets to the ramp's target across the block", () => {
    const { plannedSessions } = planBlocks({ blocks: [ramp], history: [], today: "2026-10-12" });
    const chest = plannedSessions
      .filter((s) => s.name === "Chest Upper")
      .map((s) => [s.week, s.exercises.find((e) => e.exerciseId === EX.chestPressOnRails)!.sets.length]);
    expect(chest).toEqual([
      [1, 3],
      [2, 4],
      [3, 4],
      [4, 5],
    ]);
    const legPress = plannedSessions.filter((s) => s.name === "Lower Body A").map((s) => s.exercises[0]!.sets.length);
    expect(legPress).toEqual([3, 3, 3, 3]);
  });

  it("load still moves by double progression; new sets start at the bottom of the range", () => {
    const week2 = chestPressIn(ramp, [did("2026-10-13", EX.chestPressOnRails, 180, [13, 12, 11])], "2026-10-20");
    expect(targets(week2)).toEqual([
      [180, 14],
      [180, 13],
      [180, 12],
      [180, 10],
    ]);
    expect(text(week2.progression.reason)).toBe(
      "Not yet 15 reps on every set at 180 lb, so staying at 180 lb (set ramp: 4 sets this week, up to 5)",
    );
    const topped = chestPressIn(ramp, [did("2026-10-13", EX.chestPressOnRails, 180, [15, 15, 15])], "2026-10-20");
    expect(targets(topped)).toEqual(Array.from({ length: 4 }, () => [185, 10]));
  });
});

describe("engine: RIR-informed progression", () => {
  const rir = withChestPress({ rule: "rir" });
  const last = (rirOnLastSet: number | undefined, reps: number[] = [12, 11, 10], date = "2026-10-06") =>
    did(date, EX.chestPressOnRails, 180, [
      ...reps.slice(0, -1),
      [reps.at(-1)!, rirOnLastSet === undefined ? {} : { rir: rirOnLastSet }],
    ]);

  it("reps in reserve (RIR 2+) on the last set: adds load even below the top of the range", () => {
    const exercise = chestPressIn(rir, [last(2)]);
    expect(targets(exercise)).toEqual([
      [185, 10],
      [185, 10],
      [185, 10],
    ]);
    expect(readable(exercise.progression)).toEqual({
      decision: "increase",
      fromWeight: 180,
      reason: "Last set at 180 lb had 2 reps in reserve, so next time is 185 lb",
    });
    expect(text(chestPressIn(rir, [last(3)]).progression.reason)).toBe(
      "Last set at 180 lb had 3+ reps in reserve, so next time is 185 lb",
    );
  });

  it("a grinder (RIR 0) holds the load and aims to beat the reps", () => {
    const exercise = chestPressIn(rir, [last(0)]);
    expect(targets(exercise)).toEqual([
      [180, 13],
      [180, 12],
      [180, 11],
    ]);
    expect(readable(exercise.progression)).toEqual({
      decision: "hold",
      fromWeight: 180,
      reason: "Last set at 180 lb was a grinder (RIR 0), so staying at 180 lb",
    });
    expect(chestPressIn(rir, [last(0, [15, 15, 15])]).progression.decision).toBe("hold");
  });

  it("scenario: RIR 0 three sessions running at the usual load brings the load down", () => {
    const { block, history } = rir0ThreeSessionsRunning();
    const exercise = chestPressIn(block, history);
    expect(targets(exercise)).toEqual([
      [175, 12],
      [175, 11],
      [175, 10],
    ]);
    expect(readable(exercise.progression)).toEqual({
      decision: "reduce",
      fromWeight: 180,
      reason: "RIR 0 on the last set 3 sessions running at 180 lb, so easing back to 175 lb",
    });
  });

  it("RIR 0 only twice running, or at a new load, holds rather than reducing", () => {
    const { block, history } = rir0ThreeSessionsRunning();
    expect(chestPressIn(block, history.slice(1)).progression.decision).toBe("hold");
    const newLoad = [...history.slice(0, 2), did("2026-10-06", EX.chestPressOnRails, 185, [10, 10, [10, { rir: 0 }]])];
    expect(chestPressIn(block, newLoad).progression.decision).toBe("hold");
    const easierBetween = [history[0]!, last(1, [12, 11, 10], "2026-09-29"), history[2]!];
    expect(chestPressIn(block, easierBetween).progression.decision).toBe("hold");
  });

  it("RIR 1 progresses like double progression", () => {
    expect(chestPressIn(rir, [last(1)]).progression.decision).toBe("hold");
    expect(chestPressIn(rir, [last(1, [15, 15, 15])]).progression.decision).toBe("increase");
  });

  it("RIR tap skipped: falls back to reps only (double progression)", () => {
    const below = chestPressIn(rir, [last(undefined)]);
    expect(targets(below)[0]).toEqual([180, 13]);
    expect(readable(below.progression)).toEqual({
      decision: "hold",
      fromWeight: 180,
      reason: "No RIR logged, so going by reps: not yet 15 reps on every set at 180 lb, so staying at 180 lb",
    });
    expect(readable(chestPressIn(rir, [last(undefined, [15, 15, 15])]).progression)).toEqual({
      decision: "increase",
      fromWeight: 180,
      reason: "No RIR logged, so going by reps: hit 15 reps on all 3 sets at 180 lb, so next time is 185 lb",
    });
  });
});
