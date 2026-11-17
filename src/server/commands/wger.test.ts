import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

describe("wger fallback search", () => {
  it("finds wger exercises by name, in workout tracker's muscle and equipment vocabulary", async () => {
    const commands = await signedInOwner();

    const { items } = await commands.searchWger({ query: "hip thrust" });

    expect(items.map((r) => r.name)).toEqual(["Hip Thrust", "Single Leg Hip Thrust"]);
    expect(items[0]).toMatchObject({
      wgerId: 294,
      primaryMuscles: ["glutes"],
      secondaryMuscles: ["hamstrings", "quadriceps"],
      equipment: "barbell",
      imageUrl: "https://wger.de/media/exercise-images/294/Hip-thrust-1.png",
      exerciseId: null,
    });
    expect(items[1]).toMatchObject({ equipment: "body only", imageUrl: "/images/exercise-placeholder.svg" });
  });

  it("returns nothing when wger has no match", async () => {
    const commands = await signedInOwner();

    expect(await commands.searchWger({ query: "xyzzy" })).toEqual({ items: [] });
  });

  it("adding a result creates a wger catalogue exercise with its muscles, equipment and steps", async () => {
    const commands = await signedInOwner();

    const added = await commands.addWgerExercise({ wgerId: 294 });

    expect(added).toMatchObject({
      name: "Hip Thrust",
      source: "wger",
      primaryMuscles: ["glutes"],
      secondaryMuscles: ["hamstrings", "quadriceps"],
      equipment: "barbell",
      category: "strength",
      instructions: [
        "Sit on the floor with your upper back against a bench & a barbell over your hips.",
        "Drive through your heels and lift your hips.",
        "Squeeze your glutes at the top, then lower.",
      ],
      imageUrl: "https://wger.de/media/exercise-images/294/Hip-thrust-1.png",
    });
    expect(await commands.getExercise({ id: added.id })).toEqual(added);
    const { items } = await commands.searchWger({ query: "hip thrust" });
    expect(items[0]?.exerciseId).toBe(added.id);
  });

  it("adding the same wger exercise twice keeps one catalogue entry", async () => {
    const commands = await signedInOwner();

    const first = await commands.addWgerExercise({ wgerId: 294 });
    const second = await commands.addWgerExercise({ wgerId: 294 });

    expect(second).toEqual(first);
    const wgerExercises = (await commands.listExercises({ query: "hip thrust" })).items.filter(
      (e) => e.source === "wger",
    );
    expect(wgerExercises).toEqual([first]);
  });

  it("adding an exercise wger doesn't have is not_found", async () => {
    const commands = await signedInOwner();

    await expect(commands.addWgerExercise({ wgerId: 999999 })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("unauthenticated callers cannot add wger exercises", async () => {
    await db().signUp("owner@example.com");
    const anon = db().commandsAs({ kind: "anon" });

    await expect(anon.addWgerExercise({ wgerId: 294 })).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("credits list each added wger exercise with its authors and license", async () => {
    const commands = await signedInOwner();
    expect(await commands.listWgerCredits({})).toEqual({ items: [] });

    const hip = await commands.addWgerExercise({ wgerId: 294 });
    const single = await commands.addWgerExercise({ wgerId: 1203 });
    await commands.createCustomExercise({ name: "Rails Press", primaryMuscles: ["chest"], equipment: null });

    expect(await commands.listWgerCredits({})).toEqual({
      items: [
        {
          exerciseId: hip.id,
          name: "Hip Thrust",
          licenseShortName: "CC-BY-SA 4",
          licenseName: "Creative Commons Attribution Share Alike 4",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/deed.en",
          authors: ["Grumpy Lifter", "Everkinetic"],
          sourceUrl: "https://wger.de/exercise/294/view-base",
        },
        {
          exerciseId: single.id,
          name: "Single Leg Hip Thrust",
          licenseShortName: "CC-BY-SA 3",
          licenseName: "Creative Commons Attribution Share Alike 3",
          licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/deed.en",
          authors: ["jsmith"],
          sourceUrl: "https://wger.de/exercise/1203/view-base",
        },
      ],
    });
  });

  it("reports wger being down as unavailable", async () => {
    const commands = await signedInOwner();

    await expect(commands.searchWger({ query: "server down" })).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
