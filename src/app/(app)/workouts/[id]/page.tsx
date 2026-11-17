import Link from "next/link";
import { notFound } from "next/navigation";
import { ShareCard } from "@/components/share-card";
import { WorkoutSummaryView } from "@/components/workout-summary";
import { CommandError } from "@/server/commands";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { CopyWorkout } from "./copy-workout";

/** One finished workout: summary, copy text, its Strava post and its share card. */
export default async function WorkoutSummaryPage({ params }: PageProps<"/workouts/[id]">) {
  const s = await getRequestStrings();
  const { id } = await params;
  const commands = await requireCommands();
  const summary = await commands.getWorkoutSummary({ workoutId: id }).catch((error: unknown) => {
    if (error instanceof CommandError && (error.code === "not_found" || error.code === "invalid_input")) {
      notFound();
    }
    throw error;
  });
  const workout = await commands.getWorkout({ workoutId: id });
  const names = Object.fromEntries(workout.exercises.map((exercise) => [exercise.exerciseId, exercise.name]));
  const stravaPost = await commands.getWorkoutStravaPost({ workoutId: id });

  return (
    <div className="flex flex-col gap-4">
      <Link href="/workouts" className="flex min-h-touch items-center text-sm text-muted">
        ← {s.summary.back}
      </Link>
      <WorkoutSummaryView summary={summary} />
      <CopyWorkout workout={{ ...workout, finishedAt: workout.finishedAt! }} names={names} />
      {stravaPost?.status === "posted" && (
        <a
          href={`https://www.strava.com/activities/${stravaPost.activityId}`}
          className="flex min-h-touch items-center text-sm text-accent-text underline"
          target="_blank"
          rel="noreferrer"
        >
          {s.summary.onStrava}
        </a>
      )}
      {stravaPost?.status === "pending" && <p className="text-sm text-muted">{s.summary.stravaPending}</p>}
      {stravaPost?.status === "failed" && <p className="text-sm text-muted">{s.summary.stravaFailed}</p>}
      <ShareCard summary={summary} />
    </div>
  );
}
