import type { TransactionSql } from "postgres";
import { z } from "zod";
import type { IsoDate } from "@/domain/block";
import type { Message } from "@/domain/message";
import { ActivityFileError, parseActivityFile, type FileActivity } from "../activity-files/parse";
import { CommandError, defineCommand } from "./define";
import { planTimeZone, replan } from "./replan";
import { RUN_SPORT_TYPES } from "./run-matching";

/**
 * Completed activities from files (#31): the owner exports runs from the
 * watch's app (Coros: FIT, GPX or TCX) and uploads them. Imported activities
 * sit beside Strava's in `activities` (source `file`) and go through the same
 * run matching and re-plan. See ../activity-files/parse.ts.
 */

/** Two activities starting this close together are the same one (the same run exported twice, or as FIT and GPX). */
const SAME_START_SECONDS = 120;
/** The most files in one import. */
const MAX_FILES = 100;

export type ImportedFileStatus = "imported" | "duplicate" | "skipped" | "failed";

export interface ImportedFile {
  name: string;
  status: ImportedFileStatus;
  /** What happened, for the owner (src/strings renders it). */
  message: Message;
}

const RUN_SPORTS: readonly string[] = RUN_SPORT_TYPES;

/**
 * Imports activity files. Each file stands alone: a damaged one fails with
 * its reason and the rest still import. Runs are stored and matched to
 * planned runs; other sports are skipped (they don't count toward a run
 * plan); an activity already stored (from any file, or from Strava) is not
 * stored again. Every readable activity extends how far imports reach
 * (`activity_import_coverage`), which is when a run with nothing logged is
 * judged missed. Then re-plans, as Strava ingestion does.
 */
export const importActivityFiles = defineCommand({
  input: z.object({
    files: z
      .array(z.object({ name: z.string().min(1).max(255), data: z.custom<Uint8Array>((v) => v instanceof Uint8Array, "Expected file bytes") }))
      .min(1)
      .max(MAX_FILES),
  }),
  async run({ tx, actor, engine, push, now }, { files }) {
    if (actor.kind === "anon") throw new CommandError("unauthorized", "Sign in first");
    const zone = await planTimeZone(tx);
    const results: ImportedFile[] = [];
    let latest: IsoDate | null = null;
    let imported = 0;
    for (const file of files) {
      let activities: FileActivity[];
      try {
        activities = await parseActivityFile(file.name, file.data);
      } catch (error) {
        if (!(error instanceof ActivityFileError)) throw error;
        results.push({ name: file.name, status: "failed", message: { code: "activityFileUnreadable", problem: error.problem } });
        continue;
      }
      for (const activity of activities) {
        const local = await localStart(tx, activity, zone);
        const date = local.slice(0, 10);
        if (!latest || date > latest) latest = date;
        if (!RUN_SPORTS.includes(activity.sportType)) {
          results.push({
            name: file.name,
            status: "skipped",
            message: { code: "activityFileNotRun", sport: activity.sportType, date },
          });
          continue;
        }
        const stored = await storeActivity(tx, file.name, activity, local);
        results.push(
          stored
            ? { name: file.name, status: "imported", message: { code: "activityFileImported", date, meters: activity.distanceMeters } }
            : { name: file.name, status: "duplicate", message: { code: "activityFileDuplicate", date } },
        );
        if (stored) imported++;
      }
    }
    if (latest) {
      await tx`
        insert into public.activity_import_coverage (covered_through) values (${latest})
        on conflict (id) do update set covered_through = greatest(activity_import_coverage.covered_through,
          excluded.covered_through), updated_at = now()`;
      // Matching and missed runs depend on both what came in and how far imports now reach.
      await replan(tx, engine, push, now());
    }
    return { files: results, imported };
  },
});

/** Wall-clock start: the file's own, else in the plan's time zone. */
async function localStart(tx: TransactionSql, activity: FileActivity, zone: string): Promise<string> {
  if (activity.startLocal) return activity.startLocal;
  const [row] = await tx<{ local: string }[]>`
    select to_char(${activity.startDate}::timestamptz at time zone ${zone}, 'YYYY-MM-DD"T"HH24:MI:SS') as local`;
  return row!.local;
}

/** Stores the activity unless one (from any source) already starts within SAME_START_SECONDS of it. */
async function storeActivity(tx: TransactionSql, fileName: string, a: FileActivity, local: string): Promise<boolean> {
  const rows = await tx`
    insert into public.activities
      (source, file_name, name, sport_type, start_date, start_date_local, local_date, distance_meters, moving_seconds,
        elapsed_seconds)
    select 'file', ${fileName}, ${a.name}, ${a.sportType}, ${a.startDate}, ${local}, ${local.slice(0, 10)},
      ${a.distanceMeters}, ${a.movingSeconds}, ${a.elapsedSeconds}
    where not exists (
      select 1 from public.activities
      where start_date between ${a.startDate}::timestamptz - make_interval(secs => ${SAME_START_SECONDS})
        and ${a.startDate}::timestamptz + make_interval(secs => ${SAME_START_SECONDS})
    )
    returning id`;
  return rows.length > 0;
}

export interface StoredActivity {
  id: string;
  source: "strava" | "file" | "manual";
  /** Strava's id (source strava). */
  stravaId: number | null;
  /** The imported file's name (source file). */
  fileName: string | null;
  name: string | null;
  sportType: string;
  startDate: string;
  localDate: IsoDate;
  distanceMeters: number;
  movingSeconds: number | null;
  elapsedSeconds: number | null;
  /** The planned run it counts toward, if any. */
  plannedRunId: string | null;
}

/**
 * A run typed in by hand: a distance for a day (source `manual`). Counts like any other run: several on a day add
 * up toward the day's planned run, which is done once they reach it. Like an import, it extends how far
 * outcomes are known, then re-plans.
 */
export const addManualRun = defineCommand({
  input: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a real date"),
    distanceMeters: z.number().positive().max(500_000),
    movingSeconds: z.number().int().positive().max(86_400).optional(),
  }),
  async run({ tx, actor, engine, push, now }, { date, distanceMeters, movingSeconds }) {
    if (actor.kind === "anon") throw new CommandError("unauthorized", "Sign in first");
    // Noon that day (plan time zone), a second later for each earlier manual run, so entries never share a start.
    const [row] = await tx<{ start: Date; local: string }[]>`
      with t as (
        select (${date}::date + time '12:00') + make_interval(secs => count(*)) as local
        from public.activities where local_date = ${date}::date and source = 'manual')
      select (local at time zone ${await planTimeZone(tx)}) as start, to_char(local, 'YYYY-MM-DD"T"HH24:MI:SS') as local from t`;
    const [stored] = await tx<{ id: string }[]>`
      insert into public.activities
        (source, name, sport_type, start_date, start_date_local, local_date, distance_meters, moving_seconds, elapsed_seconds)
      values ('manual', null, 'Run', ${row!.start}, ${row!.local}, ${date}, ${distanceMeters}, ${movingSeconds ?? null}, ${movingSeconds ?? null})
      returning id`;
    await tx`
      insert into public.activity_import_coverage (covered_through) values (${date})
      on conflict (id) do update set covered_through = greatest(activity_import_coverage.covered_through,
        excluded.covered_through), updated_at = now()`;
    await replan(tx, engine, push, now());
    return { id: stored!.id };
  },
});

/** Removes a manual run (a mistyped distance). Imported and Strava activities stay. */
export const deleteManualRun = defineCommand({
  input: z.object({ id: z.string().uuid() }),
  async run({ tx, actor, engine, push, now }, { id }) {
    if (actor.kind === "anon") throw new CommandError("unauthorized", "Sign in first");
    const rows = await tx`delete from public.activities where id = ${id} and source = 'manual' returning id`;
    if (rows.length === 0) throw new CommandError("not_found", "No such manual run");
    await replan(tx, engine, push, now());
    return {};
  },
});

/** Completed activities from every source, newest first. */
export const listActivities = defineCommand({
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  async run({ tx }, { limit }) {
    const rows = await tx<
      {
        id: string;
        source: "strava" | "file" | "manual";
        strava_id: string | null;
        file_name: string | null;
        name: string | null;
        sport_type: string;
        start_date: Date;
        local_date: string;
        distance_meters: string;
        moving_seconds: number | null;
        elapsed_seconds: number | null;
        planned_run_id: string | null;
      }[]
    >`
      select id, source, strava_id::text, file_name, name, sport_type, start_date,
        to_char(local_date, 'YYYY-MM-DD') as local_date, distance_meters::text, moving_seconds, elapsed_seconds,
        planned_run_id
      from public.activities order by start_date desc, id limit ${limit}`;
    const activities: StoredActivity[] = rows.map((r) => ({
      id: r.id,
      source: r.source,
      stravaId: r.strava_id === null ? null : Number(r.strava_id),
      fileName: r.file_name,
      name: r.name,
      sportType: r.sport_type,
      startDate: r.start_date.toISOString(),
      localDate: r.local_date,
      distanceMeters: Number(r.distance_meters),
      movingSeconds: r.moving_seconds,
      elapsedSeconds: r.elapsed_seconds,
      plannedRunId: r.planned_run_id,
    }));
    return { activities };
  },
});
