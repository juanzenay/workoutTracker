/**
 * Body measurements: one entry per date holding any subset of bodyweight,
 * body composition and girths. Values are stored as entered with the entry's
 * units (weights lb|kg, girths cm|in); nothing is converted on write.
 * The metric list mirrors Hevy's body measurement fields so imports map 1:1.
 */

export const WEIGHT_UNITS = ["lb", "kg"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const LENGTH_UNITS = ["cm", "in"] as const;
export type LengthUnit = (typeof LENGTH_UNITS)[number];

/** How a metric is measured: a weight (entry's weight unit), a girth (entry's length unit) or a percentage. */
export type MetricKind = "weight" | "length" | "percent";

export const BODY_METRICS = {
  weight: "weight",
  leanMass: "weight",
  fatPercent: "percent",
  neck: "length",
  shoulders: "length",
  chest: "length",
  leftBicep: "length",
  rightBicep: "length",
  leftForearm: "length",
  rightForearm: "length",
  abdomen: "length",
  waist: "length",
  hips: "length",
  leftThigh: "length",
  rightThigh: "length",
  leftCalf: "length",
  rightCalf: "length",
} as const satisfies Record<string, MetricKind>;

export type BodyMetric = keyof typeof BODY_METRICS;
export const BODY_METRIC_KEYS = Object.keys(BODY_METRICS) as BodyMetric[];

export type BodyMeasurementValues = Partial<Record<BodyMetric, number>>;

export interface BodyMeasurement {
  id: string;
  /** Calendar date, YYYY-MM-DD. At most one entry per date. */
  date: string;
  weightUnit: WeightUnit;
  lengthUnit: LengthUnit;
  /** Only the metrics that were measured. */
  values: BodyMeasurementValues;
}

export type MetricUnit = WeightUnit | LengthUnit | "%";

export function unitFor(metric: BodyMetric, entry: Pick<BodyMeasurement, "weightUnit" | "lengthUnit">): MetricUnit {
  const kind = BODY_METRICS[metric];
  if (kind === "weight") return entry.weightUnit;
  if (kind === "length") return entry.lengthUnit;
  return "%";
}

const LB_PER_KG = 1 / 0.45359237;
const IN_PER_CM = 1 / 2.54;

function convert(value: number, from: MetricUnit, to: MetricUnit): number {
  if (from === to) return value;
  const factor =
    from === "kg" && to === "lb" ? LB_PER_KG
    : from === "lb" && to === "kg" ? 1 / LB_PER_KG
    : from === "cm" && to === "in" ? IN_PER_CM
    : from === "in" && to === "cm" ? 1 / IN_PER_CM
    : null;
  if (factor === null) throw new Error(`Cannot convert ${from} to ${to}`);
  // Converted values are display values: one decimal is finer than any tape or scale.
  return Math.round(value * factor * 10) / 10;
}

/** Rounds away floating-point noise from differences of decimal measurements. */
function difference(a: number, b: number): number {
  return Math.round((a - b) * 100) / 100;
}

export interface BodyMetricPoint {
  date: string;
  value: number;
}

export interface BodyMetricHistory {
  metric: BodyMetric;
  /** Unit of every point: the latest entry's unit for this metric. Null when never measured. */
  unit: MetricUnit | null;
  /** Oldest first; only dates on which the metric was measured. */
  points: BodyMetricPoint[];
  trend: {
    latest: BodyMetricPoint;
    /** Latest minus the previous point (0 when there is only one). */
    changeSincePrevious: number;
    /** Latest minus the first point. */
    changeSinceFirst: number;
  } | null;
}

/** One metric over time, in a single unit, from entries in any order. */
export function bodyMetricHistory(entries: readonly BodyMeasurement[], metric: BodyMetric): BodyMetricHistory {
  const measured = entries
    .filter((e) => e.values[metric] != null)
    .toSorted((a, b) => a.date.localeCompare(b.date));
  const last = measured.at(-1);
  if (!last) return { metric, unit: null, points: [], trend: null };

  const unit = unitFor(metric, last);
  const points = measured.map((e) => ({
    date: e.date,
    value: convert(e.values[metric]!, unitFor(metric, e), unit),
  }));
  const latest = points.at(-1)!;
  const previous = points.at(-2) ?? latest;
  return {
    metric,
    unit,
    points,
    trend: {
      latest,
      changeSincePrevious: difference(latest.value, previous.value),
      changeSinceFirst: difference(latest.value, points[0]!.value),
    },
  };
}
