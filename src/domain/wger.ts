import type { Equipment, Muscle } from "./exercise";

/**
 * wger's fixed vocabularies (stable ids across wger instances) mapped onto
 * workout tracker's. Used to import wger exercises and, via `muscle`, to place workout tracker
 * muscles on wger's muscle-map diagrams.
 */

/** wger muscle id → workout tracker muscle (null where workout tracker has no equivalent) and which body side its diagram is on. */
export const WGER_MUSCLES: Record<number, { name: string; muscle: Muscle | null; isFront: boolean }> = {
  1: { name: "Biceps brachii", muscle: "biceps", isFront: true },
  2: { name: "Anterior deltoid", muscle: "shoulders", isFront: true },
  3: { name: "Serratus anterior", muscle: null, isFront: true },
  4: { name: "Pectoralis major", muscle: "chest", isFront: true },
  5: { name: "Triceps brachii", muscle: "triceps", isFront: false },
  6: { name: "Rectus abdominis", muscle: "abdominals", isFront: true },
  7: { name: "Gastrocnemius", muscle: "calves", isFront: false },
  8: { name: "Gluteus maximus", muscle: "glutes", isFront: false },
  9: { name: "Trapezius", muscle: "traps", isFront: false },
  10: { name: "Quadriceps femoris", muscle: "quadriceps", isFront: true },
  11: { name: "Biceps femoris", muscle: "hamstrings", isFront: false },
  12: { name: "Latissimus dorsi", muscle: "lats", isFront: false },
  13: { name: "Brachialis", muscle: "biceps", isFront: true },
  14: { name: "Obliquus externus abdominis", muscle: "abdominals", isFront: true },
  15: { name: "Soleus", muscle: "calves", isFront: false },
  16: { name: "Erector spinae", muscle: "lower back", isFront: false },
};

/**
 * wger equipment id → workout tracker equipment. Accessories (bench, mat) only decide
 * the equipment when nothing else is listed: a hip thrust is a barbell lift.
 */
export const WGER_EQUIPMENT: Record<number, { equipment: Equipment; accessory: boolean }> = {
  1: { equipment: "barbell", accessory: false },
  2: { equipment: "e-z curl bar", accessory: false },
  3: { equipment: "dumbbell", accessory: false },
  4: { equipment: "body only", accessory: true },
  5: { equipment: "exercise ball", accessory: false },
  6: { equipment: "body only", accessory: false },
  7: { equipment: "body only", accessory: false },
  8: { equipment: "other", accessory: true },
  9: { equipment: "other", accessory: true },
  10: { equipment: "kettlebells", accessory: false },
  11: { equipment: "bands", accessory: false },
  12: { equipment: "cable", accessory: false },
};

export const WGER_CARDIO_CATEGORY_ID = 15;
export const WGER_ENGLISH_LANGUAGE_ID = 2;

/** Attribution kept for every exercise imported from wger (CC-BY-SA and friends require it). */
export interface WgerAttribution {
  /** e.g. "CC-BY-SA 4" */
  licenseShortName: string;
  licenseName: string;
  licenseUrl: string;
  authors: string[];
  /** The exercise's page on wger. */
  sourceUrl: string;
}
