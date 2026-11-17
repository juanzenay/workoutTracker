import type { RunActivity, Unavailability } from "@/domain/availability";
import type { Block, HistoryWorkout, IsoDate, PlannedSession } from "@/domain/block";
import type { Message } from "@/domain/message";
import type { PlanChange, RunDiff } from "@/domain/plan-change";
import type { PlannedRun, Race, RunType } from "@/domain/running";
import { addDays, isoWeekday } from "./dates";
import type { SessionMove } from "@/domain/plan-move";
import { alignDeloads } from "./deload";
import { movedDate } from "./moves";
import { isLowerBody } from "./interactions";

/**
 * Re-planning on triggers: missed sessions, missed (or far too short) long
 * runs, and days the owner marked unavailable. Races added or moved re-plan
 * through run-plan anchoring and deload alignment (./runs.ts, ./deload.ts).
 *
 * Every rule here is deterministic in its inputs, so a later re-plan reaches
 * the same plan; a move only lands on a day still to come (or one already
 * done), so a session or run never moves onto a day that is already over.
 */

/** The tunable knobs of re-planning. */
export const REPLAN = {
  /** A missed long run may move up to this many days later. */
  longRunMoveDays: 3,
  /** A long run done to less than this share of its distance (or duration) counts as missed. */
  longRunMadeShare: 0.5,
};

/** Runs that make a day hard: no long run moves onto (or next to) one. */
const HARD_RUNS: RunType[] = ["long", "race", "tempo", "intervals", "race_pace"];
/** Runs a moved long run replaces on its new day. */
const MAKES_WAY: RunType[] = ["easy", "cross", "rest"];


/** The owner's unavailability covering `date`, if any. */
const unavailableOn = (unavailable: Unavailability[], date: IsoDate) =>
  unavailable.find((u) => u.startDate <= date && date <= u.endDate);

// ---- Runs ----

/** Days with a heavy leg session: a non-deload session with lower-body work, as the blocks schedule them (and the owner moved them). */
export function heavyLegDays(blocks: Block[], races: Race[], moves: SessionMove[] = []): Set<IsoDate> {
  const days = new Set<IsoDate>();
  for (const block of blocks) {
    const deloads = new Set(alignDeloads(block, races).weeks);
    const legSessions = block.sessions.filter((s) => s.exercises.some(isLowerBody));
    for (let offset = 0; offset < block.weeks * 7; offset++) {
      const date = addDays(block.startDate, offset);
      if (block.endDate && date > block.endDate) break;
      if (deloads.has(Math.floor(offset / 7) + 1)) continue;
      for (const session of legSessions) if (session.weekday === isoWeekday(date)) days.add(movedDate(moves, session.id, date));
    }
  }
  return days;
}

export interface RunReplanInput {
  today: IsoDate;
  heavyLegDays: Set<IsoDate>;
  unavailable: Unavailability[];
  /** Completed runs; undefined = outcomes unknown (no Strava, no imports), so no run counts as missed. */
  runActivities?: RunActivity[];
  /** Completed runs are only known before this day (file imports arrive late); undefined = before `today`. */
  runOutcomesBefore?: IsoDate;
  /**
   * The planned runs as persisted, when known: a long run counts as missed only if the owner's plan had it (the
   * past runs of a just-imported plan were never on it).
   */
  currentRuns?: PlannedRun[];
}

const runKey = (run: Pick<PlannedRun, "runPlanId" | "rowIndex">) => `${run.runPlanId}:${run.rowIndex}`;

/**
 * Runs re-planned around unavailable days and missed long runs:
 * - on an unavailable day, runs other than long runs, races and rest come off the plan;
 * - a long run on an unavailable day, or missed (day over, under `longRunMadeShare`
 *   done), moves to the first of the next `longRunMoveDays` days that is free,
 *   not hard, and has no heavy leg session or hard run on it or either side;
 *   easy/cross/rest runs on that day make way. With no such day it is dropped:
 *   a missed one stays on its day as missed, an unavailable one comes off.
 */
export function replanRuns(anchored: PlannedRun[], input: RunReplanInput): { runs: PlannedRun[]; changes: PlanChange[] } {
  const { today, unavailable } = input;
  const runs = new Map(anchored.map((r) => [runKey(r), r] as const));
  const changes: PlanChange[] = [];
  const done = new Map<IsoDate, { meters: number; seconds: number }>();
  for (const a of input.runActivities ?? []) {
    const day = done.get(a.date) ?? { meters: 0, seconds: 0 };
    done.set(a.date, { meters: day.meters + a.meters, seconds: day.seconds + a.seconds });
  }
  const remove = (run: PlannedRun): RunDiff => {
    runs.delete(runKey(run));
    return { type: "run", runPlanId: run.runPlanId, rowIndex: run.rowIndex, before: run, after: null };
  };

  // Unavailable days clear their runs (per plan and range).
  for (const range of unavailable) {
    const byPlan = new Map<string, RunDiff[]>();
    for (const run of anchored) {
      if (!unavailableOn([range], run.date) || ["long", "race", "rest"].includes(run.type)) continue;
      byPlan.set(run.runPlanId, [...(byPlan.get(run.runPlanId) ?? []), remove(run)]);
    }
    for (const [planId, diff] of byPlan) {
      if (!diff.some((d) => d.before!.date >= today)) continue;
      changes.push({
        key: `unavailable-runs:${planId}:${range.startDate}:${range.endDate}`,
        summary: { code: "unavailableRunsSummary", count: diff.length },
        reasons: [{ code: "unavailableRunsReason", from: range.startDate, to: range.endDate }],
        requiresConfirmation: false,
        diff,
      });
    }
  }

  // Long runs on unavailable days, or missed.
  for (const run of anchored.filter((r) => r.type === "long")) {
    const away = unavailableOn(unavailable, run.date);
    const onPlan = !input.currentRuns || input.currentRuns.some((r) => runKey(r) === runKey(run));
    if (!away && !(onPlan && missedLongRun(run, judgedBefore(input), input.runActivities ? done : null))) continue;
    const cause: Message = away
      ? { code: "unavailableCause", from: away.startDate, to: away.endDate }
      : { code: "longRunMissed", meters: run.distanceMeters, date: run.date };
    const target = moveTarget(run, [...runs.values()], input, done);
    if (target) {
      const makingWay = [...runs.values()].filter((r) => r.date === target && MAKES_WAY.includes(r.type));
      const diff: RunDiff[] = [
        { type: "run", runPlanId: run.runPlanId, rowIndex: run.rowIndex, before: run, after: { ...run, date: target } },
        ...makingWay.map(remove),
      ];
      runs.set(runKey(run), { ...run, date: target });
      const makesWay = makingWay.filter((r) => r.type !== "rest").map((r): "cross" | "easy" => (r.type === "cross" ? "cross" : "easy"));
      if (target < today) continue;
      changes.push({
        key: `long-run-move:${run.runPlanId}:${run.rowIndex}:${run.date}:${target}`,
        summary: { code: "longRunMoveSummary", missed: !away, date: target },
        reasons: [cause, { code: "longRunMoveReason", date: target, makesWay }],
        requiresConfirmation: false,
        diff,
      });
    } else {
      const reasons: Message[] = [cause, { code: "longRunDropReason", days: REPLAN.longRunMoveDays }];
      if (away) {
        const diff = [remove(run)];
        if (run.date >= today)
          changes.push({
            key: `long-run-drop:${run.runPlanId}:${run.rowIndex}:${run.date}`,
            summary: { code: "longRunDropSummary", missed: false },
            reasons,
            requiresConfirmation: false,
            diff,
          });
      } else if (addDays(run.date, REPLAN.longRunMoveDays) >= today) {
        // Nothing changes on the plan (it stays missed), so nothing to confirm.
        changes.push({
          key: `long-run-drop:${run.runPlanId}:${run.rowIndex}:${run.date}`,
          summary: { code: "longRunDropSummary", missed: true },
          reasons,
          requiresConfirmation: false,
          diff: [],
        });
      }
    }
  }
  const sorted = [...runs.values()].sort((a, b) => a.date.localeCompare(b.date) || a.rowIndex - b.rowIndex);
  return { runs: sorted, changes };
}

/** The first day whose runs can't be judged missed yet: today, or sooner when imports haven't reached it. */
const judgedBefore = ({ today, runOutcomesBefore }: RunReplanInput) =>
  runOutcomesBefore && runOutcomesBefore < today ? runOutcomesBefore : today;

/** Day over (before `before`), and under `longRunMadeShare` of it done (`done` null = outcomes unknown: never missed). */
function missedLongRun(run: PlannedRun, before: IsoDate, done: Map<IsoDate, { meters: number; seconds: number }> | null) {
  if (!done || run.date >= before) return false;
  const day = done.get(run.date);
  if (run.distanceMeters) return (day?.meters ?? 0) < run.distanceMeters * REPLAN.longRunMadeShare;
  if (run.durationSeconds) return (day?.seconds ?? 0) < run.durationSeconds * REPLAN.longRunMadeShare;
  return !day;
}

function moveTarget(
  run: PlannedRun,
  runs: PlannedRun[],
  { today, heavyLegDays, unavailable }: RunReplanInput,
  done: Map<IsoDate, unknown>,
): IsoDate | null {
  const others = runs.filter((r) => runKey(r) !== runKey(run));
  const hardOn = (date: IsoDate) => others.some((r) => r.date === date && HARD_RUNS.includes(r.type));
  for (let i = 1; i <= REPLAN.longRunMoveDays; i++) {
    const day = addDays(run.date, i);
    if (day < today && !done.has(day)) continue; // already over (and not run then)
    if (unavailableOn(unavailable, day)) continue;
    const around = [addDays(day, -1), day, addDays(day, 1)];
    if (around.some((d) => heavyLegDays.has(d) || hardOn(d))) continue;
    return day;
  }
  return null;
}

// ---- Sessions ----

export interface SessionReplanInput {
  history: HistoryWorkout[];
  today: IsoDate;
  unavailable: Unavailability[];
  plannedRuns: PlannedRun[];
}

/**
 * Sessions on unavailable days, or missed (day over, no workout logged that
 * day), move to the first later day in the same block week that is free (no
 * session, not unavailable, still to come or done that day); a session with
 * lower-body work never lands on or next to a long run or race. With no such
 * day an unavailable session is dropped and a missed one stays missed.
 */
export function displaceSessions(
  block: Block,
  sessions: PlannedSession[],
  { history, today, unavailable, plannedRuns }: SessionReplanInput,
): { sessions: PlannedSession[]; changes: PlanChange[] } {
  const worked = new Set(history.map((w) => w.date));
  const taken = new Set(sessions.map((s) => s.date));
  const bigRunDays = new Set(plannedRuns.filter((r) => r.type === "long" || r.type === "race").map((r) => r.date));
  const lower = new Map(block.sessions.map((s) => [s.id, s.exercises.some(isLowerBody)] as const));
  const changes: PlanChange[] = [];
  const out: PlannedSession[] = [];

  for (const session of sessions) {
    const away = unavailableOn(unavailable, session.date);
    const missed = !away && session.date < today && !worked.has(session.date);
    if (!away && !missed) {
      out.push(session);
      continue;
    }
    const naturalWeekEnd = addDays(block.startDate, 7 * session.week - 1);
    const weekEnd = block.endDate && block.endDate < naturalWeekEnd ? block.endDate : naturalWeekEnd;
    let target: IsoDate | null = null;
    for (let day = addDays(session.date, 1); day <= weekEnd && !target; day = addDays(day, 1)) {
      if (taken.has(day) || unavailableOn(unavailable, day)) continue;
      if (day < today && !worked.has(day)) continue;
      if (lower.get(session.blockSessionId) && [addDays(day, -1), day, addDays(day, 1)].some((d) => bigRunDays.has(d))) continue;
      target = day;
    }
    const base = { type: "session" as const, blockId: block.id, blockSessionId: session.blockSessionId, sessionName: session.name };
    if (target) {
      const moved = { ...session, date: target };
      taken.add(target);
      out.push(moved);
      if (target < today) continue;
      changes.push({
        key: `move-session:${session.blockSessionId}:${session.date}:${target}`,
        summary: { code: "sessionMoveSummary", session: session.name, date: target },
        reasons: [
          away
            ? { code: "sessionMoveUnavailable", session: session.name, from: away.startDate, to: away.endDate, date: target }
            : { code: "sessionMoveMissed", session: session.name, was: session.date, date: target },
        ],
        requiresConfirmation: false,
        diff: [{ ...base, before: session, after: moved }],
      });
    } else if (away) {
      if (session.date < today) continue;
      changes.push({
        key: `drop-session:${session.blockSessionId}:${session.date}`,
        summary: { code: "sessionDropSummary", session: session.name },
        reasons: [
          { code: "sessionDropReason", session: session.name, from: away.startDate, to: away.endDate, week: session.week },
        ],
        requiresConfirmation: false,
        diff: [{ ...base, before: session, after: null }],
      });
    } else {
      out.push(session); // missed, nowhere to go: stays missed
    }
  }
  return { sessions: out.sort((a, b) => a.date.localeCompare(b.date)), changes };
}

