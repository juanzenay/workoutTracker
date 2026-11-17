import type { TransactionSql } from "postgres";
import { z } from "zod";
import {
  BODY_METRIC_KEYS,
  bodyMetricHistory,
  LENGTH_UNITS,
  WEIGHT_UNITS,
  type BodyMeasurement,
  type BodyMeasurementValues,
  type BodyMetric,
  type LengthUnit,
  type WeightUnit,
} from "@/domain/body-measurement";
import { CommandError, defineCommand } from "./define";

/** Domain metric name → column. */
const COLUMNS: Record<BodyMetric, string> = {
  weight: "weight",
  leanMass: "lean_mass",
  fatPercent: "fat_percent",
  neck: "neck",
  shoulders: "shoulders",
  chest: "chest",
  leftBicep: "left_bicep",
  rightBicep: "right_bicep",
  leftForearm: "left_forearm",
  rightForearm: "right_forearm",
  abdomen: "abdomen",
  waist: "waist",
  hips: "hips",
  leftThigh: "left_thigh",
  rightThigh: "right_thigh",
  leftCalf: "left_calf",
  rightCalf: "right_calf",
};

type BodyMeasurementRow = {
  id: string;
  date: string;
  weight_unit: WeightUnit;
  length_unit: LengthUnit;
} & Record<string, string | null>;

/** Date as text (no timezone shifts) and numerics as text, parsed here. */
const SELECT_COLUMNS = `id, date::text as date, weight_unit, length_unit, ${BODY_METRIC_KEYS.map(
  (m) => `${COLUMNS[m]}::text as ${COLUMNS[m]}`,
).join(", ")}`;

function toBodyMeasurement(row: BodyMeasurementRow): BodyMeasurement {
  const values: BodyMeasurementValues = {};
  for (const metric of BODY_METRIC_KEYS) {
    const raw = row[COLUMNS[metric]];
    if (raw != null) values[metric] = Number(raw);
  }
  return {
    id: row.id,
    date: row.date,
    weightUnit: row.weight_unit,
    lengthUnit: row.length_unit,
    values,
  };
}

const metricValue = z.number().positive().max(10_000);

const valuesInput = z
  .object(Object.fromEntries(BODY_METRIC_KEYS.map((m) => [m, metricValue.nullish()])) as Record<
    BodyMetric,
    z.ZodOptional<z.ZodNullable<typeof metricValue>>
  >)
  .strict()
  .refine((v) => Object.values(v).some((x) => x != null), "Measure at least one thing")
  .refine((v) => v.fatPercent == null || v.fatPercent < 100, "Body fat is a percentage");

const entryInput = {
  date: z.iso.date(),
  weightUnit: z.enum(WEIGHT_UNITS).default("lb"),
  lengthUnit: z.enum(LENGTH_UNITS).default("cm"),
  /** Metrics measured on this date; omitted or null = not measured. */
  values: valuesInput,
};

function columnValues(values: Partial<Record<BodyMetric, number | null>>): Record<string, number | null> {
  return Object.fromEntries(BODY_METRIC_KEYS.map((m) => [COLUMNS[m], values[m] ?? null]));
}

const COMPARED_COLUMNS = ["weight_unit", "length_unit", ...BODY_METRIC_KEYS.map((m) => COLUMNS[m])];

/**
 * Hevy importer: writes the entry for `date` (lb, cm). An entry already
 * imported from Hevy is replaced when its values differ; one logged or edited
 * in workout tracker is left alone.
 */
export async function upsertImportedBodyMeasurement(
  tx: TransactionSql,
  date: string,
  values: BodyMeasurementValues,
): Promise<"imported" | "updated" | "unchanged"> {
  const row = { date, weight_unit: "lb", length_unit: "cm", ...columnValues(values), from_hevy: true };
  const assignments = tx.unsafe(COMPARED_COLUMNS.map((c) => `${c} = excluded.${c}`).join(", "));
  const current = tx.unsafe(COMPARED_COLUMNS.map((c) => `body_measurements.${c}`).join(", "));
  const incoming = tx.unsafe(COMPARED_COLUMNS.map((c) => `excluded.${c}`).join(", "));
  const [written] = await tx<{ inserted: boolean }[]>`
    insert into public.body_measurements ${tx(row)}
    on conflict (date) do update
      set ${assignments}, updated_at = now()
      where body_measurements.from_hevy and (${current}) is distinct from (${incoming})
    returning (xmax = 0) as inserted`;
  return !written ? "unchanged" : written.inserted ? "imported" : "updated";
}

export const logBodyMeasurement = defineCommand({
  input: z.object({
    /** Optional client-generated id, so offline clients can sync idempotently. */
    id: z.uuid().optional(),
    ...entryInput,
  }),
  async run({ tx }, input) {
    const row = {
      ...(input.id ? { id: input.id } : {}),
      date: input.date,
      weight_unit: input.weightUnit,
      length_unit: input.lengthUnit,
      ...columnValues(input.values),
    };
    const [created] = await tx<BodyMeasurementRow[]>`
      insert into public.body_measurements ${tx(row)}
      returning ${tx.unsafe(SELECT_COLUMNS)}`;
    return toBodyMeasurement(created!);
  },
});

export const updateBodyMeasurement = defineCommand({
  /** Replaces the whole entry: metrics left out (or null) become unmeasured. An edited Hevy entry is then workout tracker's own. */
  input: z.object({ id: z.uuid(), ...entryInput }),
  async run({ tx }, input) {
    const changes = {
      date: input.date,
      weight_unit: input.weightUnit,
      length_unit: input.lengthUnit,
      ...columnValues(input.values),
    };
    const [updated] = await tx<BodyMeasurementRow[]>`
      update public.body_measurements set ${tx(changes)}, from_hevy = false, updated_at = now()
      where id = ${input.id}
      returning ${tx.unsafe(SELECT_COLUMNS)}`;
    if (!updated) throw new CommandError("not_found", `Body measurement ${input.id} not found`);
    return toBodyMeasurement(updated);
  },
});

export const deleteBodyMeasurement = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, { id }) {
    const deleted = await tx`delete from public.body_measurements where id = ${id} returning id`;
    if (deleted.length === 0) throw new CommandError("not_found", `Body measurement ${id} not found`);
    return { id };
  },
});

async function allEntries(tx: TransactionSql): Promise<BodyMeasurement[]> {
  const rows = await tx<BodyMeasurementRow[]>`
    select ${tx.unsafe(SELECT_COLUMNS)} from public.body_measurements
    order by date desc`;
  return rows.map(toBodyMeasurement);
}

/** Every entry, newest first. */
export const listBodyMeasurements = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    return { items: await allEntries(tx) };
  },
});

/** One metric's history (oldest first, one unit) and trend. */
export const getBodyMetricHistory = defineCommand({
  input: z.object({ metric: z.enum(BODY_METRIC_KEYS) }),
  async run({ tx }, { metric }) {
    return bodyMetricHistory(await allEntries(tx), metric);
  },
});
