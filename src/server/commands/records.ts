import type { TransactionSql } from "postgres";
import { z } from "zod";
import {
  exerciseSessions,
  scanRecords,
  summarizeWorkout,
  workoutPrs,
  type ExerciseBests,
  type HistorySet,
  type PrEvent,
  type WorkoutSummary,
} from "@/domain/records";
import type { SetType, WeightUnit } from "@/domain/workout";
import { CommandError, defineCommand } from "./define";

interface HistorySetRow {
  set_id: string;
  workout_id: string;
  exercise_id: string;
  started_at: Date;
  set_type: SetType;
  weight: string | null;
  unit: WeightUnit;
  reps: number | null;
  completed: boolean;
}

/**
 * Every set of every finished workout (optionally one exercise's), in the
 * order it was done: by workout start, then exercise and set position.
 */
async function loadHistory(tx: TransactionSql, { exerciseId }: { exerciseId?: string } = {}): Promise<HistorySet[]> {
  const rows = await tx<HistorySetRow[]>`
    select s.id as set_id, w.id as workout_id, we.exercise_id, w.started_at,
      s.set_type, s.weight, s.unit, s.reps, s.completed
    from public.workout_sets s
    join public.workout_exercises we on we.id = s.workout_exercise_id
    join public.workouts w on w.id = we.workout_id
    where w.finished_at is not null and w.discarded_at is null
      ${exerciseId ? tx`and we.exercise_id = ${exerciseId}` : tx``}
    order by w.started_at, w.id, we.position, we.created_at, s.position, s.created_at`;
  return rows.map((r) => ({
    setId: r.set_id,
    workoutId: r.workout_id,
    exerciseId: r.exercise_id,
    achievedAt: r.started_at.toISOString(),
    setType: r.set_type,
    weight: r.weight === null ? null : Number(r.weight),
    unit: r.unit,
    reps: r.reps,
    completed: r.completed,
  }));
}

async function exerciseNames(tx: TransactionSql, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx<{ id: string; name: string }[]>`
    select id, name from public.exercises where id = any(${tx.array(ids)}::uuid[])`;
  return new Map(rows.map((r) => [r.id, r.name]));
}

export interface ExerciseRecords {
  exerciseId: string;
  name: string;
  bests: ExerciseBests;
}

/** Bests per exercise across all finished workouts, by exercise name. Also the logger's PR baseline. */
export const listRecords = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    const { bests } = scanRecords(await loadHistory(tx));
    const names = await exerciseNames(tx, [...bests.keys()]);
    const items: ExerciseRecords[] = [...bests]
      .filter(([, b]) => Object.keys(b).length > 0)
      .map(([exerciseId, b]) => ({ exerciseId, name: names.get(exerciseId) ?? "", bests: b }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { items };
  },
});

/** One exercise's sessions (estimated 1RM, best set, volume, sets) oldest first, plus its current bests. */
export const getExerciseHistory = defineCommand({
  input: z.object({ exerciseId: z.uuid() }),
  async run({ tx }, { exerciseId }) {
    const [exercise] = await tx<{ name: string }[]>`select name from public.exercises where id = ${exerciseId}`;
    if (!exercise) throw new CommandError("not_found", "No exercise with that id");
    const sets = await loadHistory(tx, { exerciseId });
    const { unit, sessions } = exerciseSessions(sets);
    const bests = scanRecords(sets).bests.get(exerciseId) ?? {};
    return { exerciseId, name: exercise.name, unit, sessions, bests };
  },
});

export interface RecentPr extends PrEvent {
  workoutId: string;
  name: string;
}

/** PRs across all workouts, newest workout first (one per exercise and kind per workout). */
export const listRecentPrs = defineCommand({
  input: z.object({ limit: z.number().int().min(1).max(200).default(10) }),
  async run({ tx }, { limit }) {
    const history = await loadHistory(tx);
    const { events } = scanRecords(history);
    const workoutIds = [...new Set(events.map((e) => e.set.workoutId))].reverse();
    const prs = workoutIds.flatMap((workoutId) => workoutPrs(events, workoutId)).slice(0, limit);
    const names = await exerciseNames(tx, [...new Set(prs.map((p) => p.exerciseId))]);
    const items: RecentPr[] = prs.map((pr) => ({
      ...pr,
      workoutId: pr.set.workoutId,
      name: names.get(pr.exerciseId) ?? "",
    }));
    return { items };
  },
});

/** A finished workout's summary (share card, Strava post); undefined when it isn't finished. */
export async function loadWorkoutSummary(tx: TransactionSql, workoutId: string): Promise<WorkoutSummary | undefined> {
  const [workout] = await tx<{ id: string; name: string | null; started_at: Date; finished_at: Date }[]>`
    select id, name, started_at, finished_at from public.workouts
    where id = ${workoutId} and finished_at is not null and discarded_at is null`;
  if (!workout) return undefined;
  const history = await loadHistory(tx);
  const { events } = scanRecords(history);
  const sets = history.filter((s) => s.workoutId === workoutId);
  const names = await exerciseNames(tx, [...new Set(sets.map((s) => s.exerciseId))]);
  return summarizeWorkout(
    {
      id: workout.id,
      name: workout.name,
      startedAt: workout.started_at.toISOString(),
      finishedAt: workout.finished_at.toISOString(),
    },
    sets,
    events,
    names,
  );
}

/** A finished workout's share-card summary: exercises, working sets, volume and the PRs it set. */
export const getWorkoutSummary = defineCommand({
  input: z.object({ workoutId: z.uuid() }),
  async run({ tx }, { workoutId }) {
    const summary = await loadWorkoutSummary(tx, workoutId);
    if (!summary) throw new CommandError("not_found", "No finished workout with that id");
    return summary;
  },
});
