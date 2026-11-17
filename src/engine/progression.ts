import type { BlockExercise, HistoryWorkout, IsoDate, PlannedSet, Progression } from "@/domain/block";
import { convertWeight } from "@/domain/records";
import type { Message } from "@/domain/message";
import type { WeightUnit } from "@/domain/workout";

/** What an exercise's progression rule yields for one planned session. */
export interface ProgressionResult {
  sets: PlannedSet[];
  progression: Progression;
}

/**
 * Targets for one exercise on `date`, by the exercise's progression rule.
 *
 * - **double** (default): stay at a load until the top of the rep range is hit
 *   on every planned set, then add `increment` and start again from the bottom
 *   of the range. While holding, each set aims one rep past what it did last
 *   time. With RIR logged, a top-of-range session whose last set was RIR 0
 *   (a grinder) holds instead of adding load; with no RIR it is reps only.
 * - **rir** (RIR-informed): reads the RIR on the last working set. 2+ in reserve
 *   → add load (even below the top of the range); RIR 0 → hold, but RIR 0
 *   `FATIGUE_SESSIONS` sessions running at the same (usual) load → reduce by
 *   one increment; RIR 1 → as double progression. No RIR logged → reps only
 *   (double progression).
 * - **ramp** (set ramp): load moves by double progression while the set count
 *   climbs across the block (see `rampedSets`); added sets aim for the bottom
 *   of the range.
 *
 * "Last time" = the most recent workout dated before `date` with working sets
 * (completed, not warm-up or drop, reps > 0) of the exercise. The working load
 * is the heaviest of those sets; only sets at that load count.
 */
export function progress(
  exercise: BlockExercise,
  history: HistoryWorkout[],
  date: IsoDate,
  /** Sets planned for this session (differs from `exercise.sets` on a set ramp). */
  setCount = exercise.sets,
): ProgressionResult {
  const result = progressLoad(exercise, history, date, setCount);
  if (setCount === exercise.sets) return result;
  const reason: Message = {
    code: "progressionRamp",
    reason: result.progression.reason as Message,
    sets: setCount,
    rampTo: exercise.rampTo ?? null,
  };
  return { ...result, progression: { ...result.progression, reason } };
}

/**
 * Set ramp (rule "ramp"): sets climb evenly from `exercise.sets` in the first
 * training week to `rampTo` in the last. `trainingWeek` is 0-based among the
 * block's training (non-deload) weeks, of `trainingWeeks`. Other rules: `sets`.
 */
export function rampedSets(exercise: BlockExercise, trainingWeek: number, trainingWeeks: number): number {
  if (exercise.rule !== "ramp" || !exercise.rampTo || trainingWeeks < 2) return exercise.sets;
  return exercise.sets + Math.round(((exercise.rampTo - exercise.sets) * trainingWeek) / (trainingWeeks - 1));
}

function progressLoad(
  exercise: BlockExercise,
  history: HistoryWorkout[],
  date: IsoDate,
  setCount: number,
): ProgressionResult {
  const { repRangeStart: bottom, repRangeEnd: top, unit } = exercise;
  const sessions = recentSessions(exercise, history, date);
  const setsAt = (weight: number | null, reps: (position: number) => number): PlannedSet[] =>
    Array.from({ length: setCount }, (_, position) => ({
      position,
      setType: "normal",
      weight,
      unit,
      reps: reps(position),
    }));

  const last = sessions[0];
  if (!last) {
    return {
      sets: setsAt(exercise.startWeight, () => bottom),
      progression: {
        decision: "start",
        fromWeight: null,
        reason: { code: "progressionStart", weight: exercise.startWeight, unit, reps: bottom },
      },
    };
  }

  const { load, reps, lastRir } = last;
  const increase = (reason: (next: number) => Message): ProgressionResult => {
    const next = load! + exercise.increment;
    return {
      sets: setsAt(next, () => bottom),
      progression: { decision: "increase", fromWeight: load, reason: reason(next) },
    };
  };
  const clamp = (n: number) => Math.min(top, Math.max(bottom, n));
  const hold = (reason: Message): ProgressionResult => ({
    sets: setsAt(load, (position) => clamp(reps[position] === undefined ? bottom : reps[position] + 1)),
    progression: { decision: "hold", fromWeight: load, reason },
  });

  const rirRule = exercise.rule === "rir";
  if (rirRule && load !== null && lastRir !== null) {
    if (lastRir >= 2)
      return increase((next) => ({ code: "progressionRirIncrease", at: load, rir: lastRir, next, unit }));
    const grinders = sessions.findIndex((s) => s.lastRir !== 0 || s.load !== load);
    const running = grinders === -1 ? sessions.length : grinders;
    if (running >= FATIGUE_SESSIONS) {
      const eased = Math.max(0, load - exercise.increment);
      return {
        sets: setsAt(eased, (position) => clamp(reps[position] === undefined ? bottom : reps[position] + 1)),
        progression: {
          decision: "reduce",
          fromWeight: load,
          reason: { code: "progressionRirReduce", sessions: running, at: load, next: eased, unit },
        },
      };
    }
    if (lastRir === 0) return hold({ code: "progressionRirGrinder", at: load, unit });
  }

  // Reps-based double progression (also the RIR rule's fallback when RIR was not logged).
  const fallback = (reason: Message): Message =>
    rirRule && lastRir === null ? { code: "progressionNoRir", reason } : reason;
  const hitTop = reps.length >= exercise.sets && reps.every((r) => r >= top);
  if (hitTop && load !== null && lastRir !== 0)
    return increase((next) => fallback({ code: "progressionHitTop", top, sets: reps.length, at: load, next, unit }));
  return hold(
    fallback(
      !hitTop
        ? { code: "progressionNotYet", top, at: load, unit }
        : load === null
          ? { code: "progressionHitTopBodyweight", top }
          : { code: "progressionHitTopGrinder", top, at: load, unit },
    ),
  );
}

/** RIR rule: this many sessions running ending on RIR 0 at the same load brings the load down by one increment. */
export const FATIGUE_SESSIONS = 3;


/** Weight in the exercise's unit: unchanged when units match, else converted to the nearest 0.5 lb / 0.25 kg. */
function inUnit(weight: number, from: WeightUnit, to: WeightUnit): number {
  if (from === to) return weight;
  const step = to === "lb" ? 2 : 4;
  return Math.round(convertWeight(weight, from, to) * step) / step;
}

interface DoneSession {
  date: IsoDate;
  /** Heaviest working load (exercise's unit); null = bodyweight. */
  load: number | null;
  /** Reps of the working sets at that load, in order. */
  reps: number[];
  /** RIR on the last set at that load; null = not logged. */
  lastRir: number | null;
}

/** The exercise's sessions before `date` (workouts with working sets of it), newest first. */
function recentSessions(exercise: BlockExercise, history: HistoryWorkout[], date: IsoDate): DoneSession[] {
  const before = history.filter((w) => w.date < date).toSorted((a, b) => b.date.localeCompare(a.date));
  const sessions: DoneSession[] = [];
  for (const workout of before) {
    const working = workout.exercises
      .filter((e) => e.exerciseId === exercise.exerciseId)
      .flatMap((e) => e.sets)
      .filter((s) => s.completed && s.setType !== "warmup" && s.setType !== "drop" && (s.reps ?? 0) > 0)
      .map((s) => ({
        ...s,
        weight: s.weight === null || s.weight === 0 ? null : inUnit(s.weight, s.unit, exercise.unit),
      }));
    if (working.length === 0) continue;
    const load = working.some((s) => s.weight !== null) ? Math.max(...working.map((s) => s.weight ?? 0)) : null;
    const atLoad = working.filter((s) => s.weight === load);
    sessions.push({ date: workout.date, load, reps: atLoad.map((s) => s.reps!), lastRir: atLoad.at(-1)!.rir ?? null });
  }
  return sessions;
}
