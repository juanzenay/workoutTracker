import type { Block, BlockExercise, HistoryWorkout, IsoDate, PlannedExercise, PlannedSession } from "@/domain/block";
import { diffDates, type PlanChange } from "@/domain/plan-change";
import { detectChanges } from "./changes";
import { addDays, daysBetween, isoWeekday } from "./dates";
import type { PlannedRun, Race, RunPlan } from "@/domain/running";
import { alignDeloads, deloadTargets, placeDeloads } from "./deload";
import { adjustForInjuries } from "./injuries";
import { cutLowerVolumeInPeakWeeks, deloadAlignmentChanges, lightenBeforeLongRuns, peakWeeks } from "./interactions";
import { progress, rampedSets, type ProgressionResult } from "./progression";
import { anchorRunPlans } from "./runs";
import { moveRuns, moveSessions } from "./moves";
import type { PlanMoves } from "@/domain/plan-move";
import type { RunActivity, Unavailability } from "@/domain/availability";
import type { Injury } from "@/domain/injury";
import { settleChanges } from "./policy";
import { displaceSessions, heavyLegDays, replanRuns } from "./replan";

/**
 * The engine's planning entry point. Pure: no I/O, no clock — `today` is an input.
 * The command layer loads blocks + history, calls this, and persists the output.
 */
export interface EngineInput {
  blocks: Block[];
  /** Finished workouts, dated in the block's time zone (any order). */
  history: HistoryWorkout[];
  today: IsoDate;
  /** The plan as persisted now; when given, the output's `changes` say what differs from it and why. */
  currentPlan?: PlannedSession[];
  /** Races (any priority); run plans anchor to theirs. */
  races?: Race[];
  /** Imported run plans; each anchors its final week to its race's week. */
  runPlans?: RunPlan[];
  /** Days the owner marked unavailable: sessions and runs re-plan around them. */
  unavailable?: Unavailability[];
  /** Injuries (open and cleared): exercises that load an injured joint are cut back while it is open. */
  injuries?: Injury[];
  /** Completed runs (Strava, activity files). Absent = outcomes unknown, so no run counts as missed. */
  runActivities?: RunActivity[];
  /**
   * How far `runActivities` reach when they come from file imports (which arrive late): a run on this day or
   * later isn't missed yet. Absent = every day before `today` is known.
   */
  runOutcomesBefore?: IsoDate;
  /** The planned runs as persisted now; when given, `changes` include run changes (missed or unavailable long runs). */
  currentRuns?: PlannedRun[];
  /**
   * The planned runs to plan lifting around, as persisted (with held run changes); when given, they are the
   * output's `plannedRuns` instead of the engine's own.
   */
  plannedRuns?: PlannedRun[];
  /**
   * Run plans being planned for the first time (just imported): how lifting fits around them is part of first
   * planning them, so those adjustments are `initial` changes rather than ones to confirm or announce.
   */
  newRunPlans?: string[];
  /** Moves the owner made by hand within a week: sessions and runs go to the day they chose (./moves.ts). */
  moves?: PlanMoves;
}

export interface EngineOutput {
  /** Every block's sessions, by date (then split order). */
  plannedSessions: PlannedSession[];
  /**
   * What differs from the persisted plan, and why: progression changes, running/lifting interaction adjustments
   * (./interactions.ts) and session moves (./replan.ts) — all only with `currentPlan` — plus run changes (./replan.ts)
   * with `currentRuns`. Every one follows the change policy (./policy.ts); ones that only touch what the persisted
   * plan doesn't have yet (a new block, a newly imported run plan) are `initial`. Keys are stable, so re-plans don't
   * repeat them. The output plan already includes them.
   */
  changes: PlanChange[];
  /** Every run plan's rows on real dates, by date (then plan row order). */
  plannedRuns: PlannedRun[];
}

export function planBlocks(input: EngineInput): EngineOutput {
  const { blocks, history, today, currentPlan, races = [], runPlans = [], unavailable = [], injuries = [] } = input;
  const newRunPlans = new Set(input.newRunPlans ?? []);
  const moves = input.moves ?? { sessions: [], runs: [] };
  const runReplan = replanRuns(moveRuns(anchorRunPlans(runPlans, races), moves.runs), {
    today,
    heavyLegDays: heavyLegDays(blocks, races, moves.sessions),
    unavailable,
    runActivities: input.runActivities,
    runOutcomesBefore: input.runOutcomesBefore,
    currentRuns: input.currentRuns,
  });
  const plannedRuns = input.plannedRuns ?? runReplan.runs;
  const peaks = peakWeeks(plannedRuns, runPlans);
  const interactionChanges: PlanChange[] = [];
  const injuryChanges: PlanChange[] = [];
  const plannedSessions = blocks
    .flatMap((block) => {
      // Lifting around running, in order: deloads line up with A races, then peak-mileage weeks, then sessions move
      // off unavailable days and missed days, then injured exercises are cut back, then long-run eves.
      const ownerWeeks = placeDeloads(block);
      const placement = alignDeloads(block, races);
      const aligned = sessionsOf(block, history, placement.weeks);
      // The owner's moves apply after deloads are placed (which compare unmoved plans) and before the rules that read days.
      const peak = cutLowerVolumeInPeakWeeks(block, moveSessions(aligned, moves.sessions), peaks, today, newRunPlans);
      const displaced = displaceSessions(block, peak.sessions, { history, today, unavailable, plannedRuns });
      const injured = adjustForInjuries(block, displaced.sessions, injuries, today);
      const eve = lightenBeforeLongRuns(block, injured.sessions, plannedRuns, today, newRunPlans);
      if (currentPlan) {
        const moved = placement.weeks.join() !== ownerWeeks.join();
        const ownerPlan = moved ? sessionsOf(block, history, ownerWeeks) : aligned;
        interactionChanges.push(
          ...deloadAlignmentChanges(block, placement, ownerWeeks, ownerPlan, aligned, today),
          ...peak.changes,
          ...displaced.changes,
          ...eve.changes,
        );
        injuryChanges.push(...injured.changes);
      }
      return eve.sessions;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const settle = { today, races, currentPlan, currentRuns: input.currentRuns, plannedSessions };
  const changes = [
    ...(currentPlan
      ? [
          // Progression: the policy reads the next session only (see `SettleInput.policyDates`).
          ...settleChanges(detectChanges(currentPlan, plannedSessions, history, today), {
            ...settle,
            policyDates: (change) => change.diff.flatMap(diffDates).toSorted().slice(0, 1),
          }),
          ...settleChanges(interactionChanges, settle),
          // An injury cuts every session ahead while it is open: like progression, the policy reads the next one only.
          ...settleChanges(injuryChanges, {
            ...settle,
            policyDates: (change) => change.diff.flatMap(diffDates).toSorted().slice(0, 1),
          }),
        ]
      : []),
    ...(input.currentRuns ? settleChanges(runReplan.changes, settle) : []),
  ];
  return { plannedSessions, changes, plannedRuns };
}

function sessionsOf(block: Block, history: HistoryWorkout[], deloadWeeks: number[]): PlannedSession[] {
  const deloads = new Set(deloadWeeks);
  const trainingWeeks = Array.from({ length: block.weeks }, (_, i) => i + 1).filter((w) => !deloads.has(w));
  const weekOf = (date: IsoDate) => Math.floor(daysBetween(block.startDate, date) / 7) + 1;
  // Deload sessions are deliberately light, so progression reads past them.
  const inDeload = (date: IsoDate) => date >= block.startDate && deloads.has(weekOf(date));
  const progressionHistory = deloads.size === 0 ? history : history.filter((w) => !inDeload(w.date));

  const planned: PlannedSession[] = [];
  const days = block.weeks * 7;
  for (let offset = 0; offset < days; offset++) {
    const date = addDays(block.startDate, offset);
    if (block.endDate && date > block.endDate) break;
    const weekday = isoWeekday(date);
    const week = weekOf(date);
    const deload = deloads.has(week);
    // A set ramp climbs over the training weeks only (0-based index among them).
    const trainingWeek = trainingWeeks.filter((w) => w < week).length;
    for (const session of block.sessions.toSorted((a, b) => a.position - b.position)) {
      if (session.weekday !== weekday) continue;
      planned.push({
        blockId: block.id,
        blockSessionId: session.id,
        date,
        week,
        name: session.name,
        ...(deload && { deload: true }),
        exercises: session.exercises
          .toSorted((a, b) => a.position - b.position)
          .map((exercise) => {
            const normal = progress(
              exercise,
              progressionHistory,
              date,
              rampedSets(exercise, trainingWeek, trainingWeeks.length),
            );
            return plannedExercise(exercise, deload ? deloadTargets(exercise, normal) : normal);
          }),
      });
    }
  }
  return planned;
}

/** A planned exercise from its targets (computed from history before the session's date, so a session's own workout never moves them). */
function plannedExercise(exercise: BlockExercise, targets: ProgressionResult): PlannedExercise {
  return {
    blockExerciseId: exercise.id,
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    position: exercise.position,
    repRangeStart: exercise.repRangeStart,
    repRangeEnd: exercise.repRangeEnd,
    ...targets,
  };
}
