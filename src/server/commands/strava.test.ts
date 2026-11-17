import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";
import { STRAVA_FIXTURES } from "../../../tests/fixtures/recorded-fetch";

const db = setupTestDb();

const SCOPE = "read,activity:write,activity:read_all";

async function signedInOwner(options: { stravaFixtures?: string; now?: Date } = {}) {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id }, options);
}

describe("Strava connection (OAuth)", () => {
  it("connects with an authorization code and disconnects", async () => {
    const commands = await signedInOwner();
    expect(await commands.getStravaConnection({})).toEqual({ connected: false });

    const connection = await commands.connectStrava({ code: "auth-code-1", scope: SCOPE });
    expect(connection).toEqual({
      connected: true,
      athleteId: 134815,
      athleteName: "Sam Runner",
      scope: ["read", "activity:write", "activity:read_all"],
      connectedAt: expect.any(String),
      subscription: null,
    });
    expect(await commands.getStravaConnection({})).toEqual(connection);
    // Tokens never leave the server.
    expect(JSON.stringify(connection)).not.toContain("a4b945687g");

    await commands.disconnectStrava({});
    expect(await commands.getStravaConnection({})).toEqual({ connected: false });
  });

  it("refuses a grant missing the activity scopes (the owner unticked them)", async () => {
    const commands = await signedInOwner();
    await expect(commands.connectStrava({ code: "auth-code-1", scope: "read" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    expect(await commands.getStravaConnection({})).toEqual({ connected: false });
  });

  it("reports a code Strava rejects as invalid input", async () => {
    const commands = await signedInOwner({ stravaFixtures: join(STRAVA_FIXTURES, "../strava-rejected") });
    await expect(commands.connectStrava({ code: "stale", scope: SCOPE })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("keeps the tokens out of the JSON export", async () => {
    const commands = await signedInOwner();
    await commands.connectStrava({ code: "auth-code-1", scope: SCOPE });
    const exported = JSON.stringify(await commands.exportJson({}));
    expect(exported).toContain("134815");
    expect(exported).not.toContain("a4b945687g1234aaaa5555bbbb6666cccc7777dd");
    expect(exported).not.toContain("e5n567567aaaa1111bbbb2222cccc3333dddd444");
  });

  it("is the owner's alone", async () => {
    await signedInOwner();
    const anon = db().commandsAs({ kind: "anon" });
    await expect(anon.connectStrava({ code: "auth-code-1", scope: SCOPE })).rejects.toMatchObject({ code: "unauthorized" });
  });
});

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

const CHICAGO = "America/Chicago";
const ATHLETE = 134815;
const SUBSCRIPTION = 298765;
const LONG_RUN = 16012345678;
const EASY_RUN = 16012345679;
const WEIGHTS = 16012345680;
const GONE = 16099999999;
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

/** The owner, connected to Strava with the test week planned, plus the webhook's service-role commands. */
async function connectedOwnerWithPlan({ now = WEEK_OVER, stravaFixtures }: { now?: Date; stravaFixtures?: string } = {}) {
  const commands = await signedInOwner({ now, stravaFixtures });
  await commands.connectStrava({ code: "auth-code-1", scope: SCOPE });
  const race = await commands.createRace({ name: "Tune-up 10K", date: "2026-10-11", distanceMeters: 10_000, priority: "B" });
  const { plan } = await commands.importRunPlan({ format: "json", content: ONE_WEEK_PLAN, raceId: race.id, timeZone: CHICAGO });
  // The webhook route runs as the service role; reuse one instance so sequenced fixtures advance.
  const webhook = db().commandsAs({ kind: "service" }, { now, stravaFixtures });
  return { commands, webhook, planId: plan.id };
}

function activityEvent(objectId: number, aspect: "create" | "update" | "delete", eventTime = 1760206800, updates = {}) {
  return {
    aspect_type: aspect,
    event_time: eventTime,
    object_id: objectId,
    object_type: "activity" as const,
    owner_id: ATHLETE,
    subscription_id: SUBSCRIPTION,
    updates,
  };
}

async function runsByDate(commands: Commands, planId: string) {
  const { plannedRuns } = await commands.getRunPlan({ id: planId });
  return Object.fromEntries(
    plannedRuns.map((r) => [`${r.date} ${r.type}`, { status: r.status, actualMeters: r.actualMeters, gapMeters: r.gapMeters }]),
  );
}

const statuses = async (commands: Commands, planId: string) =>
  Object.values(await runsByDate(commands, planId)).map((r) => r.status);

describe("Strava webhook ingestion and run matching", () => {
  it("a created activity is fetched, stored and marks the day's planned run done", async () => {
    const { commands, webhook, planId } = await connectedOwnerWithPlan();

    expect(await webhook.receiveStravaEvent(activityEvent(LONG_RUN, "create"))).toEqual({ accepted: true });
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 1, failed: 0 });

    const { activities } = await commands.listStravaActivities({});
    expect(activities).toEqual([
      expect.objectContaining({
        id: LONG_RUN,
        name: "Sunday Long Run",
        sportType: "Run",
        localDate: "2026-10-11",
        distanceMeters: 16120.4,
        movingSeconds: 5520,
        plannedRunId: expect.any(String),
      }),
    ]);
    expect((await runsByDate(commands, planId))["2026-10-11 long"]).toEqual({
      status: "done",
      actualMeters: 16120.4,
      gapMeters: null,
    });
  });

  it("marks each planned run done, partial (with the distance gap) or missed; rest days and lifting never match", async () => {
    const { commands, webhook, planId } = await connectedOwnerWithPlan();
    for (const id of [EASY_RUN, WEIGHTS, LONG_RUN]) await webhook.receiveStravaEvent(activityEvent(id, "create"));
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 3, failed: 0 });

    expect(await runsByDate(commands, planId)).toEqual({
      // 4 of 5 miles.
      "2026-10-06 easy": { status: "partial", actualMeters: 6437.4, gapMeters: 1609.6 },
      // Nothing run, and the day is over.
      "2026-10-08 tempo": { status: "missed", actualMeters: null, gapMeters: null },
      "2026-10-09 rest": { status: null, actualMeters: null, gapMeters: null },
      "2026-10-11 long": { status: "done", actualMeters: 16120.4, gapMeters: null },
    });
    const { activities } = await commands.listStravaActivities({});
    expect(activities.find((a) => a.id === WEIGHTS)).toMatchObject({ sportType: "WeightTraining", plannedRunId: null });
  });

  it("the calendar shows each planned run's Strava outcome", async () => {
    const { commands, webhook } = await connectedOwnerWithPlan();
    for (const id of [EASY_RUN, LONG_RUN]) await webhook.receiveStravaEvent(activityEvent(id, "create"));
    await webhook.processStravaEvents({});

    const calendar = await commands.getCalendar({ from: "2026-10-06", to: "2026-10-11" });
    expect(calendar.days.flatMap((d) => d.runs).map((r) => [r.date, r.status, r.gapMeters])).toEqual([
      ["2026-10-06", "partial", 1609.6],
      ["2026-10-08", "missed", null],
      ["2026-10-09", "rest", null],
      ["2026-10-11", "done", null],
    ]);
  });

  it("a planned run with no activity is missed once its day is over in the plan's zone, not before", async () => {
    // Sun 2026-10-11, 3 pm in Chicago: the long run is still to come.
    const sundayAfternoon = new Date("2026-10-11T20:00:00Z");
    const { commands, planId } = await connectedOwnerWithPlan({ now: sundayAfternoon });
    expect(await statuses(commands, planId)).toEqual(["missed", "missed", null, null]);

    // Sun 11:30 pm in Chicago is Mon 04:30 UTC: still Sunday where the plan is.
    const lateSunday = db().commandsAs({ kind: "service" }, { now: new Date("2026-10-12T04:30:00Z") });
    await lateSunday.refreshRunStatuses({});
    expect(await statuses(commands, planId)).toEqual(["missed", "missed", null, null]);

    // The end-of-day job after midnight in Chicago closes Sunday.
    const monday = db().commandsAs({ kind: "service" }, { now: WEEK_OVER });
    await monday.refreshRunStatuses({});
    expect(await statuses(commands, planId)).toEqual(["missed", "missed", null, "missed"]);
  });

  it("an update re-fetches the activity: a run re-typed as a walk no longer counts", async () => {
    const { commands, webhook, planId } = await connectedOwnerWithPlan();
    await webhook.receiveStravaEvent(activityEvent(EASY_RUN, "create"));
    await webhook.processStravaEvents({});
    expect((await runsByDate(commands, planId))["2026-10-06 easy"]?.status).toBe("partial");

    await webhook.receiveStravaEvent(activityEvent(EASY_RUN, "update", 1760207000, { type: "Walk", title: "Evening Walk" }));
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 1, failed: 0 });

    const { activities } = await commands.listStravaActivities({});
    expect(activities).toEqual([
      expect.objectContaining({ id: EASY_RUN, name: "Evening Walk", sportType: "Walk", plannedRunId: null }),
    ]);
    expect((await runsByDate(commands, planId))["2026-10-06 easy"]?.status).toBe("missed");
  });

  it("a deleted activity is removed and its run is missed again; one Strava no longer has is treated the same", async () => {
    const { commands, webhook, planId } = await connectedOwnerWithPlan();
    await webhook.receiveStravaEvent(activityEvent(LONG_RUN, "create"));
    await webhook.receiveStravaEvent(activityEvent(GONE, "create"));
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 2, failed: 0 });
    expect((await commands.listStravaActivities({})).activities.map((a) => a.id)).toEqual([LONG_RUN]);

    await webhook.receiveStravaEvent(activityEvent(LONG_RUN, "delete", 1760207100));
    await webhook.processStravaEvents({});
    expect((await commands.listStravaActivities({})).activities).toEqual([]);
    expect((await runsByDate(commands, planId))["2026-10-11 long"]?.status).toBe("missed");
  });

  it("a retried event is recorded once; nothing is left to process the second time", async () => {
    const { webhook } = await connectedOwnerWithPlan();
    await webhook.receiveStravaEvent(activityEvent(LONG_RUN, "create"));
    await webhook.receiveStravaEvent(activityEvent(LONG_RUN, "create"));
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 1, failed: 0 });
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 0, failed: 0 });
  });

  it("ignores events for another athlete or another subscription, and everything before Strava is connected", async () => {
    const owner = await db().signUp("owner@example.com");
    const webhook = db().commandsAs({ kind: "service" });
    expect(await webhook.receiveStravaEvent(activityEvent(LONG_RUN, "create"))).toEqual({
      accepted: false,
      reason: "not_connected",
    });

    await db().commandsAs({ kind: "user", userId: owner.id }).connectStrava({ code: "auth-code-1", scope: SCOPE });
    expect(await webhook.receiveStravaEvent({ ...activityEvent(LONG_RUN, "create"), owner_id: 999 })).toEqual({
      accepted: false,
      reason: "unknown_athlete",
    });
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 0, failed: 0 });
  });

  it("the athlete revoking access on Strava disconnects workout tracker", async () => {
    const { commands, webhook } = await connectedOwnerWithPlan();
    expect(
      await webhook.receiveStravaEvent({
        aspect_type: "update",
        event_time: 1760207200,
        object_id: ATHLETE,
        object_type: "athlete",
        owner_id: ATHLETE,
        subscription_id: SUBSCRIPTION,
        updates: { authorized: "false" },
      }),
    ).toEqual({ accepted: true });
    expect(await commands.getStravaConnection({})).toEqual({ connected: false });
  });

  it("refreshes an expiring access token before fetching and keeps the new refresh token", async () => {
    const { commands, webhook, planId } = await connectedOwnerWithPlan({
      stravaFixtures: join(STRAVA_FIXTURES, "../strava-expired"),
    });
    // The second /oauth/token response (the refresh) is served to the webhook's client.
    await webhook.receiveStravaEvent(activityEvent(LONG_RUN, "create"));
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 1, failed: 0 });
    expect((await runsByDate(commands, planId))["2026-10-11 long"]?.status).toBe("done");
  });

  it("keeps an event that failed (Strava down) for the next attempt", async () => {
    const { webhook } = await connectedOwnerWithPlan({ stravaFixtures: join(STRAVA_FIXTURES, "../strava-down") });
    await webhook.receiveStravaEvent(activityEvent(LONG_RUN, "create"));
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 0, failed: 1 });
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 0, failed: 1 });
  });
});

describe("Strava webhook subscription", () => {
  it("subscribes the deployment's callback URL, then only accepts events for that subscription", async () => {
    const commands = await signedInOwner();
    await commands.connectStrava({ code: "auth-code-1", scope: SCOPE });
    expect(
      await commands.subscribeStravaWebhook({
        callbackUrl: "https://workout-tracker.example.com/api/strava/webhook",
        verifyToken: "verify-me",
      }),
    ).toEqual({ subscriptionId: SUBSCRIPTION, callbackUrl: "https://workout-tracker.example.com/api/strava/webhook" });
    expect(await commands.getStravaConnection({})).toMatchObject({
      subscription: { id: SUBSCRIPTION, callbackUrl: "https://workout-tracker.example.com/api/strava/webhook" },
    });

    const webhook = db().commandsAs({ kind: "service" });
    expect(await webhook.receiveStravaEvent({ ...activityEvent(LONG_RUN, "create"), subscription_id: 1 })).toEqual({
      accepted: false,
      reason: "unknown_subscription",
    });
    expect(await webhook.receiveStravaEvent(activityEvent(LONG_RUN, "create"))).toEqual({ accepted: true });
  });
});

