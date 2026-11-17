import { z } from "zod";
import type { Weekday } from "./block";
import { METERS_PER_MILE } from "./distance";
import { RUN_TYPES, type Intensity, type PaceTarget, type RunPlanRow, type RunStep, type RunStructure } from "./running";

/**
 * Run plan files (CSV or JSON), as the owner imports them. One row per run:
 *
 *   week, day (mon..sun), type (easy | long | tempo | intervals | race_pace | cross | rest | race),
 *   distance (distance_m | distance_km | distance_mi) or duration (duration_s | duration_min),
 *   pace (optional: "8:30/mi", "8:20-8:40/mi", "5:10/km", or JSON {"per_km_s": [lo, hi]}),
 *   structure (optional, JSON: warmup / main / repeats / cooldown — mirrors a Coros structured workout),
 *   notes.
 *
 * JSON: `{ "name"?, "weeks"?, "runs": [row, …] }` (or a bare array of rows). CSV: a header row naming the
 * columns above (any order, any subset; the structure column holds JSON). Everything is converted to
 * meters / seconds / seconds per km; constraints match what a Coros workout accepts, so a valid plan
 * can always be pushed to the watch.
 */

export interface RunPlanFileError {
  /** 1-based data row (CSV: not counting the header); 0 = the file as a whole. */
  row: number;
  message: string;
}

export type ParsedRunPlanFile =
  | { ok: true; name: string | null; weeks: number; rows: RunPlanRow[] }
  | { ok: false; errors: RunPlanFileError[] };

export const RUN_PLAN_FORMATS = ["csv", "json"] as const;
export type RunPlanFormat = (typeof RUN_PLAN_FORMATS)[number];

const MAX_WEEKS = 52;

const DAYS: Record<string, Weekday> = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const optional = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (blank(v) ? undefined : v), schema.optional());
const positive = optional(z.coerce.number<unknown>().positive("must be a positive number"));

/** Error option: "is required" when the value is missing, `message` otherwise. */
const required = (message: string) => ({
  error: (issue: { input?: unknown }) => (issue.input === undefined ? "is required" : message),
});
const DAY_MESSAGE = "day must be mon, tue, wed, thu, fri, sat or sun";

const paceSeconds =(minutes: string, seconds: string) => Number(minutes) * 60 + Number(seconds);

/** "8:30/mi", "8:20-8:40 /mi", "5:10/km" or {per_km_s: [lo, hi] | n} → seconds per km [fast, slow]. */
const PACE_TEXT = /^\s*(\d{1,2}):([0-5]\d)\s*(?:[-–]\s*(\d{1,2}):([0-5]\d))?\s*(?:min)?\s*\/\s*(mi|mile|km)\s*$/i;

const paceRange = z
  .unknown()
  .transform((value, ctx): [number, number] => {
    if (typeof value === "string") {
      const m = PACE_TEXT.exec(value);
      if (!m) {
        ctx.addIssue({ code: "custom", message: `pace "${value}" should look like 8:30/mi, 8:20-8:40/mi or 5:10/km` });
        return z.NEVER;
      }
      const perMile = m[5]!.toLowerCase() !== "km";
      // 0.1 s/km keeps min/mile paces exact when shown back in min/mile; Coros (whole s/km) rounds at push time.
      const toPerKm = (s: number) => Math.round((perMile ? (s * 1000) / METERS_PER_MILE : s) * 10) / 10;
      const a = toPerKm(paceSeconds(m[1]!, m[2]!));
      const b = m[3] ? toPerKm(paceSeconds(m[3], m[4]!)) : a;
      return [Math.min(a, b), Math.max(a, b)];
    }
    const perKm = typeof value === "object" && value !== null && "per_km_s" in value ? value.per_km_s : undefined;
    if (typeof perKm === "number") return [perKm, perKm];
    if (Array.isArray(perKm) && perKm.length === 2) {
      const [a, b] = perKm as unknown[];
      if (typeof a === "number" && typeof b === "number") return [Math.min(a, b), Math.max(a, b)];
    }
    ctx.addIssue({ code: "custom", message: 'pace should be text like "8:30/mi" or {"per_km_s": [low, high]}' });
    return z.NEVER;
  })
  .refine(
    ([lo, hi]) => Number.isFinite(lo) && Number.isFinite(hi) && lo >= 120 && hi <= 1499,
    "pace must be between 2:00/km and 24:59/km",
  );

const range = (min: number, max: number, what: string) =>
  z
    .tuple([z.number().int().min(min).max(max), z.number().int().min(min).max(max)], `${what} must be [low, high]`)
    .refine(([lo, hi]) => lo <= hi, `${what} must be [low, high]`);

const intensity = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("pace"), per_km_s: z.unknown().optional(), pace: z.string().optional() }),
    z.object({ kind: z.literal("hr_zone"), zone: z.number().int().min(1).max(6) }),
    z.object({ kind: z.literal("hr"), bpm: range(30, 240, "bpm") }),
    z.object({ kind: z.literal("pct_threshold_pace"), pct: range(20, 140, "pct") }),
  ])
  .transform((value, ctx): Intensity => {
    if (value.kind === "hr_zone") return { kind: "hr_zone", zone: value.zone };
    if (value.kind === "hr") return { kind: "hr", bpm: value.bpm };
    if (value.kind === "pct_threshold_pace") return { kind: "pct_threshold_pace", pct: value.pct };
    const parsed = paceRange.safeParse(value.pace ?? { per_km_s: value.per_km_s });
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: parsed.error.issues[0]!.message });
      return z.NEVER;
    }
    return { kind: "pace", perKmSeconds: parsed.data };
  });

const stepFields = {
  distance_m: z.number().int().positive().optional(),
  duration_s: z.number().int().positive().optional(),
  open: z.literal(true).optional(),
  intensity: intensity.optional(),
};

type RawStep = { distance_m?: number; duration_s?: number; open?: true; intensity?: Intensity };

const oneTarget = (step: RawStep) => [step.distance_m, step.duration_s, step.open].filter((v) => v !== undefined).length === 1;
const toStep = (step: RawStep): RunStep => ({
  ...(step.distance_m !== undefined && { distanceMeters: step.distance_m }),
  ...(step.duration_s !== undefined && { durationSeconds: step.duration_s }),
  ...(step.open && { open: true as const }),
  ...(step.intensity && { intensity: step.intensity }),
});
const TARGET_MESSAGE = "each step needs exactly one of distance_m, duration_s or open";

const step = z.strictObject(stepFields).refine(oneTarget, TARGET_MESSAGE).transform(toStep);
const repeatStep = z
  .strictObject({ kind: z.enum(["work", "recovery"]), ...stepFields })
  .refine(oneTarget, TARGET_MESSAGE)
  .transform(({ kind, ...rest }) => ({ kind, ...toStep(rest) }));

const structure = z
  .strictObject({
    warmup: step.optional(),
    main: step.optional(),
    repeats: z
      .array(z.strictObject({ count: z.number().int().min(1).max(20), steps: z.array(repeatStep).min(1).max(10) }))
      .min(1)
      .max(10)
      .optional(),
    cooldown: step.optional(),
  })
  .refine((s) => Object.values(s).some((v) => v !== undefined), "structure needs a warmup, main, repeats or cooldown")
  .transform((s): RunStructure => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)));

/** JSON objects pass through; CSV cells hold a JSON string. */
const jsonish = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v, ctx) => {
    if (typeof v !== "string") return v;
    try {
      return JSON.parse(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "structure is not valid JSON" });
      return z.NEVER;
    }
  }, schema);

const row = z
  .object({
    week: z.preprocess(
      (v) => (blank(v) ? undefined : Number(v)),
      z
        .number(required("week must be a number"))
        .int("week must be a whole number")
        .min(1, "week must be 1 or more")
        .max(MAX_WEEKS, `week must be ${MAX_WEEKS} or less`),
    ),
    day: z.preprocess(
      (v) => (blank(v) ? undefined : typeof v === "string" ? (DAYS[v.trim().slice(0, 3).toLowerCase()] ?? v) : v),
      z.number(required(DAY_MESSAGE)).int(DAY_MESSAGE).min(1, DAY_MESSAGE).max(7, DAY_MESSAGE),
    ),
    type: z.preprocess(
      (v) => (blank(v) ? undefined : typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : v),
      z.enum(RUN_TYPES, required(`type must be one of ${RUN_TYPES.join(", ")}`)),
    ),
    distance_m: positive,
    distance_km: positive,
    distance_mi: positive,
    duration_s: positive,
    duration_min: positive,
    pace: optional(paceRange),
    pace_target: optional(paceRange),
    structure: optional(jsonish(structure)),
    notes: optional(z.coerce.string<unknown>().trim().max(500)),
  })
  .transform((r, ctx): RunPlanRow => {
    const distances = [r.distance_m, r.distance_km && r.distance_km * 1000, r.distance_mi && r.distance_mi * METERS_PER_MILE];
    const durations = [r.duration_s, r.duration_min && r.duration_min * 60];
    const distance = distances.filter((d) => d !== undefined);
    const duration = durations.filter((d) => d !== undefined);
    const targets = distance.length + duration.length;
    if (targets > 1) ctx.addIssue({ code: "custom", message: "give one distance or one duration, not both" });
    if (r.type === "rest" && targets > 0) ctx.addIssue({ code: "custom", message: "a rest day has no distance or duration" });
    if (r.type !== "rest" && r.type !== "race" && targets === 0 && !r.structure) {
      ctx.addIssue({ code: "custom", message: `${r.type} run needs a distance, a duration or a structure` });
    }
    const pace = r.pace ?? r.pace_target;
    const paceTarget: PaceTarget | null = pace ? { perKmSeconds: pace } : null;
    return {
      week: r.week,
      day: r.day as Weekday,
      type: r.type,
      distanceMeters: distance[0] === undefined ? null : Math.round(distance[0]),
      durationSeconds: duration[0] === undefined ? null : Math.round(duration[0]),
      paceTarget,
      structure: r.structure ?? null,
      notes: r.notes || null,
    };
  });

const describeIssue = (issue: z.core.$ZodIssue) => {
  const field = issue.path.filter((p) => typeof p !== "symbol").join(".");
  return field && !issue.message.startsWith(field) ? `${field}: ${issue.message}` : issue.message;
};

/** Validates rows; every invalid row is reported (not just the first). */
function parseRows(raw: unknown[], declaredWeeks: number | null): ParsedRunPlanFile {
  const errors: RunPlanFileError[] = [];
  const rows: RunPlanRow[] = [];
  raw.forEach((value, index) => {
    const parsed = row.safeParse(value);
    if (parsed.success) rows.push(parsed.data);
    else errors.push({ row: index + 1, message: parsed.error.issues.map(describeIssue).join("; ") });
  });
  if (raw.length === 0) errors.push({ row: 0, message: "The plan has no runs" });
  const weeks = declaredWeeks ?? Math.max(0, ...rows.map((r) => r.week));
  rows.forEach((r, index) => {
    if (r.week > weeks) errors.push({ row: index + 1, message: `week ${r.week} is past the plan's ${weeks} weeks` });
  });
  if (errors.length > 0) return { ok: false, errors: errors.sort((a, b) => a.row - b.row) };
  return { ok: true, name: null, weeks, rows };
}

const jsonFile = z.union([
  z.array(z.unknown()).transform((runs) => ({ name: undefined, weeks: undefined, runs })),
  z.object({
    name: z.string().trim().min(1).max(120).optional(),
    weeks: z.number().int().min(1).max(MAX_WEEKS).optional(),
    runs: z.array(z.unknown()),
  }),
]);

function parseJson(content: string): ParsedRunPlanFile {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { ok: false, errors: [{ row: 0, message: "The file is not valid JSON" }] };
  }
  const file = jsonFile.safeParse(value);
  if (!file.success) {
    return { ok: false, errors: [{ row: 0, message: 'Expected {"name", "runs": [...]} or an array of runs' }] };
  }
  const parsed = parseRows(file.data.runs, file.data.weeks ?? null);
  return parsed.ok ? { ...parsed, name: file.data.name ?? null } : parsed;
}

/** Minimal RFC 4180: commas, double-quoted cells with "" escapes and embedded newlines. */
export function parseCsv(content: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  const text = content.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  return records.filter((r) => r.some((v) => v.trim() !== ""));
}

const KNOWN_COLUMNS = new Set(Object.keys(row.in.shape));

function parseCsvFile(content: string): ParsedRunPlanFile {
  const [header, ...records] = parseCsv(content);
  if (!header) return { ok: false, errors: [{ row: 0, message: "The file is empty" }] };
  const columns = header.map((h) => h.trim().toLowerCase());
  const unknown = columns.filter((c) => !KNOWN_COLUMNS.has(c));
  if (unknown.length > 0) {
    return { ok: false, errors: [{ row: 0, message: `Unknown column(s): ${unknown.join(", ")}` }] };
  }
  return parseRows(
    records.map((cells) => Object.fromEntries(columns.map((c, i) => [c, cells[i]]))),
    null,
  );
}

export function parseRunPlanFile(format: RunPlanFormat, content: string): ParsedRunPlanFile {
  return format === "json" ? parseJson(content) : parseCsvFile(content);
}
