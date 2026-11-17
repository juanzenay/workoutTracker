import type { JSONValue, TransactionSql } from "postgres";
import { z } from "zod";
import type { IsoDate } from "@/domain/block";
import { parseRunPlanFile, RUN_PLAN_FORMATS } from "@/domain/run-plan-file";
import { RACE_PRIORITIES, type PlannedRun, type Race } from "@/domain/running";
import { addDays, daysBetween, isoWeekday } from "@/engine/dates";
import { CommandError, defineCommand } from "./define";
import { loadRaces, raceColumns, toRace, type RaceRow } from "./plan-data";
import { replan } from "./replan";
import type { RunStatus } from "./run-matching";

/**
 * A planned run as persisted (engine output + its row id) with its outcome
 * from Strava or imported files (see run-matching.ts): status null = still to come / rest day.
 * `gapMeters` = planned minus actual distance, on a partial run planned by distance.
 */
export interface StoredPlannedRun extends PlannedRun {
  id: string;
  status: RunStatus | null;
  actualMeters: number | null;
  actualSeconds: number | null;
  gapMeters: number | null;
}

/** A run plan without its rows, with the race it is anchored to. */
export interface RunPlanSummary {
  id: string;
  name: string;
  weeks: number;
  raceId: string | null;
  race: Race | null;
  timeZone: string;
  /** First and last planned date (null when unanchored). */
  startDate: IsoDate | null;
  endDate: IsoDate | null;
}

const isoDate = z.iso.date();

const timeZone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown time zone");

// ---- Races ----

const raceInput = z.object({
  name: z.string().trim().min(1).max(120),
  date: isoDate,
  distanceMeters: z.number().int().positive().max(1_000_000),
  priority: z.enum(RACE_PRIORITIES),
});

// ---- Run plans and planned runs ----

export interface PlannedRunRow {
  id: string;
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
  status: RunStatus | null;
  actual_meters: string | null;
  actual_seconds: number | null;
}

export const plannedRunColumns = (tx: TransactionSql) =>
  tx`id, run_plan_id, row_index, to_char(date, 'YYYY-MM-DD') as date, week, type, distance_meters, duration_seconds,
    pace_target, structure, notes, status, actual_meters::text, actual_seconds`;

export const toPlannedRun = (row: PlannedRunRow): StoredPlannedRun => ({
  id: row.id,
  runPlanId: row.run_plan_id,
  rowIndex: row.row_index,
  date: row.date,
  week: row.week,
  type: row.type,
  distanceMeters: row.distance_meters,
  durationSeconds: row.duration_seconds,
  paceTarget: row.pace_target,
  structure: row.structure,
  notes: row.notes,
  status: row.status,
  actualMeters: row.actual_meters === null ? null : Number(row.actual_meters),
  actualSeconds: row.actual_seconds,
  gapMeters:
    row.status === "partial" && row.distance_meters !== null && row.actual_meters !== null
      ? Math.round((row.distance_meters - Number(row.actual_meters)) * 10) / 10
      : null,
});

/** Planned runs on `date` (every plan), in plan row order. */
export async function plannedRunsOn(tx: TransactionSql, date: IsoDate): Promise<StoredPlannedRun[]> {
  const rows = await tx<PlannedRunRow[]>`
    select ${plannedRunColumns(tx)} from public.planned_runs where date = ${date}::date order by run_plan_id, row_index`;
  return rows.map(toPlannedRun);
}

/**
 * Running on `date` for Today: the day's planned runs and the plan whose
 * weeks include `date` (soonest race first), with its week number.
 */
export async function runningOn(tx: TransactionSql, date: IsoDate) {
  const runs = await plannedRunsOn(tx, date);
  const monday = (d: IsoDate) => addDays(d, 1 - isoWeekday(d));
  const active = (await runPlanSummaries(tx))
    .filter((p) => p.race)
    .map((p) => ({ ...p, week: p.weeks - daysBetween(monday(date), monday(p.race!.date)) / 7 }))
    .filter((p) => p.week >= 1 && p.week <= p.weeks)
    .sort((a, b) => a.race!.date.localeCompare(b.race!.date));
  const plan = active[0];
  return {
    runs,
    plan: plan ? { id: plan.id, name: plan.name, week: plan.week, weeks: plan.weeks, race: plan.race! } : null,
  };
}

async function runPlanSummaries(tx: TransactionSql, id?: string): Promise<RunPlanSummary[]> {
  const rows = await tx<
    {
      id: string;
      name: string;
      weeks: number;
      race_id: string | null;
      time_zone: string;
      start_date: string | null;
      end_date: string | null;
    }[]
  >`
    select p.id, p.name, p.weeks, p.race_id, p.time_zone,
      (select to_char(min(r.date), 'YYYY-MM-DD') from public.planned_runs r where r.run_plan_id = p.id) as start_date,
      (select to_char(max(r.date), 'YYYY-MM-DD') from public.planned_runs r where r.run_plan_id = p.id) as end_date
    from public.run_plans p
    ${id ? tx`where p.id = ${id}` : tx``}
    order by p.created_at`;
  const races = await loadRaces(tx);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    weeks: r.weeks,
    raceId: r.race_id,
    race: races.find((race) => race.id === r.race_id) ?? null,
    timeZone: r.time_zone,
    startDate: r.start_date,
    endDate: r.end_date,
  }));
}

/**
 * Imports a run plan file and anchors it to a race: `raceId`, or else the
 * next A race (today or later in `timeZone`). Importing a plan for a race
 * that already has one replaces it. Invalid rows → invalid_input with
 * `details.errors` = every bad row ({row, message}).
 */
export const importRunPlan = defineCommand({
  input: z.object({
    format: z.enum(RUN_PLAN_FORMATS),
    content: z.string().max(1_000_000),
    /** Overrides the file's own name. */
    name: z.string().trim().min(1).max(120).optional(),
    raceId: z.uuid().optional(),
    timeZone,
  }),
  async run({ tx, engine, push, now, coachChangeId }, input) {
    const parsed = parseRunPlanFile(input.format, input.content);
    if (!parsed.ok) {
      const count = parsed.errors.length;
      throw new CommandError("invalid_input", `The plan has ${count} problem${count === 1 ? "" : "s"}`, {
        errors: parsed.errors,
      });
    }
    const [race] = input.raceId
      ? await tx<{ id: string }[]>`select id from public.races where id = ${input.raceId}`
      : await tx<{ id: string }[]>`
          select id from public.races
          where priority = 'A' and date >= (now() at time zone ${input.timeZone})::date
          order by date limit 1`;
    if (!race) {
      throw new CommandError("invalid_input", input.raceId ? "No such race" : "Add an A race first: the plan anchors to it");
    }
    await tx`delete from public.run_plans where race_id = ${race.id}`;
    const [plan] = await tx<{ id: string }[]>`
      insert into public.run_plans (name, weeks, race_id, time_zone, rows)
      values (${input.name ?? parsed.name ?? "Run plan"}, ${parsed.weeks}, ${race.id}, ${input.timeZone},
        ${tx.json(parsed.rows as unknown as JSONValue)})
      returning id`;
    await replan(tx, engine, push, now(), coachChangeId);
    const [summary] = await runPlanSummaries(tx, plan!.id);
    return { plan: summary! };
  },
});

/** Every run plan (without rows), oldest import first. */
export const listRunPlans = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    return { plans: await runPlanSummaries(tx) };
  },
});

export const getRunPlan = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, { id }) {
    const [plan] = await runPlanSummaries(tx, id);
    if (!plan) throw new CommandError("not_found", "No such run plan");
    const rows = await tx<PlannedRunRow[]>`
      select ${plannedRunColumns(tx)} from public.planned_runs where run_plan_id = ${id} order by date, row_index`;
    return { plan, plannedRuns: rows.map(toPlannedRun) };
  },
});

export const deleteRunPlan = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx, engine, push, now, coachChangeId }, { id }) {
    const deleted = await tx`delete from public.run_plans where id = ${id} returning id`;
    if (deleted.length === 0) throw new CommandError("not_found", "No such run plan");
    await replan(tx, engine, push, now(), coachChangeId);
    return { id };
  },
});

// ---- Race commands (re-plan on change: runs anchor to races, lifting deloads line up with A races) ----

export const createRace = defineCommand({
  input: raceInput,
  async run({ tx, engine, push, now, coachChangeId }, input) {
    const [row] = await tx<RaceRow[]>`
      insert into public.races (name, date, distance_meters, priority)
      values (${input.name}, ${input.date}, ${input.distanceMeters}, ${input.priority})
      returning ${raceColumns(tx)}`;
    await replan(tx, engine, push, now(), coachChangeId);
    return toRace(row!);
  },
});

export const updateRace = defineCommand({
  input: raceInput.extend({ id: z.uuid() }),
  async run({ tx, engine, push, now, coachChangeId }, input) {
    const [row] = await tx<RaceRow[]>`
      update public.races
      set name = ${input.name}, date = ${input.date}, distance_meters = ${input.distanceMeters},
        priority = ${input.priority}, updated_at = now()
      where id = ${input.id}
      returning ${raceColumns(tx)}`;
    if (!row) throw new CommandError("not_found", "No such race");
    await replan(tx, engine, push, now(), coachChangeId);
    return toRace(row);
  },
});

export const deleteRace = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx, engine, push, now, coachChangeId }, { id }) {
    const deleted = await tx`delete from public.races where id = ${id} returning id`;
    if (deleted.length === 0) throw new CommandError("not_found", "No such race");
    await replan(tx, engine, push, now(), coachChangeId);
    return { id };
  },
});

/** Every race, soonest first. */
export const listRaces = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    return { races: await loadRaces(tx) };
  },
});
