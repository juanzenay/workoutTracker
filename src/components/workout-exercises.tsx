import { getRequestStrings } from "@/server/strings";
import type { LoggedWorkout } from "@/server/commands/workouts";

/** How many sets in these exercises were completed. */
export function completedSetCount(exercises: LoggedWorkout["exercises"]) {
  return exercises.reduce((n, e) => n + e.sets.filter((set) => set.completed).length, 0);
}

/** A workout's exercises and their completed sets, read-only: shared by History and the discarded archive. */
export async function WorkoutExercises({ exercises }: { exercises: LoggedWorkout["exercises"] }) {
  const s = await getRequestStrings();
  return (
    <ul className="flex flex-col gap-1">
      {exercises.map((exercise) => {
        const sets = exercise.sets.filter((set) => set.completed);
        return (
          <li key={exercise.id} className="text-sm">
            <span className="font-medium">{exercise.name}</span>
            <span className="text-muted"> · {s.history.sets(sets.length)}</span>
            {sets.length > 0 && (
              <span className="block font-numeric text-muted">
                {sets
                  .map((set) => {
                    const weight = set.weight === null ? s.history.bodyweight : `${set.weight} ${set.unit}`;
                    const reps = set.reps === null ? "–" : String(set.reps);
                    const line =
                      s.history.setLine(weight, reps) +
                      (set.rir === null ? "" : ` @ ${s.loggerExtras.rir} ${s.loggerExtras.rirValue(set.rir)}`);
                    return set.setType === "normal" ? line : `${line} (${s.setTypeBadges[set.setType]})`;
                  })
                  .join(", ")}
              </span>
            )}
            {exercise.notes && <span className="block whitespace-pre-line text-muted">{exercise.notes}</span>}
          </li>
        );
      })}
    </ul>
  );
}
