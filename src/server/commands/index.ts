import postgres, { type Sql } from "postgres";
import type { z } from "zod";
import { backupTargetsFromEnv, type BackupTargets } from "../backup/targets";
import { withActor, type Actor } from "../db/actor";
import { createHevyClient, HevyAuthError, HevyUnavailableError, type HevyClient } from "../hevy/client";
import {
  createStravaClient,
  StravaAuthError,
  StravaNotConfiguredError,
  StravaUnavailableError,
  type StravaClient,
} from "../strava/client";
import { createWebPushSender, type PushMessage, type PushSender } from "../push/sender";
import { createWgerClient, WgerUnavailableError, type WgerClient } from "../wger/client";
import { planBlocks } from "@/engine/plan";
import { CommandError, type CommandDefinition, type Engine, type StepsDefinition } from "./define";
import {
  deleteBodyMeasurement,
  getBodyMetricHistory,
  listBodyMeasurements,
  logBodyMeasurement,
  updateBodyMeasurement,
} from "./body-measurements";
import {
  deletePushSubscription,
  deliverPush,
  getPushSubscription,
  listInbox,
  raiseInboxItem,
  savePushSubscription,
} from "./inbox";
import {
  confirmPlanRevision,
  getPlanRevision,
  listPlanRevisions,
  rejectPlanRevision,
  undoPlanRevision,
} from "./plan-revisions";
import { clearInjury, deleteInjury, listInjuries, logInjury, updateInjury } from "./injuries";
import { movePlannedRun, movePlannedSession } from "./plan-moves";
import { clearUnavailable, listUnavailability, markUnavailable } from "./availability";
import { applyCoachChange, proposeCoachChange } from "./coach";
import {
  createBlock,
  deleteDraftBlock,
  draftBlock,
  getBlock,
  getPlannedSession,
  getToday,
  listBlocks,
  startBlock,
  updateBlock,
  updateDraftBlock,
} from "./blocks";
import { getAccount, getDeploymentStatus } from "./account";
import { getCalendar } from "./calendar";
import { getTrainingLoad } from "./training-load";
import { getHome } from "./home";
import { getMuscleHeatmap } from "./muscle-heatmap";
import { createCustomExercise, getExercise, listExercises } from "./exercises";
import { addFeedback, deleteFeedback, listFeedback, setFeedbackDone } from "./feedback";
import { listGyms, listMachines } from "./machines";
import { getPreviousSets } from "./previous";
import {
  createRoutine,
  createRoutineFolder,
  deleteRoutine,
  deleteRoutineFolder,
  getRoutine,
  listRoutines,
  renameRoutineFolder,
  reorderRoutineFolders,
  reorderRoutines,
  updateRoutine,
} from "./routines";
import { getHevyImport, importFromHevy, resolveHevyMatch } from "./hevy-import";
import { exportJson, exportWorkoutsCsv } from "./export";
import { getBackupStatus, runBackup } from "./backup";
import { getExerciseHistory, getWorkoutSummary, listRecentPrs, listRecords } from "./records";
import {
  createRace,
  deleteRace,
  deleteRunPlan,
  getRunPlan,
  importRunPlan,
  listRaces,
  listRunPlans,
  updateRace,
} from "./running";
import { addManualRun, deleteManualRun, importActivityFiles, listActivities } from "./activity-imports";
import {
  connectStrava,
  disconnectStrava,
  getActivitySources,
  getStravaConnection,
  listStravaActivities,
  processStravaEvents,
  receiveStravaEvent,
  refreshRunStatuses,
  subscribeStravaWebhook,
} from "./strava";
import { getWorkoutStravaPost, postWorkoutsToStrava } from "./strava-posts";
import { applyWorkoutOps, getDiscardedWorkout, getWorkout, listDiscardedWorkouts, listWorkouts } from "./workouts";
import { addWgerExercise, listWgerCredits, searchWger } from "./wger";

export { CommandError, type CommandErrorCode, type Engine } from "./define";
export type { Actor } from "../db/actor";

/**
 * Every application operation, by name. The PWA (server actions / route
 * handlers), MCP server, Strava webhook and backup job all go through these.
 */
const operations = {
  getAccount,
  getDeploymentStatus,
  listExercises,
  getExercise,
  createCustomExercise,
  applyWorkoutOps,
  listWorkouts,
  getWorkout,
  listDiscardedWorkouts,
  getDiscardedWorkout,
  listRecords,
  getWorkoutSummary,
  getExerciseHistory,
  listRecentPrs,
  getPreviousSets,
  listMachines,
  listGyms,
  addFeedback,
  listFeedback,
  setFeedbackDone,
  deleteFeedback,
  listRoutines,
  getRoutine,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  reorderRoutines,
  createRoutineFolder,
  renameRoutineFolder,
  deleteRoutineFolder,
  reorderRoutineFolders,
  searchWger,
  addWgerExercise,
  listWgerCredits,
  logBodyMeasurement,
  updateBodyMeasurement,
  deleteBodyMeasurement,
  listBodyMeasurements,
  getBodyMetricHistory,
  importFromHevy,
  getHevyImport,
  resolveHevyMatch,
  exportJson,
  exportWorkoutsCsv,
  runBackup,
  getBackupStatus,
  createBlock,
  draftBlock,
  updateDraftBlock,
  deleteDraftBlock,
  startBlock,
  updateBlock,
  listBlocks,
  getBlock,
  getToday,
  getPlannedSession,
  getCalendar,
  getTrainingLoad,
  getHome,
  getMuscleHeatmap,
  listPlanRevisions,
  getPlanRevision,
  undoPlanRevision,
  confirmPlanRevision,
  rejectPlanRevision,
  listInbox,
  raiseInboxItem,
  savePushSubscription,
  deletePushSubscription,
  getPushSubscription,
  createRace,
  updateRace,
  deleteRace,
  listRaces,
  importRunPlan,
  listRunPlans,
  getRunPlan,
  deleteRunPlan,
  getStravaConnection,
  connectStrava,
  disconnectStrava,
  subscribeStravaWebhook,
  receiveStravaEvent,
  processStravaEvents,
  listStravaActivities,
  importActivityFiles,
  addManualRun,
  deleteManualRun,
  listActivities,
  getActivitySources,
  postWorkoutsToStrava,
  getWorkoutStravaPost,
  refreshRunStatuses,
  markUnavailable,
  listUnavailability,
  clearUnavailable,
  movePlannedSession,
  movePlannedRun,
  logInjury,
  listInjuries,
  updateInjury,
  clearInjury,
  deleteInjury,
  proposeCoachChange,
  applyCoachChange,
};

type Operations = typeof operations;

export type Commands = {
  [Name in keyof Operations]: Operations[Name] extends CommandDefinition<infer Input, infer Output>
    ? (input: z.input<Input>) => Promise<Output>
    : Operations[Name] extends StepsDefinition<infer Input, infer Output>
      ? (input: z.input<Input>) => Promise<Output>
      : never;
};

export type CommandName = keyof Commands;
export type CommandInput<Name extends CommandName> = Parameters<Commands[Name]>[0];
export type CommandOutput<Name extends CommandName> = Awaited<ReturnType<Commands[Name]>>;

/** Postgres errors that mean "the caller may not do this" or "this already exists" become CommandErrors. */
function toCommandError(error: unknown): unknown {
  if (error instanceof postgres.PostgresError) {
    // 42501: insufficient_privilege (incl. RLS violations); 23505: unique_violation.
    if (error.code === "42501") return new CommandError("unauthorized", "Not allowed", error.message);
    if (error.code === "23505") return new CommandError("conflict", "Already exists", error.detail);
  }
  if (error instanceof WgerUnavailableError) {
    return new CommandError("unavailable", "wger is unavailable right now", error.message);
  }
  if (error instanceof HevyUnavailableError) {
    return new CommandError("unavailable", "Hevy is unavailable right now", error.message);
  }
  if (error instanceof HevyAuthError) {
    return new CommandError("invalid_input", "Hevy rejected the API key (it needs Hevy Pro)", error.message);
  }
  if (error instanceof StravaUnavailableError) {
    return new CommandError("unavailable", "Strava is unavailable right now", error.message);
  }
  if (error instanceof StravaAuthError) {
    return new CommandError("invalid_input", "Strava refused the authorization; connect again", error.message);
  }
  if (error instanceof StravaNotConfiguredError) {
    return new CommandError("invalid_input", error.message);
  }
  return error;
}

/** Binds the command layer to a database connection and the actor making the calls. */
export function createCommands({
  sql,
  actor,
  wger = createWgerClient(),
  hevy = createHevyClient(),
  strava = createStravaClient(),
  engine = planBlocks,
  now = () => new Date(),
  push = createWebPushSender(),
  backup = backupTargetsFromEnv(),
}: {
  sql: Sql;
  actor: Actor;
  /** Defaults to the live wger API (WGER_BASE_URL); tests pass one backed by recorded responses. */
  wger?: WgerClient;
  /** Defaults to the live Hevy API (HEVY_BASE_URL); tests pass one backed by recorded responses. */
  hevy?: HevyClient;
  /** Defaults to the live Strava API (STRAVA_API_BASE, STRAVA_CLIENT_ID/SECRET); tests pass recorded responses. */
  strava?: StravaClient;
  /** Defaults to the real engine; tests wrap it (pinned `today`, fixture changes). */
  engine?: Engine;
  /** Defaults to the wall clock; tests pin it. */
  now?: () => Date;
  /** Defaults to Web Push with the VAPID keys in the environment (no-op without them); tests pass a fake. */
  push?: PushSender;
  /** Defaults to the GitHub repo / Supabase Storage configured in the environment; tests pass fakes. */
  backup?: BackupTargets;
}): Commands {
  const bound = Object.fromEntries(
    Object.entries(operations).map(([name, op]) => {
      const definition = op as CommandDefinition<z.ZodType, unknown> | StepsDefinition<z.ZodType, unknown>;
      const call = async (rawInput: unknown) => {
        const parsed = definition.input.safeParse(rawInput ?? {});
        if (!parsed.success) {
          throw new CommandError("invalid_input", `Invalid input for ${name}`, parsed.error.issues);
        }
        const pushes: PushMessage[] = [];
        let result: unknown;
        try {
          const ctx = { actor, wger, hevy, strava, engine, now, backup, push: (m: PushMessage) => pushes.push(m) };
          result =
            "steps" in definition
              ? await definition.run({ ...ctx, transaction: (work) => withActor(sql, actor, work) }, parsed.data)
              : await withActor(sql, actor, (tx) => definition.run({ ...ctx, tx }, parsed.data));
        } catch (error) {
          throw toCommandError(error);
        }
        await deliverPush(sql, actor, push, pushes);
        return result;
      };
      return [name, call];
    }),
  );
  return bound as Commands;
}
