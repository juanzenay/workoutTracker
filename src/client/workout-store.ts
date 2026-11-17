import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  applyWorkoutOp,
  DEFAULT_REST_SECONDS,
  planExerciseReorder,
  type RestTimer,
  type SetType,
  type WeightUnit,
  type ActiveWorkout,
  type WorkoutOp,
  type WorkoutSet,
} from "@/domain/workout";
import type { LastMachines, PreviousSet, Routine } from "@/domain/routine";

/**
 * Local-first store for the active workout.
 *
 * Every change is a WorkoutOp, written in one IndexedDB transaction to both the
 * active workout (applied locally, so the UI never waits on the network) and
 * the outbox. sync() sends the outbox, oldest first, to the command layer and
 * deletes what was acknowledged. Ops are idempotent (client-generated UUIDs),
 * so an outbox resent after a lost reply never duplicates anything.
 */

/** Sends ops to the server; resolves once they are committed, throws otherwise (offline, 5xx, signed out). */
export type SyncTransport = (ops: WorkoutOp[]) => Promise<void>;

export type SetPatch = Partial<Pick<WorkoutSet, "setType" | "weight" | "unit" | "reps" | "rir" | "completed">>;

export interface WorkoutStore {
  /** The workout in progress, or null. Finished workouts leave the store (their ops stay queued until synced). */
  active(): ActiveWorkout | null;
  /** Ops written locally but not yet acknowledged by the server. */
  pendingCount(): number;
  subscribe(listener: () => void): () => void;

  start(options?: { name?: string | null; gymId?: string | null }): Promise<string>;
  /** Starts a workout named after the routine, pre-filled with its exercises and target sets. No-op if one is in progress. */
  startFromRoutine(
    routine: Pick<Routine, "name" | "exercises">,
    options?: { gymId?: string | null; lastMachines?: LastMachines },
  ): Promise<string>;
  /** Adds an exercise, on `machineId` if given (e.g. the machine it was last done on). Returns the workout exercise id. */
  addExercise(exerciseId: string, machineId?: string | null): Promise<string>;
  /** Creates a gym (name unique, case-insensitive) and returns its id; one already made this workout is returned as is. Synced. */
  createGym(name: string): Promise<string>;
  /** Sets the gym the workout is done at (null = none). Synced. */
  setGym(gymId: string | null): Promise<void>;
  /**
   * Creates a machine under an exercise at a gym (name unique per exercise and gym, case-insensitive) and returns its
   * id; one already made this workout is returned as is. Synced.
   */
  createMachine(exerciseId: string, gymId: string | null, name: string): Promise<string>;
  /** Sets a machine's notes (null clears them); they stay with the machine for later workouts. Synced. */
  setMachineNotes(machineId: string, notes: string | null): Promise<void>;
  /** Picks the machine an exercise is done on (null = none). Synced. */
  setMachine(workoutExerciseId: string, machineId: string | null): Promise<void>;
  removeExercise(workoutExerciseId: string): Promise<void>;
  /**
   * Replaces the exercise a workout exercise performs, keeping its place, superset, rest and sets. The old machine
   * clears; `machineId` (e.g. the machine the new exercise was last done on) is picked instead. Sets not yet done are
   * re-seeded from `previous` (the new exercise's last sets; the last one covers extra sets), since the old exercise's
   * loads mean nothing for it: with no history the weight is cleared. Done sets stay as logged. Synced.
   */
  swapExercise(
    workoutExerciseId: string,
    exerciseId: string,
    machineId?: string | null,
    previous?: PreviousSet[],
  ): Promise<void>;
  /** Puts the exercises in the given order (unknown ids are ignored). Nothing is queued when the order is unchanged. Synced. */
  reorderExercises(workoutExerciseIds: string[]): Promise<void>;
  /** Adds a set to an exercise, pre-filled from the exercise's previous set. Returns the set id. */
  addSet(workoutExerciseId: string): Promise<string>;
  /** Edits a set. Ticking a set complete starts its exercise's rest timer. */
  updateSet(setId: string, patch: SetPatch): Promise<void>;
  removeSet(setId: string): Promise<void>;
  finish(): Promise<void>;
  /** Archives the workout in progress instead of finishing it: it leaves the store, and history never sees it. Synced like finish(). */
  discard(): Promise<void>;

  setWorkoutNotes(notes: string | null): Promise<void>;
  setExerciseNotes(workoutExerciseId: string, notes: string | null): Promise<void>;
  /** Puts an exercise and the one after it in the same superset (joining or merging existing groups). */
  supersetWithNext(workoutExerciseId: string): Promise<void>;
  /** Takes an exercise out of its superset; a partner left alone leaves too. */
  leaveSuperset(workoutExerciseId: string): Promise<void>;

  /** Sets an exercise's rest timer length (null = DEFAULT_REST_SECONDS). Synced. */
  setRestSeconds(workoutExerciseId: string, seconds: number | null): Promise<void>;
  /** The running rest timer, or null. Device-local, kept in IndexedDB as absolute start and end times. */
  restTimer(): RestTimer | null;
  startRest(workoutExerciseId: string): Promise<void>;
  /** Adds (or with a negative delta, removes) seconds from the running timer. */
  adjustRest(deltaSeconds: number): Promise<void>;
  skipRest(): Promise<void>;

  /** Sends the outbox. Never throws: on failure the ops stay queued for the next attempt. */
  sync(): Promise<{ ok: boolean; pending: number }>;
  close(): void;
}

/** A rest timer as stored. Timers saved before the start was recorded have no `startedAt`. */
type StoredRestTimer = Omit<RestTimer, "startedAt"> & { startedAt?: string };

interface Schema extends DBSchema {
  active: { key: "current"; value: ActiveWorkout };
  outbox: { key: number; value: WorkoutOp };
  rest: { key: "current"; value: StoredRestTimer };
}

/**
 * Fills in the start of a rest timer stored before it was recorded: the start is the
 * end less the exercise's rest length. Null passes through.
 */
function upgradeRest(stored: StoredRestTimer | null, workout: ActiveWorkout | null): RestTimer | null {
  if (!stored) return null;
  if (stored.startedAt !== undefined) return { ...stored, startedAt: stored.startedAt };
  const exercise = workout?.exercises.find((e) => e.id === stored.workoutExerciseId);
  const seconds = exercise?.restSeconds ?? DEFAULT_REST_SECONDS;
  return { ...stored, startedAt: new Date(Date.parse(stored.endsAt) - seconds * 1000).toISOString() };
}

/** Fills fields added after a workout was stored by an older version of the app. */
function upgradeWorkout(workout: ActiveWorkout): ActiveWorkout {
  return {
    ...workout,
    notes: workout.notes ?? null,
    gymId: workout.gymId ?? null,
    gyms: workout.gyms ?? [],
    machines: (workout.machines ?? []).map((m) => ({ ...m, gymId: m.gymId ?? null, notes: m.notes ?? null })),
    machineNotes: workout.machineNotes ?? {},
    exercises: workout.exercises.map((e) => ({
      ...e,
      machineId: e.machineId ?? null,
      supersetGroup: e.supersetGroup ?? null,
      restSeconds: e.restSeconds ?? null,
      notes: e.notes ?? null,
      sets: e.sets.map((s) => ({ ...s, rir: s.rir ?? null })),
    })),
  };
}

export interface WorkoutStoreOptions {
  transport: SyncTransport;
  /** IndexedDB database name (tests use a fresh one each). */
  dbName?: string;
  /** Unit for a first set; later sets copy the previous set's unit. */
  defaultUnit?: WeightUnit;
  now?: () => Date;
}

const MAX_BATCH = 500;

export async function openWorkoutStore({
  transport,
  dbName = "workout-tracker-workouts",
  defaultUnit = "lb",
  now = () => new Date(),
}: WorkoutStoreOptions): Promise<WorkoutStore> {
  const db: IDBPDatabase<Schema> = await openDB<Schema>(dbName, 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore("active");
        database.createObjectStore("outbox", { autoIncrement: true });
      }
      if (oldVersion < 2) database.createObjectStore("rest");
    },
  });

  const stored = await db.get("active", "current");
  let active: ActiveWorkout | null = stored ? upgradeWorkout(stored) : null;
  let rest: RestTimer | null = upgradeRest((await db.get("rest", "current")) ?? null, active);
  let pending = await db.count("outbox");
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  async function dispatch(op: WorkoutOp): Promise<void> {
    const next = applyWorkoutOp(active, op);
    const tx = db.transaction(["active", "outbox"], "readwrite");
    if (next && !next.finishedAt) await tx.objectStore("active").put(next, "current");
    else await tx.objectStore("active").delete("current");
    await tx.objectStore("outbox").add(op);
    await tx.done;
    active = next?.finishedAt ? null : next;
    pending += 1;
    notify();
  }

  // Mutations run one at a time, each against the state the previous one left,
  // so rapid taps (type weight, tick ✓) never overwrite each other.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }

  function requireActive(): ActiveWorkout {
    if (!active) throw new Error("No workout in progress");
    return active;
  }

  function findExercise(workoutExerciseId: string) {
    const exercise = requireActive().exercises.find((e) => e.id === workoutExerciseId);
    if (!exercise) throw new Error(`Exercise ${workoutExerciseId} is not in the active workout`);
    return exercise;
  }

  async function setGroup(ids: string[], group: number | null) {
    for (const id of ids) await dispatch({ type: "setSupersetGroup", id, group });
  }

  function findSet(setId: string) {
    for (const exercise of requireActive().exercises) {
      const set = exercise.sets.find((s) => s.id === setId);
      if (set) return { exercise, set };
    }
    throw new Error(`Set ${setId} is not in the active workout`);
  }

  async function saveRest(timer: RestTimer | null): Promise<void> {
    if (timer) await db.put("rest", timer, "current");
    else await db.delete("rest", "current");
    rest = timer;
    notify();
  }

  function restFor(workoutExerciseId: string): RestTimer {
    const exercise = requireActive().exercises.find((e) => e.id === workoutExerciseId);
    const seconds = exercise?.restSeconds ?? DEFAULT_REST_SECONDS;
    const start = now().getTime();
    return {
      workoutExerciseId,
      startedAt: new Date(start).toISOString(),
      endsAt: new Date(start + seconds * 1000).toISOString(),
    };
  }

  /** Whether completing a set of this exercise starts a rest: not when rest is off, nor mid-way through a superset round. */
  function restsAfter(workoutExerciseId: string): boolean {
    const exercises = requireActive().exercises;
    const exercise = exercises.find((e) => e.id === workoutExerciseId);
    if (!exercise || exercise.restSeconds === 0) return false;
    if (exercise.supersetGroup === null) return true;
    return exercises.filter((e) => e.supersetGroup === exercise.supersetGroup).at(-1) === exercise;
  }

  const nextPosition = (items: { position: number }[]) =>
    items.reduce((max, item) => Math.max(max, item.position + 1), 0);

  let inFlight: Promise<{ ok: boolean; pending: number }> | null = null;

  async function syncOnce(): Promise<{ ok: boolean; pending: number }> {
    for (;;) {
      const tx = db.transaction("outbox", "readonly");
      const [keys, ops] = await Promise.all([
        tx.store.getAllKeys(null, MAX_BATCH),
        tx.store.getAll(null, MAX_BATCH),
      ]);
      await tx.done;
      if (keys.length === 0) return { ok: true, pending };

      try {
        await transport(ops);
      } catch {
        return { ok: false, pending };
      }

      const lastKey = keys[keys.length - 1]!;
      const del = db.transaction("outbox", "readwrite");
      await del.store.delete(IDBKeyRange.upperBound(lastKey));
      await del.done;
      pending = await db.count("outbox");
      notify();
    }
  }

  return {
    active: () => active,
    pendingCount: () => pending,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start(options = {}) {
      return serial(async () => {
        if (active) return active.id;
        const id = crypto.randomUUID();
        await dispatch({ type: "startWorkout", id, startedAt: now().toISOString(), name: options.name ?? null });
        if (options.gymId) await dispatch({ type: "setGym", id, gymId: options.gymId });
        return id;
      });
    },

    startFromRoutine(routine, { gymId = null, lastMachines = {} } = {}) {
      return serial(async () => {
        if (active) return active.id;
        const workoutId = crypto.randomUUID();
        await dispatch({ type: "startWorkout", id: workoutId, startedAt: now().toISOString(), name: routine.name });
        if (gymId) await dispatch({ type: "setGym", id: workoutId, gymId });
        for (const [position, exercise] of routine.exercises.entries()) {
          const workoutExerciseId = crypto.randomUUID();
          await dispatch({ type: "addExercise", id: workoutExerciseId, workoutId, exerciseId: exercise.exerciseId, position });
          const machineId = lastMachines[exercise.exerciseId] ?? null;
          if (machineId) await dispatch({ type: "setMachine", id: workoutExerciseId, machineId });
          if (exercise.notes) await dispatch({ type: "setExerciseNotes", id: workoutExerciseId, notes: exercise.notes });
          if (exercise.restSeconds !== null) {
            await dispatch({ type: "setRestSeconds", id: workoutExerciseId, seconds: exercise.restSeconds });
          }
          // Routine groups may start at 0 (Hevy); workout groups start at 1.
          if (exercise.supersetGroup !== null) {
            await dispatch({ type: "setSupersetGroup", id: workoutExerciseId, group: exercise.supersetGroup + 1 });
          }
          for (const [setPosition, set] of exercise.sets.entries()) {
            await dispatch({
              type: "putSet",
              id: crypto.randomUUID(),
              workoutExerciseId,
              position: setPosition,
              setType: set.setType,
              weight: set.weight,
              unit: set.unit,
              reps: set.reps,
              rir: null,
              completed: false,
            });
          }
        }
        return workoutId;
      });
    },

    addExercise(exerciseId, machineId = null) {
      return serial(async () => {
        const workout = requireActive();
        const id = crypto.randomUUID();
        await dispatch({
          type: "addExercise",
          id,
          workoutId: workout.id,
          exerciseId,
          position: nextPosition(workout.exercises),
        });
        if (machineId) await dispatch({ type: "setMachine", id, machineId });
        return id;
      });
    },

    createGym(name) {
      return serial(async () => {
        const workout = requireActive();
        const wanted = name.trim().toLowerCase();
        const existing = workout.gyms.find((g) => g.name.trim().toLowerCase() === wanted);
        if (existing) return existing.id;
        const id = crypto.randomUUID();
        await dispatch({ type: "createGym", id, name });
        return id;
      });
    },

    setGym(gymId) {
      return serial(async () => {
        await dispatch({ type: "setGym", id: requireActive().id, gymId });
      });
    },

    createMachine(exerciseId, gymId, name) {
      return serial(async () => {
        const workout = requireActive();
        const wanted = name.trim().toLowerCase();
        const existing = workout.machines.find(
          (m) => m.exerciseId === exerciseId && m.gymId === gymId && m.name.trim().toLowerCase() === wanted,
        );
        if (existing) return existing.id;
        const id = crypto.randomUUID();
        await dispatch({ type: "createMachine", id, exerciseId, gymId, name });
        return id;
      });
    },

    setMachineNotes(machineId, notes) {
      return serial(async () => {
        requireActive();
        await dispatch({ type: "setMachineNotes", id: machineId, notes });
      });
    },

    setMachine(workoutExerciseId, machineId) {
      return serial(async () => {
        findExercise(workoutExerciseId);
        await dispatch({ type: "setMachine", id: workoutExerciseId, machineId });
      });
    },

    removeExercise(workoutExerciseId) {
      return serial(async () => {
        requireActive();
        await dispatch({ type: "removeExercise", id: workoutExerciseId });
      });
    },

    swapExercise(workoutExerciseId, exerciseId, machineId = null, previous = []) {
      return serial(async () => {
        const { sets } = findExercise(workoutExerciseId);
        await dispatch({ type: "swapExercise", id: workoutExerciseId, exerciseId });
        if (machineId) await dispatch({ type: "setMachine", id: workoutExerciseId, machineId });
        for (const [index, set] of sets.entries()) {
          if (set.completed) continue;
          const seed = previous[index] ?? previous.at(-1);
          await dispatch({
            type: "putSet",
            ...set,
            workoutExerciseId,
            weight: seed?.weight ?? null,
            unit: seed?.unit ?? set.unit,
            reps: seed?.reps ?? set.reps,
          });
        }
      });
    },

    reorderExercises(workoutExerciseIds) {
      return serial(async () => {
        const workout = requireActive();
        const planned = planExerciseReorder(workout.exercises, workoutExerciseIds).order;
        if (planned.every((id, index) => id === workout.exercises[index]!.id)) return;
        await dispatch({ type: "reorderExercises", workoutId: workout.id, ids: workoutExerciseIds });
      });
    },

    addSet(workoutExerciseId) {
      return serial(async () => {
        const exercise = requireActive().exercises.find((e) => e.id === workoutExerciseId);
        if (!exercise) throw new Error(`Exercise ${workoutExerciseId} is not in the active workout`);
        const previous = exercise.sets.at(-1);
        const id = crypto.randomUUID();
        await dispatch({
          type: "putSet",
          id,
          workoutExerciseId,
          position: nextPosition(exercise.sets),
          setType: "normal" satisfies SetType,
          weight: previous?.weight ?? null,
          unit: previous?.unit ?? defaultUnit,
          reps: previous?.reps ?? null,
          rir: null,
          completed: false,
      });
      return id;
      });
    },

    updateSet(setId, patch) {
      return serial(async () => {
        const { exercise, set } = findSet(setId);
        await dispatch({ type: "putSet", ...set, ...patch, id: set.id, workoutExerciseId: exercise.id });
        if (patch.completed && !set.completed && restsAfter(exercise.id)) await saveRest(restFor(exercise.id));
      });
    },

    removeSet(setId) {
      return serial(async () => {
        findSet(setId);
        await dispatch({ type: "removeSet", id: setId });
      });
    },

    finish() {
      return serial(async () => {
        const workout = requireActive();
        await dispatch({ type: "finishWorkout", id: workout.id, finishedAt: now().toISOString() });
        await saveRest(null);
      });
    },

    discard() {
      return serial(async () => {
        const workout = active;
        if (!workout) return;
        await dispatch({ type: "discardWorkout", id: workout.id, discardedAt: now().toISOString() });
        await saveRest(null);
      });
    },

    setWorkoutNotes(notes) {
      return serial(async () => {
        await dispatch({ type: "setWorkoutNotes", id: requireActive().id, notes });
      });
    },

    setExerciseNotes(workoutExerciseId, notes) {
      return serial(async () => {
        findExercise(workoutExerciseId);
        await dispatch({ type: "setExerciseNotes", id: workoutExerciseId, notes });
      });
    },

    supersetWithNext(workoutExerciseId) {
      return serial(async () => {
        const exercises = requireActive().exercises;
        const index = exercises.findIndex((e) => e.id === workoutExerciseId);
        const [current, next] = [exercises[index], exercises[index + 1]];
        if (!current || !next) return;
        const group =
          current.supersetGroup ??
          next.supersetGroup ??
          exercises.reduce((max, e) => Math.max(max, e.supersetGroup ?? 0), 0) + 1;
        // Everyone in either exercise's group ends up in `group`.
        const joining = exercises.filter(
          (e) =>
            e.supersetGroup !== group &&
            (e === current || e === next || (next.supersetGroup !== null && e.supersetGroup === next.supersetGroup)),
        );
        await setGroup(joining.map((e) => e.id), group);
      });
    },

    leaveSuperset(workoutExerciseId) {
      return serial(async () => {
        const group = findExercise(workoutExerciseId).supersetGroup;
        if (group === null) return;
        const rest = requireActive().exercises.filter((e) => e.supersetGroup === group && e.id !== workoutExerciseId);
        await setGroup([workoutExerciseId, ...(rest.length === 1 ? [rest[0]!.id] : [])], null);
      });
    },

    setRestSeconds(workoutExerciseId, seconds) {
      return serial(async () => {
        requireActive();
        await dispatch({ type: "setRestSeconds", id: workoutExerciseId, seconds });
      });
    },

    restTimer: () => rest,

    startRest(workoutExerciseId) {
      return serial(() => saveRest(restFor(workoutExerciseId)));
    },

    adjustRest(deltaSeconds) {
      return serial(async () => {
        if (!rest) return;
        const endsAt = Math.max(now().getTime(), Date.parse(rest.endsAt) + deltaSeconds * 1000);
        await saveRest({ ...rest, endsAt: new Date(endsAt).toISOString() });
      });
    },

    skipRest() {
      return serial(() => saveRest(null));
    },

    sync() {
      inFlight ??= syncOnce().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },

    close() {
      listeners.clear();
      db.close();
    },
  };
}
