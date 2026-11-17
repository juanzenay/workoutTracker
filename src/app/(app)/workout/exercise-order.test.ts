import { describe, expect, it } from "vitest";
import { dropIndex, moveTo } from "./exercise-order";

describe("moveTo", () => {
  it("moves an id to an index and shifts the rest", () => {
    expect(moveTo(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
    expect(moveTo(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
    expect(moveTo(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
  });

  it("clamps the index to the list and leaves unknown ids alone", () => {
    expect(moveTo(["a", "b", "c"], "a", 9)).toEqual(["b", "c", "a"]);
    expect(moveTo(["a", "b", "c"], "c", -3)).toEqual(["c", "a", "b"]);
    expect(moveTo(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  });
});

describe("dropIndex", () => {
  // Card midpoints in their current order: three cards, 100px apart.
  const centers = [50, 150, 250];

  it("lands the dragged card after every other card whose midpoint is above the pointer", () => {
    expect(dropIndex(centers, 0, 40)).toBe(0);
    expect(dropIndex(centers, 0, 200)).toBe(1);
    expect(dropIndex(centers, 0, 300)).toBe(2);
    expect(dropIndex(centers, 2, 60)).toBe(1);
  });
});
