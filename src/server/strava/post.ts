import type { WeightAmount, WorkoutSummary } from "@/domain/records";
import type { Strings } from "@/strings";

/**
 * The Strava activity's name and description for a finished workout:
 * exercises with their working sets and volume, the totals, and the PRs.
 */
export function stravaActivityText(summary: WorkoutSummary, s: Strings): { name: string; description: string } {
  const t = s.stravaPost;
  const weight = (w: WeightAmount) => `${t.number(w.value)} ${w.unit}`;
  const exercises = summary.exercises.map((e) =>
    t.exercise(e.name, s.history.sets(e.sets), e.volume ? weight(e.volume) : null),
  );
  const totals = t.totals(
    [s.history.sets(summary.totalSets), summary.volume && weight(summary.volume), s.history.duration(summary.durationMinutes)].filter(
      (part): part is string => Boolean(part),
    ),
  );
  const prsByExercise = new Map<string, { name: string; records: string[] }>();
  for (const pr of summary.prs) {
    const entry = prsByExercise.get(pr.exerciseId) ?? { name: pr.name, records: [] };
    prsByExercise.set(pr.exerciseId, entry);
    const value = pr.kind === "mostReps" ? t.reps(t.number(pr.set.value)) : weight({ value: pr.set.value, unit: pr.set.unit });
    entry.records.push(t.record(s.records.kinds[pr.kind], value));
  }
  const prs = [...prsByExercise.values()].map((p) => t.pr(p.name, p.records));
  const lines = [...exercises, "", totals, ...(prs.length > 0 ? [t.prs(prs)] : []), "", t.footer];
  return { name: summary.name ?? t.defaultName, description: lines.join("\n") };
}
