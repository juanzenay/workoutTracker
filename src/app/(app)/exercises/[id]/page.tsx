import Link from "next/link";
import { notFound } from "next/navigation";
import { ExerciseImage } from "@/components/exercise-image";
import { LineChart, type ChartPoint } from "@/components/line-chart";
import { LocalDateTime } from "@/components/local-date-time";
import { convertWeight, RECORD_KINDS, type ExerciseSession } from "@/domain/records";
import { CommandError, type CommandOutput } from "@/server/commands";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";

/** Charts (estimated 1RM, best set, volume), records and past sessions for one exercise. */
async function ExerciseHistorySection({ history }: { history: CommandOutput<"getExerciseHistory"> }) {
  const s = await getRequestStrings();
  const { unit, sessions, bests } = history;
  const series = (pick: (session: ExerciseSession) => number | null): ChartPoint[] =>
    sessions.flatMap((session) => {
      const value = pick(session);
      return value === null ? [] : [{ date: session.date, value }];
    });
  const weight = (v: number) => `${Math.round(v * 10) / 10} ${unit}`;
  const charts = [
    [s.exerciseHistory.estimated1rm, series((x) => x.estimated1rm)],
    [
      s.exerciseHistory.bestSet,
      series((x) => (x.bestSet?.weight ? convertWeight(x.bestSet.weight, x.bestSet.unit, unit) : null)),
    ],
    [s.exerciseHistory.volume, series((x) => x.volume)],
  ] as const;

  return (
    <section aria-labelledby="exercise-history" className="flex flex-col gap-3">
      <h2 id="exercise-history" className="font-semibold">
        {s.exerciseHistory.title}
      </h2>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted">{s.exerciseHistory.empty}</p>
      ) : (
        <>
          {charts.map(([label, points]) =>
            points.length > 0 ? (
              <LineChart key={label} label={label} points={points} format={weight} />
            ) : null,
          )}
          {Object.keys(bests).length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {RECORD_KINDS.map((kind) => {
                const record = bests[kind];
                if (!record) return null;
                return (
                  <div key={kind} className="contents">
                    <dt className="text-muted">{s.records.kinds[kind]}</dt>
                    <dd className="font-numeric">
                      {s.records.value(kind, record.value, record.unit)}
                      <span className="text-muted"> · {s.records.set(record.weight, record.unit, record.reps)}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          <h3 className="text-sm font-semibold">{s.exerciseHistory.sessions}</h3>
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border text-sm">
            {sessions.toReversed().map((session) => (
              <li key={session.workoutId}>
                <Link
                  href={`/workouts/${session.workoutId}`}
                  className="flex min-h-touch flex-col justify-center px-3 py-2"
                >
                  <LocalDateTime iso={session.date} />
                  <span className="font-numeric text-muted">
                    {session.sets
                      .map((set) => {
                        const line = s.history.setLine(
                          set.weight === null ? s.history.bodyweight : `${set.weight} ${set.unit}`,
                          set.reps === null ? "–" : String(set.reps),
                        );
                        return set.setType === "normal" ? line : `${line} (${s.setTypeBadges[set.setType]})`;
                      })
                      .join(", ")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export default async function ExercisePage({ params }: PageProps<"/exercises/[id]">) {
  const s = await getRequestStrings();
  const { id } = await params;
  const commands = await requireCommands();

  const exercise = await commands.getExercise({ id }).catch((error: unknown) => {
    if (error instanceof CommandError && (error.code === "not_found" || error.code === "invalid_input")) {
      notFound();
    }
    throw error;
  });

  const history = await commands.getExerciseHistory({ exerciseId: id });
  const images = exercise.imageUrls.length > 0 ? exercise.imageUrls : [exercise.imageUrl];

  return (
    <article className="flex flex-col gap-4">
      <Link href="/exercises" className="flex min-h-touch items-center text-sm text-muted">
        ← {s.catalogue.back}
      </Link>
      <h1 className="text-2xl font-semibold">{exercise.name}</h1>
      <div className="grid grid-cols-2 gap-2">
        {images.map((src) => (
          <ExerciseImage key={src} src={src} alt={s.catalogue.imageAlt(exercise.name)} className="w-full" />
        ))}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">{s.catalogue.primaryMuscles}</dt>
        <dd>{exercise.primaryMuscles.map((m) => s.muscles[m]).join(", ")}</dd>
        {exercise.secondaryMuscles.length > 0 && (
          <>
            <dt className="text-muted">{s.catalogue.secondaryMuscles}</dt>
            <dd>{exercise.secondaryMuscles.map((m) => s.muscles[m]).join(", ")}</dd>
          </>
        )}
        <dt className="text-muted">{s.catalogue.equipment}</dt>
        <dd>{exercise.equipment ? s.equipment[exercise.equipment] : s.catalogue.noEquipment}</dd>
      </dl>
      <ExerciseHistorySection history={history} />
      {exercise.instructions.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{s.catalogue.instructions}</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {exercise.instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>
      )}
      {exercise.source === "wger" && (
        <p className="text-xs text-muted">
          {s.catalogue.wgerCredit}{" "}
          <Link href="/credits" className="underline">
            {s.catalogue.seeCredits}
          </Link>
        </p>
      )}
    </article>
  );
}
