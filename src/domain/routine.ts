import type { SetType, WeightUnit } from "./workout";

/**
 * Routines: reusable workout templates (exercises with target sets), kept in
 * folders so current and archived splits stay apart. Starting a workout from a
 * routine copies its exercises and sets into the logger.
 */

export interface RoutineFolder {
  id: string;
  name: string;
  position: number;
}

export interface RoutineSet {
  position: number;
  setType: SetType;
  /** Target weight as entered; null = not set (or bodyweight). */
  weight: number | null;
  unit: WeightUnit;
  /** Fixed rep target, or a range (repRangeStart–repRangeEnd); any may be null. */
  reps: number | null;
  repRangeStart: number | null;
  repRangeEnd: number | null;
}

export interface RoutineExercise {
  exerciseId: string;
  /** Catalogue name, for display. */
  name: string;
  position: number;
  restSeconds: number | null;
  /** Exercises of one routine sharing a number form a superset (0 is a valid group). */
  supersetGroup: number | null;
  notes: string | null;
  sets: RoutineSet[];
}

export interface Routine {
  id: string;
  folderId: string | null;
  name: string;
  notes: string | null;
  position: number;
  exercises: RoutineExercise[];
}

/** One set as it was last done: what the owner has to beat. */
export interface PreviousSet {
  position: number;
  setType: SetType;
  weight: number | null;
  unit: WeightUnit;
  reps: number | null;
}

/** exerciseId → the sets of the last finished workout that included it, in order. */
export type PreviousSets = Record<string, PreviousSet[]>;

/** machineId → the sets of the last finished workout that used that machine, in order. */
export type PreviousByMachine = Record<string, PreviousSet[]>;

/** exerciseId → the machine it was last done on (null = done with none); absent = never done. */
export type LastMachines = Record<string, string | null>;

/** The key for workouts with no gym in a LastMachinesByGym. */
export const NO_GYM_KEY = "";

/** gymId (NO_GYM_KEY = no gym) → what was last used there, per exercise. */
export type LastMachinesByGym = Record<string, LastMachines>;

export type RepTarget = Pick<RoutineSet, "reps" | "repRangeStart" | "repRangeEnd">;

/** Reads a typed rep target: "10" (fixed), "10-15" / "10–15" (range) or "" (none). Null if it isn't one. */
export function parseRepTarget(text: string): RepTarget | null {
  const trimmed = text.trim();
  if (trimmed === "") return { reps: null, repRangeStart: null, repRangeEnd: null };
  const fixed = /^(\d{1,4})$/.exec(trimmed);
  if (fixed) return { reps: Number(fixed[1]), repRangeStart: null, repRangeEnd: null };
  const range = /^(\d{1,4})\s*[-–—]\s*(\d{1,4})$/.exec(trimmed);
  if (!range) return null;
  const [start, end] = [Number(range[1]), Number(range[2])];
  return end < start ? null : { reps: null, repRangeStart: start, repRangeEnd: end };
}

export function formatRepTarget({ reps, repRangeStart, repRangeEnd }: RepTarget): string {
  if (reps !== null) return String(reps);
  if (repRangeStart !== null && repRangeEnd !== null) return `${repRangeStart}–${repRangeEnd}`;
  return repRangeStart !== null ? String(repRangeStart) : "";
}
