import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPlanDate, PlannedExerciseList } from "@/components/planned-session";
import { requireCommands } from "@/server/auth/session";
import { CommandError } from "@/server/commands";
import type { StoredBlock } from "@/server/commands/blocks";
import { getRequestStrings } from "@/server/strings";
import type { Strings } from "@/strings";
import { deleteDraftBlock, startBlock } from "../actions";

/** A draft block for review: the coach's notes, its split as designed, and edit / start / discard. */
function DraftReview({ block, s }: { block: StoredBlock; s: Strings }) {
  return (
    <>
      <p className="text-sm text-muted">{s.blocks.draftHint}</p>
      {block.notes && (
        <section aria-labelledby="draft-notes" className="flex flex-col gap-1 rounded-card bg-surface p-3">
          <h2 id="draft-notes" className="font-semibold text-muted">
            {s.blocks.notes}
          </h2>
          <p className="whitespace-pre-line">{block.notes}</p>
        </section>
      )}
      {block.deloadWeeks.length > 0 && (
        <p className="text-sm text-muted">
          {s.blocks.deloadWeeks}: {block.deloadWeeks.map((week) => s.blocks.week(week)).join(", ")}
        </p>
      )}
      <section aria-labelledby="draft-split" className="flex flex-col gap-2">
        <h2 id="draft-split" className="font-semibold text-muted">
          {s.blocks.split}
        </h2>
        {block.sessions.map((session) => (
          <article key={session.id} className="flex flex-col gap-1 rounded-card bg-surface p-3">
            <h3 className="flex flex-wrap justify-between gap-x-2 font-semibold">
              <span>{session.name}</span>
              <span className="font-normal text-muted">{s.weekdays[session.weekday]}</span>
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
              {session.exercises.map((exercise) => (
                <li key={exercise.id} className="flex flex-wrap justify-between gap-x-2">
                  <span>{exercise.name}</span>
                  <span className="text-muted">
                    {s.blocks.exerciseLine(exercise.sets, exercise.repRangeStart, exercise.repRangeEnd)} ·{" "}
                    {s.blocks.rules[exercise.rule]}
                    {exercise.rule === "ramp" && exercise.rampTo != null && ` (${s.blocks.rampLine(exercise.rampTo)})`}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
      <div className="flex flex-wrap gap-2">
        <form action={startBlock.bind(null, block.id)} className="flex-1">
          <SubmitButton className="min-h-touch-lg w-full">
            {s.blocks.startDraft}
          </SubmitButton>
        </form>
        <Link
          href={`/blocks/${block.id}/edit`}
          className="flex min-h-touch-lg items-center rounded-control bg-surface-raised px-4 font-medium"
        >
          {s.blocks.editDraft}
        </Link>
        <form action={deleteDraftBlock.bind(null, block.id)}>
          <SubmitButton confirm variant="ghost" className="min-h-touch-lg text-danger">
            {s.blocks.discardDraft}
          </SubmitButton>
        </form>
      </div>
    </>
  );
}

/** A block's dated planned sessions, week by week. */
export default async function BlockPage({ params }: PageProps<"/blocks/[id]">) {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { id } = await params;
  const result = await commands.getBlock({ id }).catch((error: unknown) => {
    if (error instanceof CommandError && (error.code === "not_found" || error.code === "invalid_input")) return null;
    throw error;
  });
  if (!result) notFound();
  const { block, plannedSessions } = result;
  // A draft plans nothing yet: its design is shown instead of weeks of planned sessions.
  const weeks = block.draft ? [] : Array.from({ length: block.weeks }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{block.name}</h1>
        <p className="text-muted">
          {s.blocks.dates(formatPlanDate(block.startDate), block.weeks)}
          {block.archived && (
            <span className="ml-2 rounded-control bg-surface-raised px-2 text-sm">{s.blocks.archived}</span>
          )}
          {block.draft && <span className="ml-2 rounded-control bg-surface-raised px-2 text-sm">{s.blocks.draft}</span>}
        </p>
      </div>
      {block.draft && <DraftReview block={block} s={s} />}
      {weeks.map((week) => (
        <section key={week} aria-labelledby={`week-${week}`} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 id={`week-${week}`} className="font-semibold text-muted">
              {s.blocks.week(week)}
            </h2>
            {block.deloadWeeks.includes(week) && (
              <span className="rounded-control bg-surface-raised px-2 text-sm text-muted">{s.blocks.deload}</span>
            )}
          </div>
          {plannedSessions
            .filter((session) => session.week === week)
            .map((session) => (
              <article key={session.id} className="flex flex-col gap-2 rounded-card bg-surface p-3">
                <h3 className="flex flex-wrap justify-between gap-x-2 font-semibold">
                  <span>{session.name}</span>
                  <span className="font-normal text-muted">{formatPlanDate(session.date)}</span>
                </h3>
                <PlannedExerciseList exercises={session.exercises} s={s} />
              </article>
            ))}
        </section>
      ))}
    </div>
  );
}
