import { describe, expect, it } from "vitest";
import type { Injury } from "@/domain/injury";
import { planBlocks, type EngineInput } from "./plan";
import { upperLower4Day } from "./scenarios";
import { readable } from "../../tests/readable";

const kneeLigament = (overrides: Partial<Injury> = {}): Injury => ({
  id: "inj-1",
  joint: "knee",
  side: "left",
  tissue: "ligament",
  grade: 2,
  startDate: "2026-10-13",
  clearedDate: null,
  ...overrides,
});

/** Wednesday 2026-10-14 of the Monday-start upper/lower block (Monday's workout done): Hamstring Lower Thu, Back Upper Fri, Lower Body A next Mon. */
function plan(injuries: Injury[], currentPlan?: EngineInput["currentPlan"]) {
  return planBlocks({ blocks: [upperLower4Day()], history: [{ date: "2026-10-12", exercises: [] }], today: "2026-10-14", injuries, currentPlan });
}

const sets = (output: ReturnType<typeof plan>, date: string, exercise: string) =>
  output.plannedSessions.find((s) => s.date === date)!.exercises.find((e) => e.name === exercise)!.sets;

describe("engine: injuries", () => {
  it("cuts exercises that load the injured joint by grade, and leaves the rest alone", () => {
    const before = plan([]);
    const after = plan([kneeLigament()]);

    // Seated Leg Curl is hamstrings (loads the knee): 130 lb x 3 sets becomes 65 lb x 2 sets.
    expect(sets(before, "2026-10-15", "Seated Leg Curl")).toHaveLength(3);
    expect(sets(after, "2026-10-15", "Seated Leg Curl").map((s) => s.weight)).toEqual([65, 65]);
    // Chest and back sessions don't touch the knee.
    expect(sets(after, "2026-10-16", "Face Pull")).toEqual(sets(before, "2026-10-16", "Face Pull"));
  });

  it("grade 1 trims load only; grade 3 keeps one light set with a note to skip it", () => {
    const grade1 = plan([kneeLigament({ grade: 1 })]);
    expect(sets(grade1, "2026-10-15", "Seated Leg Curl").map((s) => s.weight)).toEqual([100, 100, 100]);

    const grade3 = plan([kneeLigament({ grade: 3 })]);
    expect(sets(grade3, "2026-10-15", "Seated Leg Curl")).toHaveLength(1);
    const note = readable(grade3).plannedSessions.find((s) => s.date === "2026-10-15")!.exercises[0]!.adjustments;
    expect(note).toEqual(["knee injury, grade 3: skip this or swap it"]);
  });

  it("reports one change per injury, with the reason", () => {
    const { changes } = readable(plan([kneeLigament()], plan([]).plannedSessions));

    const change = changes.find((c) => c.key === "injury:inj-1:2")!;
    expect(change.summary).toBe("knee cut back (grade 2)");
    expect(change.reasons).toEqual([
      "Your left knee ligament injury is open (grade 2), so exercises that load it are cut back",
    ]);
    expect(change.diff.length).toBeGreaterThan(0);
  });

  it("stops at the cleared date and never touches sessions already over", () => {
    const cleared = plan([kneeLigament({ clearedDate: "2026-10-19" })]);
    // Thursday 15th is before the cleared date; the next Hamstring Lower (22nd) is after it.
    expect(sets(cleared, "2026-10-15", "Seated Leg Curl")).toHaveLength(2);
    expect(sets(cleared, "2026-10-22", "Seated Leg Curl")).toHaveLength(3);

    const started = plan([kneeLigament({ startDate: "2026-10-01" })]);
    expect(sets(started, "2026-10-12", "Leg Press")).toEqual(sets(plan([]), "2026-10-12", "Leg Press"));
  });

  it("takes the worst grade where two injuries hit one exercise", () => {
    const out = plan([kneeLigament({ id: "a", grade: 1 }), kneeLigament({ id: "b", joint: "hip", grade: 3 })]);
    expect(sets(out, "2026-10-15", "Seated Leg Curl")).toHaveLength(1);
  });
});
