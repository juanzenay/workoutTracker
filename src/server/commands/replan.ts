import type { JSONValue, TransactionSql } from "postgres";
import type { RunActivity, Unavailability } from "@/domain/availability";
import type { Injury } from "@/domain/injury";
import type { PlanMoves } from "@/domain/plan-move";
import type { PlannedRun, Race, RunPlan } from "@/domain/running";
import { loadUnavailability } from "./availability";
import { loadInjuries } from "./injuries";
import { loadMoves } from "./plan-moves";
import type { Engine, Push } from "./define";
import {
  loadBlocks,
  loadHistory,
  loadRaces,
  loadRunPlans,
  plannedColumns,
  toPlanned,
  type PlannedRow,
  type StoredBlock,
} from "./plan-data";
import { recordChanges, runsWithSide, sessionsWithSide, supersedeStale } from "./plan-revisions";
import { matchRuns, RUN_SPORT_TYPES, runOutcomesKnown } from "./run-matching";

/**
 * The one re-plan: runs the engine over every block, race, run plan, the days
 * marked unavailable and (as far as they are known) completed runs, and persists
 * its output — planned runs (upsert on plan + row, so ids are stable when a
 * race moves) and each block's planned sessions (upsert on block session +
 * date; lifting reads races and runs for the interaction rules). Whatever the
 * engine no longer plans is deleted. Engine changes are recorded as plan
 * revisions (./plan-revisions.ts); held ones (pending, undone, rejected) stay
 * off the plan.
 *
 * Call after anything that changes the engine's inputs or the day: blocks,
 * finished workouts, imports, races, run plans, unavailability, Strava
 * activities, activity file imports, and the daily job (missed sessions and runs). Pass `ctx.engine`
 * and `ctx.now()`. Planned runs are re-matched to activities.
 */
export async function replan(
  tx: TransactionSql,
  engine: Engine,
  push: Push,
  at: Date,
  /** Fold the changes this re-plan causes into this coach revision (CommandContext.coachChangeId). */
  coachChangeId?: string,
): Promise<void> {
  const [blocks, races, runPlans, unavailable, injuries, runActivities, moves] = await Promise.all([
    loadBlocks(tx, { draft: false }),
    loadRaces(tx),
    loadRunPlans(tx),
    loadUnavailability(tx),
    loadInjuries(tx),
    loadRunActivities(tx),
    loadMoves(tx),
  ]);
  const emittedKeys: string[] = [];

  // Runs first: they move around lifting as the blocks schedule it, and lifting then plans around them.
  const [now] = await tx<{ today: string }[]>`
    select to_char(now() at time zone ${await planTimeZone(tx)}, 'YYYY-MM-DD') as today`;
  const currentRuns = await loadPlannedRuns(tx);
  // A run plan with no planned runs yet was just imported: planning it (and lifting around it) is not a change.
  const planned = new Set(currentRuns.map((r) => r.runPlanId));
  const newRunPlans = runPlans.filter((p) => !planned.has(p.id)).map((p) => p.id);
  const runOutput = engine({
    blocks,
    history: [],
    today: now!.today,
    races,
    runPlans,
    unavailable,
    runActivities: runActivities.activities,
    runOutcomesBefore: runActivities.before,
    currentRuns,
    newRunPlans,
    moves,
  });
  const runHeld = await recordChanges(tx, push, null, runOutput.changes, coachChangeId);
  emittedKeys.push(...runOutput.changes.map((c) => c.key));
  await saveRuns(tx, runsWithSide(runOutput.plannedRuns, runHeld, "before"));
  await matchRuns(tx, at);
  const plannedRuns = await loadPlannedRuns(tx);

  for (const block of blocks) {
    emittedKeys.push(
      ...(await replanBlock(tx, engine, push, block, { races, runPlans, unavailable, injuries, plannedRuns, newRunPlans, moves }, coachChangeId)),
    );
  }
  await supersedeStale(tx, emittedKeys);
}

/** One block (its history and `today` are in its time zone); returns the change keys the engine emitted. */
async function replanBlock(
  tx: TransactionSql,
  engine: Engine,
  push: Push,
  block: StoredBlock,
  inputs: {
    races: Race[];
    runPlans: RunPlan[];
    unavailable: Unavailability[];
    injuries: Injury[];
    plannedRuns: PlannedRun[];
    newRunPlans: string[];
    moves: PlanMoves;
  },
  coachChangeId?: string,
) {
  const history = await loadHistory(tx, block.timeZone);
  const [now] = await tx<{ today: string }[]>`
    select to_char(now() at time zone ${block.timeZone}, 'YYYY-MM-DD') as today`;
  const currentPlan = (
    await tx<PlannedRow[]>`select ${plannedColumns(tx)} from public.planned_sessions where block_id = ${block.id}`
  ).map(toPlanned);
  const output = engine({ blocks: [block], history, today: now!.today, currentPlan, ...inputs });
  // Changes become plan revisions; ones waiting for (or refused by) the owner stay off the plan.
  const held = await recordChanges(tx, push, block.id, output.changes, coachChangeId);
  const plannedSessions = sessionsWithSide(output.plannedSessions, held, "before");
  const kept: string[] = [];
  for (const session of plannedSessions) {
    const [row] = await tx<{ id: string }[]>`
      insert into public.planned_sessions (block_id, block_session_id, date, week, name, deload, exercises)
      values (${session.blockId}, ${session.blockSessionId}, ${session.date}, ${session.week}, ${session.name},
        ${session.deload ?? false}, ${tx.json(session.exercises as unknown as JSONValue)})
      on conflict (block_session_id, date) do update
        set week = excluded.week, name = excluded.name, deload = excluded.deload, exercises = excluded.exercises,
          updated_at = now()
      returning id`;
    kept.push(row!.id);
  }
  await tx`
    delete from public.planned_sessions
    where block_id = ${block.id} and not (id = any(${tx.array(kept)}::uuid[]))`;
  return output.changes.map((c) => c.key);
}

/** The plan's time zone for running: the newest started block's, else the newest run plan's, else UTC. */
export async function planTimeZone(tx: TransactionSql): Promise<string> {
  const [row] = await tx<{ zone: string }[]>`
    select coalesce(
      (select time_zone from public.blocks where not draft order by start_date desc, created_at desc limit 1),
      (select time_zone from public.run_plans order by created_at desc limit 1), 'UTC'
    ) as zone`;
  return row!.zone;
}

/**
 * Completed runs by local date, from every source, and how far they are known (./run-matching.ts
 * `runOutcomesKnown`): none known = undefined, so nothing is missed.
 */
async function loadRunActivities(tx: TransactionSql): Promise<{ activities?: RunActivity[]; before?: string }> {
  const outcomes = await runOutcomesKnown(tx);
  if (!outcomes.known) return {};
  const rows = await tx<{ date: string; meters: string; seconds: number }[]>`
    select to_char(local_date, 'YYYY-MM-DD') as date, sum(distance_meters)::text as meters,
      coalesce(sum(moving_seconds), 0)::int as seconds
    from public.activities
    where sport_type = any(${tx.array([...RUN_SPORT_TYPES])}::text[])
    group by local_date order by local_date`;
  return {
    activities: rows.map((r) => ({ date: r.date, meters: Number(r.meters), seconds: r.seconds })),
    before: outcomes.before ?? undefined,
  };
}

export async function loadPlannedRuns(tx: TransactionSql): Promise<PlannedRun[]> {
  const rows = await tx<
    {
      run_plan_id: string;
      row_index: number;
      date: string;
      week: number;
      type: PlannedRun["type"];
      distance_meters: number | null;
      duration_seconds: number | null;
      pace_target: PlannedRun["paceTarget"];
      structure: PlannedRun["structure"];
      notes: string | null;
    }[]
  >`
    select run_plan_id, row_index, to_char(date, 'YYYY-MM-DD') as date, week, type, distance_meters, duration_seconds,
      pace_target, structure, notes
    from public.planned_runs order by date, run_plan_id, row_index`;
  return rows.map((r) => ({
    runPlanId: r.run_plan_id,
    rowIndex: r.row_index,
    date: r.date,
    week: r.week,
    type: r.type,
    distanceMeters: r.distance_meters,
    durationSeconds: r.duration_seconds,
    paceTarget: r.pace_target,
    structure: r.structure,
    notes: r.notes,
  }));
}

const json = (tx: TransactionSql, value: unknown) => (value === null ? null : tx.json(value as JSONValue));

async function saveRuns(tx: TransactionSql, plannedRuns: PlannedRun[]) {
  const kept: string[] = [];
  for (const run of plannedRuns) {
    const [row] = await tx<{ id: string }[]>`
      insert into public.planned_runs
        (run_plan_id, row_index, date, week, type, distance_meters, duration_seconds, pace_target, structure, notes)
      values (${run.runPlanId}, ${run.rowIndex}, ${run.date}, ${run.week}, ${run.type}, ${run.distanceMeters},
        ${run.durationSeconds}, ${json(tx, run.paceTarget)}, ${json(tx, run.structure)}, ${run.notes})
      on conflict (run_plan_id, row_index) do update
        set date = excluded.date, week = excluded.week, type = excluded.type, distance_meters = excluded.distance_meters,
          duration_seconds = excluded.duration_seconds, pace_target = excluded.pace_target, structure = excluded.structure,
          notes = excluded.notes, updated_at = now()
      returning id`;
    kept.push(row!.id);
  }
  await tx`delete from public.planned_runs where not (id = any(${tx.array(kept)}::uuid[]))`;
}
