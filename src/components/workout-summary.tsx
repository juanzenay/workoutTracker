"use client";

import type { WorkoutSummary } from "@/domain/records";
import { useStrings } from "@/strings/provider";

/** Text summary of a finished workout (stats, exercises, PRs). Shared by the logger's finish screen and /workouts/[id]. */
export function WorkoutSummaryView({ summary }: { summary: WorkoutSummary }) {
  const s = useStrings();
  const stats: [string, string][] = [
    [s.summary.duration, s.history.duration(summary.durationMinutes)],
    [s.summary.sets, String(summary.totalSets)],
    [s.summary.volume, summary.volume ? `${summary.volume.value} ${summary.volume.unit}` : "–"],
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{summary.name ?? s.workout.untitled}</h1>
      <dl className="grid grid-cols-3 gap-2">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-card border border-border bg-surface p-3">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-numeric font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="summary-prs">
        <h2 id="summary-prs" className="mb-2 font-semibold">
          {s.summary.prs(summary.prs.length)}
        </h2>
        {summary.prs.length === 0 ? (
          <p className="text-sm text-muted">{s.summary.noPrs}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {summary.prs.map((pr) => (
              <li key={`${pr.exerciseId}:${pr.kind}`}>
                <span className="mr-2 rounded-control bg-accent px-1.5 py-0.5 text-xs font-bold text-accent-fg">
                  {s.records.prBadge}
                </span>
                <span className="font-medium">{pr.name}</span>
                <span className="text-muted">
                  {" "}
                  · {s.records.kinds[pr.kind]} {s.records.value(pr.kind, pr.set.value, pr.set.unit)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="summary-exercises">
        <h2 id="summary-exercises" className="mb-2 font-semibold">
          {s.summary.exercises}
        </h2>
        <ul className="flex flex-col gap-1 text-sm">
          {summary.exercises.map((exercise) => (
            <li key={exercise.exerciseId}>
              <span className="font-medium">{exercise.name}</span>
              <span className="text-muted">
                {" "}
                · {s.history.sets(exercise.sets)}
                {exercise.bestSet &&
                  ` · ${s.records.set(exercise.bestSet.weight, exercise.bestSet.unit, exercise.bestSet.reps)}`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
