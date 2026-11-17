import type { Muscle } from "./exercise";
import type { Routine } from "./routine";
import type { SetType, WeightUnit } from "./workout";
import type { Text } from "./message";

/**
 * Blocks: a training block designed once (a split of sessions, exercise picks,
 * rep ranges and a length). The engine turns a block plus workout history into
 * dated planned sessions with targets; see src/engine/plan.ts.
 *
 * Dates are local calendar dates ("YYYY-MM-DD") in the block's time zone.
 * Weekdays are ISO: 1 = Monday … 7 = Sunday.
 */

export type IsoDate = string;
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const PROGRESSION_RULES = ["double", "rir", "ramp"] as const;
export type ProgressionRule = (typeof PROGRESSION_RULES)[number];

export interface BlockExercise {
  id: string;
  exerciseId: string;
  /** Catalogue name, for display. */
  name: string;
  position: number;
  /** Working sets per session. */
  sets: number;
  repRangeStart: number;
  repRangeEnd: number;
  /** Load for the first session when there is no history for the exercise; null = owner picks on the day. */
  startWeight: number | null;
  unit: WeightUnit;
  /** Load added when the top of the rep range is hit on every set. */
  increment: number;
  rule: ProgressionRule;
  /** Set ramp (rule "ramp"): sets climb from `sets` in the first training week to this in the last. */
  rampTo?: number | null;
  /** The exercise's primary muscles (catalogue); the interaction rules use them to tell lower-body work. Absent = unknown (treated as not lower body). */
  muscles?: Muscle[];
}

export interface BlockSession {
  id: string;
  name: string;
  weekday: Weekday;
  position: number;
  exercises: BlockExercise[];
}

export interface Block {
  id: string;
  name: string;
  startDate: IsoDate;
  weeks: number;
  /** Last day planned when the block was ended early (replaced by another); absent = its last week's last day. */
  endDate?: IsoDate;
  /** IANA zone the block's dates are in (e.g. "America/Los_Angeles"). */
  timeZone: string;
  /** 1-based weeks the owner set as deloads (lighter sessions); absent = none. Placed by `placeDeloads` (src/engine/deload.ts). */
  deloadWeeks?: number[];
  sessions: BlockSession[];
}

/** A finished workout as the engine sees it: dated in the block's time zone. */
export interface HistoryWorkout {
  date: IsoDate;
  exercises: {
    exerciseId: string;
    sets: {
      setType: SetType;
      weight: number | null;
      unit: WeightUnit;
      reps: number | null;
      /** Reps in reserve on the set (0–3, 3 = "3+"); null/absent = not logged. */
      rir?: number | null;
      completed: boolean;
    }[];
  }[];
}

export interface PlannedSet {
  position: number;
  setType: SetType;
  weight: number | null;
  unit: WeightUnit;
  /** Target reps for this set. */
  reps: number;
}

/** Why a planned exercise has the targets it has (progression's decision, with a plain-language reason). */
export interface Progression {
  /**
   * start = no usable history; hold = same load, beat the reps; increase = load added;
   * reduce = load taken off (RIR 0 at the usual load, sessions running); deload = a planned deload week's lighter session.
   */
  decision: "start" | "hold" | "increase" | "reduce" | "deload";
  /** Load the decision was based on (last session's working load), if any. */
  fromWeight: number | null;
  /** In plain language (rendered by src/strings; free text on plans saved before messages). */
  reason: Text;
}

export interface PlannedExercise {
  blockExerciseId: string;
  exerciseId: string;
  name: string;
  position: number;
  repRangeStart: number;
  repRangeEnd: number;
  sets: PlannedSet[];
  progression: Progression;
  /** Short notes on how running reshaped these targets (interaction rules), e.g. "Long run tomorrow: about 85% load". Absent = none. */
  adjustments?: Text[];
}

export interface PlannedSession {
  blockId: string;
  blockSessionId: string;
  date: IsoDate;
  /** 1-based week of the block. */
  week: number;
  name: string;
  /** In a deload week: fewer sets at lower load. */
  deload?: boolean;
  exercises: PlannedExercise[];
}

export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** Default load step for a unit (5 lb / 2.5 kg). */
export const defaultIncrement = (unit: WeightUnit) => (unit === "kg" ? 2.5 : 5);

/** A planned session in the shape the logger starts from (like a routine): its targets become unticked sets. */
export function plannedAsRoutine(session: PlannedSession): Pick<Routine, "name" | "exercises"> {
  return {
    name: session.name,
    exercises: session.exercises.map((exercise) => ({
      exerciseId: exercise.exerciseId,
      name: exercise.name,
      position: exercise.position,
      supersetGroup: null,
      restSeconds: null,
      notes: null,
      sets: exercise.sets.map((set) => ({
        position: set.position,
        setType: set.setType,
        weight: set.weight,
        unit: set.unit,
        reps: set.reps,
        repRangeStart: exercise.repRangeStart,
        repRangeEnd: exercise.repRangeEnd,
      })),
    })),
  };
}
