import type { Muscle } from "./exercise";

/**
 * Finer muscles for the heatmap: delt heads, upper chest and so on. exercises.primary_detail / secondary_detail hold these for the catalogue
 * (scripts/build-muscle-detail.py, rules reviewed in docs/muscle-split-review.md);
 * an exercise without them falls back to its plain muscles, which are all valid
 * here too. `parent` is the plain muscle the body diagram draws it as.
 */
export const MUSCLE_DETAIL = {
  "front delts": { parent: "shoulders" },
  "side delts": { parent: "shoulders" },
  "rear delts": { parent: "shoulders" },
  shoulders: { parent: "shoulders", other: true },
  "upper chest": { parent: "chest" },
  chest: { parent: "chest" },
  lats: { parent: "lats" },
  "middle back": { parent: "middle back" },
  traps: { parent: "traps" },
  "lower back": { parent: "lower back" },
  biceps: { parent: "biceps" },
  triceps: { parent: "triceps" },
  forearms: { parent: "forearms" },
  quadriceps: { parent: "quadriceps" },
  hamstrings: { parent: "hamstrings" },
  glutes: { parent: "glutes" },
  "glute medius": { parent: "glutes" },
  abductors: { parent: "abductors" },
  adductors: { parent: "adductors" },
  abdominals: { parent: "abdominals" },
  obliques: { parent: "abdominals" },
  calves: { parent: "calves" },
  neck: { parent: "neck" },
} as const satisfies Record<string, { parent: Muscle; other?: true }>;

export type MuscleDetail = keyof typeof MUSCLE_DETAIL;

export const MUSCLE_DETAILS = Object.keys(MUSCLE_DETAIL) as MuscleDetail[];

export const detailParent = (m: MuscleDetail): Muscle => MUSCLE_DETAIL[m].parent;

/** The part of a group nothing finer was recorded for (shown only once it has sets). */
export const isOtherDetail = (m: MuscleDetail): boolean => "other" in MUSCLE_DETAIL[m];

export function isMuscleDetail(value: string): value is MuscleDetail {
  return Object.hasOwn(MUSCLE_DETAIL, value);
}
