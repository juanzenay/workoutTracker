import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";
import type { RecordedRequest } from "../../../tests/fixtures/recorded-fetch";

const db = setupTestDb();

const SCOPE = "read,activity:write,activity:read_all";

describe("Strava is optional", () => {
  it("reports whether the deployment has a Strava app, and whether it is connected", async () => {
    const owner = await db().signUp("owner@example.com");
    const withStrava = db().commandsAs({ kind: "user", userId: owner.id });
    const withoutStrava = db().commandsAs({ kind: "user", userId: owner.id }, { stravaConfigured: false });

    expect(await withStrava.getActivitySources({})).toEqual({ strava: { configured: true, connected: false } });
    await withStrava.connectStrava({ code: "auth-code-1", scope: SCOPE });
    expect(await withStrava.getActivitySources({})).toEqual({ strava: { configured: true, connected: true } });
    expect(await withoutStrava.getActivitySources({})).toEqual({ strava: { configured: false, connected: false } });
  });

  it("without a Strava app, takes no Strava events and posts no workouts, even with a connection left over", async () => {
    const owner = await db().signUp("owner@example.com");
    await db().commandsAs({ kind: "user", userId: owner.id }).connectStrava({ code: "auth-code-1", scope: SCOPE });
    const requests: RecordedRequest[] = [];
    const commands = db().commandsAs({ kind: "user", userId: owner.id }, { stravaConfigured: false, stravaRequests: requests });
    const webhook = db().commandsAs({ kind: "service" }, { stravaConfigured: false, stravaRequests: requests });

    const event = {
      aspect_type: "create" as const,
      event_time: 1760206800,
      object_id: 16012345678,
      object_type: "activity" as const,
      owner_id: 134815,
      subscription_id: 298765,
      updates: {},
    };
    expect(await webhook.receiveStravaEvent(event)).toEqual({ accepted: false, reason: "not_configured" });
    expect(await webhook.processStravaEvents({})).toEqual({ processed: 0, failed: 0 });

    const workoutId = randomUUID();
    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id: workoutId, name: null, startedAt: "2026-10-05T07:00:00.000Z" },
        { type: "finishWorkout", id: workoutId, finishedAt: "2026-10-05T08:00:00.000Z" },
      ],
    });
    expect(await commands.getWorkoutStravaPost({ workoutId })).toBeNull();
    expect(await commands.postWorkoutsToStrava({})).toEqual({ posted: 0, failed: 0 });
    expect(requests).toEqual([]);
  });
});
