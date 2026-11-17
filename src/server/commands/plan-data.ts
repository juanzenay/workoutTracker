import type { TransactionSql } from "postgres";
import type {
  Block,
  HistoryWorkout,
  IsoDate,
  PlannedExercise,
  PlannedSession,
  ProgressionRule,
  Weekday,
} from "@/domain/block";
import type { Muscle } from "@/domain/exercise";
import type { Race, RacePriority, RunPlan, RunPlanRow } from "@/domain/running";
import type { SetType, WeightUnit } from "@/domain/workout";

/**
 * Loading what the engine reads (blocks, history, races, run plans) and the
 * persisted plan, shared by the commands and by `replan` (./replan.ts).
 */

/** A planned session as persisted (engine output + its row id). */
export interface StoredPlannedSession extends PlannedSession {
  id: string;
  deload: boolean;
}

interface BlockRow {
  id: string;
  name: string;
  start_date: string;
  weeks: number;
  time_zone: string;
  deload_weeks: number[];
  end_date: string;
  archived: boolean;
  draft: boolean;
  notes: string | null;
  sessions: {
    id: string;
    name: string;
    weekday: number;
    position: number;
    exercises: {
      id: string;
      exercise_id: string;
      name: string;
      position: number;
      sets: number;
      rep_range_start: number;
      rep_range_end: number;
      start_weight: number | string | null;
      unit: WeightUnit;
      increment: number | string;
      rule: ProgressionRule;
      ramp_to: number | null;
      muscles: Muscle[];
    }[];
  }[];
}

/** A block as the command layer returns it: the engine's block plus its last day and archive status. */
export interface StoredBlock extends Block {
  deloadWeeks: number[];
  /** Last day of the block: its last week's Sunday, or the day before the block that replaced it started. */
  endDate: IsoDate;
  /**
   * Finished (its last day is before today, in its zone) or replaced by a started draft.
   * Archived blocks are kept for browsing.
   */
  archived: boolean;
  /** Not started: reviewed and edited in workout tracker, plans no sessions until `startBlock`. */
  draft: boolean;
  /** Why the block is designed this way (the coach's rationale for a draft); null = none. */
  notes: string | null;
}

const toBlock = (row: BlockRow): StoredBlock => ({
  id: row.id,
  name: row.name,
  startDate: row.start_date,
  weeks: row.weeks,
  timeZone: row.time_zone,
  deloadWeeks: row.deload_weeks,
  endDate: row.end_date,
  archived: row.archived,
  draft: row.draft,
  notes: row.notes,
  sessions: row.sessions.map((s) => ({
    id: s.id,
    name: s.name,
    weekday: s.weekday as Weekday,
    position: s.position,
    exercises: s.exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exercise_id,
      name: e.name,
      position: e.position,
      sets: e.sets,
      repRangeStart: e.rep_range_start,
      repRangeEnd: e.rep_range_end,
      startWeight: e.start_weight === null ? null : Number(e.start_weight),
      unit: e.unit,
      increment: Number(e.increment),
      rule: e.rule,
      rampTo: e.ramp_to,
      muscles: e.muscles,
    })),
  })),
});

/** SQL for the last day of block `b`: its last week's last day, or `ended_on` when it was ended early. */
export const blockEnd = (tx: TransactionSql) => tx`least(b.start_date + b.weeks * 7 - 1, b.ended_on)`;

/** Blocks with sessions and exercises, newest start first; `id` narrows to one, `archived` and `draft` filter. */
export async function loadBlocks(
  tx: TransactionSql,
  { id, archived, draft }: { id?: string; archived?: boolean; draft?: boolean } = {},
): Promise<StoredBlock[]> {
  const rows = await tx<BlockRow[]>`
    select * from (
    select b.id, b.name, to_char(b.start_date, 'YYYY-MM-DD') as start_date, b.weeks, b.time_zone, b.deload_weeks,
      to_char(${blockEnd(tx)}, 'YYYY-MM-DD') as end_date,
      not b.draft and (b.ended_on is not null or ${blockEnd(tx)} < (now() at time zone b.time_zone)::date) as archived,
      b.draft, b.notes, b.created_at,
      coalesce((
        select json_agg(json_build_object(
          'id', s.id, 'name', s.name, 'weekday', s.weekday, 'position', s.position,
          'exercises', coalesce((
            select json_agg(json_build_object(
              'id', be.id, 'exercise_id', be.exercise_id, 'name', e.name, 'position', be.position,
              'sets', be.sets, 'rep_range_start', be.rep_range_start, 'rep_range_end', be.rep_range_end,
              'start_weight', be.start_weight, 'unit', be.unit, 'increment', be.increment, 'rule', be.rule,
              'ramp_to', be.ramp_to, 'muscles', e.primary_muscles
            ) order by be.position)
            from public.block_exercises be join public.exercises e on e.id = be.exercise_id
            where be.block_session_id = s.id
          ), '[]'::json)
        ) order by s.position)
        from public.block_sessions s where s.block_id = b.id
      ), '[]'::json) as sessions
    from public.blocks b
    ${id ? tx`where b.id = ${id}` : tx``}
    ) b
    where true
    ${archived === undefined ? tx`` : tx`and archived = ${archived}`}
    ${draft === undefined ? tx`` : tx`and draft = ${draft}`}
    order by start_date desc, created_at desc`;
  return rows.map(toBlock);
}

/** Finished workouts, dated by their start in `timeZone`, as the engine reads them. */
export async function loadHistory(tx: TransactionSql, timeZone: string): Promise<HistoryWorkout[]> {
  const rows = await tx<
    {
      date: string;
      exercises: {
        exercise_id: string;
        sets: {
          set_type: SetType;
          weight: number | string | null;
          unit: WeightUnit;
          reps: number | null;
          rir: number | null;
          completed: boolean;
        }[];
      }[];
    }[]
  >`
    select to_char(w.started_at at time zone ${timeZone}, 'YYYY-MM-DD') as date,
      coalesce((
        select json_agg(json_build_object(
          'exercise_id', we.exercise_id,
          'sets', coalesce((
            select json_agg(json_build_object(
              'set_type', s.set_type, 'weight', s.weight, 'unit', s.unit, 'reps', s.reps, 'rir', s.rir, 'completed', s.completed
            ) order by s.position, s.created_at)
            from public.workout_sets s where s.workout_exercise_id = we.id
          ), '[]'::json)
        ) order by we.position)
        from public.workout_exercises we where we.workout_id = w.id
      ), '[]'::json) as exercises
    from public.workouts w
    where w.finished_at is not null and w.discarded_at is null
    order by w.started_at`;
  return rows.map((row) => ({
    date: row.date,
    exercises: row.exercises.map((e) => ({
      exerciseId: e.exercise_id,
      sets: e.sets.map((s) => ({
        setType: s.set_type,
        weight: s.weight === null ? null : Number(s.weight),
        unit: s.unit,
        reps: s.reps,
        rir: s.rir,
        completed: s.completed,
      })),
    })),
  }));
}

export interface PlannedRow {
  id: string;
  block_id: string;
  block_session_id: string;
  date: string;
  week: number;
  name: string;
  deload: boolean;
  exercises: PlannedExercise[];
}

export const toPlanned = (row: PlannedRow): StoredPlannedSession => ({
  id: row.id,
  blockId: row.block_id,
  blockSessionId: row.block_session_id,
  date: row.date,
  week: row.week,
  name: row.name,
  deload: row.deload,
  exercises: row.exercises,
});

export const plannedColumns = (tx: TransactionSql) =>
  tx`id, block_id, block_session_id, to_char(date, 'YYYY-MM-DD') as date, week, name, deload, exercises`;

export interface RaceRow {
  id: string;
  name: string;
  date: string;
  distance_meters: number;
  priority: RacePriority;
}

export const toRace = (row: RaceRow): Race => ({
  id: row.id,
  name: row.name,
  date: row.date,
  distanceMeters: row.distance_meters,
  priority: row.priority,
});

export const raceColumns = (tx: TransactionSql) =>
  tx`id, name, to_char(date, 'YYYY-MM-DD') as date, distance_meters, priority`;

export async function loadRaces(tx: TransactionSql): Promise<Race[]> {
  const rows = await tx<RaceRow[]>`select ${raceColumns(tx)} from public.races order by date, created_at`;
  return rows.map(toRace);
}

export async function loadRunPlans(tx: TransactionSql): Promise<RunPlan[]> {
  const rows = await tx<
    { id: string; name: string; weeks: number; race_id: string | null; time_zone: string; rows: RunPlanRow[] }[]
  >`select id, name, weeks, race_id, time_zone, rows from public.run_plans order by created_at`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    weeks: r.weeks,
    raceId: r.race_id,
    timeZone: r.time_zone,
    rows: r.rows,
  }));
}
