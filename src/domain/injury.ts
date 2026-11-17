import type { IsoDate } from "./block";
import type { Muscle } from "./exercise";

/**
 * Injuries the owner logs. The engine re-plans lifting around the active ones
 * (src/engine/injuries.ts): exercises that load the injured joint are cut back
 * by grade.
 *
 * Exercises are tagged by muscle, not by joint, so each joint lists the muscles
 * whose exercises load it. That is a deliberately wide net: a ligament injury
 * hurts under load through the joint, not in one muscle.
 */

export const JOINTS = ["neck", "shoulder", "elbow", "wrist", "lower back", "hip", "knee", "ankle"] as const;
export type Joint = (typeof JOINTS)[number];

export const SIDES = ["left", "right", "both"] as const;
export type Side = (typeof SIDES)[number];

export const TISSUES = ["ligament", "tendon", "muscle", "joint", "bone", "other"] as const;
export type Tissue = (typeof TISSUES)[number];

/** Sprain-style severity: 1 mild (ligament stretched), 2 partial tear, 3 complete tear or rupture. */
export const GRADES = [1, 2, 3] as const;
export type Grade = (typeof GRADES)[number];

/** Muscles whose exercises load each joint. */
export const JOINT_MUSCLES: Record<Joint, readonly Muscle[]> = {
  neck: ["neck", "traps"],
  shoulder: ["shoulders", "chest", "lats", "triceps", "traps"],
  elbow: ["biceps", "triceps", "forearms"],
  wrist: ["forearms"],
  "lower back": ["lower back", "middle back", "glutes", "hamstrings"],
  hip: ["glutes", "hamstrings", "quadriceps", "adductors", "abductors"],
  knee: ["quadriceps", "hamstrings", "calves", "adductors"],
  ankle: ["calves"],
};

/** An injury as the engine reads it. */
export interface Injury {
  id: string;
  joint: Joint;
  side: Side;
  tissue: Tissue;
  grade: Grade;
  startDate: IsoDate;
  /** The day training is back to normal (exclusive: the injury no longer applies from then); null = still injured. */
  clearedDate: IsoDate | null;
}

/** Whether `injury` is on in the plan on `date`. */
export const injuryActiveOn = (injury: Pick<Injury, "startDate" | "clearedDate">, date: IsoDate) =>
  injury.startDate <= date && (injury.clearedDate === null || date < injury.clearedDate);

/** Whether an exercise with these primary muscles loads `joint`. */
export const loadsJoint = (joint: Joint, muscles: readonly Muscle[] | undefined) =>
  !!muscles?.some((m) => JOINT_MUSCLES[joint].includes(m));
