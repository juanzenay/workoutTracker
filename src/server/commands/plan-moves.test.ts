import { describe, expect, it } from "vitest";
import { planBlocks, type EngineInput } from "@/engine/plan";
import { setupTestDb } from "../../../tests/db/test-db";
import type { Engine } from ".";

const db = setupTestDb();

const engineOn =
  (today: string): Engine =>
  (input: EngineInput) =>
    planBlocks({ ...input, today });

const LA = "America/Los_Angeles";

async function signedInOwner(today: string) {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id }, { engine: engineOn(today), now: new Date(`${today}T19:00:00Z`) });
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

/** Lower Body A Mon, Chest Upper Tue, Hamstring Lower Thu, Back Upper Fri, from Monday 2026-10-12. */
async function upperLowerBlock(commands: Commands) {
  const id = async (name: string) => (await commands.listExercises({ query: name })).items.find((e) => e.name === name)!.id;
  const one = async (name: string, startWeight: number) => [
    { exerciseId: await id(name), sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight },
  ];
  return commands.createBlock({
    name: "Upper/Lower",
    startDate: "2026-10-12",
    weeks: 4,
    timeZone: LA,
    sessions: [
      { name: "Lower Body A", weekday: 1, exercises: await one("Leg Press", 270) },
      { name: "Chest Upper", weekday: 2, exercises: await one("Machine Bench Press", 180) },
      { name: "Hamstring Lower", weekday: 4, exercises: await one("Seated Leg Curl", 130) },
      { name: "Back Upper", weekday: 5, exercises: await one("Seated Cable Rows", 150) },
    ],
  });
}

const WEEK = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];

async function lifts(commands: Commands) {
  const { days } = await commands.getCalendar({ from: WEEK[0], to: WEEK[6] });
  return days.map((d) => d.sessions.map((s) => s.name).join("+") || null);
}

async function sessionOn(commands: Commands, date: string) {
  const { days } = await commands.getCalendar({ from: date, to: date });
  return days[0]!.sessions[0]!.id;
}

async function runPlan(commands: Commands) {
  const race = await commands.createRace({ name: "Fall Half", date: "2026-11-15", distanceMeters: 21_097, priority: "A" });
  const runs = [];
  for (let w = 1; w <= 5; w++) {
    runs.push({ week: w, day: "tue", type: "easy", distance_m: 6000 });
    runs.push(w === 5 ? { week: w, day: "sun", type: "race", distance_m: 21_097 } : { week: w, day: "sun", type: "long", distance_m: 14_000 });
  }
  const { plan } = await commands.importRunPlan({ format: "json", content: JSON.stringify({ name: "Five weeks", runs }), raceId: race.id, timeZone: LA });
  return plan;
}

async function runDays(commands: Commands, planId: string) {
  const { plannedRuns } = await commands.getRunPlan({ id: planId });
  return plannedRuns.filter((r) => r.week === 1).map((r) => [r.date, r.type]);
}

describe("Move planned sessions within the week", () => {
  it("swaps upper and lower: the move lasts through re-plans, and moving back forgets it", async () => {
    const commands = await signedInOwner("2026-10-12");
    await upperLowerBlock(commands);

    await commands.movePlannedSession({ id: await sessionOn(commands, "2026-10-12"), to: "2026-10-13" });
    expect(await lifts(commands)).toEqual([
      "Chest Upper", "Lower Body A", null, "Hamstring Lower", "Back Upper", null, null,
    ]);

    await commands.markUnavailable({ startDate: "2026-11-30", endDate: "2026-11-30" }); // any re-plan
    expect(await lifts(commands)).toEqual([
      "Chest Upper", "Lower Body A", null, "Hamstring Lower", "Back Upper", null, null,
    ]);

    // Moving it on from there is still one move from where the block put it; going home forgets it.
    await commands.movePlannedSession({ id: await sessionOn(commands, "2026-10-13"), to: "2026-10-12" });
    expect(await lifts(commands)).toEqual([
      "Lower Body A", "Chest Upper", null, "Hamstring Lower", "Back Upper", null, null,
    ]);
  });

  it("moves a session to an empty day", async () => {
    const commands = await signedInOwner("2026-10-12");
    await upperLowerBlock(commands);

    await commands.movePlannedSession({ id: await sessionOn(commands, "2026-10-15"), to: "2026-10-14" });

    expect(await lifts(commands)).toEqual(["Lower Body A", "Chest Upper", "Hamstring Lower", null, "Back Upper", null, null]);
  });

  it("only moves within the week, onto today or later", async () => {
    const commands = await signedInOwner("2026-10-14");
    await upperLowerBlock(commands);

    const thursday = await sessionOn(commands, "2026-10-15");
    await expect(commands.movePlannedSession({ id: thursday, to: "2026-10-19" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(commands.movePlannedSession({ id: thursday, to: "2026-10-13" })).rejects.toMatchObject({ code: "invalid_input" });
    // Nothing moved (Monday and Tuesday were missed, so the engine had already moved them on its own).
    expect(await lifts(commands)).toEqual([null, null, "Lower Body A", "Hamstring Lower", "Back Upper", "Chest Upper", null]);
  });
});

describe("Move planned runs within the week", () => {
  it("moves the Tuesday run to Wednesday, and it stays there on later re-plans", async () => {
    const commands = await signedInOwner("2026-10-12");
    const plan = await runPlan(commands);
    expect(await runDays(commands, plan.id)).toEqual([
      ["2026-10-13", "easy"],
      ["2026-10-18", "long"],
    ]);
    const { plannedRuns } = await commands.getRunPlan({ id: plan.id });

    await commands.movePlannedRun({ id: plannedRuns.find((r) => r.date === "2026-10-13")!.id, to: "2026-10-14" });
    expect(await runDays(commands, plan.id)).toEqual([
      ["2026-10-14", "easy"],
      ["2026-10-18", "long"],
    ]);

    await commands.markUnavailable({ startDate: "2026-11-30", endDate: "2026-11-30" });
    expect(await runDays(commands, plan.id)).toEqual([
      ["2026-10-14", "easy"],
      ["2026-10-18", "long"],
    ]);

    // Later weeks are untouched.
    const { plannedRuns: after } = await commands.getRunPlan({ id: plan.id });
    expect(after.find((r) => r.week === 2 && r.type === "easy")!.date).toBe("2026-10-20");
  });

  it("lifting plans around a moved long run", async () => {
    const commands = await signedInOwner("2026-10-12");
    await upperLowerBlock(commands);
    const plan = await runPlan(commands);
    const { plannedRuns } = await commands.getRunPlan({ id: plan.id });

    await commands.movePlannedRun({ id: plannedRuns.find((r) => r.type === "long" && r.week === 1)!.id, to: "2026-10-17" });

    expect(await runDays(commands, plan.id)).toEqual([
      ["2026-10-13", "easy"],
      ["2026-10-17", "long"],
    ]);
  });
});
