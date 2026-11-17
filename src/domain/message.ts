import type { IsoDate } from "./block";
import type { Grade, Joint, Side, Tissue } from "./injury";
import type { WeightUnit } from "./workout";

/**
 * Plain-language text workout tracker generates (plan change summaries and reasons,
 * progression reasons, inbox titles) as a code plus parameters, so the engine
 * and the command layer hold no copy: src/strings renders it at display time,
 * in the viewer's skin (Dumb Mode included). `renderText` (src/strings/render.ts).
 */
export type Message =
  // ---- Progression (src/engine/progression.ts): why a planned exercise has its targets ----
  | { code: "progressionStart"; weight: number | null; unit: WeightUnit; reps: number }
  | { code: "progressionRirIncrease"; at: number; rir: number; next: number; unit: WeightUnit }
  | { code: "progressionRirReduce"; sessions: number; at: number; next: number; unit: WeightUnit }
  | { code: "progressionRirGrinder"; at: number; unit: WeightUnit }
  | { code: "progressionHitTop"; top: number; sets: number; at: number; next: number; unit: WeightUnit }
  | { code: "progressionNotYet"; top: number; at: number | null; unit: WeightUnit }
  | { code: "progressionHitTopBodyweight"; top: number }
  | { code: "progressionHitTopGrinder"; top: number; at: number; unit: WeightUnit }
  /** The RIR rule without RIR logged: going by reps (`reason`). */
  | { code: "progressionNoRir"; reason: Message }
  /** `reason`, on a set ramp: `sets` this week, climbing to `rampTo`. */
  | { code: "progressionRamp"; reason: Message; sets: number; rampTo: number | null }
  | {
      code: "deloadWeek";
      sets: number;
      reps: number;
      weight: number | null;
      from: number | null;
      unit: WeightUnit;
      /** Share of the load kept, in percent. */
      share: number;
    }
  // ---- Plan changes (src/engine/changes.ts, interactions.ts, replan.ts) ----
  | { code: "progressionChange"; exercise: string; decision: "increase" | "reduce"; weight: number | null; unit: WeightUnit | null }
  | { code: "peakSummary"; week: number }
  | { code: "peakReason"; week: number; plan: string; meters: number }
  | { code: "peakAdjustment"; keep: number; of: number }
  | { code: "eveSummary"; session: string; race: boolean }
  | { code: "eveReason"; race: boolean; meters: number | null; share: number }
  | { code: "eveAdjustment"; race: boolean; share: number }
  | { code: "deloadMoves"; from: number[]; to: number[]; race: string }
  | { code: "deloadAdded"; weeks: number[]; race: string }
  | { code: "deloadRaceWeek"; week: number; race: string }
  | { code: "deloadPostRace"; week: number; race: string }
  | { code: "deloadDropped"; weeks: number[] }
  | { code: "unavailableRunsSummary"; count: number }
  | { code: "unavailableRunsReason"; from: IsoDate; to: IsoDate }
  | { code: "unavailableCause"; from: IsoDate; to: IsoDate }
  | { code: "longRunMissed"; meters: number | null; date: IsoDate }
  | { code: "longRunMoveSummary"; missed: boolean; date: IsoDate }
  | { code: "longRunMoveReason"; date: IsoDate; makesWay: ("cross" | "easy")[] }
  | { code: "longRunDropSummary"; missed: boolean }
  | { code: "longRunDropReason"; days: number }
  | { code: "sessionMoveSummary"; session: string; date: IsoDate }
  | { code: "sessionMoveUnavailable"; session: string; from: IsoDate; to: IsoDate; date: IsoDate }
  | { code: "sessionMoveMissed"; session: string; was: IsoDate; date: IsoDate }
  | { code: "sessionDropSummary"; session: string }
  | { code: "sessionDropReason"; session: string; from: IsoDate; to: IsoDate; week: number }
  | { code: "injurySummary"; joint: Joint; side: Side; grade: Grade }
  | { code: "injuryReason"; joint: Joint; side: Side; tissue: Tissue; grade: Grade }
  | { code: "injuryAdjustment"; joint: Joint; side: Side; grade: Grade; share: number; skip: boolean }
  // ---- Coach changes (src/server/commands/coach.ts) ----
  | { code: "coachUnavailable"; from: IsoDate; to: IsoDate; note: string | null }
  | { code: "coachNewRace"; priority: string; name: string; date: IsoDate }
  | {
      code: "coachRaceUpdated";
      name: string;
      date: IsoDate | null;
      priority: string | null;
      distanceMeters: number | null;
      renamedFrom: string | null;
    }
  | { code: "coachRunPlan"; plan: string; weeks: number; race: string | null }
  | { code: "coachEffect"; parts: { what: "session" | "run" | "targets"; how: "added" | "off" | "changed" | "moved" | null; count: number }[] }
  // ---- Activity file imports (src/server/commands/activity-imports.ts) ----
  | { code: "activityFileImported"; date: IsoDate; meters: number }
  | { code: "activityFileDuplicate"; date: IsoDate }
  /** `sport` as Strava names sports ("Ride", "Walk", …). */
  | { code: "activityFileNotRun"; sport: string; date: IsoDate }
  | { code: "activityFileUnreadable"; problem: "format" | "corrupt" | "empty" }
  // ---- Backups (src/server/commands/backup.ts) ----
  | { code: "backupFailed" }
  | { code: "backupFailedBody"; target: "github" | "storage" | null; error: string }
  | { code: "backupSucceeded"; target: "github" | "storage" };

export type MessageCode = Message["code"];

/**
 * Text as stored and shown: a message, or free text (the coach's own words, a backup job's
 * error, and rows written before messages existed — those stay readable as they were).
 */
export type Text = string | Message;

export const isMessage = (value: unknown): value is Message =>
  !!value && typeof value === "object" && typeof (value as { code?: unknown }).code === "string";
