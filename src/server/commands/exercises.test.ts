import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

describe("catalogue", () => {
  it("owner can search the bundled catalogue by name", async () => {
    const commands = await signedInOwner();

    const { items } = await commands.listExercises({ query: "bench press medium" });

    const bench = items.find((e) => e.name === "Barbell Bench Press - Medium Grip");
    expect(bench).toMatchObject({
      source: "free-exercise-db",
      equipment: "barbell",
      primaryMuscles: ["chest"],
    });
    expect(bench?.imageUrl).toMatch(/Barbell_Bench_Press_-_Medium_Grip\/0\.jpg$/);
  });

  it("every catalogue exercise has an image", async () => {
    const commands = await signedInOwner();

    const { items } = await commands.listExercises({ limit: 2000 });

    expect(items.length).toBeGreaterThan(800);
    for (const exercise of items) {
      expect(exercise.imageUrl, exercise.name).toMatch(/^(https:\/\/|\/)\S+\.(jpg|png|svg)$/);
    }
  });

  it("filters by primary muscle and equipment", async () => {
    const commands = await signedInOwner();

    const { items } = await commands.listExercises({ muscle: "hamstrings", equipment: "machine" });

    expect(items.map((e) => e.name)).toContain("Seated Leg Curl");
    for (const exercise of items) {
      expect(exercise.primaryMuscles).toContain("hamstrings");
      expect(exercise.equipment).toBe("machine");
    }
  });

  it("rejects an unknown muscle filter", async () => {
    const commands = await signedInOwner();

    await expect(
      commands.listExercises({ muscle: "elbows" as never }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("custom exercises", () => {
  it("owner creates a custom exercise with muscles and equipment, and finds it in the catalogue", async () => {
    const commands = await signedInOwner();

    const created = await commands.createCustomExercise({
      name: "  Dual Rail Chest Press ",
      primaryMuscles: ["chest"],
      secondaryMuscles: ["triceps", "shoulders"],
      equipment: "machine",
    });

    expect(created).toMatchObject({
      name: "Dual Rail Chest Press",
      source: "custom",
      primaryMuscles: ["chest"],
      secondaryMuscles: ["triceps", "shoulders"],
      equipment: "machine",
      hevyTemplateId: null,
    });
    expect(created.imageUrl).toBeTruthy();
    const { items } = await commands.listExercises({ query: "dual rail" });
    expect(items).toEqual([created]);
    expect(await commands.getExercise({ id: created.id })).toEqual(created);
  });

  it("requires at least one primary muscle", async () => {
    const commands = await signedInOwner();

    await expect(
      commands.createCustomExercise({ name: "Mystery Machine", primaryMuscles: [], equipment: "machine" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("unauthenticated callers cannot create exercises", async () => {
    await db().signUp("owner@example.com");
    const anon = db().commandsAs({ kind: "anon" });

    await expect(
      anon.createCustomExercise({ name: "Sneaky Press", primaryMuscles: ["chest"], equipment: null }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("getExercise", () => {
  it("reports a missing exercise as not_found", async () => {
    const commands = await signedInOwner();

    await expect(commands.getExercise({ id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("owner lock", () => {
  it("unauthenticated callers read nothing", async () => {
    await db().signUp("owner@example.com");
    const anon = db().commandsAs({ kind: "anon" });

    const { items } = await anon.listExercises({});

    expect(items).toEqual([]);
  });

  it("refuses to create any account after the owner's", async () => {
    await db().signUp("owner@example.com");

    await expect(db().signUp("friend@example.com")).rejects.toThrow(/locked to its owner/);
  });

  it("a session for any other user id reads nothing", async () => {
    await db().signUp("owner@example.com");
    const stranger = db().commandsAs({ kind: "user", userId: crypto.randomUUID() });

    const { items } = await stranger.listExercises({});

    expect(items).toEqual([]);
  });
});
