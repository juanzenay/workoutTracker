import type { Equipment } from "@/domain/exercise";
import { parseHevyTitle } from "./map";

/**
 * Matches a Hevy exercise title to the catalogue by name and equipment.
 *
 * Hevy titles look like "Bench Press (Barbell)"; free-exercise-db names put
 * equipment and variations in the name ("Barbell Bench Press - Medium Grip").
 * Names are compared as word sets with equipment and default-variant words
 * ("medium grip") removed and plurals
 * folded ("Leg Extensions" = "Leg Extension"; "Pullups" = "Pull Up").
 *
 * - certain: exactly one catalogue exercise has the same words and compatible equipment
 * - uncertain: no single exact match, but some catalogue names share most words
 *   (or contain every Hevy word) with compatible equipment → owner reviews
 * - none: nothing close
 */

export interface CatalogueEntry {
  id: string;
  name: string;
  equipment: Equipment | null;
}

export type MatchResult =
  | { kind: "certain"; exerciseId: string }
  | { kind: "uncertain"; candidateIds: string[] }
  | { kind: "none" };

/** Words that don't tell exercises apart: equipment (compared separately) and default variants ("Medium Grip"). */
const IGNORED_WORDS = new Set([
  "barbell",
  "dumbbell",
  "db",
  "cable",
  "machine",
  "band",
  "kettlebell",
  "leverage",
  "medium",
  "grip",
]);
const MAX_CANDIDATES = 5;
const MIN_SIMILARITY = 0.5;

function words(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => !IGNORED_WORDS.has(w));
}

interface Key {
  set: Set<string>;
  /** Words run together, so "pull up" and "pullup" compare equal. */
  compact: string;
}

function keyOf(name: string): Key {
  const ws = words(name);
  return { set: new Set(ws), compact: ws.join("") };
}

function sameWords(a: Key, b: Key): boolean {
  return a.compact === b.compact || (a.set.size === b.set.size && [...a.set].every((w) => b.set.has(w)));
}

function similarity(hevy: Key, entry: Key): number {
  const shared = [...hevy.set].filter((w) => entry.set.has(w)).length;
  if (shared === hevy.set.size && shared > 0) return Math.max(0.5, shared / entry.set.size); // entry adds a variation
  return shared / new Set([...hevy.set, ...entry.set]).size;
}

export function createCatalogueMatcher(catalogue: CatalogueEntry[]) {
  const entries = catalogue.map((entry) => ({ entry, key: keyOf(entry.name) }));

  return function match(hevyTitle: string): MatchResult {
    const { base, qualifier, equipment } = parseHevyTitle(hevyTitle);
    // A qualifier that isn't plain equipment ("Smith Machine", "Weighted") is part of the name.
    const hevyKey = keyOf(equipment && qualifier !== "smith machine" ? base : `${base} ${qualifier ?? ""}`);
    if (hevyKey.set.size === 0) return { kind: "none" };
    const compatible = entries.filter(
      ({ entry }) => equipment === null || entry.equipment === null || entry.equipment === equipment,
    );

    const exact = compatible.filter(({ key }) => sameWords(hevyKey, key));
    if (exact.length === 1) return { kind: "certain", exerciseId: exact[0]!.entry.id };

    const candidates = compatible
      .map(({ entry, key }) => ({ entry, score: sameWords(hevyKey, key) ? 1 : similarity(hevyKey, key) }))
      .filter((c) => c.score >= MIN_SIMILARITY)
      .sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length || a.entry.name.localeCompare(b.entry.name))
      .slice(0, MAX_CANDIDATES);
    return candidates.length > 0 ? { kind: "uncertain", candidateIds: candidates.map((c) => c.entry.id) } : { kind: "none" };
  };
}
