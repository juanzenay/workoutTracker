import { describe, expect, it } from "vitest";
import { fitStatValue, STAT_MAX_PX, STAT_MIN_PX } from "./share-card-fit";

// A stand-in for canvas measureText: every glyph is half an em wide, so width = length × px / 2.
const halfEm = (text: string, px: number) => (text.length * px) / 2;

describe("fitStatValue", () => {
  it("keeps the full size when the value already fits", () => {
    // 8 × 46 / 2 = 184 ≤ 218
    expect(fitStatValue("abcdefgh", 218, halfEm)).toEqual({ lines: ["abcdefgh"], px: STAT_MAX_PX });
  });

  it("shrinks to the largest size that fits on one line", () => {
    // 11 chars: 46px → 253, 40px → 220, 38px → 209 ≤ 218
    expect(fitStatValue("abcdefghijk", 218, halfEm)).toEqual({ lines: ["abcdefghijk"], px: 38 });
  });

  it("shrinks a multi-word value on one line below the old 28px floor before wrapping", () => {
    // 20 chars: at 22px it is 220 > 218, at 20px it is 200 ≤ 218, so the largest fitting size is 20px.
    expect(fitStatValue("aaaaaaaaaa bbbbbbbbb", 218, halfEm)).toEqual({ lines: ["aaaaaaaaaa bbbbbbbbb"], px: 20 });
  });

  it("wraps onto two lines at the minimum size when one line cannot fit", () => {
    // 31 chars: 31 × 18 / 2 = 279 on one line at the floor. Each 15-char half fits: 15 × 18 / 2 = 135 ≤ 218.
    const a = "a".repeat(15);
    const b = "b".repeat(15);
    expect(fitStatValue(`${a} ${b}`, 218, halfEm)).toEqual({ lines: [a, b], px: STAT_MIN_PX });
  });

  it("keeps the reported values whole at the real 218px cell width", () => {
    const duration = fitStatValue("1 h 33 min", 218, halfEm);
    const volume = fitStatValue("40,830 kg", 218, halfEm);
    expect(duration.lines).toEqual(["1 h 33 min"]);
    expect(volume.lines).toEqual(["40,830 kg"]);
    expect(duration.px).toBeLessThan(STAT_MAX_PX);
  });

  it("ellipsises a single word that is still too wide at the minimum size, and fits the column", () => {
    // 42 chars at 18px: 378. Largest prefix plus "…" that fits 218 is 23 chars + "…" = 24 × 9 = 216.
    const word = "a".repeat(42);
    expect(fitStatValue(word, 218, halfEm)).toEqual({ lines: ["a".repeat(23) + "…"], px: STAT_MIN_PX });
  });
});
