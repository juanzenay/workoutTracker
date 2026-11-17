import type { Exercise } from "@/domain/exercise";
import type { Commands } from "@/server/commands";
import type { Strings } from "@/strings";
import type { CatalogueEntry } from "./workout-logger";

/** An exercise as the pickers need it: the one shape both the page and a just-created exercise take. */
export function toCatalogueEntry(e: Exercise, s: Strings): CatalogueEntry {
  return {
    id: e.id,
    name: e.name,
    imageUrl: e.imageUrl,
    equipment: e.equipment,
    primaryMuscles: e.primaryMuscles,
    secondaryMuscles: e.secondaryMuscles,
    detail: [e.primaryMuscles.map((m) => s.muscles[m]).join(", "), e.equipment && s.equipment[e.equipment]]
      .filter(Boolean)
      .join(" · "),
  };
}

/** The whole catalogue, trimmed to what exercise pickers need (shipped to the client so picking works offline). */
export async function loadCatalogue(commands: Commands, s: Strings): Promise<CatalogueEntry[]> {
  const { items } = await commands.listExercises({ limit: 2000 });
  return items.map((e) => toCatalogueEntry(e, s));
}
