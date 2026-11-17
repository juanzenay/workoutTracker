import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { ExerciseImage } from "@/components/exercise-image";
import { linkButtonClass } from "@/components/ui/button";
import { PendingLink } from "@/components/ui/pending-link";
import { EQUIPMENT, MUSCLES, type Equipment, type Muscle } from "@/domain/exercise";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { CatalogueFilters, CatalogueResults, CatalogueSearch } from "./catalogue-filters";
import { WgerResults } from "./wger-results";

function pick<T extends string>(options: readonly T[], value: unknown): T | undefined {
  return options.find((o) => o === value);
}

export default async function CataloguePage({ searchParams }: PageProps<"/exercises">) {
  const s = await getRequestStrings();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const muscle = pick<Muscle>(MUSCLES, params.muscle);
  const equipment = pick<Equipment>(EQUIPMENT, params.equipment);

  const commands = await requireCommands();
  const { items } = await commands.listExercises({ query, muscle, equipment, limit: 200 });
  // wger is the fallback: offered automatically when nothing matches, or on request.
  const canSearchWger = query.trim().length >= 2;
  const showWger = canSearchWger && (items.length === 0 || params.wger === "1");

  return (
    <CatalogueSearch className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{s.catalogue.title}</h1>
        <Link href="/exercises/new" className={linkButtonClass("secondary", "text-sm")}>
          {s.catalogue.newCustom}
        </Link>
      </div>

      <CatalogueFilters query={query} muscle={muscle ?? ""} equipment={equipment ?? ""} />

      <CatalogueResults>
        <p className="text-sm text-muted">{s.catalogue.count(items.length)}</p>

        {items.length === 0 ? (
          !showWger && <EmptyState>{s.catalogue.empty}</EmptyState>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((exercise) => (
              <li key={exercise.id}>
                <PendingLink href={`/exercises/${exercise.id}`} className="flex items-center gap-3 py-2">
                  <ExerciseImage
                    src={exercise.imageUrl}
                    alt={s.catalogue.imageAlt(exercise.name)}
                    className="w-20 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{exercise.name}</p>
                    <p className="truncate text-sm text-muted">
                      {exercise.primaryMuscles.map((m) => s.muscles[m]).join(", ")}
                      {exercise.equipment && ` · ${s.equipment[exercise.equipment]}`}
                      {exercise.source === "custom" && ` · ${s.catalogue.customBadge}`}
                      {exercise.source === "wger" && ` · ${s.catalogue.wgerBadge}`}
                    </p>
                  </div>
                </PendingLink>
              </li>
            ))}
          </ul>
        )}

        {showWger ? (
          <WgerResults commands={commands} query={query} />
        ) : (
          canSearchWger && (
            <Link
              href={`/exercises?${new URLSearchParams({ q: query, wger: "1" })}`}
              className="flex min-h-touch items-center justify-center text-sm text-muted underline"
            >
              {s.catalogue.wgerSearch}
            </Link>
          )
        )}
      </CatalogueResults>
    </CatalogueSearch>
  );
}
