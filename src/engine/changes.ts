import type { HistoryWorkout, IsoDate, PlannedExercise, PlannedSession } from "@/domain/block";
import { sameJson } from "@/domain/json";
import type { PlanChange } from "@/domain/plan-change";

/**
 * Changes between the persisted plan (`current`) and the engine's new plan
 * (`fresh`) worth telling the owner about. Only sessions dated today or later
 * that exist in both count; everything else (new/removed sessions, past
 * sessions, rep targets moving while the load holds) updates silently.
 *
 * Today's rules: a progression load increase, or an RIR-rule reduction after
 * repeated grinders. Deload sessions (planned up front) and holds never count.
 * All upcoming sessions the
 * same workout moved form one change, keyed by block exercise + that workout's
 * date + the new load, so the key survives the passing days.
 */
export function detectChanges(
  current: PlannedSession[],
  fresh: PlannedSession[],
  history: HistoryWorkout[],
  today: IsoDate,
): PlanChange[] {
  const currentBySlot = new Map(current.map((s) => [slot(s), s]));
  const changes = new Map<string, PlanChange>();

  for (const session of fresh) {
    if (session.date < today) continue;
    const was = currentBySlot.get(slot(session));
    if (!was) continue;
    for (const after of session.exercises) {
      const { decision } = after.progression;
      if (decision !== "increase" && decision !== "reduce") continue;
      const before = was.exercises.find((e) => e.blockExerciseId === after.blockExerciseId);
      if (!before || loadOf(before) === loadOf(after)) continue;
      // Same decision as before: the load moved for another reason (an interaction rule), not progression.
      if (sameJson(before.progression.reason, after.progression.reason)) continue;

      const basis = lastDone(history, after.exerciseId, session.date);
      const key = `progression:${after.blockExerciseId}:${basis ?? "-"}:${loadOf(after)}`;
      const change = changes.get(key) ?? {
        key,
        summary: {
          code: "progressionChange",
          exercise: after.name,
          decision,
          weight: loadOf(after),
          unit: after.sets[0]?.unit ?? null,
        },
        reasons: [after.progression.reason],
        requiresConfirmation: false,
        diff: [],
      };
      change.diff.push({
        type: "exercise",
        blockId: session.blockId,
        blockSessionId: session.blockSessionId,
        date: session.date,
        sessionName: session.name,
        blockExerciseId: after.blockExerciseId,
        before,
        after,
      });
      changes.set(key, change);
    }
  }
  return [...changes.values()];
}

const slot = (s: Pick<PlannedSession, "blockSessionId" | "date">) => `${s.blockSessionId}|${s.date}`;

const loadOf = (e: PlannedExercise) => e.sets[0]?.weight ?? null;

/** Date of the latest workout before `date` with working sets of the exercise (what the progression decision read). */
function lastDone(history: HistoryWorkout[], exerciseId: string, date: IsoDate): IsoDate | null {
  let latest: IsoDate | null = null;
  for (const w of history) {
    if (w.date >= date || (latest !== null && w.date <= latest)) continue;
    const working = w.exercises
      .filter((e) => e.exerciseId === exerciseId)
      .flatMap((e) => e.sets)
      .some((s) => s.completed && s.setType !== "warmup" && s.setType !== "drop" && (s.reps ?? 0) > 0);
    if (working) latest = w.date;
  }
  return latest;
}
