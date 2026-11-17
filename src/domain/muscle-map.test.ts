import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { muscleMapFor, MUSCLE_MAP_BODIES } from "./muscle-map";

const PUBLIC = join(import.meta.dirname, "..", "..", "public");

function servedSvg(url: string): string {
  return readFileSync(join(PUBLIC, url), "utf8");
}

describe("muscle map assets", () => {
  it("serves scalable front and back body diagrams", () => {
    for (const url of [MUSCLE_MAP_BODIES.front, MUSCLE_MAP_BODIES.back]) {
      expect(servedSvg(url)).toMatch(/^<svg[^>]* viewBox="0 0 200 [\d.]+"/);
    }
  });

  it("places chest on the front and hamstrings on the back, with primary and secondary overlays", () => {
    expect(muscleMapFor("chest")).toEqual([
      {
        wgerId: 4,
        side: "front",
        primaryUrl: "/images/muscles/main/muscle-4.svg",
        secondaryUrl: "/images/muscles/secondary/muscle-4.svg",
      },
    ]);
    expect(muscleMapFor("hamstrings")).toMatchObject([{ wgerId: 11, side: "back" }]);
    expect(muscleMapFor("calves").map((o) => o.wgerId)).toEqual([7, 15]);
  });

  it("has no overlay for muscles wger doesn't draw", () => {
    expect(muscleMapFor("forearms")).toEqual([]);
    expect(muscleMapFor("neck")).toEqual([]);
  });

  it("every overlay it names is served", () => {
    for (const muscle of ["chest", "shoulders", "biceps", "triceps", "abdominals", "quadriceps",
      "hamstrings", "glutes", "calves", "lats", "traps", "lower back"] as const) {
      const overlays = muscleMapFor(muscle);
      expect(overlays.length, muscle).toBeGreaterThan(0);
      for (const o of overlays) {
        expect(servedSvg(o.primaryUrl)).toMatch(/^<svg[^>]* viewBox="0 0 200 [\d.]+"/);
        expect(servedSvg(o.secondaryUrl)).toMatch(/<path /);
      }
    }
  });
});
