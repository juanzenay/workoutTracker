import Link from "next/link";
import { PendingLink } from "@/components/ui/pending-link";
import { EmptyState } from "@/components/ui/empty-state";
import { LocalDateTime } from "@/components/local-date-time";
import { completedSetCount } from "@/components/workout-exercises";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { RestoreButton } from "./restore-button";

const PAGE = 50;

/** Discarded workouts, most recently discarded first. Each can be opened read-only or restored. The archive is kept forever, so older pages stay reachable. */
export default async function DiscardedArchivePage({ searchParams }: PageProps<"/workouts/discarded">) {
  const s = await getRequestStrings();
  const { offset: rawOffset } = await searchParams;
  const offset = Math.max(0, Math.floor(Number(rawOffset)) || 0);
  const commands = await requireCommands();
  // One extra row tells us whether an older page exists without a count query.
  const fetched = await commands.listDiscardedWorkouts({ limit: PAGE + 1, offset });
  const items = fetched.items.slice(0, PAGE);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/workouts" className="flex min-h-touch items-center text-sm text-muted">
        ← {s.summary.back}
      </Link>
      <h1 className="text-2xl font-semibold">{s.archive.title}</h1>
      {items.length === 0 ? (
        <EmptyState>{s.archive.empty}</EmptyState>
      ) : (
        items.map((workout) => {
          const sets = completedSetCount(workout.exercises);
          return (
            <article key={workout.id} className="flex flex-col gap-2 rounded-card bg-surface p-4">
              <header>
                <h2 className="text-lg font-semibold">
                  <PendingLink
                    href={`/workouts/discarded/${workout.id}`}
                    className="flex min-h-touch items-center justify-between"
                  >
                    {workout.name ?? s.workout.untitled}
                    <span className="text-sm font-normal text-muted">{s.archive.viewDetail} →</span>
                  </PendingLink>
                </h2>
                <p className="text-sm text-muted">
                  <LocalDateTime iso={workout.startedAt} /> · {s.archive.exercises(workout.exercises.length)} ·{" "}
                  {s.history.sets(sets)}
                </p>
              </header>
              <RestoreButton id={workout.id} />
            </article>
          );
        })
      )}
      {fetched.items.length > PAGE && (
        <Link
          href={`/workouts/discarded?offset=${offset + PAGE}`}
          className="flex min-h-touch items-center justify-center rounded-control border border-border-strong text-sm"
        >
          {s.archive.older}
        </Link>
      )}
    </div>
  );
}
