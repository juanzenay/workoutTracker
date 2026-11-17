import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { OAuthError, OAuthErrorCode, type AuthInfo } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";
import { createMcpEndpoint } from "./endpoint";

const db = setupTestDb();

const MCP_URL = "https://workout-tracker.test/api/mcp";
const RESOURCE_METADATA_URL = "https://workout-tracker.test/.well-known/oauth-protected-resource/api/mcp";
const LA = "America/Los_Angeles";

/** Tokens are just user ids here; the Supabase JWT verifier has its own tests. */
async function verifyAccessToken(token: string): Promise<AuthInfo> {
  if (token === "expired") throw new OAuthError(OAuthErrorCode.InvalidToken, "Token has expired");
  return { token, clientId: "claude", scopes: [], expiresAt: Math.floor(Date.now() / 1000) + 3600, extra: { userId: token } };
}

function endpoint() {
  return createMcpEndpoint({
    verifyAccessToken,
    commandsFor: (userId) => db().commandsAs({ kind: "user", userId }),
    resourceMetadataUrl: RESOURCE_METADATA_URL,
  });
}

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

/** An MCP client (like Claude) talking to the endpoint in-process with `token` as its bearer token. */
async function connect(token: string) {
  const serve = endpoint();
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      return serve(new Request(url, { ...init, headers }));
    },
  });
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
  return result.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const toolsCall = (headers: Record<string, string> = {}) =>
  new Request(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

describe("MCP endpoint: who can connect", () => {
  it("answers 401 with a WWW-Authenticate challenge pointing at the resource metadata without a valid token", async () => {
    await db().signUp("owner@example.com");
    for (const headers of [{}, { authorization: "Bearer expired" }] as Record<string, string>[]) {
      const response = await endpoint()(toolsCall(headers));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain(`resource_metadata="${RESOURCE_METADATA_URL}"`);
    }
  });

  it("refuses a valid token for anyone but the deployment owner", async () => {
    await db().signUp("owner@example.com");
    const response = await endpoint()(toolsCall({ authorization: `Bearer ${crypto.randomUUID()}` }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_token", error_description: expect.stringMatching(/owner/) });
  });

  it("the owner sees the read tools (read-only) and the coach's write tools", async () => {
    const owner = await db().signUp("owner@example.com");
    const client = await connect(owner.id);
    const { tools } = await client.listTools();
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name);
    const writes = tools.filter((t) => !t.annotations?.readOnlyHint).map((t) => t.name);
    expect(readOnly.sort()).toEqual(["get_block", "get_calendar", "get_exercise_history", "get_training_load", "list_races"]);
    expect(writes.sort()).toEqual([
      "add_race",
      "apply_change",
      "draft_block",
      "import_plan",
      "mark_unavailable",
      "propose_change",
      "undo_change",
      "update_block",
      "update_race",
    ]);
    for (const tool of tools) expect(tool.description).toBeTruthy();
  });
});

describe("MCP tools", () => {
  async function ownerWithData() {
    const owner = await db().signUp("owner@example.com");
    const commands = db().commandsAs({ kind: "user", userId: owner.id });
    const { items } = await commands.listExercises({ query: "Leg Press" });
    const legPress = items.find((e) => e.name === "Leg Press")!.id;
    await commands.createBlock({
      name: "Spring Block",
      startDate: "2030-01-07",
      weeks: 2,
      timeZone: LA,
      sessions: [{ name: "Lower", weekday: 1, exercises: [{ exerciseId: legPress, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight: 270 }] }],
    });
    const workoutId = crypto.randomUUID();
    const workoutExerciseId = crypto.randomUUID();
    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id: workoutId, startedAt: "2026-01-05T16:00:00Z" },
        { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId: legPress, position: 0 },
        {
          type: "putSet",
          id: crypto.randomUUID(),
          workoutExerciseId,
          position: 0,
          setType: "normal",
          weight: 250,
          unit: "lb",
          reps: 12,
          completed: true,
        },
        { type: "finishWorkout", id: workoutId, finishedAt: "2026-01-05T17:00:00Z" },
      ],
    });
    await commands.createRace({ name: "Far Marathon", date: "2030-05-05", distanceMeters: 42_195, priority: "A" });
    const content = JSON.stringify({
      name: "Two weeks",
      runs: [
        {
          week: 1,
          day: "thu",
          type: "intervals",
          pace_target: "9:00-9:30/mi",
          structure: {
            warmup: { distance_m: 1600, intensity: { kind: "hr_zone", zone: 2 } },
            repeats: [
              {
                count: 6,
                steps: [
                  { kind: "work", distance_m: 800, intensity: { kind: "pace", pace: "6:40-6:55/mi" } },
                  { kind: "recovery", duration_s: 90 },
                ],
              },
            ],
            cooldown: { distance_m: 1600 },
          },
        },
        { week: 2, day: "sun", type: "race" },
      ],
    });
    await commands.importRunPlan({ format: "json", content, timeZone: LA });
    return { owner, legPress };
  }

  it("get_calendar returns planned sessions and runs with status, paces in whole seconds per km for Coros", async () => {
    const { owner } = await ownerWithData();
    const client = await connect(owner.id);

    const lifting = await call(client, "get_calendar", { from: "2030-01-07", to: "2030-01-08" });
    expect(lifting.days[0].sessions).toEqual([
      expect.objectContaining({ name: "Lower", blockName: "Spring Block", status: "planned" }),
    ]);

    const running = await call(client, "get_calendar", { from: "2030-04-25", to: "2030-04-25" });
    const [run] = running.days[0].runs;
    expect(run).toMatchObject({ type: "intervals", planName: "Two weeks", status: "planned" });
    expect(run.paceTarget).toEqual({ perKmSeconds: [336, 354] }); // 9:00 and 9:30 /mi
    expect(run.structure.repeats[0].steps[0].intensity).toEqual({ kind: "pace", perKmSeconds: [249, 258] });
    // Coros-ready sections, in order, for every run that can become a structured workout.
    expect(run.corosWorkout).toEqual({
      sections: [
        { type: "warmup", target: { distanceMeters: 1600 }, intensity: { kind: "hr_zone", zone: 2 } },
        {
          type: "repeat",
          count: 6,
          sections: [
            { type: "training", target: { distanceMeters: 800 }, intensity: { kind: "pace", perKmSeconds: [249, 258] } },
            { type: "recovery", target: { durationSeconds: 90 } },
          ],
        },
        { type: "cooldown", target: { distanceMeters: 1600 } },
      ],
    });
  });

  it("an unstructured run becomes one training section with its distance and pace", async () => {
    const owner = await db().signUp("owner@example.com");
    const commands = db().commandsAs({ kind: "user", userId: owner.id });
    await commands.createRace({ name: "Far Half", date: "2030-05-05", distanceMeters: 21_097, priority: "A" });
    const content = JSON.stringify({
      runs: [
        { week: 1, day: "tue", type: "easy", distance_mi: 5, pace_target: "10:00-10:30/mi" },
        { week: 1, day: "wed", type: "rest" },
        { week: 1, day: "sun", type: "race", distance_m: 21_097 },
      ],
    });
    await commands.importRunPlan({ format: "json", content, timeZone: LA });
    const client = await connect(owner.id);
    const { days } = await call(client, "get_calendar", { from: "2030-04-30", to: "2030-05-05" });
    const runs = days.flatMap((d: { runs: unknown[] }) => d.runs);
    expect(runs.map((r: { type: string; corosWorkout: unknown }) => [r.type, r.corosWorkout])).toEqual([
      ["easy", { sections: [{ type: "training", target: { distanceMeters: 8047 }, intensity: { kind: "pace", perKmSeconds: [373, 392] } }] }],
      ["rest", null],
      ["race", { sections: [{ type: "training", target: { distanceMeters: 21_097 } }] }],
    ]);
  });

  it("get_training_load returns weekly load", async () => {
    const { owner } = await ownerWithData();
    const client = await connect(owner.id);
    const load = await call(client, "get_training_load", { weeks: 1, through: "2026-01-11" });
    expect(load.weeks).toEqual([
      expect.objectContaining({ weekStart: "2026-01-05", lifting: expect.objectContaining({ workouts: 1, workingSets: 1, volume: 3000 }) }),
    ]);
  });

  it("get_exercise_history lists exercises with history, then one exercise's sessions", async () => {
    const { owner, legPress } = await ownerWithData();
    const client = await connect(owner.id);
    const all = await call(client, "get_exercise_history");
    expect(all.exercises).toEqual([expect.objectContaining({ exerciseId: legPress, name: "Leg Press" })]);
    const one = await call(client, "get_exercise_history", { exerciseId: legPress });
    expect(one).toMatchObject({ name: "Leg Press", sessions: [expect.objectContaining({ volume: 3000 })] });
  });

  it("get_block returns the current block with its planned sessions, or one by id", async () => {
    const { owner } = await ownerWithData();
    const client = await connect(owner.id);
    const current = await call(client, "get_block");
    expect(current.block.name).toBe("Spring Block");
    expect(current.plannedSessions).toHaveLength(2);
    const byId = await call(client, "get_block", { id: current.block.id });
    expect(byId.block.id).toBe(current.block.id);
  });

  it("draft_block saves the coach's next block as a draft for review in workout tracker; the plan is untouched", async () => {
    const { owner, legPress } = await ownerWithData();
    const client = await connect(owner.id);
    const draft = {
      name: "Next Block",
      startDate: "2030-01-21",
      weeks: 4,
      deloadWeeks: [4],
      notes: "Leg Press moved from 250 to 270 last block, so a ramp to 4 sets.",
      sessions: [
        {
          name: "Lower",
          weekday: 1,
          exercises: [
            { exerciseId: legPress, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight: 270, rule: "ramp", rampTo: 4 },
          ],
        },
      ],
    };

    const result = await call(client, "draft_block", draft);
    expect(result.block).toMatchObject({
      name: "Next Block",
      draft: true,
      timeZone: LA, // the plan's
      deloadWeeks: [4],
      sessions: [{ name: "Lower", exercises: [{ name: "Leg Press", rule: "ramp", rampTo: 4 }] }],
    });
    expect(result.next).toMatch(/workout tracker/);
    expect((await call(client, "get_block")).block.name).toBe("Spring Block");
    expect((await call(client, "get_block", { id: result.block.id })).plannedSessions).toEqual([]);

    const revised = await call(client, "draft_block", { ...draft, id: result.block.id, weeks: 5, deloadWeeks: [5] });
    expect(revised.block).toMatchObject({ id: result.block.id, weeks: 5, deloadWeeks: [5], draft: true });
  });

  it("update_block edits the running block in place, with nothing to start; the calendar follows at once", async () => {
    const { owner, legPress } = await ownerWithData();
    const client = await connect(owner.id);
    const dates = async () => (await call(client, "get_block")).plannedSessions.map((s: { date: string }) => s.date);
    expect(await dates()).toEqual(["2030-01-07", "2030-01-14"]);

    const result = await call(client, "update_block", {
      notes: "Leg day moved to Thursday.",
      sessions: [
        {
          name: "Lower",
          weekday: 4,
          exercises: [{ exerciseId: legPress, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight: 270 }],
        },
      ],
      id: (await call(client, "get_block")).block.id,
    });

    expect(result.block).toMatchObject({ name: "Spring Block", draft: false, notes: "Leg day moved to Thursday." });
    expect(result.next).toMatch(/workout tracker/);
    expect(await dates()).toEqual(["2030-01-10", "2030-01-17"]);
  });

  it("list_races returns races and the run plans anchored to them", async () => {
    const { owner } = await ownerWithData();
    const client = await connect(owner.id);
    const result = await call(client, "list_races");
    expect(result.races).toEqual([expect.objectContaining({ name: "Far Marathon", date: "2030-05-05", priority: "A" })]);
    expect(result.runPlans).toEqual([expect.objectContaining({ name: "Two weeks", race: expect.objectContaining({ name: "Far Marathon" }) })]);
  });

  it("the coach proposes (nothing changes), the owner approves, the change applies; undo_change takes it back", async () => {
    const { owner } = await ownerWithData();
    const client = await connect(owner.id);
    const runsOn = async (date: string) =>
      (await call(client, "get_calendar", { from: date, to: date })).days[0].runs.map((r: { type: string }) => r.type);
    expect(await runsOn("2030-04-25")).toEqual(["intervals"]);

    const proposal = await call(client, "mark_unavailable", {
      startDate: "2030-04-24",
      endDate: "2030-04-26",
      note: "Travelling",
      reason: "You're away for a work trip.",
    });
    expect(proposal).toMatchObject({
      changeId: expect.any(String),
      status: "proposed",
      summary: "Unavailable Wednesday, Apr 24 to Friday, Apr 26 (Travelling)",
      reasons: expect.arrayContaining(["You're away for a work trip."]),
      effects: [{ what: "Intervals", from: "2030-04-25", to: null }],
    });
    expect(await runsOn("2030-04-25")).toEqual(["intervals"]);

    const applied = await call(client, "apply_change", { changeId: proposal.changeId });
    expect(applied).toMatchObject({ changeId: proposal.changeId, status: "applied", source: "coach" });
    expect(await runsOn("2030-04-25")).toEqual([]);

    const undone = await call(client, "undo_change", { changeId: proposal.changeId });
    expect(undone).toMatchObject({ status: "undone" });
    expect(await runsOn("2030-04-25")).toEqual(["intervals"]);
  });

  it("races and run plans go through proposals too", async () => {
    const owner = await db().signUp("owner@example.com");
    const client = await connect(owner.id);
    const race = await call(client, "add_race", { name: "Fall Half", date: "2030-11-17", distanceMeters: 21_097, priority: "A" });
    expect((await call(client, "list_races")).races).toEqual([]);
    await call(client, "apply_change", { changeId: race.changeId });
    const [added] = (await call(client, "list_races")).races;

    const plan = await call(client, "import_plan", {
      format: "csv",
      content: "week,day,type,distance_km\n1,sun,race,21.1",
      timeZone: LA,
    });
    expect(plan.summary).toBe("Run plan: Run plan (1 week) for Fall Half");
    await call(client, "apply_change", { changeId: plan.changeId });

    const move = await call(client, "update_race", { id: added.id, date: "2030-11-24" });
    await call(client, "apply_change", { changeId: move.changeId });
    expect((await call(client, "list_races")).runPlans).toEqual([
      expect.objectContaining({ startDate: "2030-11-24", endDate: "2030-11-24" }),
    ]);

    const generic = await call(client, "propose_change", {
      action: { type: "mark_unavailable", startDate: "2030-11-24", endDate: "2030-11-24" },
    });
    // Race days stay on the plan.
    expect(generic).toMatchObject({ status: "proposed", effects: [], reasons: ["Nothing on the plan changes"] });
  });

  it("command errors come back as tool errors, not protocol failures", async () => {
    const { owner } = await ownerWithData();
    const client = await connect(owner.id);
    const notFound = await client.callTool({ name: "get_block", arguments: { id: crypto.randomUUID() } });
    expect(notFound.isError).toBe(true);
    expect(JSON.stringify(notFound.content)).toContain("not_found");
    const invalid = await client.callTool({ name: "get_calendar", arguments: { from: "2030-01-01", to: "2030-12-31" } });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain("invalid_input");
  });
});
