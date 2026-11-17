import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { PendingLink } from "@/components/ui/pending-link";
import { LocalDateTime } from "@/components/local-date-time";
import { WorkoutExercises } from "@/components/workout-exercises";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";

/** Finished workouts, newest first. */
export default async function HistoryPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { items } = await commands.listWorkouts({ limit: 50 });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold">{s.history.title}</h1>
        <Link href="/workouts/discarded" className="flex min-h-touch items-center text-sm text-accent-text underline">
          {s.archive.link}
        </Link>
      </div>
      {items.length === 0 ? (
        <EmptyState>{s.history.empty}</EmptyState>
      ) : (
        items.map((workout) => {
          const minutes = Math.round(
            (Date.parse(workout.finishedAt!) - Date.parse(workout.startedAt)) / 60_000,
          );
          return (
            <article key={workout.id} className="flex flex-col gap-2 rounded-card bg-surface p-4">
              <header>
                <h2 className="text-lg font-semibold">
                  <PendingLink href={`/workouts/${workout.id}`} className="flex min-h-touch items-center justify-between">
                    {workout.name ?? s.workout.untitled}
                    <span className="text-sm font-normal text-muted">{s.history.viewSummary} →</span>
                  </PendingLink>
                </h2>
                <p className="text-sm text-muted">
                  <LocalDateTime iso={workout.startedAt} /> · {s.history.duration(minutes)}
                </p>
                {workout.notes && <p className="whitespace-pre-line text-sm">{workout.notes}</p>}
              </header>
              <WorkoutExercises exercises={workout.exercises} />
            </article>
          );
        })
      )}
    </div>
  );
}
