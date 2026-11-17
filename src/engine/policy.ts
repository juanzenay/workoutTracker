import type { IsoDate, PlannedExercise, PlannedSession } from "@/domain/block";
import { sameJson } from "@/domain/json";
import { diffDates, type PlanChange, type PlanDiffItem } from "@/domain/plan-change";
import type { PlannedRun, Race } from "@/domain/running";
import { addDays, isoWeekday } from "./dates";

/**
 * The change policy, for every change the engine emits (progression, interaction
 * rules, re-plan moves and drops): a change touching a race week, an A race's
 * taper, or anything more than `POLICY.aheadDays` ahead waits for the owner's
 * confirmation; the rest apply at once.
 *
 * A change is a difference from the plan the owner already has (`currentPlan` /
 * `currentRuns`). So `settleChanges` first sorts each diff item into:
 * - already in the persisted plan → dropped (nothing changes);
 * - touching what the persisted plan doesn't have yet (a new block's sessions, a
 *   newly imported run plan's runs) → part of first planning it: `initial`,
 *   applied silently, nothing to confirm or announce;
 * - the rest → the change, with the policy applied.
 */
export const POLICY = {
  /** A change reaching further ahead than this many days waits for the owner's confirmation. */
  aheadDays: 7,
  /** An A race's taper: this many weeks ending with its race week. */
  taperWeeks: 3,
};

const mondayOf = (date: IsoDate) => addDays(date, 1 - isoWeekday(date));

/** Whether a change touching `dates` waits for the owner: a race week, an A race's taper, or beyond the horizon. */
export function needsConfirmation(dates: IsoDate[], today: IsoDate, races: Race[]): boolean {
  const horizon = addDays(today, POLICY.aheadDays);
  return dates.some(
    (date) =>
      date > horizon ||
      races.some((race) => {
        const raceMonday = mondayOf(race.date);
        const weeks = race.priority === "A" ? POLICY.taperWeeks : 1;
        return date >= addDays(raceMonday, -7 * (weeks - 1)) && date <= addDays(raceMonday, 6);
      }),
  );
}

/** `change` with its confirmation flag set by the policy, from the dates it touches (by default every date in its diff). */
export function withPolicy(
  change: PlanChange,
  today: IsoDate,
  races: Race[],
  dates: IsoDate[] = change.diff.flatMap(diffDates),
): PlanChange {
  return { ...change, requiresConfirmation: needsConfirmation(dates, today, races) };
}

export interface SettleInput {
  today: IsoDate;
  races: Race[];
  /** The persisted plan (sessions); items on sessions it doesn't have are initial. */
  currentPlan?: PlannedSession[];
  /** The persisted runs; items on runs it doesn't have are initial. */
  currentRuns?: PlannedRun[];
  /** The engine's new plan (after every rule), to tell what is already persisted. */
  plannedSessions: PlannedSession[];
  /**
   * The dates the policy reads for a change (default: every date in its diff). Progression reads only its next
   * session: the sessions after it carry the same "next time" target, re-derived as each session is done.
   */
  policyDates?: (change: PlanChange) => IsoDate[];
}

type ItemState = "persisted" | "initial" | "change";

/** Changes as the owner sees them: policy applied, initial ones marked, ones already in the plan dropped. */
export function settleChanges(changes: PlanChange[], input: SettleInput): PlanChange[] {
  const slot = (s: Pick<PlannedSession, "blockSessionId" | "date">) => `${s.blockSessionId}|${s.date}`;
  const runKey = (r: Pick<PlannedRun, "runPlanId" | "rowIndex">) => `${r.runPlanId}:${r.rowIndex}`;
  const persisted = new Map((input.currentPlan ?? []).map((s) => [slot(s), s]));
  const planned = new Map(input.plannedSessions.map((s) => [slot(s), s]));
  const persistedRuns = new Map((input.currentRuns ?? []).map((r) => [runKey(r), r]));
  const exerciseIn = (session: PlannedSession | undefined, id: string): PlannedExercise | undefined =>
    session?.exercises.find((e) => e.blockExerciseId === id);

  const state = (item: PlanDiffItem): ItemState => {
    if (item.type === "exercise") {
      const was = exerciseIn(persisted.get(slot(item)), item.blockExerciseId);
      if (!was) return "initial";
      const now = exerciseIn(planned.get(slot(item)), item.blockExerciseId);
      return now && sameJson(was, now) ? "persisted" : "change";
    }
    if (item.type === "session") {
      if (item.before && persisted.has(slot(item.before))) return "change";
      // The session it moves isn't in the plan: already moved (or dropped), or never planned there before.
      return !item.after || persisted.has(slot(item.after)) ? "persisted" : "initial";
    }
    const was = persistedRuns.get(runKey(item));
    if (!was) return item.after ? "initial" : "persisted";
    return item.after && was.date === item.after.date ? "persisted" : "change";
  };

  return changes.flatMap((change): PlanChange[] => {
    if (change.initial) return [{ ...change, requiresConfirmation: false }];
    if (change.diff.length === 0) return [withPolicy(change, input.today, input.races)];
    const states = change.diff.map(state);
    // A live exercise item says what the persisted plan shows now and what it becomes (after every rule), so
    // confirming writes the new plan and undo or holding puts back exactly what the owner had.
    const live = change.diff
      .filter((_, i) => states[i] === "change")
      .map((item): PlanDiffItem => {
        if (item.type !== "exercise") return item;
        const now = exerciseIn(planned.get(slot(item)), item.blockExerciseId);
        return { ...item, before: exerciseIn(persisted.get(slot(item)), item.blockExerciseId)!, after: now ?? item.after };
      });
    if (live.length > 0) {
      const settled = { ...change, diff: live };
      return [withPolicy(settled, input.today, input.races, input.policyDates?.(settled))];
    }
    const initial = change.diff.filter((_, i) => states[i] === "initial");
    if (initial.length > 0) return [{ ...change, diff: initial, requiresConfirmation: false, initial: true }];
    return [];
  });
}
