import { describe, expect, it } from "vitest";
import {
  isBodyOnly,
  loggedWeight,
  rankSimilarExercises,
  showsWeight,
  splitSimilarExercises,
  type Equipment,
  type Muscle,
} from "./exercise";

const exercise = (
  id: string,
  primaryMuscles: Muscle[],
  equipment: Equipment | null,
  secondaryMuscles: Muscle[] = [],
) => ({ id, primaryMuscles, secondaryMuscles, equipment });

describe("similar exercises for a swap", () => {
  const target = exercise("target", ["chest"], "barbell", ["triceps"]);

  it("ranks a shared primary muscle above matching equipment, which ranks above a shared secondary muscle", () => {
    const catalogue = [
      exercise("secondary", ["biceps"], "cable", ["triceps"]),
      exercise("equipment", ["lats"], "barbell"),
      exercise("primary", ["chest"], "cable"),
    ];
    expect(rankSimilarExercises(target, catalogue).map((e) => e.id)).toEqual(["primary", "equipment", "secondary"]);
  });

  it("puts exercises with no similarity after the similar ones, keeping them all", () => {
    const catalogue = [exercise("none", ["calves"], "machine"), exercise("secondary", ["biceps"], null, ["triceps"])];
    expect(rankSimilarExercises(target, catalogue).map((e) => e.id)).toEqual(["secondary", "none"]);
  });

  it("ranks a primary-muscle match with matching equipment above one without equipment", () => {
    const catalogue = [exercise("bare", ["chest"], "cable"), exercise("full", ["chest"], "barbell")];
    expect(rankSimilarExercises(target, catalogue).map((e) => e.id)).toEqual(["full", "bare"]);
  });

  it("keeps catalogue order among exercises in the same tier", () => {
    const catalogue = [exercise("b", ["chest"], null), exercise("a", ["chest"], null), exercise("c", ["chest"], null)];
    expect(rankSimilarExercises(target, catalogue).map((e) => e.id)).toEqual(["b", "a", "c"]);
  });

  it("leaves out the exercise being swapped", () => {
    const catalogue = [target, exercise("other", ["chest"], null)];
    expect(rankSimilarExercises(target, catalogue).map((e) => e.id)).toEqual(["other"]);
  });

  it("never treats a missing equipment as matching", () => {
    const bodyTarget = exercise("t", ["chest"], null);
    const catalogue = [exercise("x", ["lats"], null)];
    expect(rankSimilarExercises(bodyTarget, catalogue).map((e) => e.id)).toEqual(["x"]);
  });

  it("splits the ranked catalogue into the exercises that share something with the target, then the rest", () => {
    const catalogue = [
      exercise("none", ["calves"], "machine"),
      exercise("secondary", ["biceps"], null, ["triceps"]),
      exercise("equipment", ["lats"], "barbell"),
      exercise("primary", ["chest"], "cable"),
      exercise("other", ["calves"], null),
    ];
    const { similar, rest } = splitSimilarExercises(target, catalogue);
    expect(similar.map((e) => e.id)).toEqual(["primary", "equipment", "secondary"]);
    expect(rest.map((e) => e.id)).toEqual(["none", "other"]);
  });

  it("leaves the target out of both groups", () => {
    const { similar, rest } = splitSimilarExercises(target, [target, exercise("other", ["calves"], null)]);
    expect(similar).toEqual([]);
    expect(rest.map((e) => e.id)).toEqual(["other"]);
  });
});

describe("body-only exercises", () => {
  it("are the exercises whose equipment is 'body only'", () => {
    expect(isBodyOnly("body only")).toBe(true);
    expect(isBodyOnly("barbell")).toBe(false);
    expect(isBodyOnly(null)).toBe(false);
  });

  it("hide the weight input unless weight was added or already logged", () => {
    expect(showsWeight("body only", false, false)).toBe(false);
    expect(showsWeight("body only", true, false)).toBe(true);
    expect(showsWeight("body only", false, true)).toBe(true);
  });

  it("always show the weight input for other or unknown equipment", () => {
    expect(showsWeight("barbell", false, false)).toBe(true);
    expect(showsWeight(null, false, false)).toBe(true);
  });

  it("save their sets with weight null while the weight input is hidden", () => {
    expect(loggedWeight(false, 95)).toBeNull();
    expect(loggedWeight(false, null)).toBeNull();
  });

  it("save the entered weight once the input is shown", () => {
    expect(loggedWeight(true, 10)).toBe(10);
    expect(loggedWeight(true, null)).toBeNull();
  });

  it("keep the entered weight for other or unknown equipment", () => {
    expect(loggedWeight(showsWeight("barbell", false, false), 182.5)).toBe(182.5);
    expect(loggedWeight(showsWeight("dumbbell", false, false), null)).toBeNull();
    expect(loggedWeight(showsWeight(null, false, false), 20)).toBe(20);
  });
});
