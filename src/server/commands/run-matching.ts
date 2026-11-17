import type { TransactionSql } from "postgres";
import type { IsoDate } from "@/domain/block";
import type { RunType } from "@/domain/running";

/**
 * Matches stored activities (Strava's and imported files') to planned runs and records each planned
 * run's outcome. Recomputed from scratch every time (idempotent), so it is
 * safe to call after any ingestion, re-plan, or from the end-of-day job:
 *
 * - An activity counts when it is a run (RUN_SPORT_TYPES) and its local start
 *   date (where it happened) is the planned run's date. Rest and cross days
 *   never match.
 * - Several runs that day for one planned run add up (a run split in two, a
 *   warm-up before a race). With several planned runs that day (doubles),
 *   activities go to them in order and any extra ones to the last.
 * - done: at least DONE_RATIO of the planned distance (or duration, if the run
 *   is planned by time; any run counts when neither is planned).
 *   partial: less than that — the gap is plan minus actual.
 *   missed: no run, the day is over in the plan's time zone, and outcomes are
 *   known for it (`runOutcomesKnown`).
 *   null: still to come (or a rest/cross day).
 */

export const RUN_SPORT_TYPES = ["Run", "TrailRun", "VirtualRun"] as const;
export const DONE_RATIO = 0.95;
const UNMATCHED_TYPES: RunType[] = ["rest", "cross"];

export type RunStatus = "done" | "partial" | "missed";

interface PlannedRow {
  id: string;
  date: IsoDate;
  row_index: number;
  run_plan_id: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  past: boolean;
}

interface ActivityRow {
  id: string;
  local_date: IsoDate;
  distance_meters: string;
  moving_seconds: number | null;
}

/**
 * How far completed runs are known: with Strava connected, every day that is
 * over (activities arrive as they happen); without it, only days before the
 * latest day an activity file import reached (`before`) — imports come in
 * late, so a run with nothing logged after that isn't judged missed yet.
 * Neither: nothing is known, and no run is missed.
 */
export type RunOutcomes = { known: false } | { known: true; before: IsoDate | null };

export async function runOutcomesKnown(tx: TransactionSql): Promise<RunOutcomes> {
  const [row] = await tx<{ strava: boolean; covered: string | null }[]>`
    select exists (select 1 from public.strava_connection) as strava,
      (select to_char(covered_through, 'YYYY-MM-DD') from public.activity_import_coverage) as covered`;
  if (row!.strava) return { known: true, before: null };
  if (row!.covered) return { known: true, before: row!.covered };
  return { known: false };
}

export async function matchRuns(tx: TransactionSql, now: Date): Promise<void> {
  const outcomes = await runOutcomesKnown(tx);
  const before = outcomes.known ? outcomes.before : null;
  const planned = await tx<PlannedRow[]>`
    select r.id, to_char(r.date, 'YYYY-MM-DD') as date, r.row_index, r.run_plan_id, r.distance_meters, r.duration_seconds,
      ${outcomes.known} and r.date < (${now}::timestamptz at time zone p.time_zone)::date
        and (${before}::date is null or r.date < ${before}::date) as past
    from public.planned_runs r join public.run_plans p on p.id = r.run_plan_id
    where not (r.type = any(${tx.array(UNMATCHED_TYPES)}::text[]))
    order by r.date, r.run_plan_id, r.row_index`;
  const activities = await tx<ActivityRow[]>`
    select id::text, to_char(local_date, 'YYYY-MM-DD') as local_date, distance_meters::text, moving_seconds
    from public.activities
    where sport_type = any(${tx.array([...RUN_SPORT_TYPES])}::text[])
    order by start_date, id`;

  const byDate = new Map<IsoDate, ActivityRow[]>();
  for (const a of activities) byDate.set(a.local_date, [...(byDate.get(a.local_date) ?? []), a]);

  const matches: { activityId: string; plannedRunId: string }[] = [];
  const results: { id: string; status: RunStatus | null; meters: number | null; seconds: number | null }[] = [];
  const dates = [...new Set(planned.map((p) => p.date))];
  for (const date of dates) {
    const runs = planned.filter((p) => p.date === date);
    const done = byDate.get(date) ?? [];
    const assigned = runs.map(() => [] as ActivityRow[]);
    done.forEach((a, i) => assigned[Math.min(i, runs.length - 1)]!.push(a));
    runs.forEach((run, i) => {
      const mine = assigned[i]!;
      for (const a of mine) matches.push({ activityId: a.id, plannedRunId: run.id });
      if (mine.length === 0) {
        results.push({ id: run.id, status: run.past ? "missed" : null, meters: null, seconds: null });
        return;
      }
      const meters = Math.round(mine.reduce((sum, a) => sum + Number(a.distance_meters), 0) * 10) / 10;
      const seconds = mine.reduce((sum, a) => sum + (a.moving_seconds ?? 0), 0);
      const ratio = run.distance_meters
        ? meters / run.distance_meters
        : run.duration_seconds
          ? seconds / run.duration_seconds
          : 1;
      results.push({ id: run.id, status: ratio >= DONE_RATIO ? "done" : "partial", meters, seconds });
    });
  }

  await tx`update public.activities set planned_run_id = null where planned_run_id is not null`;
  for (const m of matches) {
    await tx`update public.activities set planned_run_id = ${m.plannedRunId} where id = ${m.activityId}`;
  }
  await tx`
    update public.planned_runs set status = null, actual_meters = null, actual_seconds = null
    where type = any(${tx.array(UNMATCHED_TYPES)}::text[]) and (status is not null or actual_meters is not null)`;
  for (const o of results) {
    await tx`
      update public.planned_runs set status = ${o.status}, actual_meters = ${o.meters}, actual_seconds = ${o.seconds}
      where id = ${o.id}`;
  }
}
