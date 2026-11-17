import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { WorkoutExercises } from "@/components/workout-exercises";
import { CommandError } from "@/server/commands";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { RestoreButton } from "../restore-button";

/** One discarded workout, read-only, with Restore. Anything in history (or unknown) is a 404 here. */
export default async function DiscardedWorkoutPage({ params }: PageProps<"/workouts/discarded/[id]">) {
  const s = await getRequestStrings();
  const { id } = await params;
  const commands = await requireCommands();
  const workout = await commands.getDiscardedWorkout({ id }).catch((error: unknown) => {
    if (error instanceof CommandError && (error.code === "not_found" || error.code === "invalid_input")) {
      notFound();
    }
    throw error;
  });

  return (
    <div className="flex flex-col gap-4">
      <Link href="/workouts/discarded" className="flex min-h-touch items-center text-sm text-muted">
        ← {s.archive.back}
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{workout.name ?? s.workout.untitled}</h1>
        <p className="text-sm text-muted">
          <LocalDateTime iso={workout.startedAt} />
        </p>
        {workout.notes && <p className="whitespace-pre-line text-sm">{workout.notes}</p>}
      </header>
      <p className="text-sm text-muted">{s.archive.readOnly}</p>
      <WorkoutExercises exercises={workout.exercises} />
      <RestoreButton id={workout.id} />
    </div>
  );
}
