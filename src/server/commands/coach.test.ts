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

const LA = "America/Los_Angeles";

function ownerOn(userId: string, today: string) {
  return db().commandsAs({ kind: "user", userId }, { engine: engineOn(today), now: new Date(`${today}T19:00:00Z`) });
}

async function signedInOwner(today: string) {
  const owner = await db().signUp("owner@example.com");
  return ownerOn(owner.id, today);
}

type Commands = ReturnType<typeof ownerOn>;

/** Lower Body A Mon, Chest Upper Tue, Hamstring Lower Thu, Back Upper Fri, from Monday 2026-10-12. */
async function upperLowerBlock(commands: Commands) {
  const id = async (name: string) =>
    (await commands.listExercises({ query: name })).items.find((e) => e.name === name)!.id;
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

const WEEK_1 = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];

async function week(commands: Commands, dates = WEEK_1) {
  const out: [string, string | null][] = [];
  for (const date of dates) out.push([date, readable(await commands.getToday({ date })).session?.name ?? null]);
  return out;
}

const AS_DESIGNED = [
  ["2026-10-12", "Lower Body A"],
  ["2026-10-13", "Chest Upper"],
  ["2026-10-14", null],
  ["2026-10-15", "Hamstring Lower"],
  ["2026-10-16", "Back Upper"],
  ["2026-10-17", null],
  ["2026-10-18", null],
];

describe("Coach changes: propose → apply → undo", () => {
  it("sick until Wednesday: proposing changes nothing, applying re-plans as one coach revision, undo puts it back", async () => {
    const commands = await signedInOwner("2026-10-12");
    await upperLowerBlock(commands);

    const proposal = readable(await commands.proposeCoachChange({
      action: { type: "mark_unavailable", startDate: "2026-10-12", endDate: "2026-10-14", note: "Sick" },
      reason: "You said you're sick until Thursday.",
    }));

    expect(proposal).toMatchObject({
      source: "coach",
      status: "proposed",
      summary: "Unavailable Monday, Oct 12 to Wednesday, Oct 14 (Sick)",
      reasons: ["You said you're sick until Thursday.", "Lower Body A moves to Saturday", "Chest Upper moves to Sunday"],
    });
    expect(proposal.diff.map((d) => d.type === "session" && [d.sessionName, d.before?.date, d.after?.date])).toEqual([
      ["Lower Body A", "2026-10-12", "2026-10-17"],
      ["Chest Upper", "2026-10-13", "2026-10-18"],
    ]);
    // Nothing changed yet.
    expect(await week(commands)).toEqual(AS_DESIGNED);
    expect((await commands.listUnavailability({})).unavailability).toEqual([]);
    expect(readable(await commands.listPlanRevisions({})).revisions).toEqual([]);

    const applied = readable(await commands.applyCoachChange({ id: proposal.id }));

    expect(applied).toMatchObject({ id: proposal.id, source: "coach", status: "applied", summary: proposal.summary });
    expect(await week(commands)).toEqual([
      ["2026-10-12", null],
      ["2026-10-13", null],
      ["2026-10-14", null],
      ["2026-10-15", "Hamstring Lower"],
      ["2026-10-16", "Back Upper"],
      ["2026-10-17", "Lower Body A"],
      ["2026-10-18", "Chest Upper"],
    ]);
    // One "Plan updated" card from the coach (the moves it caused are folded into it), announced in the inbox.
    expect(readable(await commands.listPlanRevisions({})).revisions.map((r) => [r.summary, r.source, r.status])).toEqual([
      [proposal.summary, "coach", "applied"],
    ]);
    const { entries } = readable(await commands.listInbox({}));
    const items = entries.flatMap((e) => (e.type === "item" ? [e.item] : e.items));
    expect(items.map((i) => [i.title, i.url])).toEqual([[proposal.summary, `/plan-changes/${proposal.id}`]]);

    // Applying twice is refused.
    await expect(commands.applyCoachChange({ id: proposal.id })).rejects.toMatchObject({ code: "conflict" });

    await commands.undoPlanRevision({ id: proposal.id });

    expect(await week(commands)).toEqual(AS_DESIGNED);
    expect((await commands.listUnavailability({})).unavailability).toEqual([]);
    expect(readable(await commands.listPlanRevisions({})).revisions.map((r) => [r.summary, r.status])).toEqual([
      [proposal.summary, "undone"],
    ]);

    // The same change can be proposed and applied again later.
    const again = readable(await commands.proposeCoachChange({
      action: { type: "mark_unavailable", startDate: "2026-10-12", endDate: "2026-10-14" },
    }));
    await commands.applyCoachChange({ id: again.id });
    expect((await week(commands)).at(-1)).toEqual(["2026-10-18", "Chest Upper"]);
  });

  it("a race and a run plan anchored to it; moving the race moves the runs; each undoes on its own", async () => {
    const commands = await signedInOwner("2026-10-12");
    const approve = async (action: Parameters<Commands["proposeCoachChange"]>[0]["action"]) =>
      readable(await commands.applyCoachChange({ id: (await commands.proposeCoachChange({ action })).id }));

    const addRace = await approve({ type: "add_race", name: "Fall Half", date: "2026-11-15", distanceMeters: 21_097, priority: "A" });
    expect(addRace).toMatchObject({ summary: "New A race: Fall Half on Sunday, Nov 15", status: "applied", source: "coach" });
    const [race] = (await commands.listRaces({})).races;

    const runs = [];
    for (let w = 1; w <= 3; w++) {
      runs.push({ week: w, day: "tue", type: "easy", distance_m: 6000 });
      runs.push(w === 3 ? { week: w, day: "sun", type: "race", distance_m: 21_097 } : { week: w, day: "sun", type: "long", distance_m: 14_000 });
    }
    // Same format as file import; anchored to the A race; time zone defaults to the plan's.
    const importPlan = readable(await commands.proposeCoachChange({
      action: { type: "import_run_plan", format: "json", content: JSON.stringify({ name: "Three weeks", runs }) },
    }));
    expect(importPlan).toMatchObject({
      summary: "Run plan: Three weeks (3 weeks) for Fall Half",
      reasons: ["6 planned runs added"],
    });
    expect((await commands.listRunPlans({})).plans).toEqual([]);
    await commands.applyCoachChange({ id: importPlan.id });
    const [plan] = (await commands.listRunPlans({})).plans;
    expect(plan).toMatchObject({ name: "Three weeks", raceId: race!.id, startDate: "2026-10-27", endDate: "2026-11-15" });

    const moveRace = await approve({ type: "update_race", id: race!.id, date: "2026-11-22" });
    expect(moveRace.summary).toBe("Fall Half moves to Sunday, Nov 22");
    expect((await commands.listRunPlans({})).plans[0]).toMatchObject({ startDate: "2026-11-03", endDate: "2026-11-22" });

    await commands.undoPlanRevision({ id: moveRace.id });
    expect((await commands.listRaces({})).races).toMatchObject([{ name: "Fall Half", date: "2026-11-15", priority: "A" }]);
    expect((await commands.listRunPlans({})).plans[0]).toMatchObject({ startDate: "2026-10-27", endDate: "2026-11-15" });

    await commands.undoPlanRevision({ id: importPlan.id });
    expect((await commands.listRunPlans({})).plans).toEqual([]);

    await commands.undoPlanRevision({ id: addRace.id });
    expect((await commands.listRaces({})).races).toEqual([]);
  });

  it("re-importing replaces the race's plan; undo brings the old plan back", async () => {
    const commands = await signedInOwner("2026-10-12");
    await commands.createRace({ name: "Fall Half", date: "2026-11-15", distanceMeters: 21_097, priority: "A" });
    const plan = (name: string, meters: number) =>
      JSON.stringify({ name, runs: [{ week: 1, day: "sun", type: "race", distance_m: meters }] });
    await commands.importRunPlan({ format: "json", content: plan("Old", 21_000), timeZone: LA });

    const replace = readable(await commands.proposeCoachChange({
      action: { type: "import_run_plan", format: "json", content: plan("New", 21_097) },
    }));
    await commands.applyCoachChange({ id: replace.id });
    expect((await commands.listRunPlans({})).plans.map((p) => p.name)).toEqual(["New"]);

    await commands.undoPlanRevision({ id: replace.id });
    expect((await commands.listRunPlans({})).plans.map((p) => p.name)).toEqual(["Old"]);
    const [old] = (await commands.listRunPlans({})).plans;
    expect((await commands.getRunPlan({ id: old!.id })).plannedRuns).toMatchObject([
      { date: "2026-11-15", type: "race", distanceMeters: 21_000 },
    ]);
  });

  it("undo leaves alone what changed since: a race edited after the coach moved it keeps its edit", async () => {
    const commands = await signedInOwner("2026-10-12");
    const race = await commands.createRace({ name: "Fall Half", date: "2026-11-15", distanceMeters: 21_097, priority: "A" });
    const move = readable(await commands.proposeCoachChange({ action: { type: "update_race", id: race.id, date: "2026-11-22" } }));
    await commands.applyCoachChange({ id: move.id });
    await commands.updateRace({ ...race, date: "2026-11-29" });

    await commands.undoPlanRevision({ id: move.id });

    expect((await commands.listRaces({})).races).toMatchObject([{ date: "2026-11-29" }]);
  });

  it("propose refuses what the command would refuse, leaving nothing behind; apply needs a proposed coach change", async () => {
    const commands = await signedInOwner("2026-10-12");
    await expect(
      commands.proposeCoachChange({ action: { type: "import_run_plan", format: "json", content: JSON.stringify({ runs: [] }) } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      commands.proposeCoachChange({ action: { type: "mark_unavailable", startDate: "2026-10-14", endDate: "2026-10-12" } }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      commands.proposeCoachChange({ action: { type: "update_race", id: crypto.randomUUID(), date: "2026-11-22" } }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(readable(await commands.listPlanRevisions({ status: ["proposed"] })).revisions).toEqual([]);

    await expect(commands.applyCoachChange({ id: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
    // An engine revision is not a coach proposal.
    await upperLowerBlock(commands);
    await commands.markUnavailable({ startDate: "2026-10-12", endDate: "2026-10-12" });
    const [engineChange] = readable(await commands.listPlanRevisions({})).revisions;
    await expect(commands.applyCoachChange({ id: engineChange!.id })).rejects.toMatchObject({ code: "not_found" });

    const anon = db().commandsAs({ kind: "anon" });
    await expect(
      anon.proposeCoachChange({ action: { type: "mark_unavailable", startDate: "2026-10-12", endDate: "2026-10-12" } }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});
