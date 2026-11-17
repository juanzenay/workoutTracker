import { describe, expect, it } from "vitest";
import { MUSCLE_DETAILS, type MuscleDetail } from "./muscle-detail";
import { bodyShading, listMuscles } from "./muscle-focus";

/** Every muscle untrained, except the given sets. */
function trained(sets: Partial<Record<MuscleDetail, number>>) {
  return MUSCLE_DETAILS.map((muscle) => {
    const n = sets[muscle] ?? 0;
    return { muscle, sets: n, level: n === 0 ? 0 : n < 8 ? 2 : 4 };
  });
}

describe("listMuscles", () => {
  it("lists every part, hiding empty 'other' rows", () => {
    const names = listMuscles(trained({ "side delts": 4 }), null).map((m) => m.muscle);
    expect(names).toContain("front delts");
    expect(names).toContain("lats");
    expect(names).not.toContain("shoulders");
    expect(names).toContain("calves");
  });

  it("shows an 'other' row once it has sets", () => {
    expect(listMuscles(trained({ shoulders: 2 }), null).map((m) => m.muscle)).toContain("shoulders");
  });

  it("narrows to the tapped muscle's parts", () => {
    const names = listMuscles(trained({ "side delts": 4, "upper chest": 3 }), { by: "map", group: "shoulders" }).map((m) => m.muscle);
    expect(names).toEqual(["front delts", "side delts", "rear delts"]);
  });

  it("keeps the whole list when a row is tapped", () => {
    const all = listMuscles(trained({}), null);
    expect(listMuscles(trained({}), { by: "list", muscle: "rear delts" })).toHaveLength(all.length);
  });
});

describe("bodyShading", () => {
  const muscles = trained({ "front delts": 10, "rear delts": 3, "upper chest": 5 });

  it("shades each muscle by its most-trained part", () => {
    const shades = bodyShading(muscles, null);
    expect(shades.get("shoulders")).toEqual({ level: 4, sets: 10, dim: false });
    expect(shades.get("chest")).toEqual({ level: 2, sets: 5, dim: false });
    expect(shades.has("calves")).toBe(false);
  });

  it("dims everything but the tapped muscle", () => {
    const shades = bodyShading(muscles, { by: "map", group: "chest" });
    expect(shades.get("chest")?.dim).toBe(false);
    expect(shades.get("shoulders")?.dim).toBe(true);
  });

  it("shows only the tapped row's own muscle, at its own shade", () => {
    const shades = bodyShading(muscles, { by: "list", muscle: "rear delts" });
    expect([...shades.keys()]).toEqual(["shoulders"]);
    expect(shades.get("shoulders")).toEqual({ level: 2, sets: 3, dim: false });
  });

  it("shows nothing for a tapped row that is untrained", () => {
    expect(bodyShading(muscles, { by: "list", muscle: "calves" }).size).toBe(0);
  });
});
