import type { TransactionSql } from "postgres";
import { z } from "zod";
import {
  planExerciseReorder,
  workoutOpSchema,
  type SetType,
  type WeightUnit,
  type Workout,
  type WorkoutExercise,
  type WorkoutOp,
} from "@/domain/workout";
import { replan } from "./replan";
import { CommandError, defineCommand } from "./define";
import { queueStravaPost } from "./strava-posts";

/** A logged workout as history shows it: exercises carry their catalogue name. */
export interface LoggedWorkout extends Workout {
  notes: string | null;
  exercises: (WorkoutExercise & { name: string; notes: string | null; supersetGroup: number | null })[];
}

/** Applies one op. For discard/restore, returns whether the workout actually moved in or out of history (false on a replay). */
async function applyOp(tx: TransactionSql, op: WorkoutOp): Promise<boolean> {
  switch (op.type) {
    case "startWorkout":
      await tx`
        insert into public.workouts (id, name, started_at)
        values (${op.id}, ${op.name}, ${op.startedAt})
        on conflict (id) do nothing`;
      return false;
    case "addExercise":
      await tx`
        insert into public.workout_exercises (id, workout_id, exercise_id, position)
        values (${op.id}, ${op.workoutId}, ${op.exerciseId}, ${op.position})
        on conflict (id) do nothing`;
      return false;
    case "removeExercise":
      await tx`delete from public.workout_exercises where id = ${op.id}`;
      return false;
    case "swapExercise":
      // Machines belong to one exercise, so the swapped-in exercise starts with none.
      await tx`update public.workout_exercises set exercise_id = ${op.exerciseId}, machine_id = null where id = ${op.id}`;
      return false;
    case "createMachine":
      // A replay, or a name already taken for the exercise, changes nothing.
      await tx`
        insert into public.machines (id, exercise_id, gym_id, name)
        values (${op.id}, ${op.exerciseId}, ${op.gymId}, ${op.name})
        on conflict do nothing`;
      return false;
    case "createGym":
      await tx`insert into public.gyms (id, name) values (${op.id}, ${op.name}) on conflict do nothing`;
      return false;
    case "setGym":
      // A gym that does not exist leaves the workout with none.
      await tx`
        update public.workouts
        set gym_id = (select g.id from public.gyms g where g.id = ${op.gymId}::uuid), updated_at = now()
        where id = ${op.id}`;
      return false;
    case "setMachineNotes":
      await tx`update public.machines set notes = ${op.notes} where id = ${op.id}`;
      return false;
    case "setMachine":
      // A machine that is missing, or belongs to another exercise, leaves the exercise with none.
      await tx`
        update public.workout_exercises we
        set machine_id = (
          select m.id from public.machines m where m.id = ${op.machineId}::uuid and m.exercise_id = we.exercise_id
        )
        where we.id = ${op.id}`;
      return false;
    case "reorderExercises": {
      const rows = await tx<{ id: string; superset_group: number | null }[]>`
        select id, superset_group from public.workout_exercises
        where workout_id = ${op.workoutId}
        order by position, created_at`;
      const plan = planExerciseReorder(
        rows.map((r) => ({ id: r.id, supersetGroup: r.superset_group })),
        op.ids,
      );
      for (const [position, id] of plan.order.entries()) {
        await tx`update public.workout_exercises set position = ${position} where id = ${id}`;
      }
      if (plan.ungroup.length > 0) {
        await tx`update public.workout_exercises set superset_group = null where id in ${tx(plan.ungroup)}`;
      }
      return false;
    }
    case "putSet":
      await tx`
        insert into public.workout_sets
          (id, workout_exercise_id, position, set_type, weight, unit, reps, rir, completed)
        values (
          ${op.id}, ${op.workoutExerciseId}, ${op.position}, ${op.setType},
          ${op.weight}, ${op.unit}, ${op.reps}, ${op.rir}, ${op.completed}
        )
        on conflict (id) do update set
          position = excluded.position,
          set_type = excluded.set_type,
          weight = excluded.weight,
          unit = excluded.unit,
          reps = excluded.reps,
          rir = excluded.rir,
          completed = excluded.completed,
          updated_at = now()`;
      return false;
    case "removeSet":
      await tx`delete from public.workout_sets where id = ${op.id}`;
      return false;
    case "finishWorkout":
      await tx`
        update public.workouts
        set finished_at = coalesce(finished_at, ${op.finishedAt}), updated_at = now()
        where id = ${op.id}`;
      return false;
    case "discardWorkout": {
      const moved = await tx`
        update public.workouts set discarded_at = ${op.discardedAt}, updated_at = now()
        where id = ${op.id} and discarded_at is null
        returning id`;
      return moved.length > 0;
    }
    case "restoreWorkout": {
      // Only a discarded workout changes; a replay (or a restore of a live workout) is a no-op.
      const moved = await tx`
        update public.workouts
        set discarded_at = null, finished_at = coalesce(finished_at, ${op.finishedAt}), updated_at = now()
        where id = ${op.id} and discarded_at is not null
        returning id`;
      return moved.length > 0;
    }
    case "setWorkoutNotes":
      await tx`update public.workouts set notes = ${op.notes}, updated_at = now() where id = ${op.id}`;
      return false;
    case "setSupersetGroup":
      await tx`update public.workout_exercises set superset_group = ${op.group} where id = ${op.id}`;
      return false;
    case "setRestSeconds":
      await tx`update public.workout_exercises set rest_seconds = ${op.seconds} where id = ${op.id}`;
      return false;
    case "setExerciseNotes":
      await tx`update public.workout_exercises set notes = ${op.notes} where id = ${op.id}`;
      return false;
  }
}

/**
 * Replays a batch of logger ops (the client's outbox) in order, in one
 * transaction. Idempotent: every op is keyed by client-generated ids, so
 * replaying the same outbox any number of times yields the same workout.
 */
export const applyWorkoutOps = defineCommand({
  input: z.object({ ops: z.array(workoutOpSchema).max(1000) }),
  async run({ tx, engine, push, now, strava }, { ops }) {
    let historyMoved = false;
    for (const op of ops) {
      const moved = await applyOp(tx, op);
      historyMoved ||= moved;
      // Posting happens after the sync commits (postWorkoutsToStrava); queueing is once per workout.
      const queues = op.type === "finishWorkout" || (op.type === "restoreWorkout" && moved);
      if (queues && strava.configured) await queueStravaPost(tx, op.id);
    }
    // A finished workout moves the next targets (double progression); so does one leaving or rejoining history.
    const finished = ops.filter((op) => op.type === "finishWorkout").length;
    if (finished > 0 || historyMoved) await replan(tx, engine, push, now());
    return { applied: ops.length, finished };
  },
});

interface WorkoutRow {
  id: string;
  name: string | null;
  started_at: Date;
  finished_at: Date | null;
  notes: string | null;
  exercises: {
    id: string;
    exercise_id: string;
    machine_id: string | null;
    name: string;
    position: number;
    superset_group: number | null;
    rest_seconds: number | null;
    notes: string | null;
    sets: {
      id: string;
      position: number;
      set_type: SetType;
      weight: number | string | null;
      unit: WeightUnit;
      reps: number | null;
      rir: number | null;
      completed: boolean;
    }[];
  }[];
}

function toLoggedWorkout(row: WorkoutRow): LoggedWorkout {
  return {
    id: row.id,
    name: row.name,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
    notes: row.notes,
    exercises: row.exercises.map((e) => ({
      id: e.id,
      exerciseId: e.exercise_id,
      machineId: e.machine_id,
      name: e.name,
      position: e.position,
      supersetGroup: e.superset_group,
      restSeconds: e.rest_seconds,
      notes: e.notes,
      sets: e.sets.map((s) => ({
        id: s.id,
        position: s.position,
        setType: s.set_type,
        // numeric → JSON number: decimal lb values like 182.5 are exact in a double.
        weight: s.weight === null ? null : Number(s.weight),
        unit: s.unit,
        reps: s.reps,
        rir: s.rir,
        completed: s.completed,
      })),
    })),
  };
}

const pagination = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

type WorkoutScope = "history" | "discarded";

async function selectWorkouts(tx: TransactionSql, scope: WorkoutScope, limit: number, offset: number, id?: string) {
  const rows = await tx<WorkoutRow[]>`
    select w.id, w.name, w.started_at, w.finished_at, w.notes,
      coalesce((
        select json_agg(json_build_object(
          'id', we.id, 'exercise_id', we.exercise_id, 'machine_id', we.machine_id, 'name', e.name, 'position', we.position,
          'superset_group', we.superset_group,
          'rest_seconds', we.rest_seconds, 'notes', we.notes,
          'sets', coalesce((
            select json_agg(json_build_object(
              'id', s.id, 'position', s.position, 'set_type', s.set_type, 'weight', s.weight,
              'unit', s.unit, 'reps', s.reps, 'rir', s.rir, 'completed', s.completed
            ) order by s.position, s.created_at)
            from public.workout_sets s where s.workout_exercise_id = we.id
          ), '[]'::json)
        ) order by we.position, we.created_at)
        from public.workout_exercises we join public.exercises e on e.id = we.exercise_id
        where we.workout_id = w.id
      ), '[]'::json) as exercises
    from public.workouts w
    where ${scope === "history" ? tx`w.finished_at is not null and w.discarded_at is null` : tx`w.discarded_at is not null`}
      and ${id === undefined ? tx`true` : tx`w.id = ${id}`}
    order by ${scope === "history" ? tx`w.finished_at desc, w.id` : tx`w.discarded_at desc, w.id`}
    limit ${limit} offset ${offset}`;
  return { items: rows.map(toLoggedWorkout) };
}

/** Finished workouts, newest first. Discarded ones are archived, not history. */
export const listWorkouts = defineCommand({
  input: pagination,
  run: ({ tx }, { limit, offset }) => selectWorkouts(tx, "history", limit, offset),
});

/** One finished workout with its exercises and sets, as history shows it (the detail page's copy text). */
export const getWorkout = defineCommand({
  input: z.object({ workoutId: z.uuid() }),
  async run({ tx }, { workoutId }) {
    const [workout] = (await selectWorkouts(tx, "history", 1, 0, workoutId)).items;
    if (!workout) throw new CommandError("not_found", "No finished workout with that id");
    return workout;
  },
});

/** The discarded archive (finished or abandoned mid-session), most recently discarded first. */
export const listDiscardedWorkouts = defineCommand({
  input: pagination,
  run: ({ tx }, { limit, offset }) => selectWorkouts(tx, "discarded", limit, offset),
});

/** One discarded workout for the archive's read-only detail; not_found for anything in history or unknown. */
export const getDiscardedWorkout = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, { id }) {
    const [workout] = (await selectWorkouts(tx, "discarded", 1, 0, id)).items;
    if (!workout) throw new CommandError("not_found", "No such discarded workout");
    return workout;
  },
});
