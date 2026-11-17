import { describe, expect, it } from "vitest";
import { getStrings, SKINS } from ".";

/**
 * Dumb Mode's copy pack (#28): its own string set covering every screen. Keys whose values must stay
 * as they are, because they are glyphs or tiny labels in fixed-width cells, or text that leaves the
 * app (the Strava post, the installed app's description), are listed here; everything else must have
 * its own dumb copy.
 */
const SAME_ON_PURPOSE = [
  "home.marks",
  "setTypeBadges",
  "loggerExtras.rirValue",
  "stravaPost",
  "workoutText",
  "app.description",
];

type Leaf = { path: string; value: unknown };

function leaves(value: unknown, path = ""): Leaf[] {
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [{ path, value }];
}

const standard = getStrings("standard");
const dumb = getStrings("dumb");

describe("Dumb Mode string pack", () => {
  it("is a skin", () => {
    expect(SKINS).toContain("dumb");
  });

  it("covers the same keys as the standard pack", () => {
    expect(leaves(dumb).map((l) => l.path)).toEqual(leaves(standard).map((l) => l.path));
  });

  it("rewrites every screen's copy, apart from glyphs, badges and text that leaves the app", () => {
    const standardLeaves = new Map(leaves(standard).map((l) => [l.path, l.value]));
    const unchanged = leaves(dumb)
      .filter((l) => !SAME_ON_PURPOSE.some((p) => l.path === p || l.path.startsWith(`${p}.`)))
      .filter((l) => l.value === standardLeaves.get(l.path))
      .map((l) => l.path);
    expect(unchanged).toEqual([]);
  });

  it("talks dumb", () => {
    expect(dumb.history.setLine("135 lb", "3")).toBe("u lifted the heavy thing (135 lb) 3 times. good job big guy");
    expect(dumb.workout.finish).toBe("im done");
  });

  it("keeps the standard pack the default", () => {
    expect(getStrings()).toBe(standard);
  });
});
