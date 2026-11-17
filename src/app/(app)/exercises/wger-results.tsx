import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { ExerciseImage } from "@/components/exercise-image";
import { CommandError, type Commands, type CommandOutput } from "@/server/commands";
import { getRequestStrings } from "@/server/strings";
import { addWgerExercise } from "./actions";

type Results = CommandOutput<"searchWger">["items"] | "unavailable";

async function search(commands: Commands, query: string): Promise<Results> {
  try {
    return (await commands.searchWger({ query })).items;
  } catch (error) {
    if (error instanceof CommandError && error.code === "unavailable") return "unavailable";
    throw error;
  }
}

/** Fallback results from wger, offered when the catalogue has no match. */
export async function WgerResults({ commands, query }: { commands: Commands; query: string }) {
  const s = await getRequestStrings();
  const results = await search(commands, query);

  return (
    <section className="flex flex-col gap-2" aria-labelledby="wger-title">
      <h2 id="wger-title" className="font-semibold">
        {s.catalogue.wgerTitle}
      </h2>
      <p className="text-sm text-muted">{s.catalogue.wgerIntro}</p>
      {results === "unavailable" ? (
        <p className="py-4 text-center text-muted">{s.catalogue.wgerUnavailable}</p>
      ) : results.length === 0 ? (
        <p className="py-4 text-center text-muted">{s.catalogue.wgerEmpty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {results.map((result) => (
            <li key={result.wgerId} className="flex items-center gap-3 py-2">
              <ExerciseImage
                src={result.imageUrl}
                alt={s.catalogue.imageAlt(result.name)}
                className="w-20 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{result.name}</p>
                <p className="truncate text-sm text-muted">
                  {result.primaryMuscles.map((m) => s.muscles[m]).join(", ")}
                  {result.equipment && ` · ${s.equipment[result.equipment]}`}
                </p>
              </div>
              {result.exerciseId ? (
                <Link
                  href={`/exercises/${result.exerciseId}`}
                  className="flex min-h-touch items-center px-2 text-sm text-muted"
                >
                  {s.catalogue.wgerAdded}
                </Link>
              ) : (
                <form action={addWgerExercise}>
                  <input type="hidden" name="wgerId" value={result.wgerId} />
                  <SubmitButton variant="secondary">
                    {s.catalogue.wgerAdd}
                  </SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted">
        {s.catalogue.wgerCredit}{" "}
        <Link href="/credits" className="underline">
          {s.catalogue.seeCredits}
        </Link>
      </p>
    </section>
  );
}
