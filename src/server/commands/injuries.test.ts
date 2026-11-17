import { describe, expect, it } from "vitest";
import { planBlocks, type EngineInput } from "@/engine/plan";
import { setupTestDb } from "../../../tests/db/test-db";
import type { Engine } from ".";
import { readable } from "../../../tests/readable";

const db = setupTestDb();

const engineOn =
  (today: string): Engine =>
  (input: EngineInput) =>
    planBlocks({ ...input, today });

async function signedInOwner(today: string) {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id }, { engine: engineOn(today), now: new Date(`${today}T19:00:00Z`) });
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

async function legBlock(commands: Commands) {
  const id = async (name: string) =>
    (await commands.listExercises({ query: name })).items.find((e) => e.name === name)!.id;
  const one = async (name: string, startWeight: number) => [
    { exerciseId: await id(name), sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight },
  ];
  return commands.createBlock({
    name: "Upper/Lower",
    startDate: "2026-10-12",
    weeks: 4,
    timeZone: "America/Los_Angeles",
    sessions: [
      { name: "Chest Upper", weekday: 2, exercises: await one("Machine Bench Press", 180) },
      { name: "Hamstring Lower", weekday: 4, exercises: await one("Seated Leg Curl", 130) },
    ],
  });
}

const curl = async (commands: Commands, date: string) =>
  readable(await commands.getToday({ date })).session!.exercises[0]!.sets.map((s) => s.weight);

describe("Injuries", () => {
  it("a knee ligament injury cuts the leg curl, and clearing it puts the plan back", async () => {
    const commands = await signedInOwner("2026-10-12");
    await legBlock(commands);
    expect(await curl(commands, "2026-10-15")).toEqual([130, 130, 130]);

    const injury = await commands.logInjury({
      joint: "knee",
      side: "left",
      tissue: "ligament",
      grade: 2,
      startDate: "2026-10-12",
      note: "Rolled it",
    });

    expect(injury).toMatchObject({ joint: "knee", grade: 2, clearedDate: null, note: "Rolled it" });
    expect((await commands.listInjuries({})).injuries).toEqual([injury]);
    expect(await curl(commands, "2026-10-15")).toEqual([65, 65]);
    // Chest day doesn't load the knee.
    expect((await commands.getToday({ date: "2026-10-13" })).session!.exercises[0]!.sets.map((s) => s.weight)).toEqual([180, 180, 180]);

    // Healing: grade 1 trims the load only.
    await commands.updateInjury({ id: injury.id, grade: 1 });
    expect(await curl(commands, "2026-10-15")).toEqual([100, 100, 100]);

    await commands.clearInjury({ id: injury.id, clearedDate: "2026-10-14" });
    expect((await commands.listInjuries({})).injuries[0]).toMatchObject({ clearedDate: "2026-10-14" });
    expect(await curl(commands, "2026-10-15")).toEqual([130, 130, 130]);
  });

  it("deleting an injury logged by mistake puts the plan back; unknown ids are not found", async () => {
    const commands = await signedInOwner("2026-10-12");
    await legBlock(commands);
    const injury = await commands.logInjury({ joint: "hip", side: "both", tissue: "muscle", grade: 3, startDate: "2026-10-12" });
    expect(await curl(commands, "2026-10-15")).toEqual([65]);

    await commands.deleteInjury({ id: injury.id });

    expect((await commands.listInjuries({})).injuries).toEqual([]);
    expect(await curl(commands, "2026-10-15")).toEqual([130, 130, 130]);
    await expect(commands.deleteInjury({ id: injury.id })).rejects.toMatchObject({ code: "not_found" });
  });

  it("refuses a grade outside 1 to 3", async () => {
    const commands = await signedInOwner("2026-10-12");
    await expect(
      commands.logInjury({ joint: "knee", side: "left", tissue: "ligament", grade: 4 as 3, startDate: "2026-10-12" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});
