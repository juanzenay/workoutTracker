import type { Category, Equipment, Muscle } from "@/domain/exercise";
import type { SetType } from "@/domain/workout";
import type { BodyMeasurementValues } from "@/domain/body-measurement";
import type { HevyBodyMeasurement, HevyExerciseTemplate } from "./client";

/** Hevy stores kg converted from the lb the owner typed (1 lb = 0.45359237 kg exactly). */
const KG_PER_LB = 0.45359237;

/** Hevy kg → lb rounded to the nearest 0.5 lb, so 81.6467… kg (stored for 180 lb) reads 180 again. */
export function kgToLb(kg: number | null): number | null {
  return kg === null ? null : Math.round((kg / KG_PER_LB) * 2) / 2;
}

/** One decimal: finer than any scale or tape, and drops Hevy's float noise. Non-positive → not measured. */
const measured = (n: number | null) => (n === null || !(n > 0) ? undefined : Math.round(n * 10) / 10);

/**
 * A Hevy body measurement as workout tracker values: weights kg → lb, girths stay cm.
 * Null when the entry measures nothing.
 */
export function toBodyMeasurementValues(m: HevyBodyMeasurement): BodyMeasurementValues | null {
  const lb = (kg: number | null) => measured(kg === null ? null : kg / KG_PER_LB);
  const fat = measured(m.fat_percent);
  const values: BodyMeasurementValues = {
    weight: lb(m.weight_kg),
    leanMass: lb(m.lean_mass_kg),
    fatPercent: fat !== undefined && fat < 100 ? fat : undefined,
    neck: measured(m.neck_cm),
    shoulders: measured(m.shoulder_cm),
    chest: measured(m.chest_cm),
    leftBicep: measured(m.left_bicep_cm),
    rightBicep: measured(m.right_bicep_cm),
    leftForearm: measured(m.left_forearm_cm),
    rightForearm: measured(m.right_forearm_cm),
    abdomen: measured(m.abdomen),
    waist: measured(m.waist),
    hips: measured(m.hips),
    leftThigh: measured(m.left_thigh),
    rightThigh: measured(m.right_thigh),
    leftCalf: measured(m.left_calf),
    rightCalf: measured(m.right_calf),
  };
  const present = Object.entries(values).filter(([, v]) => v !== undefined);
  return present.length > 0 ? (Object.fromEntries(present) as BodyMeasurementValues) : null;
}

const SET_TYPES: Record<string, SetType> = { normal: "normal", warmup: "warmup", failure: "failure", dropset: "drop" };

export function toSetType(hevyType: string | null | undefined): SetType {
  return SET_TYPES[hevyType ?? ""] ?? "normal";
}

const MUSCLES: Record<string, Muscle> = {
  abdominals: "abdominals",
  shoulders: "shoulders",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  quadriceps: "quadriceps",
  hamstrings: "hamstrings",
  calves: "calves",
  glutes: "glutes",
  abductors: "abductors",
  adductors: "adductors",
  lats: "lats",
  upper_back: "middle back",
  traps: "traps",
  lower_back: "lower back",
  chest: "chest",
  neck: "neck",
};

/** Hevy muscle groups → workout tracker muscles (cardio / full_body / other have no equivalent and are dropped). */
export function toMuscles(groups: (string | null | undefined)[]): Muscle[] {
  return [...new Set(groups.flatMap((g) => (g && MUSCLES[g] ? [MUSCLES[g]] : [])))];
}

/** Hevy names equipment only in the title: "Bench Press (Barbell)". */
const EQUIPMENT: Record<string, Equipment> = {
  barbell: "barbell",
  dumbbell: "dumbbell",
  cable: "cable",
  machine: "machine",
  "smith machine": "machine",
  band: "bands",
  kettlebell: "kettlebells",
  "ez bar": "e-z curl bar",
  bodyweight: "body only",
  "plate loaded": "machine",
};

export interface ParsedHevyTitle {
  /** Title without the equipment parenthetical. */
  base: string;
  /** Raw parenthetical, lower-cased ("smith machine"), or null. */
  qualifier: string | null;
  equipment: Equipment | null;
}

export function parseHevyTitle(title: string): ParsedHevyTitle {
  const match = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(title);
  if (!match) return { base: title.trim(), qualifier: null, equipment: null };
  const qualifier = match[2]!.trim().toLowerCase();
  return { base: match[1]!.trim(), qualifier, equipment: EQUIPMENT[qualifier] ?? null };
}

/** What workout tracker records for a Hevy exercise that has no catalogue match (source `hevy`). */
export interface HevyExerciseDraft {
  hevyTemplateId: string;
  name: string;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  equipment: Equipment | null;
  category: Category;
}

export function toHevyExerciseDraft(template: HevyExerciseTemplate): HevyExerciseDraft {
  const primaryMuscles = toMuscles([template.primary_muscle_group]);
  return {
    hevyTemplateId: template.id,
    name: template.title.trim().slice(0, 120),
    primaryMuscles,
    secondaryMuscles: toMuscles(template.secondary_muscle_groups ?? []).filter((m) => !primaryMuscles.includes(m)),
    equipment: parseHevyTitle(template.title).equipment,
    category: template.primary_muscle_group === "cardio" ? "cardio" : "strength",
  };
}
