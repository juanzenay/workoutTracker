import { describe, expect, it } from "vitest";
import { planBlocks, type EngineInput } from "@/engine/plan";
import { setupTestDb } from "../../../tests/db/test-db";
import type { Engine } from ".";
import { readable, text } from "../../../tests/readable";

const db = setupTestDb();

/** The real engine with `today` pinned, so tests don't depend on the clock. */
const engineOn =
  (today: string): Engine =>
  (input: EngineInput) =>
    planBlocks({ ...input, today });

const LA = "America/Los_Angeles";

/** The owner's command layer on `today` (engine and clock pinned: noon in Los Angeles). */
function ownerOn(userId: string, today: string) {
  return db().commandsAs({ kind: "user", userId }, { engine: engineOn(today), now: new Date(`${today}T19:00:00Z`) });
}

async function signedInOwner(today: string) {
  const owner = await db().signUp("owner@example.com");
  return { commands: ownerOn(owner.id, today), on: (day: string) => ownerOn(owner.id, day) };
}

type Commands = ReturnType<typeof ownerOn>;

/** A 4-week upper/lower block from Monday 2026-10-12: Lower Body A Mon, Chest Upper Tue, Hamstring Lower Thu, Back Upper Fri. */
async function upperLowerBlock(commands: Commands, startDate = "2026-10-12", weeks = 4, deloadWeeks: number[] = []) {
  const id = async (name: string) =>
    (await commands.listExercises({ query: name })).items.find((e) => e.name === name)!.id;
  const one = async (name: string, startWeight: number) => [
    { exerciseId: await id(name), sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight },
  ];
  return commands.createBlock({
    name: "Upper/Lower",
    startDate,
    weeks,
    timeZone: LA,
    deloadWeeks,
    sessions: [
      { name: "Lower Body A", weekday: 1, exercises: await one("Leg Press", 270) },
      { name: "Chest Upper", weekday: 2, exercises: await one("Machine Bench Press", 180) },
      { name: "Hamstring Lower", weekday: 4, exercises: await one("Seated Leg Curl", 130) },
      { name: "Back Upper", weekday: 5, exercises: await one("Seated Cable Rows", 150) },
    ],
  });
}

/** Session names by date over `dates`. */
async function week(commands: Commands, dates: string[]) {
  const out: [string, string | null][] = [];
  for (const date of dates) out.push([date, readable(await commands.getToday({ date })).session?.name ?? null]);
  return out;
}

const WEEK_1 = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"];

describe("Mark unavailable", () => {
  it("sick until Thursday: the plan re-plans around the days, as an undoable revision", async () => {
    const { commands } = await signedInOwner("2026-10-12");
    await upperLowerBlock(commands);

    const unavailable = await commands.markUnavailable({ startDate: "2026-10-12", endDate: "2026-10-14", note: "Sick" });

    expect(unavailable).toMatchObject({ startDate: "2026-10-12", endDate: "2026-10-14", note: "Sick" });
    expect((await commands.listUnavailability({})).unavailability).toEqual([unavailable]);
    expect(await week(commands, WEEK_1)).toEqual([
      ["2026-10-12", null],
      ["2026-10-13", null],
      ["2026-10-14", null],
      ["2026-10-15", "Hamstring Lower"],
      ["2026-10-16", "Back Upper"],
      ["2026-10-17", "Lower Body A"],
      ["2026-10-18", "Chest Upper"],
    ]);
    const { revisions } = readable(await commands.listPlanRevisions({}));
    expect(revisions.map((r) => [r.summary, r.status]).sort()).toEqual([
      ["Chest Upper moves to Sunday", "applied"],
      ["Lower Body A moves to Saturday", "applied"],
    ]);

    // One tap: Lower Body A is back on Monday, and stays there on later re-plans.
    await commands.undoPlanRevision({ id: revisions.find((r) => text(r.summary).startsWith("Lower"))!.id });
    expect((await week(commands, WEEK_1)).filter(([, name]) => name === "Lower Body A")).toEqual([["2026-10-12", "Lower Body A"]]);
    await commands.markUnavailable({ startDate: "2026-11-30", endDate: "2026-11-30" }); // any re-plan
    expect((await week(commands, WEEK_1)).filter(([, name]) => name === "Lower Body A")).toEqual([["2026-10-12", "Lower Body A"]]);

    // Clearing the days puts the week back as designed.
    await commands.clearUnavailable({ id: unavailable.id });
    expect(await week(commands, WEEK_1)).toEqual([
      ["2026-10-12", "Lower Body A"],
      ["2026-10-13", "Chest Upper"],
      ["2026-10-14", null],
      ["2026-10-15", "Hamstring Lower"],
      ["2026-10-16", "Back Upper"],
      ["2026-10-17", null],
      ["2026-10-18", null],
    ]);
  });

  it("days more than a week ahead wait for confirmation; confirming applies them", async () => {
    const { commands } = await signedInOwner("2026-10-12");
    await upperLowerBlock(commands);

    await commands.markUnavailable({ startDate: "2026-10-28", endDate: "2026-11-01" });

    expect(await week(commands, ["2026-10-29", "2026-10-30"])).toEqual([
      ["2026-10-29", "Hamstring Lower"],
      ["2026-10-30", "Back Upper"],
    ]);
    const pending = readable(await commands.listPlanRevisions({ status: ["pending"] })).revisions;
    expect(pending.map((r) => r.summary).sort()).toEqual(["Back Upper dropped this week", "Hamstring Lower dropped this week"]);

    for (const r of pending) readable(await commands.confirmPlanRevision({ id: r.id }));
    expect(await week(commands, ["2026-10-29", "2026-10-30"])).toEqual([
      ["2026-10-29", null],
      ["2026-10-30", null],
    ]);
  });

  it("rejects a range that ends before it starts, and is the owner's alone", async () => {
    const { commands } = await signedInOwner("2026-10-12");
    await expect(commands.markUnavailable({ startDate: "2026-10-14", endDate: "2026-10-12" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    const anon = db().commandsAs({ kind: "anon" });
    await expect(anon.markUnavailable({ startDate: "2026-10-12", endDate: "2026-10-12" })).rejects.toMatchObject({
      code: "unauthorized",
    });
  });
});

describe("re-plan triggers", () => {
  it("a missed session: the daily job moves it to the next free day that week", async () => {
    const { commands, on } = await signedInOwner("2026-10-12");
    await upperLowerBlock(commands);

    // Tuesday: Monday's Lower Body A was never logged.
    const tuesday = on("2026-10-13");
    await tuesday.refreshRunStatuses({});

    expect((await week(tuesday, WEEK_1)).slice(0, 3)).toEqual([
      ["2026-10-12", null],
      ["2026-10-13", "Chest Upper"],
      ["2026-10-14", "Lower Body A"],
    ]);
    expect(readable(await tuesday.listPlanRevisions({})).revisions).toMatchObject([
      {
        summary: "Lower Body A moves to Wednesday",
        reasons: ["Lower Body A on Monday, Oct 12 was missed, so it moves to Wednesday, Oct 14, the next free day this week"],
        status: "applied",
      },
    ]);
  });

  it("a missed long run (Strava connected, no run that day) moves the next day, undoably", async () => {
    const { commands, on } = await signedInOwner("2026-10-18");
    await commands.connectStrava({ code: "auth-code-1", scope: "read,activity:write,activity:read_all" });
    const race = await commands.createRace({ name: "Fall Half", date: "2026-11-15", distanceMeters: 21_097, priority: "A" });
    const runs = [];
    for (let w = 1; w <= 5; w++) {
      runs.push({ week: w, day: "tue", type: "easy", distance_m: 6000 });
      runs.push(w === 5 ? { week: w, day: "sun", type: "race", distance_m: 21_097 } : { week: w, day: "sun", type: "long", distance_m: 14_000 });
    }
    const { plan } = await commands.importRunPlan({
      format: "json",
      content: JSON.stringify({ name: "Five weeks", runs }),
      raceId: race.id,
      timeZone: LA,
    });
    const longRuns = async (c: Commands) =>
      (await c.getRunPlan({ id: plan.id })).plannedRuns.filter((r) => r.week === 1).map((r) => [r.date, r.type, r.status]);
    expect(await longRuns(commands)).toEqual([
      ["2026-10-13", "easy", "missed"],
      ["2026-10-18", "long", null],
    ]);

    // Monday: the daily job closes Sunday with no run.
    const monday = on("2026-10-19");
    await monday.refreshRunStatuses({});

    expect(await longRuns(monday)).toEqual([
      ["2026-10-13", "easy", "missed"],
      ["2026-10-19", "long", null],
    ]);
    const [move] = readable(await monday.listPlanRevisions({})).revisions;
    expect(move).toMatchObject({ summary: "Missed long run moves to Monday", status: "applied" });

    await monday.undoPlanRevision({ id: move!.id });
    expect(await longRuns(monday)).toEqual([
      ["2026-10-13", "easy", "missed"],
      ["2026-10-18", "long", "missed"],
    ]);
    await monday.refreshRunStatuses({});
    expect((await longRuns(monday))[1]).toEqual(["2026-10-18", "long", "missed"]);
  });

  it("race moved two weeks earlier: the race-week deload waits for confirmation, then applies", async () => {
    const { commands } = await signedInOwner("2027-03-15");
    const block = await upperLowerBlock(commands, "2027-03-22", 6, [4]);
    const deloadWeeks = async () => {
      const { plannedSessions } = readable(await commands.getBlock({ id: block.id }));
      return [...new Set(plannedSessions.filter((s) => s.deload).map((s) => s.week))];
    };
    const race = await commands.createRace({ name: "Spring Marathon", date: "2027-04-25", distanceMeters: 42_195, priority: "A" });
    expect(await deloadWeeks()).toEqual([4]);
    const [first] = readable(await commands.listPlanRevisions({ status: ["pending"] })).revisions;
    expect(first!.summary).toBe("Deload moves from week 4 to weeks 5–6 to line up with Spring Marathon");

    await commands.updateRace({ ...race, date: "2027-04-11" });

    const { revisions } = readable(await commands.listPlanRevisions({}));
    expect(revisions.map((r) => [r.summary, r.status])).toEqual([
      ["Week 3 becomes a deload to line up with Spring Marathon", "pending"],
      ["Deload moves from week 4 to weeks 5–6 to line up with Spring Marathon", "superseded"],
    ]);
    await commands.confirmPlanRevision({ id: revisions[0]!.id });
    expect(await deloadWeeks()).toEqual([3, 4]);
  });
});
