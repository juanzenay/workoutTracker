import { z } from "zod";

/**
 * Workouts and the ops that build them.
 *
 * The logger is local-first: the client records every change as a WorkoutOp,
 * applies it to its IndexedDB copy straight away (see applyWorkoutOp) and
 * queues it in an outbox. The outbox is later replayed against the command
 * layer (applyWorkoutOps). Every op names its entities by client-generated
 * UUIDs and is idempotent, so replaying an outbox — in whole or in part, once
 * or many times — converges on the same workout without duplicates.
 */

export const SET_TYPES = ["normal", "warmup", "drop", "failure"] as const;
export type SetType = (typeof SET_TYPES)[number];

export const WEIGHT_UNITS = ["lb", "kg"] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

/** Weights are stored exactly as entered, with their unit; nothing is converted. */
const weight = z.number().finite().min(0).max(10_000).nullable();
const reps = z.number().int().min(0).max(1_000).nullable();

/** Reps in reserve, tapped on an exercise's last set. 3 means "3+". Optional: null = not tapped. */
export const RIR_VALUES = [0, 1, 2, 3] as const;
const rir = z.number().int().min(0).max(3).nullable().default(null);
/** A machine's title, e.g. "Leverage Iso Low Row, Gym A". */
const machineName = z.string().trim().min(1).max(120);
const timestamp = z.iso.datetime({ offset: true });
/** Free text; blank clears it (stored as null). */
const notes = z
  .string()
  .max(2_000)
  .nullable()
  .transform((text) => (text?.trim() ? text : null));

export const workoutOpSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("startWorkout"),
    id: z.uuid(),
    startedAt: timestamp,
    name: z.string().trim().max(120).nullable().default(null),
  }),
  z.object({
    type: z.literal("addExercise"),
    id: z.uuid(),
    workoutId: z.uuid(),
    exerciseId: z.uuid(),
    position: z.number().int().min(0),
  }),
  z.object({ type: z.literal("removeExercise"), id: z.uuid() }),
  /**
   * Creates a machine under an exercise. Names are unique per exercise, case-insensitively; a repeat
   * (same id, or the same name again) is ignored, so replays converge.
   */
  z.object({
    type: z.literal("createMachine"),
    id: z.uuid(),
    exerciseId: z.uuid(),
    name: machineName,
    /** The gym the machine is at; null = none (machines made before gyms existed). */
    gymId: z.uuid().nullable().default(null),
  }),
  /** Creates a gym. Names are unique, case-insensitively; a repeat (same id, or the same name again) is ignored. */
  z.object({ type: z.literal("createGym"), id: z.uuid(), name: machineName }),
  /** Sets the gym a workout is done at; null = none. A gym that does not exist leaves it as none. */
  z.object({ type: z.literal("setGym"), id: z.uuid(), gymId: z.uuid().nullable() }),
  /** Sets a machine's notes (seat position and the like), kept with the machine across workouts; blank clears them. */
  z.object({ type: z.literal("setMachineNotes"), id: z.uuid(), notes }),
  /** Picks the machine a workout exercise is done on; null = none. A machine that does not exist leaves it as none. */
  z.object({ type: z.literal("setMachine"), id: z.uuid(), machineId: z.uuid().nullable() }),
  /** Replaces the exercise a workout exercise performs. Its position, superset group, rest and sets stay as they are; its machine clears. */
  z.object({ type: z.literal("swapExercise"), id: z.uuid(), exerciseId: z.uuid() }),
  /**
   * Puts a workout's exercises in the given order (positions are rewritten to match). Ids not in the workout
   * are ignored; see planExerciseReorder for how superset membership changes.
   */
  z.object({ type: z.literal("reorderExercises"), workoutId: z.uuid(), ids: z.array(z.uuid()).max(200) }),
  /** Creates or replaces a whole set (every edit sends the full row). */
  z.object({
    type: z.literal("putSet"),
    id: z.uuid(),
    workoutExerciseId: z.uuid(),
    position: z.number().int().min(0),
    setType: z.enum(SET_TYPES),
    weight,
    unit: z.enum(WEIGHT_UNITS),
    reps,
    rir,
    completed: z.boolean(),
  }),
  z.object({ type: z.literal("removeSet"), id: z.uuid() }),
  z.object({ type: z.literal("finishWorkout"), id: z.uuid(), finishedAt: timestamp }),
  /**
   * Archives a workout (finished or still in progress) out of history and stats; restoreWorkout undoes it.
   * Both are idempotent: the first discard time and the first finish time win.
   */
  z.object({ type: z.literal("discardWorkout"), id: z.uuid(), discardedAt: timestamp }),
  /** `finishedAt` only applies to a workout that was discarded while still in progress. */
  z.object({ type: z.literal("restoreWorkout"), id: z.uuid(), finishedAt: timestamp }),
  z.object({ type: z.literal("setWorkoutNotes"), id: z.uuid(), notes }),
  /** Exercises sharing a group number within a workout form one superset; null = not in a superset. */
  z.object({ type: z.literal("setSupersetGroup"), id: z.uuid(), group: z.number().int().min(1).max(1_000).nullable() }),
  z.object({ type: z.literal("setExerciseNotes"), id: z.uuid(), notes }),
  /** The exercise's rest timer duration; null = DEFAULT_REST_SECONDS. */
  z.object({ type: z.literal("setRestSeconds"), id: z.uuid(), seconds: z.number().int().min(0).max(3_600).nullable() }),
]);

export type WorkoutOp = z.output<typeof workoutOpSchema>;
export type WorkoutOpInput = z.input<typeof workoutOpSchema>;

export interface WorkoutSet {
  id: string;
  position: number;
  setType: SetType;
  weight: number | null;
  unit: WeightUnit;
  reps: number | null;
  rir: number | null;
  completed: boolean;
}

/**
 * A machine an exercise is done on. Weights differ between machines, so each keeps its own history
 * (the Previous column follows the machine picked).
 */
export interface Machine {
  id: string;
  exerciseId: string;
  /** The gym the machine is at; null = none. */
  gymId: string | null;
  name: string;
  /** How to set the machine up (seat position and the like). */
  notes: string | null;
}

/** A gym where workouts are done. Machines belong to one. */
export interface Gym {
  id: string;
  name: string;
}

/** True when `name` is already taken by another machine of the same exercise at the same gym (case-insensitive). */
export function machineNameTaken(machines: Machine[], exerciseId: string, gymId: string | null, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return machines.some(
    (m) => m.exerciseId === exerciseId && m.gymId === gymId && m.name.trim().toLowerCase() === wanted,
  );
}

/** True when `name` is already taken by another gym (case-insensitive). */
export function gymNameTaken(gyms: Gym[], name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return gyms.some((g) => g.name.trim().toLowerCase() === wanted);
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  /** The machine this exercise is done on, or null for none. */
  machineId: string | null;
  position: number;
  supersetGroup: number | null;
  restSeconds: number | null;
  notes: string | null;
  sets: WorkoutSet[];
}

export interface Workout {
  id: string;
  name: string | null;
  startedAt: string;
  finishedAt: string | null;
  notes: string | null;
  exercises: WorkoutExercise[];
}

/** The workout in the logger: also holds the machines created during it (the server's own list is shipped with the page). Local only. */
export interface ActiveWorkout extends Workout {
  /** The gym the workout is done at, or null. */
  gymId: string | null;
  /** Gyms created during this workout. */
  gyms: Gym[];
  machines: Machine[];
  /** Machine notes edited during this workout, by machine id; they win over the notes the page shipped with. */
  machineNotes: Record<string, string | null>;
}

/** A set with nothing logged yet: not completed, no weight, reps or RIR. Its type does not count as logged data. */
export function isEmptySet(set: WorkoutSet): boolean {
  return !set.completed && set.weight === null && set.reps === null && set.rir === null;
}

/** Rest timer length for an exercise that has no rest duration of its own. */
export const DEFAULT_REST_SECONDS = 90;

/**
 * A running rest timer. Device-local (never synced). Stored as absolute start and
 * end times so it stays correct when the app is backgrounded, suspended or reloaded.
 */
export interface RestTimer {
  workoutExerciseId: string;
  startedAt: string;
  endsAt: string;
}

/** Whole seconds left on a rest timer at `now` (0 when done or none). */
export function restRemaining(timer: RestTimer | null, now: Date): number {
  if (!timer) return 0;
  return Math.max(0, Math.ceil((Date.parse(timer.endsAt) - now.getTime()) / 1000));
}

/** Whole seconds since the rest started at `now` (0 when none). Moving the end time does not change it. */
export function restElapsed(timer: RestTimer | null, now: Date): number {
  if (!timer) return 0;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(timer.startedAt)) / 1000));
}

/** The rest length a running timer is counting toward: its exercise's rest, or the default. */
export function restTargetSeconds(exercises: WorkoutExercise[], timer: RestTimer | null): number {
  const exercise = exercises.find((e) => e.id === timer?.workoutExerciseId);
  return exercise?.restSeconds ?? DEFAULT_REST_SECONDS;
}

/**
 * What the rest timer shows at `now`. Count down: time left, done at zero, no overtime.
 * Count up: time elapsed, done once it reaches the exercise's rest length, and it keeps running.
 */
export function restDisplay(
  timer: RestTimer | null,
  now: Date,
  mode: "down" | "up",
  targetSeconds: number,
): { seconds: number; done: boolean } {
  if (!timer) return { seconds: 0, done: false };
  if (mode === "down") {
    const seconds = restRemaining(timer, now);
    return { seconds, done: seconds === 0 };
  }
  const seconds = restElapsed(timer, now);
  return { seconds, done: seconds >= targetSeconds };
}

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/** The outcome of a reorder: the new order of every exercise, and the ones that leave their superset. */
export interface ExerciseReorder {
  order: string[];
  ungroup: string[];
}

/**
 * Plans a reorder. `current` lists the workout's exercises in their current order; `requested` is the wanted
 * order of some of them. Unknown and repeated ids are ignored, the listed exercises come first in the requested
 * order, and the rest keep their relative order after them.
 *
 * An exercise moved out of place (not part of the longest run that kept its order) leaves its superset, and a
 * superset left with a single member ungroups that member too, so no group of one remains.
 */
export function planExerciseReorder(
  current: { id: string; supersetGroup: number | null }[],
  requested: string[],
): ExerciseReorder {
  const rank = new Map(current.map((e, index) => [e.id, index]));
  const listed = [...new Set(requested)].filter((id) => rank.has(id));
  const listedIds = new Set(listed);
  const order = [...listed, ...current.map((e) => e.id).filter((id) => !listedIds.has(id))];

  const kept = new Set(longestIncreasing(listed.map((id) => rank.get(id)!)).map((i) => listed[i]!));
  const group = new Map(current.map((e) => [e.id, e.supersetGroup]));
  const ungroup = new Set(listed.filter((id) => !kept.has(id) && group.get(id) != null));

  for (const touched of new Set([...ungroup].map((id) => group.get(id)!))) {
    const remaining = current.filter((e) => e.supersetGroup === touched && !ungroup.has(e.id));
    if (remaining.length === 1) ungroup.add(remaining[0]!.id);
  }
  return { order, ungroup: [...ungroup] };
}

/** Indexes of one longest strictly increasing subsequence of `values`, in order. */
function longestIncreasing(values: number[]): number[] {
  const length = values.map(() => 1);
  const previous = values.map(() => -1);
  let end = -1;
  values.forEach((value, i) => {
    for (let j = 0; j < i; j++) {
      if (values[j]! < value && length[j]! + 1 > length[i]!) {
        length[i] = length[j]! + 1;
        previous[i] = j;
      }
    }
    if (end === -1 || length[i]! > length[end]!) end = i;
  });
  const run: number[] = [];
  for (let i = end; i !== -1; i = previous[i]!) run.unshift(i);
  return run;
}

/**
 * Applies one op to a local workout (null = no workout yet). Pure: returns a
 * new workout. Ops that reference something not in this workout are ignored,
 * mirroring how the server treats them.
 */
export function applyWorkoutOp(workout: ActiveWorkout | null, op: WorkoutOp): ActiveWorkout | null {
  if (op.type === "startWorkout") {
    if (workout?.id === op.id) return workout;
    return { id: op.id, name: op.name, startedAt: op.startedAt, finishedAt: null, notes: null, exercises: [], gymId: null, gyms: [], machines: [], machineNotes: {} };
  }
  if (!workout) return null;

  const mapExercises = (fn: (exercises: WorkoutExercise[]) => WorkoutExercise[]): ActiveWorkout => ({
    ...workout,
    exercises: fn(workout.exercises).sort(byPosition),
  });

  switch (op.type) {
    case "addExercise":
      if (op.workoutId !== workout.id || workout.exercises.some((e) => e.id === op.id)) return workout;
      return mapExercises((exercises) => [
        ...exercises,
        {
          id: op.id,
          exerciseId: op.exerciseId,
          machineId: null,
          position: op.position,
          supersetGroup: null,
          restSeconds: null,
          notes: null,
          sets: [],
        },
      ]);
    case "removeExercise":
      return mapExercises((exercises) => exercises.filter((e) => e.id !== op.id));
    case "swapExercise":
      return mapExercises((exercises) =>
        exercises.map((e) => (e.id === op.id ? { ...e, exerciseId: op.exerciseId, machineId: null } : e)),
      );
    case "createMachine":
      if (
        workout.machines.some((m) => m.id === op.id) ||
        machineNameTaken(workout.machines, op.exerciseId, op.gymId, op.name)
      ) {
        return workout;
      }
      return {
        ...workout,
        machines: [...workout.machines, { id: op.id, exerciseId: op.exerciseId, gymId: op.gymId, name: op.name, notes: null }],
      };
    case "createGym":
      if (workout.gyms.some((g) => g.id === op.id) || gymNameTaken(workout.gyms, op.name)) return workout;
      return { ...workout, gyms: [...workout.gyms, { id: op.id, name: op.name }] };
    case "setGym":
      return op.id === workout.id ? { ...workout, gymId: op.gymId } : workout;
    case "setMachineNotes":
      return { ...workout, machineNotes: { ...workout.machineNotes, [op.id]: op.notes } };
    case "setMachine":
      return mapExercises((exercises) => exercises.map((e) => (e.id === op.id ? { ...e, machineId: op.machineId } : e)));
    case "reorderExercises": {
      if (op.workoutId !== workout.id) return workout;
      const plan = planExerciseReorder(workout.exercises, op.ids);
      const ungrouped = new Set(plan.ungroup);
      return mapExercises((exercises) => {
        const byId = new Map(exercises.map((e) => [e.id, e]));
        return plan.order.map((id, position) => {
          const e = byId.get(id)!;
          return { ...e, position, supersetGroup: ungrouped.has(id) ? null : e.supersetGroup };
        });
      });
    }
    case "putSet": {
      const { id, position, setType, weight, unit, reps, rir, completed } = op;
      const set: WorkoutSet = { id, position, setType, weight, unit, reps, rir, completed };
      return mapExercises((exercises) =>
        exercises.map((e) =>
          e.id === op.workoutExerciseId
            ? { ...e, sets: [...e.sets.filter((s) => s.id !== set.id), set].sort(byPosition) }
            : e,
        ),
      );
    }
    case "removeSet":
      return mapExercises((exercises) =>
        exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.id !== op.id) })),
      );
    case "finishWorkout":
      if (op.id !== workout.id) return workout;
      return { ...workout, finishedAt: workout.finishedAt ?? op.finishedAt };
    case "discardWorkout":
      // The discarded workout leaves the in-progress slot; the server keeps it in the archive.
      if (op.id !== workout.id) return workout;
      return null;
    case "restoreWorkout":
      // Server-side only for now: the local copy has no archive state yet.
      return workout;
    case "setWorkoutNotes":
      return op.id === workout.id ? { ...workout, notes: op.notes } : workout;
    case "setSupersetGroup":
      return mapExercises((exercises) =>
        exercises.map((e) => (e.id === op.id ? { ...e, supersetGroup: op.group } : e)),
      );
    case "setRestSeconds":
      return mapExercises((exercises) =>
        exercises.map((e) => (e.id === op.id ? { ...e, restSeconds: op.seconds } : e)),
      );
    case "setExerciseNotes":
      return mapExercises((exercises) => exercises.map((e) => (e.id === op.id ? { ...e, notes: op.notes } : e)));
  }
}
