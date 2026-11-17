import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

describe("logging body measurements", () => {
  it("owner logs bodyweight and girths for a date and sees them listed", async () => {
    const commands = await signedInOwner();

    await commands.logBodyMeasurement({
      date: "2026-10-01",
      weightUnit: "lb",
      lengthUnit: "in",
      values: { weight: 185.5, waist: 33.5, leftBicep: 15.25 },
    });

    const { items } = await commands.listBodyMeasurements({});
    expect(items).toEqual([
      expect.objectContaining({
        date: "2026-10-01",
        weightUnit: "lb",
        lengthUnit: "in",
        values: { weight: 185.5, waist: 33.5, leftBicep: 15.25 },
      }),
    ]);
  });
});

describe("editing and deleting body measurements", () => {
  it("owner edits an entry's date and values; cleared values are no longer measured", async () => {
    const commands = await signedInOwner();
    const logged = await commands.logBodyMeasurement({
      date: "2026-10-01",
      values: { weight: 185.5, chest: 104 },
    });

    const edited = await commands.updateBodyMeasurement({
      id: logged.id,
      date: "2026-10-02",
      weightUnit: "lb",
      lengthUnit: "cm",
      values: { weight: 184, chest: null, waist: 86 },
    });

    expect(edited).toEqual({
      id: logged.id,
      date: "2026-10-02",
      weightUnit: "lb",
      lengthUnit: "cm",
      values: { weight: 184, waist: 86 },
    });
    const { items } = await commands.listBodyMeasurements({});
    expect(items).toEqual([edited]);
  });

  it("owner deletes an entry", async () => {
    const commands = await signedInOwner();
    const keep = await commands.logBodyMeasurement({ date: "2026-10-01", values: { weight: 185 } });
    const drop = await commands.logBodyMeasurement({ date: "2026-10-02", values: { weight: 186 } });

    await commands.deleteBodyMeasurement({ id: drop.id });

    const { items } = await commands.listBodyMeasurements({});
    expect(items.map((m) => m.id)).toEqual([keep.id]);
    await expect(commands.deleteBodyMeasurement({ id: drop.id })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("each date has at most one entry", async () => {
    const commands = await signedInOwner();
    await commands.logBodyMeasurement({ date: "2026-10-01", values: { weight: 185 } });
    const other = await commands.logBodyMeasurement({ date: "2026-10-02", values: { weight: 186 } });

    await expect(
      commands.logBodyMeasurement({ date: "2026-10-01", values: { waist: 86 } }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      commands.updateBodyMeasurement({ id: other.id, date: "2026-10-01", values: { weight: 186 } }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("history and trend", () => {
  it("shows one metric's history oldest first, skipping dates it wasn't measured, with its trend", async () => {
    const commands = await signedInOwner();
    await commands.logBodyMeasurement({ date: "2026-09-20", weightUnit: "lb", values: { weight: 185 } });
    await commands.logBodyMeasurement({ date: "2026-10-04", weightUnit: "lb", values: { weight: 184 } });
    await commands.logBodyMeasurement({ date: "2026-09-27", weightUnit: "lb", values: { weight: 183.5 } });
    await commands.logBodyMeasurement({ date: "2026-10-05", values: { waist: 86 } });

    const history = await commands.getBodyMetricHistory({ metric: "weight" });

    expect(history).toEqual({
      metric: "weight",
      unit: "lb",
      points: [
        { date: "2026-09-20", value: 185 },
        { date: "2026-09-27", value: 183.5 },
        { date: "2026-10-04", value: 184 },
      ],
      trend: {
        latest: { date: "2026-10-04", value: 184 },
        changeSincePrevious: 0.5,
        changeSinceFirst: -1,
      },
    });
  });

  it("expresses mixed-unit history in the latest entry's unit", async () => {
    const commands = await signedInOwner();
    await commands.logBodyMeasurement({ date: "2026-09-01", weightUnit: "kg", lengthUnit: "cm", values: { weight: 80, waist: 86.36 } });
    await commands.logBodyMeasurement({ date: "2026-10-01", weightUnit: "lb", lengthUnit: "in", values: { weight: 180, waist: 33.5 } });

    const weight = await commands.getBodyMetricHistory({ metric: "weight" });
    const waist = await commands.getBodyMetricHistory({ metric: "waist" });

    expect(weight.unit).toBe("lb");
    expect(weight.points).toEqual([
      { date: "2026-09-01", value: 176.4 },
      { date: "2026-10-01", value: 180 },
    ]);
    expect(waist.unit).toBe("in");
    expect(waist.points).toEqual([
      { date: "2026-09-01", value: 34 },
      { date: "2026-10-01", value: 33.5 },
    ]);
    expect(waist.trend?.changeSinceFirst).toBe(-0.5);
  });

  it("a metric never measured has no history or trend", async () => {
    const commands = await signedInOwner();
    await commands.logBodyMeasurement({ date: "2026-10-01", values: { weight: 185 } });

    expect(await commands.getBodyMetricHistory({ metric: "neck" })).toEqual({
      metric: "neck",
      unit: null,
      points: [],
      trend: null,
    });
  });
});

describe("validation and access", () => {
  it("rejects an entry that measures nothing, a bad date or a non-positive value", async () => {
    const commands = await signedInOwner();

    for (const input of [
      { date: "2026-10-01", values: {} },
      { date: "2026-10-01", values: { weight: null } },
      { date: "2026-13-01", values: { weight: 185 } },
      { date: "2026-10-01", values: { waist: 0 } },
      { date: "2026-10-01", values: { fatPercent: 120 } },
      { date: "2026-10-01", values: { elbow: 10 } },
    ]) {
      await expect(commands.logBodyMeasurement(input as never), JSON.stringify(input)).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    expect((await commands.listBodyMeasurements({})).items).toEqual([]);
  });

  it("anonymous visitors can neither log nor read measurements", async () => {
    const owner = await signedInOwner();
    await owner.logBodyMeasurement({ date: "2026-10-01", values: { weight: 185 } });
    const anon = db().commandsAs({ kind: "anon" });

    await expect(
      anon.logBodyMeasurement({ date: "2026-10-02", values: { weight: 185 } }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    expect((await anon.listBodyMeasurements({})).items).toEqual([]);
  });
});
