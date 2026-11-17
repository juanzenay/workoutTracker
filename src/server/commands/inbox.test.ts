import { describe, expect, it } from "vitest";
import { planBlocks, type EngineInput } from "@/engine/plan";
import { setupTestDb } from "../../../tests/db/test-db";
import { fakePushSender, testSubscription } from "../../../tests/fixtures/fake-push";
import type { Engine } from ".";
import { readable } from "../../../tests/readable";

const db = setupTestDb();

/**
 * While set, the engine's `today` (overrides the test's): the block is designed before its first session,
 * so creating it never finds sessions already missed (src/engine/replan.ts).
 */
let pinnedDay: string | null = null;

async function on<T>(day: string, run: () => Promise<T>): Promise<T> {
  pinnedDay = day;
  try {
    return await run();
  } finally {
    pinnedDay = null;
  }
}

/** The real engine with `today` pinned to Wednesday 2026-10-14. */
const engineOn =
  (wrap: (out: ReturnType<typeof planBlocks>) => ReturnType<typeof planBlocks> = (out) => out): Engine =>
  (input: EngineInput) =>
    wrap(planBlocks({ ...input, today: pinnedDay ?? "2026-10-14" }));

/** Fixture policy: every change the engine emits needs the owner's confirmation. */
const confirmEverything = engineOn((out) => ({
  ...out,
  changes: out.changes.map((c) => ({ ...c, requiresConfirmation: true })),
}));

async function signedInOwner({ engine = engineOn(), gone = [] as string[] } = {}) {
  const owner = await db().signUp("owner@example.com");
  const push = fakePushSender({ gone });
  const commands = db().commandsAs({ kind: "user", userId: owner.id }, { engine, push: push.sender });
  return { commands, sent: push.sent, owner };
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>["commands"];

/** A block with Machine Bench Press 3 × 10–15 from 180 lb every Tuesday from 2026-10-12, then 180 × 15 on every set that Tuesday. */
async function progressionChange(commands: Commands) {
  const { items } = await commands.listExercises({ query: "Machine Bench Press" });
  const chestPress = items.find((e) => e.name === "Machine Bench Press")!.id;
  await on("2026-10-12", () =>
    commands.createBlock({
      name: "Upper/Lower",
      startDate: "2026-10-12",
      weeks: 4,
      timeZone: "America/Los_Angeles",
      sessions: [
        { name: "Chest Upper", weekday: 2, exercises: [{ exerciseId: chestPress, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight: 180 }] },
      ],
    }),
  );
  const workoutId = crypto.randomUUID();
  const workoutExerciseId = crypto.randomUUID();
  const at = "2026-10-13T19:30:00-07:00";
  await commands.applyWorkoutOps({
    ops: [
      { type: "startWorkout", id: workoutId, startedAt: at },
      { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId: chestPress, position: 0 },
      ...[0, 1, 2].map((position) => ({
        type: "putSet" as const,
        id: crypto.randomUUID(),
        workoutExerciseId,
        position,
        setType: "normal" as const,
        weight: 180,
        unit: "lb" as const,
        reps: 15,
        completed: true,
      })),
      { type: "finishWorkout", id: workoutId, finishedAt: at },
    ],
  });
}

describe("inbox", () => {
  it("records an applied plan change as a minor item without a push", async () => {
    const { commands, sent } = await signedInOwner();
    await commands.savePushSubscription(testSubscription());
    await progressionChange(commands);

    const { revisions } = readable(await commands.listPlanRevisions({}));
    const { entries } = readable(await commands.listInbox({}));
    expect(entries).toEqual([
      {
        type: "item",
        item: expect.objectContaining({
          level: "minor",
          kind: "plan_change_applied",
          title: revisions[0]!.summary,
          url: `/plan-changes/${revisions[0]!.id}`,
        }),
      },
    ]);
    expect(sent).toEqual([]);
  });

  it("records a pending confirmation as an important item and pushes it to each device", async () => {
    const { commands, sent } = await signedInOwner({ engine: confirmEverything });
    await commands.savePushSubscription(testSubscription("https://web.push.apple.com/phone"));
    await commands.savePushSubscription(testSubscription("https://fcm.googleapis.com/fcm/send/laptop"));
    await progressionChange(commands);

    const { revisions } = readable(await commands.listPlanRevisions({ status: ["pending"] }));
    const pending = revisions[0]!;
    const { entries } = readable(await commands.listInbox({}));
    expect(entries).toEqual([
      {
        type: "item",
        item: expect.objectContaining({
          level: "important",
          kind: "plan_change_pending",
          title: pending.summary,
          body: pending.reasons,
          url: `/plan-changes/${pending.id}`,
        }),
      },
    ]);
    expect(sent.map((s) => s.subscription.endpoint).sort()).toEqual([
      "https://fcm.googleapis.com/fcm/send/laptop",
      "https://web.push.apple.com/phone",
    ]);
    expect(sent[0]!.message).toEqual(
      expect.objectContaining({ title: pending.summary, url: `/plan-changes/${pending.id}` }),
    );
  });

  it("opens the pending change a notification points at, to confirm or reject it", async () => {
    const { commands, sent } = await signedInOwner({ engine: confirmEverything });
    await commands.savePushSubscription(testSubscription());
    await progressionChange(commands);

    const id = sent[0]!.message.url.replace("/plan-changes/", "");
    expect(readable(await commands.getPlanRevision({ id }))).toMatchObject({ id, status: "pending" });
    await commands.confirmPlanRevision({ id });
    expect(readable(await commands.getPlanRevision({ id }))).toMatchObject({ id, status: "applied" });
    await expect(commands.getPlanRevision({ id: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
  });

  it("announces a pending change once, however often re-plans refresh it", async () => {
    const { commands, sent } = await signedInOwner({ engine: confirmEverything });
    await commands.savePushSubscription(testSubscription());
    await progressionChange(commands);
    const id = crypto.randomUUID();
    await commands.applyWorkoutOps({
      ops: [
        { type: "startWorkout", id, startedAt: "2026-10-14T08:00:00-07:00" },
        { type: "finishWorkout", id, finishedAt: "2026-10-14T08:30:00-07:00" },
      ],
    });

    expect(readable(await commands.listInbox({})).entries).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("groups back-to-back minor items between important ones, newest first", async () => {
    const { commands } = await signedInOwner();
    for (const [level, title] of [
      ["minor", "m1"],
      ["important", "i1"],
      ["minor", "m2"],
      ["minor", "m3"],
      ["minor", "m4"],
      ["important", "i2"],
      ["important", "i3"],
      ["minor", "m5"],
    ] as const) {
      await commands.raiseInboxItem({ kind: "test", level, title });
    }

    const { entries } = readable(await commands.listInbox({}));
    const shape = entries.map((e) => (e.type === "item" ? e.item.title : e.items.map((i) => i.title)));
    expect(shape).toEqual(["m5", "i3", "i2", ["m4", "m3", "m2"], "i1", "m1"]);
  });

  it("lets server jobs raise an important item (backup failure) that is pushed", async () => {
    const { commands, sent } = await signedInOwner();
    await commands.savePushSubscription(testSubscription());
    const push = fakePushSender();
    const job = db().commandsAs({ kind: "service" }, { push: push.sender });

    await job.raiseInboxItem({ kind: "backup_failed", level: "important", title: "Backup failed", body: "GitHub said 401", url: "/export" });

    expect(readable(await commands.listInbox({})).entries).toEqual([
      { type: "item", item: expect.objectContaining({ kind: "backup_failed", level: "important", title: "Backup failed" }) },
    ]);
    expect(push.sent).toEqual([
      {
        subscription: expect.objectContaining({ endpoint: testSubscription().endpoint }),
        message: expect.objectContaining({ title: "Backup failed", body: "GitHub said 401", url: "/export" }),
      },
    ]);
    expect(sent).toEqual([]);
  });

  it("pushes an important item to the subscribed device with its title, url and tag", async () => {
    const { commands, sent } = await signedInOwner();
    await commands.savePushSubscription(testSubscription());

    const important = await commands.raiseInboxItem({ kind: "test", level: "important", title: "loud", url: "/export" });

    expect(sent).toEqual([
      {
        subscription: expect.objectContaining({ endpoint: testSubscription().endpoint }),
        message: { title: "loud", url: "/export", tag: important.id },
      },
    ]);
  });

  it("sends no push for a minor item", async () => {
    const { commands, sent } = await signedInOwner();
    await commands.savePushSubscription(testSubscription());

    await commands.raiseInboxItem({ kind: "test", level: "minor", title: "quiet", url: "/export" });

    expect(readable(await commands.listInbox({})).entries).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  it("only links items to paths inside the app", async () => {
    const { commands } = await signedInOwner();
    for (const url of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
      await expect(commands.raiseInboxItem({ kind: "test", level: "minor", title: "x", url })).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    await expect(commands.raiseInboxItem({ kind: "test", level: "minor", title: "x", url: "/export" })).resolves.toMatchObject({
      url: "/export",
    });
  });

  it("does not let anonymous callers read or raise inbox items", async () => {
    await signedInOwner();
    const anon = db().commandsAs({ kind: "anon" });
    await expect(anon.raiseInboxItem({ kind: "test", level: "important", title: "x" })).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect((await anon.listInbox({})).entries).toEqual([]);
  });

  it("forgets devices the push service says are gone, and devices the owner turned off", async () => {
    const phone = "https://web.push.apple.com/phone";
    const laptop = "https://fcm.googleapis.com/fcm/send/laptop";
    const tablet = "https://updates.push.services.mozilla.com/tablet";
    const { commands, sent } = await signedInOwner({ gone: [phone] });
    for (const endpoint of [phone, laptop, tablet]) await commands.savePushSubscription(testSubscription(endpoint));
    await commands.deletePushSubscription({ endpoint: tablet });

    await commands.raiseInboxItem({ kind: "test", level: "important", title: "first" });

    expect(await commands.getPushSubscription({ endpoint: phone })).toEqual({ subscribed: false });
    expect(await commands.getPushSubscription({ endpoint: laptop })).toEqual({ subscribed: true });
    expect(await commands.getPushSubscription({ endpoint: tablet })).toEqual({ subscribed: false });
    expect(sent.map((s) => s.subscription.endpoint)).toEqual([laptop]);
  });

  it("keeps the inbox item when sending a push fails", async () => {
    const owner = await db().signUp("owner@example.com");
    const commands = db().commandsAs(
      { kind: "user", userId: owner.id },
      { push: { send: async () => Promise.reject(new Error("push service down")) } },
    );
    await commands.savePushSubscription(testSubscription());

    await expect(commands.raiseInboxItem({ kind: "test", level: "important", title: "still here" })).resolves.toMatchObject({
      title: "still here",
    });
    expect(readable(await commands.listInbox({})).entries).toHaveLength(1);
  });
});
