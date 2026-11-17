import type { Block, IsoDate, PlannedExercise, PlannedSession } from "@/domain/block";
import { injuryActiveOn, loadsJoint, type Grade, type Injury } from "@/domain/injury";
import type { PlanChange } from "@/domain/plan-change";
import { blockExercises, diffSessions, noted } from "./interactions";

/**
 * Lifting around injuries. An exercise whose primary muscles load an injured
 * joint (`JOINT_MUSCLES`) is cut back for as long as the injury is open, by
 * grade; sessions before today are left alone. Where several injuries hit one
 * exercise, the worst grade decides (the first logged on a tie).
 *
 * The plan can only change an exercise's targets, not remove it, so even the
 * worst grade keeps one light set, with a note to skip it.
 */

/** The tunable knobs of the injury rules, by grade. */
export const INJURY = {
  /** Share of the load kept. */
  loadShare: { 1: 0.8, 2: 0.5, 3: 0.5 } as Record<Grade, number>,
  /** Share of the sets kept (rounded, at least 1: grade 3 keeps one). */
  setShare: { 1: 1, 2: 2 / 3, 3: 0 } as Record<Grade, number>,
};

const worst = (injuries: Injury[]) => injuries.reduce((a, b) => (b.grade > a.grade ? b : a));

/** One change per injury: its exercises in sessions still to come, cut back to the grade. */
export function adjustForInjuries(
  block: Block,
  sessions: PlannedSession[],
  injuries: Injury[],
  today: IsoDate,
): { sessions: PlannedSession[]; changes: PlanChange[] } {
  if (injuries.length === 0) return { sessions, changes: [] };
  const exercises = blockExercises(block);
  const diffs = new Map<string, { injury: Injury; diff: PlanChange["diff"] }>();
  const adjusted = sessions.map((session) => {
    if (session.date < today) return session;
    const open = injuries.filter((i) => injuryActiveOn(i, session.date));
    if (open.length === 0) return session;
    const after = {
      ...session,
      exercises: session.exercises.map((e) => {
        const exercise = exercises.get(e.blockExerciseId);
        const hits = open.filter((i) => loadsJoint(i.joint, exercise?.muscles));
        return hits.length === 0 || !exercise ? e : cutBack(e, exercise.increment, worst(hits));
      }),
    };
    for (const diff of diffSessions([session], [after])) {
      const hit = worst(open.filter((i) => loadsJoint(i.joint, exercises.get(diff.blockExerciseId)?.muscles)));
      const key = `injury:${hit.id}:${hit.grade}`;
      const entry = diffs.get(key) ?? { injury: hit, diff: [] };
      entry.diff.push(diff);
      diffs.set(key, entry);
    }
    return after;
  });
  const changes = [...diffs].map(([key, { injury, diff }]): PlanChange => ({
    key,
    summary: { code: "injurySummary", joint: injury.joint, side: injury.side, grade: injury.grade },
    reasons: [{ code: "injuryReason", joint: injury.joint, side: injury.side, tissue: injury.tissue, grade: injury.grade }],
    requiresConfirmation: false,
    diff,
  }));
  return { sessions: adjusted, changes };
}

function cutBack(exercise: PlannedExercise, increment: number, injury: Injury): PlannedExercise {
  const { grade } = injury;
  const keep = Math.max(1, Math.round(exercise.sets.length * INJURY.setShare[grade]));
  const share = INJURY.loadShare[grade];
  const sets = exercise.sets.slice(0, keep).map((set) =>
    set.weight === null
      ? set
      : { ...set, weight: Math.min(set.weight, Math.max(increment, Math.floor((set.weight * share) / increment) * increment)) },
  );
  return noted(
    { ...exercise, sets },
    { code: "injuryAdjustment", joint: injury.joint, side: injury.side, grade, share: Math.round(share * 100), skip: grade === 3 },
  );
}
