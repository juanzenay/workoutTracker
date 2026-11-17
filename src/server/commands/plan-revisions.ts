import type { JSONValue, TransactionSql } from "postgres";
import { z } from "zod";
import type { PlannedExercise, PlannedSession } from "@/domain/block";
import type { PlannedRun } from "@/domain/running";
import {
  REVISION_STATUSES,
  type ExerciseDiff,
  type RunDiff,
  type SessionDiff,
  type PlanChange,
  type PlanDiffItem,
  type PlanRevision,
  type RevisionSource,
  type RevisionStatus,
} from "@/domain/plan-change";
import { sameJson } from "@/domain/json";
import type { Text } from "@/domain/message";
import { CommandError, defineCommand, type Push } from "./define";
import { undoCoachChange, type CoachData } from "./coach";
import { raiseInbox } from "./inbox";
import { matchRuns } from "./run-matching";

/**
 * Change policy. The engine emits changes (src/engine/changes.ts, interactions.ts,
 * replan.ts; policy.ts sets which ones need confirmation and which are initial); here each becomes a
 * plan revision:
 * - new change, no confirmation needed → applied (stays in the plan), revision `applied`;
 * - new change needing confirmation → revision `pending`, plan keeps the `before` side;
 * - key already pending → its diff/reasons are refreshed, plan keeps `before`;
 * - key undone or rejected → plan keeps `before` (the owner said no);
 * - key already applied (or initial) → nothing new;
 * - new initial change (part of first planning a new block or run plan) → revision `initial`: on the plan, never
 *   shown or announced (it only keeps the key known).
 * Pending engine revisions whose key the engine no longer emits become `superseded`.
 * Every new revision is announced in the inbox: pending → important item + Web Push,
 * applied → minor item, no push.
 *
 * While a coach change is applied (`coachChangeId`), new changes are part of it:
 * applied at once (the owner approved in chat) and recorded as its children
 * (not shown or announced on their own) — see ./coach.ts.
 */

interface RevisionRow {
  id: string;
  key: string;
  source: RevisionSource;
  status: RevisionStatus;
  summary: Text;
  reasons: Text[];
  diff: PlanDiffItem[];
  /** Coach revisions: the action and what undo restores (./coach.ts). */
  coach: CoachData | null;
  created_at: Date;
  updated_at: Date;
}

const toRevision = (row: RevisionRow): PlanRevision => ({
  id: row.id,
  key: row.key,
  source: row.source,
  status: row.status,
  summary: row.summary,
  reasons: row.reasons,
  diff: row.diff,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

/**
 * Records `changes` (emitted by the engine in one re-plan: one block's, or the
 * runs') as revisions and returns the changes that must not apply yet (or
 * ever): the caller reverts them to their `before` side (`sessionsWithSide`,
 * `runsWithSide`) before persisting. Call from replan (./replan.ts).
 */
export async function recordChanges(
  tx: TransactionSql,
  push: Push,
  blockId: string | null,
  changes: PlanChange[],
  coachChangeId?: string,
): Promise<PlanChange[]> {
  if (changes.length === 0) return [];
  const latest = await tx<{ id: string; key: string; status: RevisionStatus }[]>`
    select distinct on (key) id, key, status from public.plan_revisions
    where key = any(${tx.array(changes.map((c) => c.key))}::text[])
    order by key, created_at desc`;
  const byKey = new Map(latest.map((r) => [r.key, r]));

  const held: PlanChange[] = [];
  for (const change of changes) {
    const existing = byKey.get(change.key);
    if (existing?.status === "applied" || existing?.status === "initial") continue;
    if (existing?.status === "pending") {
      await tx`
        update public.plan_revisions
        set summary = ${texts(tx, change.summary)}, reasons = ${texts(tx, change.reasons)},
          diff = ${tx.json(change.diff as unknown as JSONValue)}, updated_at = now()
        where id = ${existing.id}`;
      held.push(change);
    } else if (existing?.status === "undone" || existing?.status === "rejected") {
      held.push(change); // the owner said no
    } else if (change.initial && !coachChangeId) {
      // Part of first planning it: on the plan, recorded so later re-plans know the key, never shown or announced.
      await tx`
        insert into public.plan_revisions (key, block_id, source, status, summary, reasons, diff)
        values (${change.key}, ${blockId}, 'engine', 'initial', ${texts(tx, change.summary)}, ${texts(tx, change.reasons)},
          ${tx.json(change.diff as unknown as JSONValue)})`;
    } else if (coachChangeId) {
      await tx`
        insert into public.plan_revisions (key, block_id, source, status, summary, reasons, diff, parent_id)
        values (${change.key}, ${blockId}, 'coach', 'applied', ${texts(tx, change.summary)}, ${texts(tx, change.reasons)},
          ${tx.json(change.diff as unknown as JSONValue)}, ${coachChangeId})`;
    } else {
      const status: RevisionStatus = change.requiresConfirmation ? "pending" : "applied";
      const [revision] = await tx<{ id: string }[]>`
        insert into public.plan_revisions (key, block_id, source, status, summary, reasons, diff)
        values (${change.key}, ${blockId}, 'engine', ${status}, ${texts(tx, change.summary)}, ${texts(tx, change.reasons)},
          ${tx.json(change.diff as unknown as JSONValue)})
        returning id`;
      await announceRevision({ tx, push }, { id: revision!.id, status, summary: change.summary, reasons: change.reasons });
      if (status === "pending") held.push(change);
    }
  }
  return held;
}

/** Inbox item for a new revision: one waiting for the owner is important (pushed); an applied one is minor. */
export async function announceRevision(
  ctx: { tx: TransactionSql; push: Push },
  revision: { id: string; status: RevisionStatus; summary: Text; reasons: Text[] },
): Promise<void> {
  const pending = revision.status === "pending";
  await raiseInbox(ctx, {
    kind: pending ? "plan_change_pending" : "plan_change_applied",
    level: pending ? "important" : "minor",
    title: revision.summary,
    body: revision.reasons.length > 0 ? revision.reasons : null,
    url: `/plan-changes/${revision.id}`,
  });
}

/** Pending engine revisions the latest re-plan no longer proposes. */
export async function supersedeStale(tx: TransactionSql, emittedKeys: string[]): Promise<void> {
  await tx`
    update public.plan_revisions set status = 'superseded', updated_at = now()
    where status = 'pending' and source = 'engine' and not (key = any(${tx.array(emittedKeys)}::text[]))`;
}

const other = (side: "before" | "after") => (side === "before" ? "after" : "before");
const slot = (s: Pick<PlannedSession, "blockSessionId" | "date">) => `${s.blockSessionId}|${s.date}`;

/** `sessions` with every session-side diff item of `changes` set to its `side` (exercise targets, moves and drops). */
export function sessionsWithSide(sessions: PlannedSession[], changes: PlanChange[], side: "before" | "after"): PlannedSession[] {
  const bySlot = new Map(sessions.map((s) => [slot(s), s]));
  for (const item of changes.flatMap((c) => c.diff)) {
    if (item.type === "exercise") {
      const session = bySlot.get(slot(item));
      if (!session) continue;
      const exercises = session.exercises.map((e) => (e.blockExerciseId === item.blockExerciseId ? item[side] : e));
      bySlot.set(slot(item), { ...session, exercises, deload: deloadFlag(exercises).deload });
    } else if (item.type === "session") {
      const gone = item[other(side)];
      if (gone) bySlot.delete(slot(gone));
      const kept = item[side];
      if (kept) bySlot.set(slot(kept), kept);
    }
  }
  return [...bySlot.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** `runs` with every run diff item of `changes` set to its `side` (null = off the plan). */
export function runsWithSide(runs: PlannedRun[], changes: PlanChange[], side: "before" | "after"): PlannedRun[] {
  const key = (r: { runPlanId: string; rowIndex: number }) => `${r.runPlanId}:${r.rowIndex}`;
  const byKey = new Map(runs.map((r) => [key(r), r]));
  for (const item of changes.flatMap((c) => c.diff)) {
    if (item.type !== "run") continue;
    const kept = item[side];
    if (kept) byKey.set(key(item), kept);
    else byKey.delete(key(item));
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.rowIndex - b.rowIndex);
}

/**
 * Writes each diff item's `side` into the persisted plan. With `onlyIfAt`, an
 * item is written only while the plan still shows that side (so undo never
 * clobbers targets that moved on since). Exercise items whose session is gone
 * are skipped. Returns whether any planned run changed.
 */
async function writeSide(
  tx: TransactionSql,
  diff: PlanDiffItem[],
  side: "before" | "after",
  onlyIfAt?: "before" | "after",
): Promise<boolean> {
  let runs = false;
  for (const item of diff) {
    if (item.type === "exercise") await writeExercise(tx, item, side, onlyIfAt);
    else if (item.type === "session") await writeSession(tx, item, side, onlyIfAt);
    else runs = (await writeRun(tx, item, side, onlyIfAt)) || runs;
  }
  return runs;
}

async function writeExercise(tx: TransactionSql, item: ExerciseDiff, side: "before" | "after", onlyIfAt?: "before" | "after") {
  const [row] = await tx<{ id: string; exercises: PlannedExercise[] }[]>`
    select id, exercises from public.planned_sessions
    where block_session_id = ${item.blockSessionId} and date = ${item.date}`;
  if (!row) return;
  const index = row.exercises.findIndex((e) => e.blockExerciseId === item.blockExerciseId);
  if (index < 0) return;
  if (onlyIfAt && !sameJson(row.exercises[index], item[onlyIfAt])) return;
  const exercises = row.exercises.with(index, item[side]);
  await tx`
    update public.planned_sessions
    set exercises = ${tx.json(exercises as unknown as JSONValue)}, deload = ${deloadFlag(exercises).deload ?? false},
      updated_at = now()
    where id = ${row.id}`;
}

/** A session is a deload session when its exercises are (a deload change swaps the exercises' targets). */
function deloadFlag(exercises: PlannedExercise[]): { deload?: true } {
  return exercises.some((e) => e.progression.decision === "deload") ? { deload: true } : {};
}

async function writeSession(tx: TransactionSql, item: SessionDiff, side: "before" | "after", onlyIfAt?: "before" | "after") {
  const shown = onlyIfAt ? item[onlyIfAt] : null;
  if (shown) {
    const [row] = await tx`
      select 1 from public.planned_sessions where block_session_id = ${shown.blockSessionId} and date = ${shown.date}`;
    if (!row) return;
  }
  const gone = item[other(side)];
  if (gone) {
    await tx`delete from public.planned_sessions where block_session_id = ${gone.blockSessionId} and date = ${gone.date}`;
  }
  const kept = item[side];
  if (kept) {
    await tx`
      insert into public.planned_sessions (block_id, block_session_id, date, week, name, deload, exercises)
      values (${kept.blockId}, ${kept.blockSessionId}, ${kept.date}, ${kept.week}, ${kept.name}, ${kept.deload ?? false},
        ${tx.json(kept.exercises as unknown as JSONValue)})
      on conflict (block_session_id, date) do nothing`;
  }
}

async function writeRun(tx: TransactionSql, item: RunDiff, side: "before" | "after", onlyIfAt?: "before" | "after") {
  const [row] = await tx<{ date: string }[]>`
    select to_char(date, 'YYYY-MM-DD') as date from public.planned_runs
    where run_plan_id = ${item.runPlanId} and row_index = ${item.rowIndex}`;
  if (onlyIfAt && (row?.date ?? null) !== (item[onlyIfAt]?.date ?? null)) return false;
  const run = item[side];
  if (!run) {
    await tx`delete from public.planned_runs where run_plan_id = ${item.runPlanId} and row_index = ${item.rowIndex}`;
    return true;
  }
  const json = (value: unknown) => (value === null ? null : tx.json(value as JSONValue));
  await tx`
    insert into public.planned_runs
      (run_plan_id, row_index, date, week, type, distance_meters, duration_seconds, pace_target, structure, notes)
    values (${run.runPlanId}, ${run.rowIndex}, ${run.date}, ${run.week}, ${run.type}, ${run.distanceMeters},
      ${run.durationSeconds}, ${json(run.paceTarget)}, ${json(run.structure)}, ${run.notes})
    on conflict (run_plan_id, row_index) do update set date = excluded.date, updated_at = now()`;
  return true;
}

export { sameJson } from "@/domain/json";

/** Text (a message or free text) or a list of them, as a jsonb parameter. */
export const texts = (tx: TransactionSql, value: Text | Text[]) => tx.json(value as unknown as JSONValue);

const revisionColumns = (tx: TransactionSql) =>
  tx`id, key, source, status, summary, reasons, diff, coach, created_at, updated_at`;

async function revisionFor(tx: TransactionSql, id: string, expected: RevisionStatus): Promise<RevisionRow> {
  const [row] = await tx<RevisionRow[]>`
    select ${revisionColumns(tx)} from public.plan_revisions where id = ${id} for update`;
  if (!row) throw new CommandError("not_found", "No such plan revision");
  if (row.status !== expected) throw new CommandError("conflict", `Plan revision is ${row.status}, not ${expected}`);
  return row;
}

async function setStatus(tx: TransactionSql, id: string, status: RevisionStatus): Promise<PlanRevision> {
  const [row] = await tx<RevisionRow[]>`
    update public.plan_revisions set status = ${status}, updated_at = now() where id = ${id}
    returning ${revisionColumns(tx)}`;
  return toRevision(row!);
}

/** Revisions, newest first (coach proposals and initial ones only when `status` asks for them). `status` narrows; `withinDays` keeps those created in the last N days. */
export const listPlanRevisions = defineCommand({
  input: z.object({
    status: z.array(z.enum(REVISION_STATUSES)).min(1).optional(),
    withinDays: z.number().int().min(1).max(3650).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  async run({ tx }, { status, withinDays, limit }) {
    const rows = await tx<RevisionRow[]>`
      select ${revisionColumns(tx)} from public.plan_revisions
      where parent_id is null
        ${status ? tx`and status = any(${tx.array(status)}::text[])` : tx`and status not in ('proposed', 'initial')`}
        ${withinDays ? tx`and created_at >= now() - make_interval(days => ${withinDays})` : tx``}
      order by created_at desc, id
      limit ${limit}`;
    return { revisions: rows.map(toRevision) };
  },
});

/** One revision (what an inbox item or push notification opens). */
export const getPlanRevision = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, { id }) {
    const [row] = await tx<RevisionRow[]>`select ${revisionColumns(tx)} from public.plan_revisions where id = ${id}`;
    if (!row) throw new CommandError("not_found", "No such plan revision");
    return toRevision(row);
  },
});

/**
 * One tap: restores the plan as it was before an applied change (where it still
 * shows the change) and marks it undone. A coach change is undone by restoring
 * what it changed in the engine's inputs and re-planning (./coach.ts).
 */
export const undoPlanRevision = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run(ctx, { id }) {
    const { tx, now } = ctx;
    const row = await revisionFor(tx, id, "applied");
    if (row.coach) await undoCoachChange(ctx, id, row.coach);
    else if (await writeSide(tx, row.diff, "before", "after")) await matchRuns(tx, now());
    return setStatus(tx, id, "undone");
  },
});

/** Applies a pending change to the plan. */
export const confirmPlanRevision = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx, now }, { id }) {
    const row = await revisionFor(tx, id, "pending");
    if (await writeSide(tx, row.diff, "after")) await matchRuns(tx, now());
    return setStatus(tx, id, "applied");
  },
});

/** Declines a pending change; the plan is untouched and the engine won't apply the same change again. */
export const rejectPlanRevision = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, { id }) {
    await revisionFor(tx, id, "pending");
    return setStatus(tx, id, "rejected");
  },
});
