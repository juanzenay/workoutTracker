import type { Block, BlockExercise, IsoDate, PlannedExercise, PlannedSession } from "@/domain/block";
import type { Muscle } from "@/domain/exercise";
import type { Message } from "@/domain/message";
import type { ExerciseDiff, PlanChange } from "@/domain/plan-change";
import type { PlannedRun, RunPlan } from "@/domain/running";
import { addDays, isoWeekday } from "./dates";
import type { DeloadPlacement } from "./deload";

/**
 * Running/lifting interaction rules: how lifting is planned around running and
 * races. Each adjustment is also a plan change with a plain-language reason;
 * keys are stable for the same adjustment across re-plans.
 */

/** The tunable knobs of the interaction rules. */
export const INTERACTIONS = {
  /** Muscles that make an exercise lower-body work. */
  lowerBody: ["quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors"] as readonly Muscle[],
  /** A run plan week is peak mileage at this share of the plan's biggest week (race rows don't count). */
  peakShare: 0.9,
  /** In a peak-mileage week, lower-body exercises keep this share of their sets (rounded, at least 1). */
  peakLowerSets: 2 / 3,
  /** The day before a long run (or race), lower-body loads drop to this share (rounded down to the increment). */
  longRunEveLoad: 0.85,
};

export const isLowerBody = (exercise: Pick<BlockExercise, "muscles"> | undefined) =>
  !!exercise?.muscles?.some((m) => INTERACTIONS.lowerBody.includes(m));

const mondayOf = (date: IsoDate) => addDays(date, 1 - isoWeekday(date));

/** A run plan's peak-mileage week, as a Monday–Sunday calendar week. */
export interface PeakWeek {
  monday: IsoDate;
  meters: number;
  runPlanId: string;
  planName: string;
}

/** Every run plan's peak-mileage weeks (by planned distance, race rows excluded). */
export function peakWeeks(plannedRuns: PlannedRun[], runPlans: RunPlan[]): PeakWeek[] {
  return runPlans.flatMap((plan) => {
    const weeks = new Map<number, { monday: IsoDate; meters: number }>();
    for (const run of plannedRuns) {
      if (run.runPlanId !== plan.id) continue;
      const week = weeks.get(run.week) ?? { monday: mondayOf(run.date), meters: 0 };
      if (run.type !== "race") week.meters += run.distanceMeters ?? 0;
      weeks.set(run.week, week);
    }
    const most = Math.max(0, ...[...weeks.values()].map((w) => w.meters));
    if (most === 0) return [];
    return [...weeks.values()]
      .filter((w) => w.meters >= most * INTERACTIONS.peakShare)
      .map((w) => ({ ...w, runPlanId: plan.id, planName: plan.name }));
  });
}

/**
 * Peak-mileage weeks: lower-body exercises in the block's (non-deload) sessions
 * that week drop a third of their sets. One change per block and week; a newly
 * imported run plan's (`newRunPlans`) are `initial`.
 */
export function cutLowerVolumeInPeakWeeks(
  block: Block,
  sessions: PlannedSession[],
  peaks: PeakWeek[],
  today: IsoDate,
  newRunPlans: ReadonlySet<string> = new Set(),
): { sessions: PlannedSession[]; changes: PlanChange[] } {
  const exercises = blockExercises(block);
  const changes = new Map<string, PlanChange>();
  const adjusted = sessions.map((session) => {
    const peak = session.deload ? undefined : peaks.find((p) => p.monday === mondayOf(session.date));
    if (!peak) return session;
    const after = {
      ...session,
      exercises: session.exercises.map((e) => {
        if (!isLowerBody(exercises.get(e.blockExerciseId))) return e;
        const keep = Math.max(1, Math.round(e.sets.length * INTERACTIONS.peakLowerSets));
        if (keep === e.sets.length) return e;
        return noted({ ...e, sets: e.sets.slice(0, keep) }, { code: "peakAdjustment", keep, of: e.sets.length });
      }),
    };
    const diff = session.date >= today ? diffSessions([session], [after]) : [];
    if (diff.length > 0) {
      const key = `peak-lower:${block.id}:${peak.monday}`;
      const change = changes.get(key) ?? {
        key,
        summary: { code: "peakSummary", week: session.week },
        reasons: [{ code: "peakReason", week: session.week, plan: peak.planName, meters: peak.meters }],
        requiresConfirmation: false,
        ...(newRunPlans.has(peak.runPlanId) && { initial: true as const }),
        diff: [],
      };
      change.diff.push(...diff);
      changes.set(key, change);
    }
    return after;
  });
  return { sessions: adjusted, changes: [...changes.values()] };
}

/**
 * No heavy lower session the day before a long run or race: the session's
 * lower-body loads come down to ~85%. Deload sessions are already light.
 * One change per session; one for a newly imported run plan's (`newRunPlans`) run is `initial`.
 */
export function lightenBeforeLongRuns(
  block: Block,
  sessions: PlannedSession[],
  plannedRuns: PlannedRun[],
  today: IsoDate,
  newRunPlans: ReadonlySet<string> = new Set(),
): { sessions: PlannedSession[]; changes: PlanChange[] } {
  const exercises = blockExercises(block);
  const changes: PlanChange[] = [];
  const adjusted = sessions.map((session) => {
    if (session.deload) return session;
    const tomorrow = addDays(session.date, 1);
    const run = plannedRuns.find((r) => r.date === tomorrow && (r.type === "long" || r.type === "race"));
    if (!run) return session;
    const race = run.type === "race";
    const after = {
      ...session,
      exercises: session.exercises.map((e) => {
        const exercise = exercises.get(e.blockExerciseId);
        return exercise && isLowerBody(exercise) ? lighten(e, exercise.increment, race) : e;
      }),
    };
    const diff = session.date >= today ? diffSessions([session], [after]) : [];
    if (diff.length > 0) {
      const share = Math.round(INTERACTIONS.longRunEveLoad * 100);
      changes.push({
        key: `long-run-eve:${session.blockSessionId}:${session.date}`,
        summary: { code: "eveSummary", session: session.name, race },
        reasons: [{ code: "eveReason", race, meters: run.distanceMeters, share }],
        requiresConfirmation: false,
        ...(newRunPlans.has(run.runPlanId) && { initial: true as const }),
        diff,
      });
    }
    return after;
  });
  return { sessions: adjusted, changes };
}

/** Every set's load cut to the eve-of-long-run share, rounded down to the increment (loads left to the owner stay so). */
function lighten(exercise: PlannedExercise, increment: number, race: boolean): PlannedExercise {
  const load = INTERACTIONS.longRunEveLoad;
  if (exercise.sets.every((set) => set.weight === null)) return exercise;
  const sets = exercise.sets.map((set) =>
    set.weight === null ? set : { ...set, weight: Math.floor((set.weight * load) / increment) * increment },
  );
  return noted({ ...exercise, sets }, { code: "eveAdjustment", race, share: Math.round(load * 100) });
}

export const noted = (exercise: PlannedExercise, note: Message): PlannedExercise => ({
  ...exercise,
  adjustments: [...(exercise.adjustments ?? []), note],
});

export const blockExercises = (block: Block) =>
  new Map(block.sessions.flatMap((s) => s.exercises).map((e) => [e.id, e] as const));

/** Changes for deloads that moved (or were added) to line up with A races: `before` = the owner's placement. */
export function deloadAlignmentChanges(
  block: Block,
  placement: DeloadPlacement,
  ownerWeeks: number[],
  ownerPlan: PlannedSession[],
  plan: PlannedSession[],
  today: IsoDate,
): PlanChange[] {
  const owner = new Set(ownerWeeks);
  const changes: PlanChange[] = [];
  for (const { race, raceWeek, postRaceWeek, dropped } of placement.alignments) {
    const aligned = [raceWeek, postRaceWeek].filter((w) => w !== null);
    const added = aligned.filter((w) => !owner.has(w));
    if (added.length === 0 && dropped.length === 0) continue;
    const touched = new Set([...added, ...dropped]);
    const diff = diffSessions(
      ownerPlan.filter((s) => touched.has(s.week) && s.date >= today),
      plan,
    );
    if (diff.length === 0) continue;
    const reasons: Message[] = [];
    if (raceWeek !== null) reasons.push({ code: "deloadRaceWeek", week: raceWeek, race: race.name });
    if (postRaceWeek !== null) reasons.push({ code: "deloadPostRace", week: postRaceWeek, race: race.name });
    if (dropped.length > 0) reasons.push({ code: "deloadDropped", weeks: dropped });
    changes.push({
      key: `deload-align:${block.id}:${race.id}:${race.date}`,
      summary:
        dropped.length > 0
          ? { code: "deloadMoves", from: dropped, to: aligned, race: race.name }
          : { code: "deloadAdded", weeks: added, race: race.name },
      reasons,
      requiresConfirmation: false,
      diff,
    });
  }
  return changes;
}

/** Exercise-level diff of `before` sessions against the same slots in `after` (only exercises that differ). */
export function diffSessions(before: PlannedSession[], after: PlannedSession[]): ExerciseDiff[] {
  const afterBySlot = new Map(after.map((s) => [`${s.blockSessionId}|${s.date}`, s]));
  return before.flatMap((was) => {
    const now = afterBySlot.get(`${was.blockSessionId}|${was.date}`);
    if (!now) return [];
    return was.exercises.flatMap((b): ExerciseDiff[] => {
      const a = now.exercises.find((e) => e.blockExerciseId === b.blockExerciseId);
      if (!a || JSON.stringify(a) === JSON.stringify(b)) return [];
      return [
        {
          type: "exercise",
          blockId: now.blockId,
          blockSessionId: now.blockSessionId,
          date: now.date,
          sessionName: now.name,
          blockExerciseId: a.blockExerciseId,
          before: b,
          after: a,
        },
      ];
    });
  });
}
