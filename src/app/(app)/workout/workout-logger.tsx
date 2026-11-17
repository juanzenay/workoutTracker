"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefCallback } from "react";
import { warmOfflineCache } from "@/client/offline-cache";
import { useRestTimerMode } from "@/client/rest-timer-mode";
import { useWorkoutStore, type SyncState } from "@/client/use-workout-store";
import type { WorkoutStore } from "@/client/workout-store";
import { ExerciseImage } from "@/components/exercise-image";
import { CopyFieldButtons, type CopyFieldKey } from "@/components/copy-field-buttons";
import { CopyWorkoutButton } from "@/components/copy-workout-button";
import { ShareCard } from "@/components/share-card";
import { WorkoutSummaryView } from "@/components/workout-summary";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { useArmed } from "@/components/ui/use-armed";
import {
  loggedWeight,
  rankSimilarExercises,
  showsWeight,
  splitSimilarExercises,
  type Equipment,
  type Muscle,
} from "@/domain/exercise";
import {
  historySetsOf,
  livePrs,
  scanRecords,
  summarizeWorkout,
  type BestsByExercise,
  type ExerciseBests,
  type RecordKind,
  type WorkoutSummary,
} from "@/domain/records";
import {
  NO_GYM_KEY,
  type LastMachines,
  type LastMachinesByGym,
  type PreviousByMachine,
  type PreviousSet,
  type PreviousSets,
  type Routine,
} from "@/domain/routine";
import { workoutFields, workoutPlainText } from "@/domain/workout-text";
import {
  isEmptySet,
  restTargetSeconds,
  SET_TYPES,
  type Gym,
  type Machine,
  type SetType,
  type WorkoutExercise,
  type WorkoutSet,
} from "@/domain/workout";
import { getStrings } from "@/strings";
import { useStrings } from "@/strings/provider";
import {
  DiscardWorkoutButton,
  NotesField,
  RestLengthSelect,
  RestTimerBar,
  RirPicker,
  supersetLabels,
} from "./logger-extras";
import { CreateExerciseForm } from "./create-exercise-form";
import { GymPicker } from "./gym-picker";
import { MachinePicker } from "./machine-picker";
import { moveTo } from "./exercise-order";
import { useExerciseReorder, type MoveHandle } from "./use-exercise-reorder";

/** What the logger needs to know about each catalogue exercise (kept small: the whole catalogue ships with the page). */
export interface CatalogueEntry {
  id: string;
  name: string;
  imageUrl: string;
  detail: string;
  equipment: Equipment | null;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
}

/** Each exercise's bests from finished workouts: the baseline PRs are measured against. */
export interface RecordsEntry {
  exerciseId: string;
  bests: ExerciseBests;
}

export function WorkoutLogger({
  catalogue,
  records,
  routines = [],
  previous = {},
  previousByMachine = {},
  lastMachinesByGym = {},
  gyms: serverGyms = [],
  lastGymId = null,
  machines: serverMachines = [],
  startPlanned = null,
}: {
  catalogue: CatalogueEntry[];
  records: RecordsEntry[];
  routines?: Routine[];
  /** exerciseId → its sets from the last finished workout (shown as Previous). */
  previous?: PreviousSets;
  /** machineId → its sets from the last finished workout that used it (Previous for an exercise done on a machine). */
  previousByMachine?: PreviousByMachine;
  /** gymId (NO_GYM_KEY = none) → exerciseId → the machine it was last done on there (null = none); new exercises start on it. */
  lastMachinesByGym?: LastMachinesByGym;
  /** Every gym the server knows; gyms made in this workout are added to them. */
  gyms?: Gym[];
  /** The gym the last finished workout was at; new workouts start there. */
  lastGymId?: string | null;
  /** Every machine the server knows; machines made in this workout are added to them. */
  machines?: Machine[];
  /** Start this planned session (as a routine: its targets) on arrival (from /workout?planned=…), unless a workout is in progress. */
  startPlanned?: Pick<Routine, "name" | "exercises"> | null;
}) {
  const s = useStrings();
  const [restTimerMode] = useRestTimerMode();
  const router = useRouter();
  // Read on the device, not passed from the server, so the cached page starts routines offline too.
  const startRoutineId = useSearchParams().get("routine");
  const { store, unavailable, active, pending, restTimer, syncState } = useWorkoutStore();
  const [finished, setFinished] = useState<{ summary: WorkoutSummary; text: string; fields: Record<CopyFieldKey, string> } | null>(null);
  // Exercises created from the picker this visit: the catalogue shipped with the page predates them.
  const [created, setCreated] = useState<CatalogueEntry[]>([]);
  const entries = useMemo(() => [...catalogue, ...created], [catalogue, created]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  // Updated locally on finish, so a second workout without a reload still compares against the first.
  const [baseline, setBaseline] = useState<BestsByExercise>(
    () => new Map(records.map((r) => [r.exerciseId, r.bests])),
  );
  const prFlags = useMemo(
    () => (active ? livePrs(baseline, active) : new Map<string, RecordKind[]>()),
    [baseline, active],
  );
  const machines = useMemo(() => {
    const known = new Set(serverMachines.map((m) => m.id));
    const all = [...serverMachines, ...(active?.machines ?? []).filter((m) => !known.has(m.id))];
    // Notes edited in this workout win over the ones the page shipped with.
    const edited = active?.machineNotes ?? {};
    return all.map((m) => (m.id in edited ? { ...m, notes: edited[m.id]! } : m));
  }, [serverMachines, active]);
  const gyms = useMemo(() => {
    const known = new Set(serverGyms.map((g) => g.id));
    return [...serverGyms, ...(active?.gyms ?? []).filter((g) => !known.has(g.id))];
  }, [serverGyms, active]);
  const gymId = active?.gymId ?? null;
  // What each exercise starts on at a gym: the machine it was last done on there, if that machine is still the gym's.
  const lastMachinesAt = (atGym: string | null): LastMachines =>
    Object.fromEntries(
      Object.entries(lastMachinesByGym[atGym ?? NO_GYM_KEY] ?? {}).map(([exerciseId, machineId]) => [
        exerciseId,
        machineId !== null && machines.some((m) => m.id === machineId && m.gymId === atGym) ? machineId : null,
      ]),
    );
  const startGymId = lastGymId !== null && gyms.some((g) => g.id === lastGymId) ? lastGymId : null;
  // Sets the workout's gym; the exercises' machines belong to the old gym, so each moves to this gym's default.
  async function changeGym(nextGymId: string | null) {
    if (!store || !active) return;
    await store.setGym(nextGymId);
    const defaults = lastMachinesAt(nextGymId);
    for (const e of store.active()?.exercises ?? []) {
      const machineId = defaults[e.exerciseId] ?? null;
      if (machineId !== e.machineId) await store.setMachine(e.id, machineId);
    }
  }
  const supersets = useMemo(() => supersetLabels(active?.exercises ?? []), [active]);
  const [announcement, setAnnouncement] = useState("");
  // The exercise whose Swap picker is open, if any.
  const [swappingId, setSwappingId] = useState<string | null>(null);
  // Reorder mode swaps the tall cards for one-line rows, so every exercise fits on screen to drag or nudge.
  const [reordering, setReordering] = useState(false);
  // The exercise whose Resort button was tapped: its row is scrolled into view when the rows replace the cards.
  const resortFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = resortFocus.current;
    resortFocus.current = null;
    if (reordering && id) document.getElementById(`reorder-${id}`)?.scrollIntoView({ block: "center" });
  }, [reordering]);
  const exercises = active?.exercises ?? [];
  const applyOrder = (ids: string[], movedId: string) => {
    const moved = exercises.find((e) => e.id === movedId);
    const name = moved ? (byId.get(moved.exerciseId)?.name ?? moved.exerciseId) : "";
    setAnnouncement(s.workout.exerciseMoved(name, ids.indexOf(movedId) + 1, ids.length));
    void store?.reorderExercises(ids);
  };
  const reorder = useExerciseReorder(
    exercises.map((e) => e.id),
    applyOrder,
  );

  // Keep the images of routine exercises and of everything done before on the device for the gym.
  useEffect(() => {
    const ids = new Set([...routines.flatMap((r) => r.exercises.map((e) => e.exerciseId)), ...Object.keys(previous)]);
    warmOfflineCache([...ids].flatMap((id) => byId.get(id)?.imageUrl ?? []));
  }, [routines, previous, byId]);

  const handledStart = useRef(false);
  useEffect(() => {
    if (!store || !(startRoutineId || startPlanned) || handledStart.current) return;
    handledStart.current = true;
    const routine = startPlanned ?? routines.find((r) => r.id === startRoutineId);
    void (routine && !store.active()
      ? store.startFromRoutine(routine, { gymId: startGymId, lastMachines: lastMachinesAt(startGymId) })
      : Promise.resolve()
    ).finally(() => router.replace("/workout"));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once (handledStart); the helpers close over props that don't change then
  }, [store, startRoutineId, startPlanned, routines, router]);

  if (unavailable) return <p className="text-danger">{s.workout.storageUnavailable}</p>;

  if (!store) return <p className="text-muted">{s.workout.loading}</p>;

  if (!active) {
    return (
      <div className="flex flex-col gap-4">
        {finished ? (
          <>
            <p className="text-sm font-medium text-success-text">{s.workout.finishedTitle}</p>
            <SyncStatus state={syncState} pending={pending} />
            <WorkoutSummaryView summary={finished.summary} />
            <CopyWorkoutButton text={finished.text} />
            <CopyFieldButtons fields={finished.fields} />
            <ShareCard summary={finished.summary} />
            <Link
              href="/workouts"
              className="flex min-h-touch items-center justify-center rounded-control bg-surface-raised px-4 font-medium"
            >
              {s.workout.viewHistory}
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">{s.workout.title}</h1>
            <p className="text-muted">{s.workout.noWorkout}</p>
            {pending > 0 && <SyncStatus state={syncState} pending={pending} />}
          </>
        )}
        <Button
          className="min-h-touch-lg"
          onClick={() => {
            setFinished(null);
            void store.start({ gymId: startGymId });
          }}
        >
          {finished ? s.workout.startAnother : s.workout.startEmpty}
        </Button>
        {routines.length > 0 && (
          <section aria-labelledby="start-routine" className="flex flex-col gap-2">
            <h2 id="start-routine" className="font-semibold">
              {s.workout.startRoutine}
            </h2>
            {routines.map((routine) => (
              <Button
                key={routine.id}
                variant="secondary"
                className="min-h-touch-lg text-left"
                onClick={() => {
                  setFinished(null);
                  void store.startFromRoutine(routine, { gymId: startGymId, lastMachines: lastMachinesAt(startGymId) });
                }}
              >
                {routine.name}
              </Button>
            ))}
          </section>
        )}
      </div>
    );
  }

  const swappingExercise = active.exercises.find((e) => e.id === swappingId);
  const swappingEntry = swappingExercise && byId.get(swappingExercise.exerciseId);

  return (
    <div className="flex flex-col gap-4 pb-24">
      {/* Sticky so Finish and the clock stay in reach however long the workout gets. */}
      <div className="sticky top-[env(safe-area-inset-top)] z-[6] -mx-4 -mt-4 flex items-center justify-between gap-3 border-b border-border bg-bg px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold" title={active.name ?? undefined}>
            {active.name ?? s.workout.untitled}
          </h1>
          <Elapsed since={active.startedAt} />
        </div>
        <div className="flex shrink-0 items-center justify-end">
          {(active.exercises.length > 1 || reordering) && (
            <Button
              variant={reordering ? "secondary" : "outline"}
              className="mr-2 shrink-0"
              aria-pressed={reordering}
              onClick={() => setReordering((on) => !on)}
            >
              {reordering ? s.workout.reorderDone : s.workout.reorder}
            </Button>
          )}
          <Button
            className="shrink-0"
            onClick={async () => {
              const workout = active;
              await store.finish();
              // Summarised on the device, so the share card works even when the finish happened offline.
              const sets = historySetsOf(workout);
              const { bests, events } = scanRecords(sets, baseline);
              const names = new Map(entries.map((e) => [e.id, e.name]));
              const finishedAt = new Date().toISOString();
              const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
              const paste = { ...workout, finishedAt };
              // The standard pack, not the skin's: Dumb Mode keeps the paste-ready text as it is.
              const text = workoutPlainText(paste, names, getStrings(), timeZone);
              setFinished({
                summary: summarizeWorkout(paste, sets, events, names),
                text,
                fields: { ...workoutFields(paste, getStrings(), timeZone), description: text },
              });
              setBaseline(bests);
            }}
          >
            {s.workout.finish}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <GymPicker store={store} gyms={gyms} gymId={gymId} onPick={changeGym} />
        <div className="ml-auto">
          <DiscardWorkoutButton store={store} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SyncStatus state={syncState} pending={pending} />
        <NotesField
          label={s.loggerExtras.workoutNotes}
          chip={s.loggerExtras.workoutNote}
          value={active.notes}
          onSave={(notes) => void store.setWorkoutNotes(notes)}
          className="basis-full"
        />
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {reordering && (
        <ul className="flex flex-col gap-2">
          {active.exercises.map((exercise, index) => (
            <ReorderRow
              key={exercise.id}
              id={`reorder-${exercise.id}`}
              name={byId.get(exercise.exerciseId)?.name ?? exercise.exerciseId}
              superset={exercise.supersetGroup === null ? null : supersets.get(exercise.supersetGroup)!}
              handle={reorder.handleFor(exercise.id)}
              cardRef={reorder.cardRef(exercise.id)}
              dragOffset={reorder.dragging?.id === exercise.id ? reorder.dragging.dy : null}
              canMoveUp={index > 0}
              canMoveDown={index < active.exercises.length - 1}
              onNudge={(step) => {
                const ids = active.exercises.map((e) => e.id);
                applyOrder(moveTo(ids, exercise.id, index + step), exercise.id);
              }}
            />
          ))}
        </ul>
      )}
      {!reordering && active.exercises.map((exercise, index) => (
        <ExerciseCard
          key={exercise.id}
          store={store}
          exercise={exercise}
          entry={byId.get(exercise.exerciseId)}
          prFlags={prFlags}
          previous={
            (exercise.machineId ? previousByMachine[exercise.machineId] : previous[exercise.exerciseId]) ?? []
          }
          machines={machines}
          gyms={gyms}
          gymId={gymId}
          onGymChange={changeGym}
          superset={exercise.supersetGroup === null ? null : supersets.get(exercise.supersetGroup)!}
          hasNext={index < active.exercises.length - 1}
          onSwap={() => setSwappingId(exercise.id)}
          onResort={() => {
            resortFocus.current = exercise.id;
            setReordering(true);
          }}
        />
      ))}

      <ExercisePicker
        catalogue={entries}
        onPick={(id) => void store.addExercise(id, lastMachinesAt(gymId)[id] ?? null)}
        onCreated={(exercise) => {
          setCreated((all) => [...all, exercise]);
          void store.addExercise(exercise.id, null);
        }}
      />
      {swappingId && (
        <ExercisePickerDialog
          catalogue={entries}
          similarTo={swappingEntry}
          title={s.workout.swapPickerTitle}
          onPick={(exerciseId) => {
            const machineId = lastMachinesAt(gymId)[exerciseId] ?? null;
            const lastSets = (machineId ? previousByMachine[machineId] : previous[exerciseId]) ?? [];
            void store.swapExercise(swappingId, exerciseId, machineId, lastSets);
            setSwappingId(null);
          }}
          onClose={() => setSwappingId(null)}
        />
      )}
      <RestTimerBar
        store={store}
        timer={restTimer}
        targetSeconds={restTargetSeconds(active.exercises, restTimer)}
        countUp={restTimerMode === "up"}
      />
    </div>
  );
}

function SyncStatus({ state, pending }: { state: SyncState; pending: number }) {
  const s = useStrings();
  const text =
    state === "synced"
      ? s.workout.sync.synced
      : state === "syncing"
        ? s.workout.sync.syncing
        : state === "offline"
          ? s.workout.sync.offline(pending)
          : s.workout.sync.failed(pending);
  return (
    <p role="status" className={`text-sm ${state === "synced" ? "text-success-text" : "text-muted"}`}>
      {text}
    </p>
  );
}

function Elapsed({ since }: { since: string }) {
  const s = useStrings();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  const hh = Math.floor(seconds / 3600);
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(hh ? 2 : 1, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <p className="font-numeric text-sm text-muted">
      <span className="sr-only">{s.workout.elapsed} </span>
      {hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`}
    </p>
  );
}

function ExerciseCard({
  store,
  exercise,
  entry,
  prFlags,
  previous,
  machines,
  gyms,
  gymId,
  onGymChange,
  superset,
  hasNext,
  onSwap,
  onResort,
}: {
  store: WorkoutStore;
  exercise: WorkoutExercise;
  entry: CatalogueEntry | undefined;
  prFlags: Map<string, RecordKind[]>;
  previous: PreviousSet[];
  /** Every known machine, for the picker. */
  machines: Machine[];
  /** Every known gym, and the one the workout is at. */
  gyms: Gym[];
  gymId: string | null;
  /** Sets the workout's gym, moving the exercises' machines with it. */
  onGymChange: (gymId: string | null) => Promise<void>;
  /** Superset letter (A, B…) when the exercise is in one. */
  superset: string | null;
  hasNext: boolean;
  /** Switches the workout to reorder mode, with this exercise in view. */
  onResort: () => void;
  /** Opens the picker to swap this exercise for another. */
  onSwap: () => void;
}) {
  const s = useStrings();
  // Removing an exercise drops its logged sets too, so that takes a second tap.
  const [removeArmed, armRemove] = useArmed();
  const lastSet = exercise.sets.at(-1);
  const headingId = `exercise-${exercise.id}`;
  const equipment = entry?.equipment ?? null;
  const [addedWeight, setAddedWeight] = useState(false);
  const hasWeightedSet = exercise.sets.some((set) => set.weight !== null) || previous.some((set) => set.weight !== null);
  const weightShown = showsWeight(equipment, addedWeight, hasWeightedSet);
  const bodyOnly = !weightShown;
  // Hevy-style badges: normal sets are numbered, other types show a letter.
  const badges: string[] = [];
  let normalCount = 0;
  for (const set of exercise.sets) {
    if (set.setType === "normal") normalCount += 1;
    badges.push(set.setType === "normal" ? String(normalCount) : s.setTypeBadges[set.setType]);
  }

  return (
    <section
      aria-labelledby={headingId}
      className={`relative flex flex-col gap-2 rounded-card bg-surface p-3 ${superset ? "border-l-4 border-accent" : ""}`}
    >
      {superset && (
        <p className="text-xs font-semibold uppercase text-accent-text">{s.loggerExtras.superset(superset)}</p>
      )}
      <div className="flex items-center gap-3">
        <Button variant="outline" className="min-h-touch shrink-0 px-3 text-sm" onClick={onResort}>
          {s.workout.reorder}
        </Button>
        {entry && <ExerciseImage src={entry.imageUrl} alt="" className="w-12 shrink-0" />}
        <h2 id={headingId} className="min-w-0 flex-1 text-lg leading-snug font-semibold text-pretty text-accent-text">
          {entry?.name ?? exercise.exerciseId}
        </h2>
        <Button variant="ghost" className="shrink-0 px-2 text-sm" onClick={onSwap}>
          {s.workout.swap}
        </Button>
        <button
          type="button"
          aria-label={removeArmed ? `${s.workout.removeExercise}: ${s.common.confirmDelete}` : s.workout.removeExercise}
          onClick={() => {
            if (exercise.sets.length > 0 && !removeArmed) armRemove();
            else void store.removeExercise(exercise.id);
          }}
          className={`min-h-touch min-w-touch shrink-0 rounded-control ${removeArmed ? "bg-danger px-3 text-sm font-medium text-bg" : "text-muted"}`}
        >
          {removeArmed ? s.common.confirmDelete : "✕"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <RestLengthSelect store={store} exercise={exercise} />
        <MachinePicker
          store={store}
          exercise={exercise}
          machines={machines}
          gyms={gyms}
          gymId={gymId}
          onGymChange={onGymChange}
        />
        {bodyOnly && (
          <Button variant="outline" className="text-sm" onClick={() => setAddedWeight(true)}>
            + {s.workout.addWeight}
          </Button>
        )}
        {superset ? (
          <Button variant="outline" className="text-sm" onClick={() => void store.leaveSuperset(exercise.id)}>
            {s.loggerExtras.leaveSuperset}
          </Button>
        ) : (
          hasNext && (
            <Button variant="outline" className="text-sm" onClick={() => void store.supersetWithNext(exercise.id)}>
              {s.loggerExtras.supersetWithNext}
            </Button>
          )
        )}
        <NotesField
          label={s.loggerExtras.exerciseNotes}
          chip={s.loggerExtras.exerciseNote}
          value={exercise.notes}
          onSave={(notes) => void store.setExerciseNotes(exercise.id, notes)}
          className="basis-full"
        />
      </div>

      {exercise.sets.length > 0 && (
        <div
          className={`grid ${bodyOnly ? BODY_ONLY_SET_ROW_COLUMNS : SET_ROW_COLUMNS} items-center gap-1 px-1 text-xs uppercase text-muted`}
        >
          <span className="text-center">{s.workout.setColumn}</span>
          <span className="text-center">{s.workout.previousColumn}</span>
          {!bodyOnly && <span className="text-center">{s.workout.weightColumn}</span>}
          <span className="text-center">{s.workout.repsColumn}</span>
          <span className="text-center">✓</span>
        </div>
      )}

      {exercise.sets.map((set, index) => (
        <SetRow
          key={set.id}
          store={store}
          set={set}
          index={index + 1}
          badge={badges[index]!}
          prKinds={prFlags.get(set.id)}
          previous={previous[index]}
          weightShown={weightShown}
        />
      ))}
      {lastSet && <RirPicker store={store} set={lastSet} />}

      <Button variant="secondary" onClick={() => void store.addSet(exercise.id)}>
        + {s.workout.addSet}
      </Button>
    </section>
  );
}

/** One exercise as a single short row in reorder mode: drag the handle, or tap the arrows. */
function ReorderRow({
  id,
  name,
  superset,
  handle,
  cardRef,
  dragOffset,
  canMoveUp,
  canMoveDown,
  onNudge,
}: {
  id: string;
  name: string;
  superset: string | null;
  handle: MoveHandle;
  cardRef: RefCallback<HTMLElement>;
  dragOffset: number | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Moves the exercise one place up (-1) or down (1). */
  onNudge: (step: -1 | 1) => void;
}) {
  const s = useStrings();
  return (
    <li
      id={id}
      ref={cardRef}
      style={dragOffset === null ? undefined : { transform: `translateY(${dragOffset}px)` }}
      className={`relative flex items-center gap-2 rounded-card bg-surface p-2 ${superset ? "border-l-4 border-accent" : ""} ${dragOffset === null ? "" : "z-[5] opacity-90"}`}
    >
      <button
        type="button"
        data-move-handle
        aria-label={s.workout.moveExercise}
        {...handle}
        className="flex min-h-touch min-w-touch shrink-0 cursor-grab touch-none select-none items-center justify-center rounded-control text-muted"
      >
        <span aria-hidden>⋮⋮</span>
      </button>
      <span className="min-w-0 flex-1 font-semibold text-pretty">
        {name}
        {superset && <span className="ml-2 text-xs uppercase text-accent-text">{s.loggerExtras.superset(superset)}</span>}
      </span>
      <button
        type="button"
        aria-label={s.workout.moveUp}
        disabled={!canMoveUp}
        onClick={() => onNudge(-1)}
        className="min-h-touch min-w-touch shrink-0 rounded-control text-muted disabled:opacity-30"
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={s.workout.moveDown}
        disabled={!canMoveDown}
        onClick={() => onNudge(1)}
        className="min-h-touch min-w-touch shrink-0 rounded-control text-muted disabled:opacity-30"
      >
        ↓
      </button>
    </li>
  );
}

function parseWeight(text: string): number | null {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() === "" || !Number.isFinite(value) || value < 0 ? null : value;
}

function parseReps(text: string): number | null {
  const value = Number.parseInt(text.trim(), 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const show = (value: number | null) => (value === null ? "" : String(value));

// Shared by the column headings and every set row so they line up. Weight gets the widest share:
// it is the value most likely to have 3+ digits or a decimal, and it also carries the lb/kg toggle.
const SET_ROW_COLUMNS = "grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(0,2.2fr)_minmax(0,1fr)_2.75rem]";
// Body-only exercises have no weight column, so Previous and reps take the space it would have had.
const BODY_ONLY_SET_ROW_COLUMNS = "grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(0,1.5fr)_2.75rem]";
// An empty set slides this far left to show its remove control, which sits in the space it leaves.
const SWIPE_REVEAL_PX = 56;
// Pointer travel before a press on an empty set becomes a swipe, so a tap never moves the row.
const SWIPE_THRESHOLD_PX = 6;

interface Press {
  pointerId: number;
  startX: number;
  startOffset: number;
  engaged: boolean;
}

function SetRow({
  store,
  set,
  index,
  badge,
  prKinds,
  previous,
  weightShown,
}: {
  store: WorkoutStore;
  set: WorkoutSet;
  index: number;
  badge: string;
  /** Records this set beat, if it is a PR. */
  prKinds?: RecordKind[];
  /** The same set position last time, if there was one. */
  previous: PreviousSet | undefined;
  /** Whether the exercise's weight input is shown (see `showsWeight`). */
  weightShown: boolean;
}) {
  const s = useStrings();
  const bodyOnly = !weightShown;
  // Drafts hold what is being typed ("182." mid-entry); null shows the stored value.
  // They are committed on blur and on ✓.
  const [weightDraft, setWeightDraft] = useState<string | null>(null);
  const [repsDraft, setRepsDraft] = useState<string | null>(null);
  const weight = weightDraft ?? show(set.weight);
  const reps = repsDraft ?? show(set.reps);

  const commit = (patch: Partial<WorkoutSet> = {}) => {
    const next = { weight: loggedWeight(weightShown, parseWeight(weight)), reps: parseReps(reps), ...patch };
    const changed = (Object.keys(next) as (keyof typeof next)[]).some((key) => next[key] !== set[key]);
    const write = changed ? store.updateSet(set.id, next) : Promise.resolve();
    // Drop only the drafts this commit saved; the owner may already be typing in the other field.
    void write.finally(() => {
      setWeightDraft((d) => (d === weightDraft ? null : d));
      setRepsDraft((d) => (d === repsDraft ? null : d));
    });
  };

  // An empty set or a completed one can be swiped away; a started but unfinished one stays put.
  const swipeable = set.completed || isEmptySet(set);
  const [removeArmed, armRemove] = useArmed();
  const [offset, setOffset] = useState(0);
  const press = useRef<Press | null>(null);
  const shift = swipeable ? offset : 0;
  const revealed = shift < 0;

  // Presses on the row's own controls never start a swipe, so editing and the set type are unaffected.
  // A press on a control (or a tap on the row) while the remove control is out closes it again.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const control = (e.target as Element).closest("input, select, textarea, button");
    if (control && e.currentTarget.contains(control)) {
      setOffset(0);
      return;
    }
    if (!swipeable) return;
    // Captured now, not once the swipe engages: the first few pixels can already take the pointer off the row.
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { pointerId: e.pointerId, startX: e.clientX, startOffset: offset, engaged: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const active = press.current;
    if (!active || active.pointerId !== e.pointerId) return;
    const dx = e.clientX - active.startX;
    if (!active.engaged) {
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
      active.engaged = true;
    }
    setOffset(Math.min(0, Math.max(-SWIPE_REVEAL_PX, active.startOffset + dx)));
  };

  // Let go past halfway and the control stays out; otherwise the row springs back.
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const active = press.current;
    if (!active || active.pointerId !== e.pointerId) return;
    press.current = null;
    if (!active.engaged) {
      setOffset(0);
      return;
    }
    const finalOffset = active.startOffset + (e.clientX - active.startX);
    setOffset(finalOffset < -SWIPE_REVEAL_PX / 2 ? -SWIPE_REVEAL_PX : 0);
  };

  const onPointerCancel = () => {
    press.current = null;
    setOffset(0);
  };

  const done = set.completed;
  // px-1! because TextInput's own px-3 would otherwise win and eat the width the value needs.
  const cell = "min-h-touch-lg px-1! text-center font-numeric text-lg";

  return (
    <div className="relative">
      {revealed && (
        <button
          type="button"
          aria-label={removeArmed ? `${s.workout.removeSet}: ${s.workout.confirmRemoveSet}` : s.workout.removeSet}
          onClick={() => {
            // A completed set holds logged work, so it takes a second tap; an empty set goes at once.
            if (set.completed && !removeArmed) armRemove();
            else void store.removeSet(set.id);
          }}
          style={{ width: SWIPE_REVEAL_PX }}
          className="absolute inset-y-0 right-0 flex items-center justify-center rounded-control bg-danger font-medium text-bg"
        >
          {removeArmed ? s.workout.confirmRemoveSet : "✕"}
        </button>
      )}
      <div
        role="group"
        aria-label={s.workout.set(index)}
        style={shift === 0 ? undefined : { transform: `translateX(${shift}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={`relative grid ${bodyOnly ? BODY_ONLY_SET_ROW_COLUMNS : SET_ROW_COLUMNS} touch-pan-y items-center gap-1 rounded-control p-1 ${done ? "bg-success/15" : ""}`}
      >
        {prKinds && (
          <span
            role="img"
            aria-label={s.records.prLabel(prKinds.map((k) => s.records.kinds[k]))}
            className="pointer-events-none absolute -top-1 right-0 rounded-control bg-accent px-1.5 text-xs font-bold text-accent-fg"
          >
            {s.records.prBadge}
          </span>
        )}
        <label className="relative flex min-h-touch-lg items-center justify-center rounded-control bg-surface-raised font-semibold">
          <span
            aria-hidden
            className={set.setType === "warmup" ? "text-accent-text" : set.setType === "normal" ? "" : "text-danger"}
          >
            {badge}
          </span>
          <select
            aria-label={s.workout.setType}
            value={set.setType}
            onChange={(e) => commit({ setType: e.target.value as SetType })}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {SET_TYPES.map((t) => (
              <option key={t} value={t}>
                {s.setTypes[t]}
              </option>
            ))}
          </select>
        </label>

        <PreviousCell previous={previous} bodyOnly={bodyOnly} />

        {!bodyOnly && (
          <div className="flex items-center gap-1">
            <TextInput
              inputMode="decimal"
              aria-label={s.workout.weight(set.unit)}
              value={weight}
              onChange={(e) => setWeightDraft(e.target.value)}
              onBlur={() => commit()}
              className={cell}
            />
            <button
              type="button"
              aria-label={s.workout.unitToggle(set.unit)}
              onClick={() => commit({ unit: set.unit === "lb" ? "kg" : "lb" })}
              className="min-h-touch w-6 shrink-0 text-xs text-muted"
            >
              {set.unit}
            </button>
          </div>
        )}

        <TextInput
          inputMode="numeric"
          aria-label={s.workout.reps}
          value={reps}
          onChange={(e) => setRepsDraft(e.target.value)}
          onBlur={() => commit()}
          className={cell}
        />

        <button
          type="button"
          aria-label={s.workout.complete}
          aria-pressed={done}
          onClick={() => commit({ completed: !done })}
          className={`min-h-touch-lg rounded-control text-2xl font-bold ${done ? "bg-success text-accent-fg" : "bg-surface-raised text-muted"}`}
        >
          ✓
        </button>
      </div>
    </div>
  );
}

function PreviousCell({ previous, bodyOnly }: { previous: PreviousSet | undefined; bodyOnly: boolean }) {
  const s = useStrings();
  if (!previous) {
    return (
      <span className="text-center text-muted" aria-label={s.workout.noPrevious}>
        —
      </span>
    );
  }
  const reps = previous.reps === null ? "—" : String(previous.reps);
  // Body-only exercises show reps alone: there is no weight to compare.
  const weight = previous.weight === null ? s.history.bodyweight : `${previous.weight}`;
  const text = bodyOnly ? reps : s.history.setLine(weight, reps);
  const label = s.workout.previous(bodyOnly || previous.weight === null ? text : `${text} ${previous.unit}`);
  return (
    <span className="truncate text-center font-numeric text-sm text-muted" aria-label={label}>
      {text}
    </span>
  );
}

export function ExercisePicker({
  catalogue,
  onPick,
  onCreated,
}: {
  catalogue: CatalogueEntry[];
  onPick: (exerciseId: string) => void;
  /** Given, the picker offers to create an exercise when nothing matches. */
  onCreated?: (exercise: CatalogueEntry) => void;
}) {
  const s = useStrings();
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" className="min-h-touch-lg" onClick={() => setOpen(true)}>
        + {s.workout.addExercise}
      </Button>
    );
  }

  return (
    <ExercisePickerDialog
      catalogue={catalogue}
      title={s.workout.pickerTitle}
      onPick={(exerciseId) => {
        onPick(exerciseId);
        setOpen(false);
      }}
      onCreated={onCreated}
      onClose={() => setOpen(false)}
    />
  );
}

/** The searchable exercise list, used to add an exercise and to swap one. The caller decides what a pick does. */
function ExercisePickerDialog({
  catalogue,
  similarTo,
  title,
  onPick,
  onCreated,
  onClose,
}: {
  catalogue: CatalogueEntry[];
  /** Given, the catalogue is ranked by similarity to this exercise, which is left out. */
  similarTo?: CatalogueEntry;
  title: string;
  onPick: (exerciseId: string) => void;
  /** Given, the dialog offers to create an exercise when nothing matches. */
  onCreated?: (exercise: CatalogueEntry) => void;
  onClose: () => void;
}) {
  const s = useStrings();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const typed = query.trim();

  const sections = useMemo<{ heading?: string; matches: CatalogueEntry[] }[]>(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matching = (list: CatalogueEntry[]) => list.filter((e) => words.every((w) => e.name.toLowerCase().includes(w)));
    // The empty-search swap list is split into headed groups, which must hold every exercise, so it is never capped.
    if (similarTo && words.length === 0) {
      const { similar, rest } = splitSimilarExercises(similarTo, catalogue);
      return [
        { heading: s.workout.swapSimilarHeading, matches: similar },
        { heading: s.workout.swapAllHeading, matches: rest },
      ];
    }
    const flat = similarTo ? rankSimilarExercises(similarTo, catalogue) : catalogue;
    return [{ matches: matching(flat).slice(0, 50) }];
  }, [catalogue, similarTo, query, s]);
  const groups = sections.filter((group) => group.matches.length > 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-10 flex flex-col gap-3 overflow-y-auto bg-bg px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{title}</h2>
        <Button variant="ghost" onClick={onClose}>
          {s.workout.closePicker}
        </Button>
      </div>
      {creating ? (
        <>
          <Button variant="ghost" className="self-start" onClick={() => setCreating(false)}>
            {s.workout.backToSearch}
          </Button>
          <CreateExerciseForm
            name={typed}
            onCreated={(exercise) => {
              onCreated?.(exercise);
              onClose();
            }}
          />
        </>
      ) : (
        <>
          <TextInput
            type="search"
            autoFocus
            aria-label={s.workout.pickerSearch}
            placeholder={s.workout.pickerPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <p className="text-muted">{s.workout.pickerEmpty}</p>
              {typed && onCreated && (
                <Button variant="secondary" className="min-h-touch-lg" onClick={() => setCreating(true)}>
                  {s.workout.createExercise(typed)}
                </Button>
              )}
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.heading ?? ""} className="flex flex-col gap-1">
                {group.heading && <h3 className="text-sm font-semibold text-muted">{group.heading}</h3>}
                <ul className="flex flex-col divide-y divide-border">
                  {group.matches.map((exercise) => (
                    <li key={exercise.id}>
                      <button
                        type="button"
                        aria-label={exercise.name}
                        onClick={() => onPick(exercise.id)}
                        className="flex min-h-touch-lg w-full items-center gap-3 py-2 text-left"
                      >
                        <ExerciseImage src={exercise.imageUrl} alt="" className="w-16 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{exercise.name}</span>
                          <span className="block truncate text-sm text-muted">{exercise.detail}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </div>
  );
}
