import { describe, expect, it } from "vitest";
import { formatRepTarget, parseRepTarget } from "./routine";

describe("rep targets", () => {
  it("reads a fixed target, a range, or nothing", () => {
    expect(parseRepTarget("10")).toEqual({ reps: 10, repRangeStart: null, repRangeEnd: null });
    expect(parseRepTarget(" 10 – 15 ")).toEqual({ reps: null, repRangeStart: 10, repRangeEnd: 15 });
    expect(parseRepTarget("8-12")).toEqual({ reps: null, repRangeStart: 8, repRangeEnd: 12 });
    expect(parseRepTarget("")).toEqual({ reps: null, repRangeStart: null, repRangeEnd: null });
  });

  it("rejects what isn't a rep target", () => {
    expect(parseRepTarget("12-8")).toBeNull();
    expect(parseRepTarget("lots")).toBeNull();
    expect(parseRepTarget("-3")).toBeNull();
  });

  it("writes targets back the way they are typed", () => {
    expect(formatRepTarget({ reps: 10, repRangeStart: null, repRangeEnd: null })).toBe("10");
    expect(formatRepTarget({ reps: null, repRangeStart: 10, repRangeEnd: 15 })).toBe("10–15");
    expect(formatRepTarget({ reps: null, repRangeStart: null, repRangeEnd: null })).toBe("");
  });
});
