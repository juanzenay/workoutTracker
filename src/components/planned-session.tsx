import type { IsoDate, PlannedExercise } from "@/domain/block";
import type { Strings } from "@/strings";
import { renderText } from "@/strings/render";

/** "Tue, Oct 13" for a calendar date (no time zone shift: the date is already local). */
export function formatPlanDate(date: IsoDate): string {
  return new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

/** "180 lb × 13, 12, 10" — or one line per load when sets differ in weight. */
function targetText(exercise: PlannedExercise, s: Strings): string {
  const byWeight = new Map<string, number[]>();
  for (const set of exercise.sets) {
    const weight = set.weight === null ? "" : `${set.weight} ${set.unit}`;
    byWeight.set(weight, [...(byWeight.get(weight) ?? []), set.reps]);
  }
  return [...byWeight].map(([weight, reps]) => s.blocks.targets(weight, reps.join(", "))).join(" · ");
}

/** A planned session's exercises with targets and the progression reason behind each. */
export function PlannedExerciseList({ exercises, s }: { exercises: PlannedExercise[]; s: Strings }) {
  return (
    <ul className="flex flex-col gap-2">
      {exercises.map((exercise) => (
        <li key={exercise.blockExerciseId} className="flex flex-col">
          <span className="flex flex-wrap justify-between gap-x-2">
            <span className="font-medium">{exercise.name}</span>
            <span className="font-numeric">{targetText(exercise, s)}</span>
          </span>
          {exercise.progression.reason && (
            <span className="text-sm text-muted">{renderText(s, exercise.progression.reason)}</span>
          )}
          {exercise.adjustments?.map((note, i) => (
            <span key={i} className="text-sm text-muted">
              {renderText(s, note)}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}
