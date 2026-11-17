import type { Strings } from "@/strings";
import type { Workout, WorkoutSet } from "./workout";

/**
 * A finished workout as paste-ready plain text: the title, the date and
 * duration, then each exercise with its completed sets in the order they were
 * performed. No markup, so it reads the same in any app's description field.
 */
export function workoutPlainText(
  workout: Workout & { finishedAt: string },
  names: ReadonlyMap<string, string>,
  s: Strings,
  timeZone: string,
): string {
  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone }).format(new Date(workout.startedAt));
  const minutes = durationMinutes(workout);
  const blocks = workout.exercises
    .toSorted((a, b) => a.position - b.position)
    .map((exercise) => [
      names.get(exercise.exerciseId) ?? "",
      ...exercise.sets
        .filter((set) => set.completed)
        .toSorted((a, b) => a.position - b.position)
        .map((set) => setLine(set, s)),
    ]);
  return [
    workout.name?.trim() || s.workout.untitled,
    s.workoutText.dateLine(date, s.history.duration(minutes)),
    ...blocks.flatMap((block) => ["", ...block]),
  ].join("\n");
}

/**
 * The values of a finished workout's Strava manual activity form, one per field, so each can be
 * copied on its own: the title, the start date as M/D/YYYY, and the elapsed time as h:mm:ss.
 */
export function workoutFields(
  workout: Workout & { finishedAt: string },
  s: Strings,
  timeZone: string,
): { title: string; date: string; duration: string } {
  const minutes = durationMinutes(workout);
  const hours = Math.floor(minutes / 60);
  return {
    title: workout.name?.trim() || s.workout.untitled,
    date: new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric", timeZone }).format(
      new Date(workout.startedAt),
    ),
    duration: `${hours}:${String(minutes % 60).padStart(2, "0")}:00`,
  };
}

function durationMinutes(workout: Workout & { finishedAt: string }): number {
  return Math.max(0, Math.round((Date.parse(workout.finishedAt) - Date.parse(workout.startedAt)) / 60_000));
}

function setLine(set: WorkoutSet, s: Strings): string {
  const weight = set.weight === null ? s.history.bodyweight : `${set.weight.toLocaleString("en-US", { maximumFractionDigits: 1 })} ${set.unit}`;
  return s.history.setLine(weight, set.reps === null ? s.workoutText.noReps : String(set.reps));
}
