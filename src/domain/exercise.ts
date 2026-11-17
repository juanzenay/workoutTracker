/**
 * Exercise vocabulary. Muscles and equipment follow free-exercise-db's fixed
 * lists so catalogue and custom exercises can be filtered together; importers
 * (Hevy, wger) map their own names onto these.
 */

export const EXERCISE_SOURCES = ["free-exercise-db", "wger", "custom", "hevy"] as const;
export type ExerciseSource = (typeof EXERCISE_SOURCES)[number];

export const MUSCLES = [
  "abdominals",
  "abductors",
  "adductors",
  "biceps",
  "calves",
  "chest",
  "forearms",
  "glutes",
  "hamstrings",
  "lats",
  "lower back",
  "middle back",
  "neck",
  "quadriceps",
  "shoulders",
  "traps",
  "triceps",
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "cable",
  "machine",
  "kettlebells",
  "bands",
  "body only",
  "e-z curl bar",
  "medicine ball",
  "exercise ball",
  "foam roll",
  "other",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

/** A "body only" exercise has no external load, so the logger shows no weight for it. */
export const isBodyOnly = (equipment: Equipment | null) => equipment === "body only";

/**
 * Whether an exercise's set rows show the weight input. Body-only exercises show it once weight was
 * added by hand ("+ add weight") or any of their sets already has a weight.
 */
export const showsWeight = (equipment: Equipment | null, addedWeight: boolean, hasWeightedSet: boolean) =>
  !isBodyOnly(equipment) || addedWeight || hasWeightedSet;

/** The weight a set is saved with: with the weight input hidden, sets log reps alone, stored as null like other bodyweight sets. */
export function loggedWeight(weightShown: boolean, weight: number | null): number | null {
  return weightShown ? weight : null;
}

export const CATEGORIES = [
  "strength",
  "powerlifting",
  "olympic weightlifting",
  "strongman",
  "plyometrics",
  "stretching",
  "cardio",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Exercise {
  id: string;
  name: string;
  source: ExerciseSource;
  hevyTemplateId: string | null;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  equipment: Equipment | null;
  category: Category;
  instructions: string[];
  /** Always set: the first catalogue image, or the placeholder for exercises without one. */
  imageUrl: string;
  /** Every image for the exercise (may be empty). */
  imageUrls: string[];
}

/** The fields similar exercises are ranked on. */
export interface SimilarityFields {
  id: string;
  primaryMuscles: readonly Muscle[];
  secondaryMuscles: readonly Muscle[];
  equipment: Equipment | null;
}

const sharesAny = (a: readonly Muscle[], b: readonly Muscle[]) => a.some((m) => b.includes(m));

/** How alike `e` is to `target`: 0 means nothing in common. */
function similarityScore(target: SimilarityFields, e: SimilarityFields): number {
  // Weights 4, 2, 1 are bits: each tier outranks the sum of all the tiers below it.
  return (
    (sharesAny(e.primaryMuscles, target.primaryMuscles) ? 4 : 0) +
    (target.equipment !== null && e.equipment === target.equipment ? 2 : 0) +
    (sharesAny(e.secondaryMuscles, target.secondaryMuscles) ? 1 : 0)
  );
}

/**
 * Orders `catalogue` for swapping out `target`: shared primary muscle first, then matching equipment,
 * then shared secondary muscle, then the rest. Each tier outranks all the ones below it; ties keep
 * catalogue order. `target` itself is left out.
 */
export function rankSimilarExercises<T extends SimilarityFields>(target: SimilarityFields, catalogue: T[]): T[] {
  return catalogue
    .filter((e) => e.id !== target.id)
    .map((e) => ({ e, score: similarityScore(target, e) }))
    .sort((a, b) => b.score - a.score)
    .map(({ e }) => e);
}

/** `rankSimilarExercises`, split into the exercises that share something with `target` and the rest. */
export function splitSimilarExercises<T extends SimilarityFields>(
  target: SimilarityFields,
  catalogue: T[],
): { similar: T[]; rest: T[] } {
  const ranked = rankSimilarExercises(target, catalogue);
  return {
    similar: ranked.filter((e) => similarityScore(target, e) > 0),
    rest: ranked.filter((e) => similarityScore(target, e) === 0),
  };
}
