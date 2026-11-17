import type { IsoDate, Weekday } from "./block";

/**
 * Running: races, run plans (imported from a file, never bundled) and the
 * dated planned runs the engine anchors from them (src/engine/runs.ts).
 *
 * Distances are meters, durations seconds, paces seconds per km (smaller =
 * faster). Dates are local "YYYY-MM-DD" in the run plan's time zone.
 */

export const RACE_PRIORITIES = ["A", "B", "C"] as const;
export type RacePriority = (typeof RACE_PRIORITIES)[number];

export interface Race {
  id: string;
  name: string;
  date: IsoDate;
  distanceMeters: number;
  priority: RacePriority;
}

export const RUN_TYPES = ["easy", "long", "tempo", "intervals", "race_pace", "cross", "rest", "race"] as const;
export type RunType = (typeof RUN_TYPES)[number];

/** Pace range in seconds per km (to 0.1 s, so min/mile paces survive the round trip): [fastest, slowest]. */
export interface PaceTarget {
  perKmSeconds: [number, number];
}

/** Intensity of one structure step; mirrors what a Coros structured workout accepts. */
export type Intensity =
  | { kind: "pace"; perKmSeconds: [number, number] }
  | { kind: "hr_zone"; zone: number }
  | { kind: "hr"; bpm: [number, number] }
  | { kind: "pct_threshold_pace"; pct: [number, number] };

/** One step: exactly one of distance / duration / open (lap button). */
export interface RunStep {
  distanceMeters?: number;
  durationSeconds?: number;
  open?: true;
  intensity?: Intensity;
}

export interface RunRepeat {
  /** 1–20 (Coros limit). */
  count: number;
  steps: (RunStep & { kind: "work" | "recovery" })[];
}

/** Warm-up / main / repeats / cool-down: rich enough to become a Coros structured workout (no nesting). */
export interface RunStructure {
  warmup?: RunStep;
  main?: RunStep;
  repeats?: RunRepeat[];
  cooldown?: RunStep;
}

/** One row of a run plan file. */
export interface RunPlanRow {
  week: number;
  day: Weekday;
  type: RunType;
  distanceMeters: number | null;
  durationSeconds: number | null;
  paceTarget: PaceTarget | null;
  structure: RunStructure | null;
  notes: string | null;
}

export interface RunPlan {
  id: string;
  name: string;
  /** Length in weeks; the final week is the anchor race's week. */
  weeks: number;
  /** The race the plan is anchored to (an A race); null = not anchored, no planned runs. */
  raceId: string | null;
  timeZone: string;
  rows: RunPlanRow[];
}

/** A run plan row placed on a real date. */
export interface PlannedRun {
  runPlanId: string;
  /** Index of the row in the plan's rows (stable across re-anchoring). */
  rowIndex: number;
  date: IsoDate;
  /** 1-based week of the plan. */
  week: number;
  type: RunType;
  distanceMeters: number | null;
  durationSeconds: number | null;
  paceTarget: PaceTarget | null;
  structure: RunStructure | null;
  notes: string | null;
}

const wholePace = ([fast, slow]: [number, number]): [number, number] => [Math.round(fast), Math.round(slow)];

function wholeStep<Step extends RunStep>(step: Step): Step {
  const { intensity } = step;
  return intensity?.kind === "pace" ? { ...step, intensity: { ...intensity, perKmSeconds: wholePace(intensity.perKmSeconds) } } : step;
}

/**
 * Paces are stored to 0.1 s/km; Coros structured workouts take whole seconds
 * per km. Rounds the pace target and every pace step (use where a planned run
 * is handed out to become a Coros workout, e.g. the MCP calendar).
 */
export function withWholeSecondPaces<Run extends { paceTarget: PaceTarget | null; structure: RunStructure | null }>(
  run: Run,
): Run {
  const { paceTarget, structure } = run;
  return {
    ...run,
    paceTarget: paceTarget && { perKmSeconds: wholePace(paceTarget.perKmSeconds) },
    structure: structure && {
      ...structure,
      ...(structure.warmup && { warmup: wholeStep(structure.warmup) }),
      ...(structure.main && { main: wholeStep(structure.main) }),
      ...(structure.repeats && {
        repeats: structure.repeats.map((r) => ({ ...r, steps: r.steps.map(wholeStep) })),
      }),
      ...(structure.cooldown && { cooldown: wholeStep(structure.cooldown) }),
    },
  };
}

/** A section's end: a distance (m), a time (s), or the lap button. */
export type CorosTarget = { distanceMeters: number } | { durationSeconds: number } | "open";

export interface CorosSection {
  type: "warmup" | "training" | "recovery" | "cooldown";
  target: CorosTarget;
  intensity?: Intensity;
}

export interface CorosRepeat {
  type: "repeat";
  count: number;
  sections: CorosSection[];
}

/** A planned run as the sections of a Coros structured workout, in order. */
export interface CorosWorkout {
  sections: (CorosSection | CorosRepeat)[];
}

const NOT_A_RUN: RunType[] = ["rest", "cross"];

function section(type: CorosSection["type"], step: RunStep): CorosSection {
  const target: CorosTarget =
    step.distanceMeters !== undefined
      ? { distanceMeters: step.distanceMeters }
      : step.durationSeconds !== undefined
        ? { durationSeconds: step.durationSeconds }
        : "open";
  return { type, target, ...(step.intensity && { intensity: step.intensity }) };
}

/**
 * The sections a Coros structured workout is built from (warm-up, training,
 * repeat groups of training/recovery, cool-down), paces in whole seconds per
 * km. A run without structure is one training section: its distance (or
 * duration, else open) at its pace target. Rest and cross-training days: null.
 */
export function corosWorkout(run: PlannedRun): CorosWorkout | null {
  if (NOT_A_RUN.includes(run.type)) return null;
  const { paceTarget, structure } = withWholeSecondPaces(run);
  if (!structure) {
    const step: RunStep = {
      ...(run.distanceMeters !== null ? { distanceMeters: run.distanceMeters } : {}),
      ...(run.distanceMeters === null && run.durationSeconds !== null ? { durationSeconds: run.durationSeconds } : {}),
      ...(paceTarget && { intensity: { kind: "pace" as const, perKmSeconds: paceTarget.perKmSeconds } }),
    };
    return { sections: [section("training", step)] };
  }
  const sections: CorosWorkout["sections"] = [];
  if (structure.warmup) sections.push(section("warmup", structure.warmup));
  if (structure.main) sections.push(section("training", structure.main));
  for (const repeat of structure.repeats ?? []) {
    sections.push({
      type: "repeat",
      count: repeat.count,
      sections: repeat.steps.map(({ kind, ...step }) => section(kind === "work" ? "training" : "recovery", step)),
    });
  }
  if (structure.cooldown) sections.push(section("cooldown", structure.cooldown));
  return { sections };
}
