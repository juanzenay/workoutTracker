import { describe, expect, it } from "vitest";
import { exerciseDiffs as ex } from "@/domain/plan-change";
import { planBlocks, type EngineInput } from "@/engine/plan";
import { setupTestDb } from "../../../tests/db/test-db";
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

/** The real engine with `today` pinned, so tests don't depend on the clock. */
const engineOn =
  (today: string, wrap: (out: ReturnType<typeof planBlocks>) => ReturnType<typeof planBlocks> = (out) => out): Engine =>
  (input: EngineInput) =>
    wrap(planBlocks({ ...input, today: pinnedDay ?? today }));

/** Fixture policy: every change the engine emits needs the owner's confirmation. */
const confirmEverything = engineOn("2026-10-14", (out) => ({
  ...out,
  changes: out.changes.map((c) => ({ ...c, requiresConfirmation: true })),
}));

async function signedInOwner(engine: Engine = engineOn("2026-10-14")) {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id }, { engine });
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

/** A 4-week block with Machine Bench Press 3 × 10–15 from 180 lb every Tuesday, starting Monday 2026-10-12. */
async function chestBlock(commands: Commands) {
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
  return chestPress;
}

/** Finishes a workout doing `exerciseId` at `weight` lb for `reps` per set. */
async function logWorkout(commands: Commands, exerciseId: string, startedAt: string, weight: number, reps: number[]) {
  const workoutId = crypto.randomUUID();
  const workoutExerciseId = crypto.randomUUID();
  await commands.applyWorkoutOps({
    ops: [
      { type: "startWorkout", id: workoutId, startedAt },
      { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId, position: 0 },
      ...reps.map((r, position) => ({
        type: "putSet" as const,
        id: crypto.randomUUID(),
        workoutExerciseId,
        position,
        setType: "normal" as const,
        weight,
        unit: "lb" as const,
        reps: r,
        completed: true,
      })),
      { type: "finishWorkout", id: workoutId, finishedAt: startedAt },
    ],
  });
}

/** Planned Machine Bench Press loads on the upcoming Tuesdays. */
async function upcomingLoads(commands: Commands) {
  const loads: (number | null)[] = [];
  for (const date of ["2026-10-20", "2026-10-27", "2026-11-03"]) {
    const { session } = readable(await commands.getToday({ date }));
    loads.push(session!.exercises[0]!.sets[0]!.weight);
  }
  return loads;
}

/** Tuesday evening in Los Angeles: 180 lb × 15 on every set. */
const hitTheTop = (commands: Commands, chestPress: string) =>
  logWorkout(commands, chestPress, "2026-10-13T19:30:00-07:00", 180, [15, 15, 15]);

describe("plan revisions", () => {
  it("a progression bump applies and is persisted as a revision with diff, reasons, source and status", async () => {
    const commands = await signedInOwner();
    const chestPress = await chestBlock(commands);
    expect(readable(await commands.listPlanRevisions({})).revisions).toEqual([]);

    await hitTheTop(commands, chestPress);

    expect(await upcomingLoads(commands)).toEqual([185, 185, 185]);
    const { revisions } = readable(await commands.listPlanRevisions({}));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      source: "engine",
      status: "applied",
      summary: "Machine Bench Press goes up to 185 lb",
      reasons: ["Hit 15 reps on all 3 sets at 180 lb, so next time is 185 lb"],
    });
    expect(ex(revisions[0]!).map((d) => [d.date, d.before.sets[0]!.weight, d.after.sets[0]!.weight])).toEqual([
      ["2026-10-20", 180, 185],
      ["2026-10-27", 180, 185],
      ["2026-11-03", 180, 185],
    ]);

    expect(readable(await commands.listPlanRevisions({ status: ["applied"], withinDays: 7 })).revisions).toHaveLength(1);
    expect(readable(await commands.listPlanRevisions({ status: ["pending"] })).revisions).toEqual([]);

    // Re-planning again (another finished workout) doesn't duplicate it.
    await logWorkout(commands, chestPress, "2026-10-14T08:00:00-07:00", 50, []);
    expect(readable(await commands.listPlanRevisions({})).revisions).toHaveLength(1);
  });

  it("undo restores the previous plan, marks the revision undone, and the change stays off on later re-plans", async () => {
    const commands = await signedInOwner();
    const chestPress = await chestBlock(commands);
    await hitTheTop(commands, chestPress);
    const [revision] = readable(await commands.listPlanRevisions({})).revisions;

    const undone = readable(await commands.undoPlanRevision({ id: revision!.id }));

    expect(undone).toMatchObject({ id: revision!.id, status: "undone" });
    expect(await upcomingLoads(commands)).toEqual([180, 180, 180]);
    const { session } = readable(await commands.getToday({ date: "2026-10-20" }));
    expect(session!.exercises[0]!.progression.decision).toBe("start");

    await logWorkout(commands, chestPress, "2026-10-14T08:00:00-07:00", 50, []); // any re-plan
    expect(await upcomingLoads(commands)).toEqual([180, 180, 180]);
    expect(readable(await commands.listPlanRevisions({})).revisions.map((r) => r.status)).toEqual(["undone"]);

    await expect(commands.undoPlanRevision({ id: revision!.id })).rejects.toMatchObject({ code: "conflict" });
    await expect(commands.undoPlanRevision({ id: crypto.randomUUID() })).rejects.toMatchObject({ code: "not_found" });
  });

  it("after an undo, hitting the top again next session is a new change", async () => {
    const commands = await signedInOwner(engineOn("2026-10-21"));
    const chestPress = await chestBlock(commands);
    await on("2026-10-14", () => hitTheTop(commands, chestPress)); // logged the next morning
    await commands.undoPlanRevision({ id: (await commands.listPlanRevisions({})).revisions[0]!.id });

    await logWorkout(commands, chestPress, "2026-10-20T19:30:00-07:00", 180, [15, 15, 15]);

    expect((await upcomingLoads(commands)).slice(1)).toEqual([185, 185]);
    expect(readable(await commands.listPlanRevisions({})).revisions.map((r) => r.status)).toEqual(["applied", "undone"]);
  });

  it("a change needing confirmation is pending and leaves the plan alone until confirmed", async () => {
    const commands = await signedInOwner(confirmEverything);
    const chestPress = await chestBlock(commands);

    await hitTheTop(commands, chestPress);

    expect(await upcomingLoads(commands)).toEqual([180, 180, 180]);
    const { revisions } = readable(await commands.listPlanRevisions({ status: ["pending"] }));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ status: "pending", summary: "Machine Bench Press goes up to 185 lb" });

    await logWorkout(commands, chestPress, "2026-10-14T08:00:00-07:00", 50, []); // a re-plan doesn't duplicate or apply it
    expect(await upcomingLoads(commands)).toEqual([180, 180, 180]);
    expect(readable(await commands.listPlanRevisions({})).revisions).toHaveLength(1);

    expect(readable(await commands.confirmPlanRevision({ id: revisions[0]!.id }))).toMatchObject({ status: "applied" });
    expect(await upcomingLoads(commands)).toEqual([185, 185, 185]);

    // Confirmed = applied: undoable like any other.
    await commands.undoPlanRevision({ id: revisions[0]!.id });
    expect(await upcomingLoads(commands)).toEqual([180, 180, 180]);
  });

  it("rejecting a pending change leaves the plan alone, now and on later re-plans", async () => {
    const commands = await signedInOwner(confirmEverything);
    const chestPress = await chestBlock(commands);
    await hitTheTop(commands, chestPress);
    const [pending] = readable(await commands.listPlanRevisions({})).revisions;

    expect(await commands.rejectPlanRevision({ id: pending!.id })).toMatchObject({ status: "rejected" });
    await logWorkout(commands, chestPress, "2026-10-14T08:00:00-07:00", 50, []);

    expect(await upcomingLoads(commands)).toEqual([180, 180, 180]);
    expect(readable(await commands.listPlanRevisions({})).revisions.map((r) => r.status)).toEqual(["rejected"]);
    await expect(commands.confirmPlanRevision({ id: pending!.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("a revision saved before messages existed (free text, converted by the migration) still reads as it was", async () => {
    const commands = await signedInOwner();
    // Harness setup: a row as 20261014000200_text_messages converts an old one (text → JSON string).
    await db().sql`
      insert into public.plan_revisions (key, source, status, summary, reasons, diff)
      values ('old', 'engine', 'applied', to_jsonb('Bench goes up to 185 lb'::text),
        to_jsonb(array['Hit 15 reps on all 3 sets at 180 lb']::text[]), '[]')`;

    expect((await commands.listPlanRevisions({})).revisions).toMatchObject([
      { summary: "Bench goes up to 185 lb", reasons: ["Hit 15 reps on all 3 sets at 180 lb"] },
    ]);
  });
  it("a pending change the engine no longer proposes is superseded", async () => {
    const commands = await signedInOwner(confirmEverything);
    const chestPress = await chestBlock(commands);
    await hitTheTop(commands, chestPress);

    // A worse session the next morning: the plan now holds 180 lb instead.
    await logWorkout(commands, chestPress, "2026-10-14T08:00:00-07:00", 180, [12, 12, 12]);

    expect(readable(await commands.listPlanRevisions({})).revisions.map((r) => r.status)).toEqual(["superseded"]);
    expect(await upcomingLoads(commands)).toEqual([180, 180, 180]);
  });

  it("only the owner sees and changes revisions", async () => {
    const commands = await signedInOwner();
    const chestPress = await chestBlock(commands);
    await hitTheTop(commands, chestPress);
    const [revision] = readable(await commands.listPlanRevisions({})).revisions;

    const anon = db().commandsAs({ kind: "anon" });
    expect((await anon.listPlanRevisions({})).revisions).toEqual([]);
    await expect(anon.undoPlanRevision({ id: revision!.id })).rejects.toMatchObject({ code: "not_found" });
  });
});
