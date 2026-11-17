import type { TransactionSql } from "postgres";
import { z } from "zod";
import type { SetType, WeightUnit } from "@/domain/workout";
import type { Actor } from "../db/actor";
import { CommandError, defineCommand } from "./define";

/** Everything workout tracker stores, one array of rows per table. Restorable and diff-friendly (stable row order). */
export interface WorkoutTrackerExport {
  format: "workout-tracker-export";
  version: 1;
  exportedAt: string;
  /** Table name (schema `public`) → its rows, exactly as stored (column names as in the database). */
  tables: Record<string, Record<string, unknown>[]>;
}

function requireSignedIn(actor: Actor): void {
  if (actor.kind === "anon") throw new CommandError("unauthorized", "Sign in to export your data");
}

/** Secrets never leave the database, even in the owner's own export or backup. */
const SECRET_COLUMNS: Record<string, string[]> = {
  hevy_connection: ["api_key"],
  strava_connection: ["access_token", "refresh_token"],
  push_subscriptions: ["p256dh", "auth"],
};

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Dumps every table in `public` — discovered from the catalog, so tables added
 * by later migrations are exported without touching this code. Runs as the
 * actor, so RLS decides what is visible (owner and service see everything).
 */
async function dumpPublicTables(tx: TransactionSql): Promise<WorkoutTrackerExport["tables"]> {
  const tables = await tx<{ name: string }[]>`
    select c.relname as name
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      and has_table_privilege(c.oid, 'select')
    order by c.relname`;

  const result: WorkoutTrackerExport["tables"] = {};
  for (const { name } of tables) {
    // to_jsonb keeps types faithful (numeric → number, timestamps → ISO strings);
    // ordering by the row's text form makes nightly backups diff cleanly.
    const redact = (SECRET_COLUMNS[name] ?? []).map((column) => ` - ${quoteLiteral(column)}`).join("");
    const [row] = await tx.unsafe<{ rows: Record<string, unknown>[] }[]>(
      `select coalesce(jsonb_agg(to_jsonb(t)${redact} order by t::text), '[]'::jsonb) as rows
       from public.${quoteIdent(name)} t`,
    );
    result[name] = row!.rows;
  }
  return result;
}

const LB_IN_KG = 0.45359237;

/** Hevy names drop sets "dropset"; the other set types match. */
const HEVY_SET_TYPE: Record<SetType, string> = {
  normal: "normal",
  warmup: "warmup",
  drop: "dropset",
  failure: "failure",
};

interface CsvSetRow {
  title: string | null;
  started_at: Date;
  finished_at: Date;
  description: string | null;
  exercise_title: string;
  superset_id: number | null;
  exercise_notes: string | null;
  set_index: number;
  set_type: SetType;
  /** numeric as text, so a weight entered as 182.5 is written as 182.5. */
  weight: string | null;
  unit: WeightUnit;
  reps: number | null;
}

/** Weight in the export's unit: as entered when units match, otherwise converted and rounded to 0.01. */
function weightIn(unit: WeightUnit, row: CsvSetRow): string {
  if (row.weight === null) return "";
  if (row.unit === unit) return String(Number(row.weight));
  const value = Number(row.weight);
  const converted = unit === "kg" ? value * LB_IN_KG : value / LB_IN_KG;
  return String(Math.round(converted * 100) / 100);
}

/** Hevy's date style: "9 Oct 2026, 17:27" in the owner's local time. */
function hevyDate(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

function csvLine(values: (string | number | null)[]): string {
  return values.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",");
}

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Finished workouts in Hevy's `workouts.csv` export format: one row per
 * completed set, newest workout first. Hevy accounts export either lb or kg
 * columns; sets already in that unit are written exactly as entered.
 */
export const exportWorkoutsCsv = defineCommand({
  input: z.object({
    /** IANA zone for start/end times (Hevy writes local times without an offset). */
    timeZone: z.string().refine(isTimeZone, "Unknown time zone"),
    unit: z.enum(["lb", "kg"]).default("lb"),
  }),
  async run({ tx, actor }, { timeZone, unit }) {
    requireSignedIn(actor);
    const rows = await tx<CsvSetRow[]>`
      select w.name as title, w.started_at, w.finished_at, w.notes as description,
        e.name as exercise_title, we.superset_group as superset_id, we.notes as exercise_notes,
        (row_number() over (partition by we.id order by s.position, s.created_at) - 1)::int as set_index,
        s.set_type, s.weight::text as weight, s.unit, s.reps
      from public.workouts w
      join public.workout_exercises we on we.workout_id = w.id
      join public.exercises e on e.id = we.exercise_id
      join public.workout_sets s on s.workout_exercise_id = we.id
      where w.finished_at is not null and w.discarded_at is null and s.completed
      order by w.started_at desc, w.id, we.position, we.created_at, s.position, s.created_at`;

    const header = [
      "title",
      "start_time",
      "end_time",
      "description",
      "exercise_title",
      "superset_id",
      "exercise_notes",
      "set_index",
      "set_type",
      unit === "lb" ? "weight_lbs" : "weight_kg",
      "reps",
      unit === "lb" ? "distance_miles" : "distance_km",
      "duration_seconds",
      "rpe",
    ];
    const lines = rows.map((r) =>
      csvLine([
        r.title ?? "Workout",
        hevyDate(r.started_at, timeZone),
        hevyDate(r.finished_at, timeZone),
        r.description,
        r.exercise_title,
        r.superset_id,
        r.exercise_notes,
        r.set_index,
        HEVY_SET_TYPE[r.set_type],
        weightIn(unit, r),
        r.reps,
        null,
        null,
        null,
      ]),
    );
    return {
      filename: "workouts.csv",
      csv: [csvLine(header), ...lines, ""].join("\n"),
    };
  },
});

/** Everything `tx` can see, as one export. Shared by `exportJson` and the nightly backup. */
export async function buildExport(tx: TransactionSql): Promise<WorkoutTrackerExport> {
  return {
    format: "workout-tracker-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    tables: await dumpPublicTables(tx),
  };
}

/** All of the owner's data as JSON (the nightly backup job reuses this). */
export const exportJson = defineCommand({
  input: z.object({}),
  async run({ tx, actor }): Promise<WorkoutTrackerExport> {
    requireSignedIn(actor);
    return buildExport(tx);
  },
});
