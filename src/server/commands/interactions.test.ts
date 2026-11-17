import { describe, expect, it } from "vitest";
import { exerciseDiffs as ex } from "@/domain/plan-change";
import { planBlocks, type EngineInput } from "@/engine/plan";
import { setupTestDb } from "../../../tests/db/test-db";
import type { Engine } from ".";
import { readable } from "../../../tests/readable";

const db = setupTestDb();

/** The real engine with `today` pinned, so tests don't depend on the clock. */
const engineOn =
  (today: string): Engine =>
  (input: EngineInput) =>
    planBlocks({ ...input, today });

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id }, { engine: engineOn("2027-03-15") });
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

const LA = "America/Los_Angeles";

/** A synthetic 18-week plan (JSON): Tue easy, Sat race pace, Sun long run; the race in week 18. */
function marathonPlanJson() {
  const runs = [];
  for (let week = 1; week <= 18; week++) {
    runs.push({ week, day: "tue", type: "easy", distance_m: 4828 });
    runs.push({ week, day: "sat", type: "race_pace", distance_m: 8047 });
    runs.push(
      week === 18
        ? { week, day: "sun", type: "race", distance_m: 42_195 }
        : { week, day: "sun", type: "long", distance_m: 9656 + week * 800 },
    );
  }
  return JSON.stringify({ name: "Synthetic Marathon 18", runs });
}

/** A 6-week block from Monday 2027-03-22 (deload in week 4): Machine Bench Press on Tuesday, Seated Leg Curl on Saturday. */
async function createBlock(commands: Commands) {
  const id = async (name: string) =>
    (await commands.listExercises({ query: name })).items.find((e) => e.name === name)!.id;
  const exercise = (exerciseId: string, startWeight: number) => ({
    exerciseId,
    sets: 3,
    repRangeStart: 10,
    repRangeEnd: 15,
    startWeight,
  });
  return commands.createBlock({
    name: "Upper/Lower",
    startDate: "2027-03-22",
    weeks: 6,
    timeZone: LA,
    deloadWeeks: [4],
    sessions: [
      { name: "Chest Upper", weekday: 2, exercises: [exercise(await id("Machine Bench Press"), 180)] },
      { name: "Hamstring Lower", weekday: 6, exercises: [exercise(await id("Seated Leg Curl"), 100)] },
    ],
  });
}

async function deloadWeeks(commands: Commands, blockId: string) {
  const { plannedSessions } = readable(await commands.getBlock({ id: blockId }));
  return [...new Set(plannedSessions.filter((s) => s.deload).map((s) => s.week))];
}

/** Seated Leg Curl's planned sets on a Saturday, as [weight, reps]. */
async function legCurl(commands: Commands, date: string) {
  const { session } = readable(await commands.getToday({ date }));
  return session!.exercises[0]!.sets.map((s) => [s.weight, s.reps]);
}

describe("running/lifting interaction rules through the command layer", () => {
  it("races and run plans re-plan lifting: deloads line up with the race, legs back off for peak weeks and long runs", async () => {
    const commands = await signedInOwner();
    const block = await createBlock(commands);
    expect(await deloadWeeks(commands, block.id)).toEqual([4]);
    expect(await legCurl(commands, "2027-03-27")).toEqual([
      [100, 10],
      [100, 10],
      [100, 10],
    ]);

    // An A race in week 5 moves the deload — it touches race week, so once the owner confirms.
    const race = await commands.createRace({
      name: "Spring Marathon",
      date: "2027-04-25",
      distanceMeters: 42_195,
      priority: "A",
    });
    expect(await deloadWeeks(commands, block.id)).toEqual([4]);
    const [pending] = readable(await commands.listPlanRevisions({ status: ["pending"] })).revisions;
    await commands.confirmPlanRevision({ id: pending!.id });
    expect(await deloadWeeks(commands, block.id)).toEqual([5, 6]);

    // The run plan: plan weeks 14–17 (block weeks 1–4) are peak mileage, and every Saturday is a long-run eve.
    // Importing it plans lifting around it at once, as part of first planning it: nothing to confirm or announce.
    const inbox = readable(await commands.listInbox({})).entries.length;
    await commands.importRunPlan({ format: "json", content: marathonPlanJson(), timeZone: LA });
    expect(await legCurl(commands, "2027-03-27")).toEqual([
      [85, 10],
      [85, 10],
    ]);
    // Upper body untouched.
    expect(readable(await commands.getToday({ date: "2027-03-23" })).session!.exercises[0]!.sets).toHaveLength(3);

    const { revisions } = readable(await commands.listPlanRevisions({}));
    expect(revisions.map((r) => [r.summary, r.status])).toEqual([
      ["Deload moves from week 4 to weeks 5–6 to line up with Spring Marathon", "applied"],
    ]);
    expect(readable(await commands.listInbox({})).entries).toHaveLength(inbox);
    const initial = readable(await commands.listPlanRevisions({ status: ["initial"], limit: 200 })).revisions;
    expect(initial.map((r) => r.summary)).toContain("Less leg volume in week 1: peak mileage");
    const firstEve = initial.find((r) => r.key.startsWith("long-run-eve:") && ex(r)[0]!.date === "2027-03-27");
    expect(firstEve!.reasons).toEqual([
      "The 13 mi long run is the next day, so lower-body loads come down to about 85% to keep your legs fresh for it",
    ]);
    // Re-planning again (e.g. a finished workout) doesn't duplicate them.
    await commands.updateRace({ ...race });
    expect(readable(await commands.listPlanRevisions({})).revisions).toHaveLength(revisions.length);

    // No race, no run plan: the block is back to the owner's own plan.
    await commands.deleteRace({ id: race.id });
    expect(await deloadWeeks(commands, block.id)).toEqual([4]);
    expect(await legCurl(commands, "2027-03-27")).toEqual([
      [100, 10],
      [100, 10],
      [100, 10],
    ]);
  });

  it("an adjustment on the day before a race waits for confirmation; undoing it keeps it off on later re-plans", async () => {
    const commands = await signedInOwner();
    await createBlock(commands);
    // A B race (no deload alignment) with its run plan; then the race moves a week later, to Sunday 2027-05-02.
    const race = await commands.createRace({ name: "Spring Half", date: "2027-04-25", distanceMeters: 21_098, priority: "B" });
    await commands.importRunPlan({ format: "json", content: marathonPlanJson(), raceId: race.id, timeZone: LA });
    expect(await legCurl(commands, "2027-05-01")).toEqual([
      [100, 10],
      [100, 10],
      [100, 10],
    ]);
    await commands.updateRace({ ...race, date: "2027-05-02" });

    // Saturday 2027-05-01 is now the race's eve, in race week: the owner confirms the lighter session.
    const pending = readable(await commands.listPlanRevisions({ status: ["pending"] })).revisions;
    const eve = pending.find((r) => r.key === `long-run-eve:${ex(r)[0]?.blockSessionId}:2027-05-01`)!;
    expect(eve).toMatchObject({ summary: "Hamstring Lower lightened before the race" });
    expect(await legCurl(commands, "2027-05-01")).toEqual([
      [100, 10],
      [100, 10],
      [100, 10],
    ]);
    await commands.confirmPlanRevision({ id: eve.id });
    expect(await legCurl(commands, "2027-05-01")).toEqual([
      [85, 10],
      [85, 10],
      [85, 10],
    ]);

    await commands.undoPlanRevision({ id: eve.id });
    await commands.updateRace({ ...race, date: "2027-05-02" });
    expect(await legCurl(commands, "2027-05-01")).toEqual([
      [100, 10],
      [100, 10],
      [100, 10],
    ]);
  });
});
