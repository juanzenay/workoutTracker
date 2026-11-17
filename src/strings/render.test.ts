import { describe, expect, it } from "vitest";
import type { Message } from "@/domain/message";
import { getStrings } from ".";
import { renderMessages, renderText } from "./render";

const missed: Message = { code: "longRunMissed", meters: 26_554, date: "2027-03-28" };

describe("generated text (messages)", () => {
  it("renders in the viewer's skin", () => {
    expect(renderText(getStrings("standard"), missed)).toBe("The 16.5 mi long run on Sunday, Mar 28 was missed");
    expect(renderText(getStrings("dumb"), missed)).toBe("u skipped the 16.5 miles big run on Sunday (couch?) mar 28");
  });

  it("nests messages, and lists weeks the way people say them", () => {
    const s = getStrings();
    const noRir: Message = {
      code: "progressionNoRir",
      reason: { code: "progressionHitTop", top: 15, sets: 3, at: 180, next: 185, unit: "lb" },
    };
    expect(renderText(s, noRir)).toBe("No RIR logged, so going by reps: hit 15 reps on all 3 sets at 180 lb, so next time is 185 lb");
    expect(renderText(s, { code: "deloadMoves", from: [2, 5], to: [5, 6], race: "Spring Marathon" })).toBe(
      "Deload moves from weeks 2 and 5 to weeks 5–6 to line up with Spring Marathon",
    );
  });

  it("free text — the coach's own words, and anything saved before messages existed — stays as it was", () => {
    expect(renderText(getStrings("dumb"), "Machine Chest Press goes up to 185 lb")).toBe("Machine Chest Press goes up to 185 lb");
  });

  it("renders every message inside a result, leaving the rest alone (MCP tool output)", () => {
    expect(renderMessages(getStrings(), { id: "r1", summary: { code: "peakSummary", week: 3 }, reasons: ["Coach said so"] })).toEqual({
      id: "r1",
      summary: "Less leg volume in week 3: peak mileage",
      reasons: ["Coach said so"],
    });
  });
});
