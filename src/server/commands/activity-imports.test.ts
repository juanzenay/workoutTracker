import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";
import { FIT_SPORT, fitActivity, gpxActivity } from "../../../tests/fixtures/run-files";

const db = setupTestDb();

const CHICAGO = "America/Chicago";
/** Mon 2026-10-12, noon in Chicago: the whole test week is over. */
const WEEK_OVER = new Date("2026-10-12T17:00:00Z");

/** A synthetic one-week plan for a race on Sun 2026-10-11: easy Tue 5 mi, tempo Thu 6 mi, rest Fri, long Sun 10 mi. */
const ONE_WEEK_PLAN = JSON.stringify({
  name: "Test Week",
  runs: [
    { week: 1, day: "tue", type: "easy", distance_m: 8047 },
    { week: 1, day: "thu", type: "tempo", distance_m: 9656 },
    { week: 1, day: "fri", type: "rest" },
    { week: 1, day: "sun", type: "long", distance_m: 16093 },
  ],
});

/** The owner (Strava never connected) with the test week planned. */
async function ownerWithPlan({ now = WEEK_OVER }: { now?: Date } = {}) {
  const owner = await db().signUp("owner@example.com");
  const commands = db().commandsAs({ kind: "user", userId: owner.id }, { now });
  const race = await commands.createRace({ name: "Tune-up 10K", date: "2026-10-11", distanceMeters: 10_000, priority: "B" });
  const { plan } = await commands.importRunPlan({ format: "json", content: ONE_WEEK_PLAN, raceId: race.id, timeZone: CHICAGO });
  return { commands, planId: plan.id };
}

type Commands = Awaited<ReturnType<typeof ownerWithPlan>>["commands"];

async function runsByDate(commands: Commands, planId: string) {
  const { plannedRuns } = await commands.getRunPlan({ id: planId });
  return Object.fromEntries(
    plannedRuns.map((r) => [`${r.date} ${r.type}`, { status: r.status, actualMeters: r.actualMeters, gapMeters: r.gapMeters }]),
  );
}

/** Sun 2026-10-11, 8:05 in Chicago: the long run, 10 mi in 1:25 (FIT, as the Coros app exports it). */
const longRunFit = () =>
  fitActivity({ start: "2026-10-11T13:05:00Z", utcOffsetHours: -5, meters: 16_120, movingSeconds: 5100, elapsedSeconds: 5160 });

describe("importing run files", () => {
  it("stores a FIT run and marks the day's planned run done", async () => {
    const { commands, planId } = await ownerWithPlan();

    const result = await commands.importActivityFiles({ files: [{ name: "long.fit", data: longRunFit() }] });

    expect(result.files).toEqual([
      { name: "long.fit", status: "imported", message: { code: "activityFileImported", date: "2026-10-11", meters: 16_120 } },
    ]);
    const { activities } = await commands.listActivities({});
    expect(activities).toEqual([
      expect.objectContaining({
        source: "file",
        sportType: "Run",
        startDate: "2026-10-11T13:05:00.000Z",
        localDate: "2026-10-11",
        distanceMeters: 16_120,
        movingSeconds: 5100,
        elapsedSeconds: 5160,
        plannedRunId: expect.any(String),
      }),
    ]);
    expect((await runsByDate(commands, planId))["2026-10-11 long"]).toEqual({
      status: "done",
      actualMeters: 16_120,
      gapMeters: null,
    });
  });

  it("stores a GPX run short of plan as partial, with the gap", async () => {
    const { commands, planId } = await ownerWithPlan();
    // Tue 2026-10-06, 6:30 in Chicago: 3 mi of the planned 5, with a 2-minute stop at a light.
    const gpx = gpxActivity({ start: "2026-10-06T11:30:00Z", meters: 4828, seconds: 1800, pauseSeconds: 120 });

    const result = await commands.importActivityFiles({ files: [{ name: "easy.gpx", data: gpx }] });

    expect(result.files).toEqual([
      { name: "easy.gpx", status: "imported", message: { code: "activityFileImported", date: "2026-10-06", meters: 4828 } },
    ]);
    const [activity] = (await commands.listActivities({})).activities;
    expect(activity).toMatchObject({ source: "file", name: "Morning Run", sportType: "Run", localDate: "2026-10-06" });
    expect(activity!.movingSeconds).toBe(1800);
    expect(activity!.elapsedSeconds).toBe(1920);
    expect((await runsByDate(commands, planId))["2026-10-06 easy"]).toEqual({
      status: "partial",
      actualMeters: 4828,
      gapMeters: 3219,
    });
  });
});

describe("importing the same run again", () => {
  it("never stores a run twice: the same file, or the same run in another format or export", async () => {
    const { commands, planId } = await ownerWithPlan();
    await commands.importActivityFiles({ files: [{ name: "long.fit", data: longRunFit() }] });

    // The same file again, and the same run as GPX (starting a few seconds apart) in an export with a new run.
    const sameRunGpx = gpxActivity({ start: "2026-10-11T13:05:04Z", meters: 16_100, seconds: 5100 });
    const tuesday = gpxActivity({ start: "2026-10-06T11:30:00Z", meters: 8100, seconds: 2700 });
    const result = await commands.importActivityFiles({
      files: [
        { name: "long.fit", data: longRunFit() },
        { name: "long.gpx", data: sameRunGpx },
        { name: "tue.gpx", data: tuesday },
        { name: "tue-again.gpx", data: tuesday },
      ],
    });

    expect(result.files.map((f) => [f.name, f.status])).toEqual([
      ["long.fit", "duplicate"],
      ["long.gpx", "duplicate"],
      ["tue.gpx", "imported"],
      ["tue-again.gpx", "duplicate"],
    ]);
    expect(result.files[0]!.message).toEqual({ code: "activityFileDuplicate", date: "2026-10-11" });
    expect((await commands.listActivities({})).activities.map((a) => a.localDate)).toEqual(["2026-10-11", "2026-10-06"]);
    expect(await runsByDate(commands, planId)).toMatchObject({
      "2026-10-06 easy": { status: "done", actualMeters: 8100 },
      "2026-10-11 long": { status: "done", actualMeters: 16_120 },
    });
  });
});

describe("files that aren't runs, or can't be read", () => {
  it("skips other sports with a note and fails a damaged file, importing the rest of the batch", async () => {
    const { commands, planId } = await ownerWithPlan();
    const ride = fitActivity({
      start: "2026-10-10T14:00:00Z",
      utcOffsetHours: -5,
      sport: FIT_SPORT.cycling,
      meters: 30_000,
      movingSeconds: 3600,
    });
    const truncated = longRunFit().subarray(0, 40);
    const walk = gpxActivity({ start: "2026-10-09T23:00:00Z", meters: 3000, seconds: 2400, type: "walking" });

    const result = await commands.importActivityFiles({
      files: [
        { name: "ride.fit", data: ride },
        { name: "broken.fit", data: truncated },
        { name: "notes.txt", data: new TextEncoder().encode("Ran 5 miles today") },
        { name: "walk.gpx", data: walk },
        { name: "long.fit", data: longRunFit() },
      ],
    });

    expect(result.files).toEqual([
      { name: "ride.fit", status: "skipped", message: { code: "activityFileNotRun", sport: "Ride", date: "2026-10-10" } },
      { name: "broken.fit", status: "failed", message: { code: "activityFileUnreadable", problem: "corrupt" } },
      { name: "notes.txt", status: "failed", message: { code: "activityFileUnreadable", problem: "format" } },
      // 18:00 in Chicago on Friday (GPX has no local time: the plan's time zone places it).
      { name: "walk.gpx", status: "skipped", message: { code: "activityFileNotRun", sport: "Walk", date: "2026-10-09" } },
      { name: "long.fit", status: "imported", message: { code: "activityFileImported", date: "2026-10-11", meters: 16_120 } },
    ]);
    expect((await commands.listActivities({})).activities.map((a) => a.sportType)).toEqual(["Run"]);
    expect((await runsByDate(commands, planId))["2026-10-11 long"]).toMatchObject({ status: "done" });
  });
});

describe("TCX files", () => {
  it("imports a TCX run", async () => {
    const { commands, planId } = await ownerWithPlan();
    const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-10-08T11:00:00Z</Id>
      <Lap StartTime="2026-10-08T11:00:00Z">
        <TotalTimeSeconds>1500</TotalTimeSeconds><DistanceMeters>5000</DistanceMeters>
        <Track><Trackpoint><Time>2026-10-08T11:00:00Z</Time><DistanceMeters>0</DistanceMeters></Trackpoint></Track>
      </Lap>
      <Lap StartTime="2026-10-08T11:26:00Z">
        <TotalTimeSeconds>1450</TotalTimeSeconds><DistanceMeters>4700</DistanceMeters>
        <Track><Trackpoint><Time>2026-10-08T11:50:10Z</Time><DistanceMeters>9700</DistanceMeters></Trackpoint></Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

    const result = await commands.importActivityFiles({ files: [{ name: "tempo.tcx", data: new TextEncoder().encode(tcx) }] });

    expect(result.files).toEqual([
      { name: "tempo.tcx", status: "imported", message: { code: "activityFileImported", date: "2026-10-08", meters: 9700 } },
    ]);
    expect((await commands.listActivities({})).activities[0]).toMatchObject({ movingSeconds: 2950, elapsedSeconds: 3010 });
    expect((await runsByDate(commands, planId))["2026-10-08 tempo"]).toMatchObject({ status: "done", actualMeters: 9700 });
  });
});

describe("imported runs in mileage and running load", () => {
  it("count toward home's mileage and Analytics' running load", async () => {
    const { commands } = await ownerWithPlan();
    const tuesday = gpxActivity({ start: "2026-10-06T11:30:00Z", meters: 8100, seconds: 2700 });
    await commands.importActivityFiles({
      files: [
        { name: "tue.gpx", data: tuesday },
        { name: "long.fit", data: longRunFit() },
      ],
    });

    const home = await commands.getHome({ date: "2026-10-11" });
    expect(home.load.running).toMatchObject({ runs: 2, distanceMeters: 24_220, movingSeconds: 7800 });
    const { weeks } = await commands.getTrainingLoad({ weeks: 2, through: "2026-10-11" });
    expect(weeks.map((w) => w.running.distanceMeters)).toEqual([0, 24_220]);
  });
});

describe("missed runs with file imports", () => {
  it("waits to judge a run missed until an import covers a later day", async () => {
    const { commands, planId } = await ownerWithPlan();
    const tuesday = gpxActivity({ start: "2026-10-06T11:30:00Z", meters: 8100, seconds: 2700 });

    await commands.importActivityFiles({ files: [{ name: "tue.gpx", data: tuesday }] });
    // The week is over, but nothing imported reaches Thursday yet: the tempo run may still be on its way.
    expect(await runsByDate(commands, planId)).toMatchObject({
      "2026-10-06 easy": { status: "done" },
      "2026-10-08 tempo": { status: null },
      "2026-10-11 long": { status: null },
    });

    await commands.importActivityFiles({ files: [{ name: "long.fit", data: longRunFit() }] });
    // Sunday's run came in, so Thursday is known now: missed.
    expect(await runsByDate(commands, planId)).toMatchObject({
      "2026-10-08 tempo": { status: "missed" },
      "2026-10-11 long": { status: "done" },
    });
  });

  it("judges nothing missed before any import (or Strava)", async () => {
    const { commands, planId } = await ownerWithPlan();
    await commands.refreshRunStatuses({});
    const statuses = Object.values(await runsByDate(commands, planId)).map((r) => r.status);
    expect(statuses.every((s) => s === null)).toBe(true);
  });
});

describe("typing in a run", () => {
  it("adds up to the day's goal: partial after the first entry, done once the total reaches it", async () => {
    const { commands, planId } = await ownerWithPlan();

    await commands.addManualRun({ date: "2026-10-06", distanceMeters: 3000 });
    expect(await runsByDate(commands, planId)).toMatchObject({ "2026-10-06 easy": { status: "partial", actualMeters: 3000 } });

    // A second run the same day (treadmill + outdoors) takes it to the 5 mi goal.
    await commands.addManualRun({ date: "2026-10-06", distanceMeters: 5100 });
    expect(await runsByDate(commands, planId)).toMatchObject({ "2026-10-06 easy": { status: "done", actualMeters: 8100 } });
    expect((await commands.listActivities({})).activities.map((a) => a.source)).toEqual(["manual", "manual"]);
  });

  it("removes a mistyped run, and refuses anything but manual runs and real days", async () => {
    const { commands, planId } = await ownerWithPlan();
    await commands.importActivityFiles({ files: [{ name: "long.fit", data: longRunFit() }] });
    const { id } = await commands.addManualRun({ date: "2026-10-06", distanceMeters: 8100 });

    await commands.deleteManualRun({ id });

    expect(await runsByDate(commands, planId)).toMatchObject({ "2026-10-06 easy": { status: "missed" } });
    const fileRun = (await commands.listActivities({})).activities[0]!;
    await expect(commands.deleteManualRun({ id: fileRun.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(commands.addManualRun({ date: "2026-02-31", distanceMeters: 5000 })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
