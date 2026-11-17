import type { IsoDate, PlannedSession } from "@/domain/block";
import type { PlanMoves, SessionMove } from "@/domain/plan-move";
import type { PlannedRun } from "@/domain/running";

/**
 * The owner's hand-made moves (./../domain/plan-move.ts) applied to what the engine planned: a session or run
 * on its `from` day goes to `to`. Applied before the re-planning rules, so those see the days as they now are
 * (a moved run still makes way for, or is moved off, an unavailable day like any other).
 */

export function moveSessions(sessions: PlannedSession[], moves: SessionMove[]): PlannedSession[] {
  if (moves.length === 0) return sessions;
  const to = new Map(moves.map((m) => [`${m.blockSessionId}|${m.from}`, m.to] as const));
  return sessions
    .map((s) => {
      const date = to.get(`${s.blockSessionId}|${s.date}`);
      return date ? { ...s, date } : s;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function moveRuns(runs: PlannedRun[], moves: PlanMoves["runs"]): PlannedRun[] {
  if (moves.length === 0) return runs;
  const to = new Map(moves.map((m) => [`${m.runPlanId}:${m.rowIndex}|${m.from}`, m.to] as const));
  return runs.map((r) => {
    const date = to.get(`${r.runPlanId}:${r.rowIndex}|${r.date}`);
    return date ? { ...r, date } : r;
  });
}

/** Where `blockSessionId`'s session planned on `date` ends up (its own day when not moved). */
export function movedDate(moves: SessionMove[], blockSessionId: string, date: IsoDate): IsoDate {
  return moves.find((m) => m.blockSessionId === blockSessionId && m.from === date)?.to ?? date;
}
