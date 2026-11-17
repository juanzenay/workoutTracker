import { z } from "zod";
import type { IsoDate } from "@/domain/block";
import { addDays, daysBetween } from "@/engine/dates";
import { planTimeZone, planToday, sessionOrder } from "./blocks";
import { plannedColumns, toPlanned, type PlannedRow, type StoredPlannedSession } from "./plan-data";
import { CommandError, defineCommand } from "./define";
import type { RunStatus as RunOutcome } from "./run-matching";
import { plannedRunColumns, toPlannedRun, type PlannedRunRow, type StoredPlannedRun } from "./running";

/**
 * - `completed`: a workout was finished that day (in the block's time zone)
 * - `missed`: the day is past and nothing was logged
 * - `planned`: today or later, not done yet
 */
export type SessionStatus = "completed" | "missed" | "planned";

/**
 * - `done` / `partial` / `missed`: the outcome from Strava or imported activity files (see ./run-matching.ts); `gapMeters` on partial
 * - `planned`: today or later
 * - `rest`: a rest day in the plan
 * - `not_recorded`: past, and no outcome yet (no Strava and nothing imported, or imports don't reach a later day yet)
 */
export type RunStatus = RunOutcome | "planned" | "rest" | "not_recorded";

export interface CalendarSession extends StoredPlannedSession {
  blockName: string;
  status: SessionStatus;
}

export interface CalendarRun extends Omit<StoredPlannedRun, "status"> {
  planName: string;
  status: RunStatus;
}

export interface CalendarWorkout {
  id: string;
  name: string | null;
  startedAt: string;
  finishedAt: string;
}

export interface CalendarDay {
  date: IsoDate;
  sessions: CalendarSession[];
  runs: CalendarRun[];
  /** Finished workouts started that day (plan time zone), planned or not. */
  workouts: CalendarWorkout[];
}

export const MAX_CALENDAR_DAYS = 92;

const isoDate = z.iso.date();

/**
 * The owner's calendar between `from` and `to` (inclusive; default today and
 * the 13 days after): every day with its planned lifting sessions, planned
 * runs (with structure and pace targets) and the workouts logged, each
 * planned item carrying a status.
 */
export const getCalendar = defineCommand({
  input: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
  async run({ tx }, input) {
    const zone = await planTimeZone(tx);
    const today = await planToday(tx, zone);
    const from = input.from ?? today;
    const to = input.to ?? addDays(from, 13);
    const span = daysBetween(from, to) + 1;
    if (span < 1) throw new CommandError("invalid_input", "The calendar range ends before it starts");
    if (span > MAX_CALENDAR_DAYS)
      throw new CommandError("invalid_input", `The calendar covers at most ${MAX_CALENDAR_DAYS} days at a time`);

    const sessionRows = await tx<(PlannedRow & { block_name: string; done: boolean })[]>`
      select ${plannedColumns(tx)},
        (select b.name from public.blocks b where b.id = planned_sessions.block_id) as block_name,
        exists (
          select 1 from public.workouts w, public.blocks b
          where b.id = planned_sessions.block_id and w.finished_at is not null and w.discarded_at is null
            and (w.started_at at time zone b.time_zone)::date = planned_sessions.date
        ) as done
      from public.planned_sessions
      where date between ${from}::date and ${to}::date
      order by ${sessionOrder(tx)}`;
    const runRows = await tx<(PlannedRunRow & { plan_name: string })[]>`
      select ${plannedRunColumns(tx)},
        (select p.name from public.run_plans p where p.id = planned_runs.run_plan_id) as plan_name
      from public.planned_runs
      where date between ${from}::date and ${to}::date
      order by date, run_plan_id, row_index`;
    const workoutRows = await tx<
      { id: string; name: string | null; date: string; started_at: Date; finished_at: Date }[]
    >`
      select id, name, started_at, finished_at,
        to_char(started_at at time zone ${zone}, 'YYYY-MM-DD') as date
      from public.workouts
      where finished_at is not null and discarded_at is null
        and started_at between ${from}::date - 1 and ${to}::date + 2
      order by started_at`;

    const sessions: CalendarSession[] = sessionRows.map((row) => ({
      ...toPlanned(row),
      blockName: row.block_name,
      status: row.done ? "completed" : row.date < today ? "missed" : "planned",
    }));
    const runs: CalendarRun[] = runRows.map((row) => ({
      ...toPlannedRun(row),
      planName: row.plan_name,
      status: row.status ?? (row.type === "rest" ? "rest" : row.date < today ? "not_recorded" : "planned"),
    }));
    const days: CalendarDay[] = Array.from({ length: span }, (_, i) => {
      const date = addDays(from, i);
      return {
        date,
        sessions: sessions.filter((s) => s.date === date),
        runs: runs.filter((r) => r.date === date),
        workouts: workoutRows
          .filter((w) => w.date === date)
          .map((w) => ({
            id: w.id,
            name: w.name,
            startedAt: w.started_at.toISOString(),
            finishedAt: w.finished_at.toISOString(),
          })),
      };
    });
    return { from, to, today, days };
  },
});
