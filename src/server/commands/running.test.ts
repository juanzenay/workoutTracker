import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

describe("races", () => {
  it("add, edit and delete races with priority A/B/C, listed by date", async () => {
    const commands = await signedInOwner();

    const marathon = await commands.createRace({ name: "Spring Marathon", date: "2027-04-25", distanceMeters: 42_195, priority: "A" });
    await commands.createRace({ name: "Tune-up Half", date: "2027-03-14", distanceMeters: 21_098, priority: "B" });
    expect(marathon).toMatchObject({ name: "Spring Marathon", date: "2027-04-25", distanceMeters: 42_195, priority: "A" });

    await commands.updateRace({ id: marathon.id, name: "Spring Marathon", date: "2027-05-02", distanceMeters: 42_195, priority: "A" });
    expect((await commands.listRaces({})).races.map((r) => [r.name, r.date, r.priority])).toEqual([
      ["Tune-up Half", "2027-03-14", "B"],
      ["Spring Marathon", "2027-05-02", "A"],
    ]);

    await commands.deleteRace({ id: marathon.id });
    expect((await commands.listRaces({})).races.map((r) => r.name)).toEqual(["Tune-up Half"]);
    await expect(commands.deleteRace({ id: marathon.id })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects an unknown priority or a non-positive distance", async () => {
    const commands = await signedInOwner();
    await expect(
      commands.createRace({ name: "X", date: "2027-04-25", distanceMeters: 5000, priority: "D" as "A" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(commands.createRace({ name: "X", date: "2027-04-25", distanceMeters: 0, priority: "A" })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });

  it("anonymous callers cannot see races", async () => {
    const commands = await signedInOwner();
    await commands.createRace({ name: "Spring Marathon", date: "2027-04-25", distanceMeters: 42_195, priority: "A" });
    const anon = db().commandsAs({ kind: "anon" });
    await expect(anon.listRaces({})).resolves.toEqual({ races: [] });
  });
});

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

const LA = "America/Los_Angeles";

/** A synthetic 18-week plan file (JSON): cross, easy, rest, race pace and a Sunday long run; the race in week 18. */
function marathonPlanJson() {
  const runs = [];
  for (let week = 1; week <= 18; week++) {
    runs.push({ week, day: "mon", type: "cross", duration_s: 2700, notes: "bike or swim" });
    runs.push({ week, day: "tue", type: "easy", distance_m: 4828 });
    runs.push({ week, day: "fri", type: "rest" });
    runs.push({ week, day: "sat", type: "race_pace", distance_m: 8047, pace_target: { per_km_s: [326, 336] } });
    runs.push(
      week === 18
        ? { week, day: "sun", type: "race", distance_m: 42_195 }
        : { week, day: "sun", type: "long", distance_m: 9656 + week * 800 },
    );
  }
  return JSON.stringify({ name: "Synthetic Marathon 18", runs });
}

async function addMarathon(commands: Commands) {
  return commands.createRace({ name: "Spring Marathon", date: "2027-04-25", distanceMeters: 42_195, priority: "A" });
}

describe("run plan import", () => {
  it("imports a JSON plan and anchors its final week to the A race week", async () => {
    const commands = await signedInOwner();
    const race = await addMarathon(commands);

    const { plan } = await commands.importRunPlan({ format: "json", content: marathonPlanJson(), timeZone: LA });
    expect(plan).toMatchObject({ name: "Synthetic Marathon 18", weeks: 18, raceId: race.id });

    const { plannedRuns } = await commands.getRunPlan({ id: plan.id });
    expect(plannedRuns).toHaveLength(18 * 5);
    expect(plannedRuns[0]).toMatchObject({ date: "2026-12-21", week: 1, type: "cross", durationSeconds: 2700, notes: "bike or swim" });
    expect(plannedRuns[3]).toMatchObject({
      date: "2026-12-26",
      type: "race_pace",
      distanceMeters: 8047,
      paceTarget: { perKmSeconds: [326, 336] },
    });
    expect(plannedRuns.at(-1)).toMatchObject({ date: "2027-04-25", week: 18, type: "race", distanceMeters: 42_195 });
    expect((await commands.listRunPlans({})).plans.map((p) => [p.name, p.race?.name])).toEqual([
      ["Synthetic Marathon 18", "Spring Marathon"],
    ]);
  });

  it("imports CSV in miles and min/mile, with a structured interval session", async () => {
    const commands = await signedInOwner();
    await commands.createRace({ name: "City 10K", date: "2027-03-07", distanceMeters: 10_000, priority: "A" });
    const structure = JSON.stringify({
      warmup: { distance_m: 1609, intensity: { kind: "hr_zone", zone: 2 } },
      repeats: [
        {
          count: 6,
          steps: [
            { kind: "work", distance_m: 800, intensity: { kind: "pace", pace: "6:40-6:55/mi" } },
            { kind: "recovery", distance_m: 400 },
          ],
        },
      ],
      cooldown: { duration_s: 600 },
    });
    const csv = [
      "week,day,type,distance_mi,duration_min,pace,structure,notes",
      "1,Tue,easy,3,,9:00-9:30/mi,,",
      `1,wed,intervals,,,,"${structure.replaceAll('"', '""')}","6 x 800, with ""jog"" recoveries"`,
      "1,thu,cross,,30,,,",
      "2,sun,race,6.2,,,,Race day",
    ].join("\n");

    const { plan } = await commands.importRunPlan({ format: "csv", content: csv, name: "10K plan", timeZone: LA });
    expect(plan).toMatchObject({ name: "10K plan", weeks: 2, startDate: "2027-02-23", endDate: "2027-03-07" });

    const { plannedRuns } = await commands.getRunPlan({ id: plan.id });
    expect(plannedRuns.map((r) => [r.date, r.type, r.distanceMeters, r.durationSeconds])).toEqual([
      ["2027-02-23", "easy", 4828, null],
      ["2027-02-24", "intervals", null, null],
      ["2027-02-25", "cross", null, 1800],
      ["2027-03-07", "race", 9978, null],
    ]);
    expect(plannedRuns[0]!.paceTarget).toEqual({ perKmSeconds: [335.5, 354.2] }); // 9:00 and 9:30 /mi
    expect(plannedRuns[1]).toMatchObject({
      notes: '6 x 800, with "jog" recoveries',
      structure: {
        warmup: { distanceMeters: 1609, intensity: { kind: "hr_zone", zone: 2 } },
        repeats: [
          {
            count: 6,
            steps: [
              { kind: "work", distanceMeters: 800, intensity: { kind: "pace", perKmSeconds: [248.5, 257.9] } },
              { kind: "recovery", distanceMeters: 400 },
            ],
          },
        ],
        cooldown: { durationSeconds: 600 },
      },
    });
  });

  it("reports every invalid row clearly and imports nothing", async () => {
    const commands = await signedInOwner();
    await addMarathon(commands);
    const csv = [
      "week,day,type,distance_mi,duration_min,pace,structure,notes",
      "1,tue,easy,3,,,,",
      "1,funday,easy,3,,,,",
      "0,wed,jog,3,,,,",
      "1,thu,easy,,,,,",
      "1,fri,rest,2,,,,",
      "1,sat,tempo,5,,8:30,,",
      '2,sun,intervals,,,,"{""repeats"":[{""count"":30,""steps"":[{""kind"":""work"",""distance_m"":400}]}]}",',
    ].join("\n");

    const error = await commands.importRunPlan({ format: "csv", content: csv, timeZone: LA }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "invalid_input", message: "The plan has 6 problems" });
    expect((error as { details: { errors: { row: number; message: string }[] } }).details.errors).toEqual([
      { row: 2, message: "day must be mon, tue, wed, thu, fri, sat or sun" },
      { row: 3, message: "week must be 1 or more; type must be one of easy, long, tempo, intervals, race_pace, cross, rest, race" },
      { row: 4, message: "easy run needs a distance, a duration or a structure" },
      { row: 5, message: "a rest day has no distance or duration" },
      { row: 6, message: 'pace "8:30" should look like 8:30/mi, 8:20-8:40/mi or 5:10/km' },
      { row: 7, message: expect.stringMatching(/^structure\.repeats\.0\.count: /) },
    ]);
    expect((await commands.listRunPlans({})).plans).toEqual([]);
  });

  it("rejects a file that is not JSON, has unknown columns, or has no rows", async () => {
    const commands = await signedInOwner();
    await addMarathon(commands);
    const errorsOf = (format: "csv" | "json", content: string) =>
      commands
        .importRunPlan({ format, content, timeZone: LA })
        .catch((e: { details: { errors: unknown[] } }) => e.details.errors);

    expect(await errorsOf("json", "{nope")).toEqual([{ row: 0, message: "The file is not valid JSON" }]);
    expect(await errorsOf("csv", "week,day,kind\n1,mon,easy")).toEqual([{ row: 0, message: "Unknown column(s): kind" }]);
    expect(await errorsOf("json", '{"runs": []}')).toEqual([{ row: 0, message: "The plan has no runs" }]);
  });

  it("needs an A race to anchor to", async () => {
    const commands = await signedInOwner();
    await commands.createRace({ name: "Tune-up Half", date: "2027-03-14", distanceMeters: 21_098, priority: "B" });
    await expect(commands.importRunPlan({ format: "json", content: marathonPlanJson(), timeZone: LA })).rejects.toMatchObject({
      code: "invalid_input",
      message: "Add an A race first: the plan anchors to it",
    });
  });

  it("re-anchors when the race moves, unplans when it is deleted, and a re-import replaces the plan", async () => {
    const commands = await signedInOwner();
    const race = await addMarathon(commands);
    const { plan } = await commands.importRunPlan({ format: "json", content: marathonPlanJson(), timeZone: LA });
    const before = (await commands.getRunPlan({ id: plan.id })).plannedRuns;

    await commands.updateRace({ ...race, date: "2027-05-09" });
    const after = (await commands.getRunPlan({ id: plan.id })).plannedRuns;
    expect(after[0]).toMatchObject({ id: before[0]!.id, date: "2027-01-04" });
    expect(after.at(-1)).toMatchObject({ date: "2027-05-09", type: "race" });

    const { plan: again } = await commands.importRunPlan({ format: "json", content: marathonPlanJson(), name: "v2", timeZone: LA });
    expect((await commands.listRunPlans({})).plans.map((p) => p.id)).toEqual([again.id]);

    await commands.deleteRace({ id: race.id });
    expect(await commands.getRunPlan({ id: again.id })).toMatchObject({ plan: { raceId: null, startDate: null }, plannedRuns: [] });
  });
});

describe("today with a run plan", () => {
  it("shows the day's planned run with type, distance and pace target, alongside lifting", async () => {
    const commands = await signedInOwner();
    await addMarathon(commands);
    await commands.importRunPlan({ format: "json", content: marathonPlanJson(), timeZone: LA });

    const saturday = await commands.getToday({ date: "2026-12-26" });
    expect(saturday.runs).toMatchObject([{ type: "race_pace", distanceMeters: 8047, paceTarget: { perKmSeconds: [326, 336] }, week: 1 }]);
    expect(saturday.block).toBeNull();
    expect(saturday.plan).toMatchObject({ name: "Synthetic Marathon 18", week: 1, weeks: 18, race: { name: "Spring Marathon" } });

    expect((await commands.getToday({ date: "2026-12-24" })).runs).toEqual([]);
    expect((await commands.getToday({ date: "2026-12-01" })).plan).toBeNull();
  });
});
