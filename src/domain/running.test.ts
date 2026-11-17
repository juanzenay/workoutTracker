import { describe, expect, it } from "vitest";
import { withWholeSecondPaces } from "./running";

describe("withWholeSecondPaces", () => {
  it("rounds the pace target and every pace step to whole seconds per km (what Coros accepts), leaving the rest alone", () => {
    const run = {
      type: "intervals" as const,
      paceTarget: { perKmSeconds: [335.5, 354.2] as [number, number] },
      structure: {
        warmup: { distanceMeters: 1609, intensity: { kind: "hr_zone" as const, zone: 2 } },
        repeats: [
          {
            count: 6,
            steps: [
              { kind: "work" as const, distanceMeters: 800, intensity: { kind: "pace" as const, perKmSeconds: [248.5, 257.9] as [number, number] } },
              { kind: "recovery" as const, durationSeconds: 90 },
            ],
          },
        ],
        cooldown: { open: true as const, intensity: { kind: "pace" as const, perKmSeconds: [372.8, 372.8] as [number, number] } },
      },
    };

    expect(withWholeSecondPaces(run)).toEqual({
      type: "intervals",
      paceTarget: { perKmSeconds: [336, 354] },
      structure: {
        warmup: { distanceMeters: 1609, intensity: { kind: "hr_zone", zone: 2 } },
        repeats: [
          {
            count: 6,
            steps: [
              { kind: "work", distanceMeters: 800, intensity: { kind: "pace", perKmSeconds: [249, 258] } },
              { kind: "recovery", durationSeconds: 90 },
            ],
          },
        ],
        cooldown: { open: true, intensity: { kind: "pace", perKmSeconds: [373, 373] } },
      },
    });
    expect(withWholeSecondPaces({ paceTarget: null, structure: null })).toEqual({ paceTarget: null, structure: null });
  });
});
