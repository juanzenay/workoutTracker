import type { IsoDate, PlannedExercise, PlannedSession } from "./block";
import type { PlannedRun } from "./running";
import type { Text } from "./message";

/**
 * Plan changes: what the engine emits when its new plan differs from the plan
 * as persisted in a way the owner should hear about. The command layer turns
 * each into a **plan revision** (applied, or pending until confirmed).
 */

/** One exercise of one planned session, before and after the change. */
export interface ExerciseDiff {
  type: "exercise";
  blockId: string;
  blockSessionId: string;
  date: IsoDate;
  /** Planned session name, for display. */
  sessionName: string;
  blockExerciseId: string;
  before: PlannedExercise;
  after: PlannedExercise;
}

/**
 * A whole planned session moved (to another day) or dropped by a re-plan:
 * `before`/`after` are the session on its old/new date; null = not planned.
 */
export interface SessionDiff {
  type: "session";
  blockId: string;
  blockSessionId: string;
  sessionName: string;
  before: PlannedSession | null;
  after: PlannedSession | null;
}

/** A planned run moved or dropped by a re-plan; null = not planned. */
export interface RunDiff {
  type: "run";
  runPlanId: string;
  rowIndex: number;
  before: PlannedRun | null;
  after: PlannedRun | null;
}

export type PlanDiffItem = ExerciseDiff | SessionDiff | RunDiff;

/** Every date a diff item touches (both sides). */
export function diffDates(item: PlanDiffItem): IsoDate[] {
  if (item.type === "exercise") return [item.date];
  return [item.before?.date, item.after?.date].filter((d) => d !== undefined);
}

export interface PlanChange {
  /**
   * Stable identity: the engine emits the same key for the same change on every
   * re-plan (until what triggered it changes). The command layer uses it to
   * avoid duplicating pending revisions and to keep undone/rejected changes off.
   */
  key: string;
  /** One-line headline, e.g. "Machine Chest Press goes up to 185 lb". */
  summary: Text;
  /** Plain-language reasons. */
  reasons: Text[];
  /** True = wait for the owner's confirmation before touching the plan. */
  requiresConfirmation: boolean;
  /**
   * Part of first planning what it touches (a new block's sessions, a newly imported run plan's runs and how
   * lifting fits around them), not a change to a plan the owner already has: it applies silently, with nothing to
   * confirm or announce. The command layer still records its key, so later re-plans don't take it for a new change.
   */
  initial?: true;
  diff: PlanDiffItem[];
}

export const REVISION_SOURCES = ["engine", "coach", "user"] as const;
export type RevisionSource = (typeof REVISION_SOURCES)[number];

/**
 * proposed = a coach change waiting for the owner's approval in chat (not on the plan, not shown in workout tracker);
 * superseded = a pending engine change the engine no longer proposes (what triggered it changed);
 * initial = part of first planning what it touches (`PlanChange.initial`): applied silently, never shown.
 */
export const REVISION_STATUSES = ["proposed", "applied", "pending", "undone", "rejected", "superseded", "initial"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

/** A persisted plan change. */
export interface PlanRevision {
  id: string;
  key: string;
  source: RevisionSource;
  status: RevisionStatus;
  summary: Text;
  reasons: Text[];
  diff: PlanDiffItem[];
  /** When it was proposed (pending) or applied. */
  createdAt: string;
  /** When its status last changed. */
  updatedAt: string;
}

/** The exercise-level items of a change's diff. */
export const exerciseDiffs = (change: { diff: PlanDiffItem[] }): ExerciseDiff[] =>
  change.diff.filter((d): d is ExerciseDiff => d.type === "exercise");
