import type { SetType, WeightUnit, Workout } from "./workout";

/**
 * Personal records (PRs). Pure: used by the command layer for the records page,
 * exercise history and workout summaries, and by the logger on the device to
 * flag a PR the moment a set is ticked (offline included).
 *
 * Only completed, non-warm-up sets with at least one rep count. A weighted set
 * competes for heaviest weight, best estimated 1RM and best set volume; a
 * bodyweight set (no weight, or 0) competes for most reps. Weights stay as
 * entered with their unit; sets in different units are compared by real mass.
 */

export const RECORD_KINDS = ["heaviestWeight", "bestEstimated1rm", "bestSetVolume", "mostReps"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/** One logged set, placed in history. `achievedAt` is when its workout started. */
export interface HistorySet {
  setId: string;
  workoutId: string;
  exerciseId: string;
  achievedAt: string;
  setType: SetType;
  weight: number | null;
  unit: WeightUnit;
  reps: number | null;
  completed: boolean;
}

/** A record-holding set. `value` is the record itself, in `unit` (reps for mostReps). */
export interface RecordSet {
  setId: string;
  workoutId: string;
  achievedAt: string;
  weight: number | null;
  unit: WeightUnit;
  reps: number;
  value: number;
}

export type ExerciseBests = Partial<Record<RecordKind, RecordSet>>;

/** A set that beat the exercise's previous best of `kind`. */
export interface PrEvent {
  exerciseId: string;
  kind: RecordKind;
  set: RecordSet;
  previous: RecordSet;
}

const LB_PER_KG = 2.2046226218;

/** Converts a weight between units (for comparison and charts only; nothing is stored converted). */
export function convertWeight(weight: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return weight;
  return from === "kg" ? weight * LB_PER_KG : weight / LB_PER_KG;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Epley estimate of a one-rep max; a single is its own 1RM. */
export function estimateOneRepMax(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  return reps === 1 ? weight : round1(weight * (1 + reps / 30));
}

/** Whether a set counts towards records, volume and PRs at all. */
export function isWorkingSet(set: Pick<HistorySet, "completed" | "setType" | "reps">): boolean {
  return set.completed && set.setType !== "warmup" && set.reps !== null && set.reps > 0;
}

/** The record values a working set achieves, keyed by kind, in the set's own unit. */
function valuesOf(set: HistorySet): Partial<Record<RecordKind, number>> {
  const reps = set.reps ?? 0;
  if (set.weight === null || set.weight === 0) return { mostReps: reps };
  return {
    heaviestWeight: set.weight,
    bestEstimated1rm: estimateOneRepMax(set.weight, reps),
    bestSetVolume: round1(set.weight * reps),
  };
}

/** Comparable magnitude of a record (weights normalised to lb). */
function magnitude(kind: RecordKind, record: Pick<RecordSet, "value" | "unit">): number {
  return kind === "mostReps" ? record.value : convertWeight(record.value, record.unit, "lb");
}

export type BestsByExercise = Map<string, ExerciseBests>;

/**
 * Walks sets in the order they were done, keeping each exercise's bests and
 * emitting a PrEvent whenever a set strictly beats an existing best. The very
 * first record of a kind is a baseline, not a PR. `seed` (not mutated) holds
 * bests from before these sets, e.g. the logger's history.
 */
export function scanRecords(
  sets: Iterable<HistorySet>,
  seed: BestsByExercise = new Map(),
): { bests: BestsByExercise; events: PrEvent[] } {
  const bests: BestsByExercise = new Map([...seed].map(([id, b]) => [id, { ...b }]));
  const events: PrEvent[] = [];
  for (const set of sets) {
    if (!isWorkingSet(set)) continue;
    const exerciseBests = bests.get(set.exerciseId) ?? {};
    bests.set(set.exerciseId, exerciseBests);
    for (const [kind, value] of Object.entries(valuesOf(set)) as [RecordKind, number][]) {
      const record: RecordSet = {
        setId: set.setId,
        workoutId: set.workoutId,
        achievedAt: set.achievedAt,
        weight: set.weight,
        unit: set.unit,
        reps: set.reps!,
        value,
      };
      const previous = exerciseBests[kind];
      if (previous && magnitude(kind, record) <= magnitude(kind, previous)) continue;
      exerciseBests[kind] = record;
      if (previous) events.push({ exerciseId: set.exerciseId, kind, set: record, previous });
    }
  }
  return { bests, events };
}

/** A workout's PRs: the final best per exercise and kind, against the best from before the workout. */
export function workoutPrs(events: PrEvent[], workoutId: string): PrEvent[] {
  const byKey = new Map<string, PrEvent>();
  const exerciseOrder: string[] = [];
  for (const event of events) {
    if (event.set.workoutId !== workoutId) continue;
    if (!exerciseOrder.includes(event.exerciseId)) exerciseOrder.push(event.exerciseId);
    const key = `${event.exerciseId}:${event.kind}`;
    const earlier = byKey.get(key);
    byKey.set(key, earlier ? { ...event, previous: earlier.previous } : event);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      exerciseOrder.indexOf(a.exerciseId) - exerciseOrder.indexOf(b.exerciseId) ||
      RECORD_KINDS.indexOf(a.kind) - RECORD_KINDS.indexOf(b.kind),
  );
}

export interface WeightAmount {
  value: number;
  unit: WeightUnit;
}

export interface WorkoutSummaryExercise {
  exerciseId: string;
  name: string;
  /** Working sets (completed, not warm-ups). */
  sets: number;
  /** Weight × reps over working sets; null when every set was bodyweight. */
  volume: WeightAmount | null;
  /** Highest estimated 1RM (or most reps, for bodyweight). */
  bestSet: { weight: number | null; reps: number; unit: WeightUnit } | null;
}

export interface WorkoutSummary {
  workoutId: string;
  name: string | null;
  startedAt: string;
  finishedAt: string;
  durationMinutes: number;
  totalSets: number;
  volume: WeightAmount | null;
  exercises: WorkoutSummaryExercise[];
  prs: (PrEvent & { name: string })[];
}

const sumVolume = (sets: HistorySet[], unit: WeightUnit): number | null => {
  const weighted = sets.filter((s) => s.weight);
  if (weighted.length === 0) return null;
  return round1(weighted.reduce((sum, s) => sum + convertWeight(s.weight! * s.reps!, s.unit, unit), 0));
};

function bestSetOf(sets: HistorySet[]): WorkoutSummaryExercise["bestSet"] {
  let best: HistorySet | undefined;
  const score = (s: HistorySet) =>
    s.weight ? convertWeight(estimateOneRepMax(s.weight, s.reps!), s.unit, "lb") : -1 / (1 + s.reps!);
  for (const set of sets) if (!best || score(set) > score(best)) best = set;
  return best ? { weight: best.weight, reps: best.reps!, unit: best.unit } : null;
}

/**
 * What the share card (and the Strava post) shows for a finished workout.
 * `sets` are the workout's sets in order; `events` come from scanRecords over
 * history up to and including this workout. Volume is expressed in the unit
 * of the workout's first weighted set (lb if none).
 */
export function summarizeWorkout(
  workout: { id: string; name: string | null; startedAt: string; finishedAt: string },
  sets: HistorySet[],
  events: PrEvent[],
  names: ReadonlyMap<string, string>,
): WorkoutSummary {
  const working = sets.filter(isWorkingSet);
  const unit = working.find((s) => s.weight)?.unit ?? "lb";
  const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];
  const exercises = exerciseIds.map((exerciseId): WorkoutSummaryExercise => {
    const own = working.filter((s) => s.exerciseId === exerciseId);
    const volume = sumVolume(own, unit);
    return {
      exerciseId,
      name: names.get(exerciseId) ?? "",
      sets: own.length,
      volume: volume === null ? null : { value: volume, unit },
      bestSet: bestSetOf(own),
    };
  });
  const volume = sumVolume(working, unit);
  return {
    workoutId: workout.id,
    name: workout.name,
    startedAt: workout.startedAt,
    finishedAt: workout.finishedAt,
    durationMinutes: Math.max(0, Math.round((Date.parse(workout.finishedAt) - Date.parse(workout.startedAt)) / 60_000)),
    totalSets: working.length,
    volume: volume === null ? null : { value: volume, unit },
    exercises,
    prs: workoutPrs(events, workout.id).map((pr) => ({ ...pr, name: names.get(pr.exerciseId) ?? "" })),
  };
}

/** A workout's sets as history, in logging order. `achievedAt` is the workout start. */
export function historySetsOf(workout: Workout): HistorySet[] {
  return workout.exercises
    .toSorted((a, b) => a.position - b.position)
    .flatMap((exercise) =>
      exercise.sets
        .toSorted((a, b) => a.position - b.position)
        .map((set) => ({
          setId: set.id,
          workoutId: workout.id,
          exerciseId: exercise.exerciseId,
          achievedAt: workout.startedAt,
          setType: set.setType,
          weight: set.weight,
          unit: set.unit,
          reps: set.reps,
          completed: set.completed,
        })),
    );
}

/**
 * PRs in the workout being logged, for the logger's flags: set id → the
 * record kinds that set beat, against `baseline` (bests from finished
 * workouts) and the earlier ticked sets of this workout.
 */
export function livePrs(baseline: BestsByExercise, workout: Workout): Map<string, RecordKind[]> {
  const flags = new Map<string, RecordKind[]>();
  for (const event of scanRecords(historySetsOf(workout), baseline).events) {
    flags.set(event.set.setId, [...(flags.get(event.set.setId) ?? []), event.kind]);
  }
  return flags;
}

export interface ExerciseSession {
  workoutId: string;
  date: string;
  /** Best estimated 1RM of the session, in the history's unit; null for bodyweight-only sessions. */
  estimated1rm: number | null;
  bestSet: WorkoutSummaryExercise["bestSet"];
  /** Working-set volume in the history's unit; null for bodyweight-only sessions. */
  volume: number | null;
  /** Every completed set, warm-ups included, as entered. */
  sets: { weight: number | null; reps: number | null; unit: WeightUnit; setType: SetType }[];
}

/**
 * One exercise's sessions for charts, oldest first. Values are converted to
 * the unit of the most recent weighted working set (lb if none), so a chart
 * has one axis even if the unit changed once.
 */
export function exerciseSessions(sets: HistorySet[]): { unit: WeightUnit; sessions: ExerciseSession[] } {
  const unit = sets.filter((s) => isWorkingSet(s) && s.weight).at(-1)?.unit ?? "lb";
  const byWorkout = new Map<string, HistorySet[]>();
  for (const set of sets) {
    if (!set.completed) continue;
    byWorkout.set(set.workoutId, [...(byWorkout.get(set.workoutId) ?? []), set]);
  }
  const sessions = [...byWorkout].map(([workoutId, own]): ExerciseSession => {
    const working = own.filter(isWorkingSet);
    const oneRepMaxes = working
      .filter((s) => s.weight)
      .map((s) => convertWeight(estimateOneRepMax(s.weight!, s.reps!), s.unit, unit));
    return {
      workoutId,
      date: own[0]!.achievedAt,
      estimated1rm: oneRepMaxes.length ? round1(Math.max(...oneRepMaxes)) : null,
      bestSet: bestSetOf(working),
      volume: sumVolume(working, unit),
      sets: own.map((s) => ({ weight: s.weight, reps: s.reps, unit: s.unit, setType: s.setType })),
    };
  });
  return { unit, sessions };
}
