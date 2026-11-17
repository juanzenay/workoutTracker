import { SubmitButton } from "@/components/ui/submit-button";
import { ExerciseImage } from "@/components/exercise-image";
import { LocalDateTime } from "@/components/local-date-time";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { resolveHevyMatch } from "./actions";
import { HevyImportForm } from "./import-form";

/** A full import fetches ~20 pages from Hevy one at a time; give the server action room. */
export const maxDuration = 120;

/** Hevy import: run (and re-run) the import, then review uncertain exercise matches once. */
export default async function HevyImportPage() {
  const commands = await requireCommands();
  const s = await getRequestStrings();
  const status = await commands.getHevyImport({});

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{s.hevyImport.title}</h1>
      <p className="text-muted">{s.hevyImport.intro}</p>

      <HevyImportForm connected={status.connected} />

      <section className="flex flex-col gap-1 text-sm">
        <h2 className="font-semibold">{s.hevyImport.lastRun}</h2>
        {status.lastImportedAt && status.lastResult ? (
          <p>
            <LocalDateTime iso={status.lastImportedAt} /> · {s.hevyImport.result(status.lastResult.workouts)}
          </p>
        ) : (
          <p className="text-muted">{s.hevyImport.never}</p>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">{s.hevyImport.reviewTitle}</h2>
        {status.reviews.length === 0 ? (
          <p className="text-sm text-muted">{s.hevyImport.reviewNone}</p>
        ) : (
          <>
            <p className="text-sm text-muted">{s.hevyImport.reviewIntro}</p>
            {status.reviews.map((review) => (
              <form
                key={review.hevyTemplateId}
                action={resolveHevyMatch}
                className="flex flex-col gap-2 rounded-card border border-border p-3"
              >
                <input type="hidden" name="hevyTemplateId" value={review.hevyTemplateId} />
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 font-medium">{review.hevyTitle}</legend>
                  {review.candidates.map((candidate) => (
                    <label
                      key={candidate.id}
                      className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-border-strong px-2 has-checked:border-accent"
                    >
                      <input type="radio" name="choice" value={candidate.id} required />
                      <ExerciseImage src={candidate.imageUrl} alt="" className="w-14" />
                      <span>
                        {candidate.name}
                        {candidate.equipment && (
                          <span className="text-sm text-muted"> · {s.equipment[candidate.equipment]}</span>
                        )}
                      </span>
                    </label>
                  ))}
                  <label className="flex min-h-touch cursor-pointer items-center gap-3 rounded-control border border-border-strong px-2 has-checked:border-accent">
                    <input type="radio" name="choice" value="keep" required />
                    <span>{s.hevyImport.keepHevy(review.hevyTitle)}</span>
                  </label>
                </fieldset>
                <SubmitButton variant="secondary" className="self-start">
                  {s.hevyImport.confirm}
                </SubmitButton>
              </form>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
