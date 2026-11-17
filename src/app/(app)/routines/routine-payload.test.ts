import { describe, expect, it } from "vitest";
import type { Equipment } from "@/domain/exercise";
import { toPayload, type DraftExercise } from "./routine-payload";

const equipmentOf: Record<string, Equipment | null> = {
  "3/4 Sit-Up": "body only",
  "Barbell Squat": "barbell",
  Unknown: null,
};

function exercise(exerciseId: string, weight: string, addedWeight = false): DraftExercise {
  return {
    key: exerciseId,
    exerciseId,
    restSeconds: "",
    supersetGroup: null,
    notes: "",
    addedWeight,
    sets: [{ key: "set", setType: "normal", weight, unit: "lb", reps: "12" }],
  };
}

const payloadOf = (exercises: DraftExercise[]) =>
  toPayload("Back Upper", "", "", exercises, (id) => equipmentOf[id] ?? null)?.exercises?.[0]?.sets[0];

describe("routine payload weights", () => {
  it("saves a body-only exercise's sets with no weight while its weight input is hidden", () => {
    expect(payloadOf([exercise("3/4 Sit-Up", "")])).toMatchObject({ weight: null, reps: 12 });
  });

  it("keeps a body-only exercise's weight once a set already has one", () => {
    expect(payloadOf([exercise("3/4 Sit-Up", "95")])).toMatchObject({ weight: 95, reps: 12 });
  });

  it("saves the typed weight for a body-only exercise with added weight", () => {
    expect(payloadOf([exercise("3/4 Sit-Up", "10", true)])).toMatchObject({ weight: 10, reps: 12 });
  });

  it("clearing the added weight saves the set as bodyweight", () => {
    expect(payloadOf([exercise("3/4 Sit-Up", "", true)])).toMatchObject({ weight: null, reps: 12 });
  });

  it("keeps the typed weight for barbell exercises", () => {
    expect(payloadOf([exercise("Barbell Squat", "182.5")])).toMatchObject({ weight: 182.5, reps: 12 });
  });

  it("keeps the typed weight for exercises with no equipment", () => {
    expect(payloadOf([exercise("Unknown", "20")])).toMatchObject({ weight: 20, reps: 12 });
  });
});
