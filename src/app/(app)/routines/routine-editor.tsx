"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ExerciseImage } from "@/components/exercise-image";
import { Button, linkButtonClass } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { isBodyOnly } from "@/domain/exercise";
import { formatRepTarget, type Routine, type RoutineFolder } from "@/domain/routine";
import { SET_TYPES, type SetType } from "@/domain/workout";
import { useStrings } from "@/strings/provider";
import { ExercisePicker, type CatalogueEntry } from "../workout/workout-logger";
import { saveRoutine } from "./actions";
import { type DraftExercise, type DraftSet, toPayload } from "./routine-payload";

const key = () => crypto.randomUUID();

// Shared by the column headings and every set row so they line up.
const SET_ROW_COLUMNS = "grid-cols-[5.5rem_1fr_1fr_2.75rem]";
// Body-only exercises have no weight column, so reps takes the space it would have had.
const BODY_ONLY_SET_ROW_COLUMNS = "grid-cols-[5.5rem_1fr_2.75rem]";

function toDraft(routine: Routine | null): DraftExercise[] {
  return (routine?.exercises ?? []).map((e) => ({
    key: key(),
    exerciseId: e.exerciseId,
    restSeconds: e.restSeconds === null ? "" : String(e.restSeconds),
    supersetGroup: e.supersetGroup,
    notes: e.notes ?? "",
    // A saved weight already shows the input, so it is "added" from the start.
    addedWeight: e.sets.some((s) => s.weight !== null),
    sets: e.sets.map((s) => ({
      key: key(),
      setType: s.setType,
      weight: s.weight === null ? "" : String(s.weight),
      unit: s.unit,
      reps: formatRepTarget(s),
    })),
  }));
}

export function RoutineEditor({
  routine,
  folders,
  catalogue,
  defaultFolderId = null,
}: {
  routine: Routine | null;
  folders: RoutineFolder[];
  catalogue: CatalogueEntry[];
  defaultFolderId?: string | null;
}) {
  const s = useStrings();
  // Exercises created from the picker this visit: the catalogue shipped with the page predates them.
  const [created, setCreated] = useState<CatalogueEntry[]>([]);
  const entries = useMemo(() => [...catalogue, ...created], [catalogue, created]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const [name, setName] = useState(routine?.name ?? "");
  const [folderId, setFolderId] = useState(routine?.folderId ?? defaultFolderId ?? "");
  const [notes, setNotes] = useState(routine?.notes ?? "");
  const [exercises, setExercises] = useState(() => toDraft(routine));
  const [error, setError] = useState(false);
  const [saving, startSaving] = useTransition();

  const updateExercise = (k: string, fn: (e: DraftExercise) => DraftExercise) =>
    setExercises((all) => all.map((e) => (e.key === k ? fn(e) : e)));
  const updateSet = (ek: string, sk: string, patch: Partial<DraftSet>) =>
    updateExercise(ek, (e) => ({ ...e, sets: e.sets.map((x) => (x.key === sk ? { ...x, ...patch } : x)) }));
  const addExercise = (exerciseId: string) =>
    setExercises((all) => [
      ...all,
      {
        key: key(),
        exerciseId,
        restSeconds: "",
        supersetGroup: null,
        notes: "",
        addedWeight: false,
        sets: [{ key: key(), setType: "normal", weight: "", unit: "lb", reps: "" }],
      },
    ]);
  const moveExercise = (index: number, by: -1 | 1) =>
    setExercises((all) => {
      const to = index + by;
      if (to < 0 || to >= all.length) return all;
      const next = [...all];
      [next[index], next[to]] = [next[to]!, next[index]!];
      return next;
    });

  const submit = () => {
    const payload = toPayload(name, folderId, notes, exercises, (id) => byId.get(id)?.equipment ?? null);
    if (!payload) {
      setError(true);
      return;
    }
    startSaving(async () => {
      const result = await saveRoutine(routine?.id ?? null, payload);
      setError(result?.error === "invalid");
    });
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <h1 className="text-2xl font-semibold">{routine ? s.routines.editorEditTitle : s.routines.editorNewTitle}</h1>
      <Field label={s.routines.name}>
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={s.routines.namePlaceholder}
          maxLength={120}
        />
      </Field>
      <Field label={s.routines.folder}>
        <Select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
          <option value="">{s.routines.unfiled}</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={s.routines.notes}>
        <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {exercises.map((exercise, index) => {
        const entry = byId.get(exercise.exerciseId);
        // Driven by the draft flag, not the typed text, so the input does not unmount while it is being cleared.
        const bodyOnly = isBodyOnly(entry?.equipment ?? null) && !exercise.addedWeight;
        const headingId = `routine-exercise-${exercise.key}`;
        return (
          <section
            key={exercise.key}
            aria-labelledby={headingId}
            className="flex flex-col gap-2 rounded-card bg-surface p-3"
          >
            <div className="flex items-center gap-2">
              {entry && <ExerciseImage src={entry.imageUrl} alt="" className="w-12 shrink-0" />}
              <h2 id={headingId} className="line-clamp-2 min-w-0 flex-1 leading-snug font-semibold text-accent-text">
                {entry?.name ?? exercise.exerciseId}
              </h2>
              <button
                type="button"
                aria-label={s.routines.moveUp(entry?.name ?? "")}
                disabled={index === 0}
                onClick={() => moveExercise(index, -1)}
                className="min-h-touch min-w-touch text-muted disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={s.routines.moveDown(entry?.name ?? "")}
                disabled={index === exercises.length - 1}
                onClick={() => moveExercise(index, 1)}
                className="min-h-touch min-w-touch text-muted disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={s.workout.removeExercise}
                onClick={() => setExercises((all) => all.filter((e) => e.key !== exercise.key))}
                className="min-h-touch min-w-touch text-muted"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label={s.routines.restSeconds}>
                <TextInput
                  inputMode="numeric"
                  value={exercise.restSeconds}
                  onChange={(e) => updateExercise(exercise.key, (x) => ({ ...x, restSeconds: e.target.value }))}
                />
              </Field>
              <Field label={s.routines.exerciseNotes}>
                <TextInput
                  value={exercise.notes}
                  onChange={(e) => updateExercise(exercise.key, (x) => ({ ...x, notes: e.target.value }))}
                />
              </Field>
            </div>

            <div
              className={`grid ${bodyOnly ? BODY_ONLY_SET_ROW_COLUMNS : SET_ROW_COLUMNS} items-center gap-2 px-1 text-xs uppercase text-muted`}
            >
              <span>{s.workout.setColumn}</span>
              {!bodyOnly && <span className="text-center">{s.workout.weightColumn}</span>}
              <span className="text-center">{s.workout.repsColumn}</span>
              <span />
            </div>
            {exercise.sets.map((set, setIndex) => (
              <div
                key={set.key}
                role="group"
                aria-label={s.workout.set(setIndex + 1)}
                className={`grid ${bodyOnly ? BODY_ONLY_SET_ROW_COLUMNS : SET_ROW_COLUMNS} items-center gap-2`}
              >
                <Select
                  aria-label={s.workout.setType}
                  value={set.setType}
                  onChange={(e) => updateSet(exercise.key, set.key, { setType: e.target.value as SetType })}
                  className="px-1 text-sm"
                >
                  {SET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {s.setTypes[t]}
                    </option>
                  ))}
                </Select>
                {!bodyOnly && (
                  <div className="flex items-center gap-1">
                    <TextInput
                      inputMode="decimal"
                      aria-label={s.workout.weight(set.unit)}
                      value={set.weight}
                      onChange={(e) => updateSet(exercise.key, set.key, { weight: e.target.value })}
                      className="px-1 text-center font-numeric"
                    />
                    <button
                      type="button"
                      aria-label={s.workout.unitToggle(set.unit)}
                      onClick={() => updateSet(exercise.key, set.key, { unit: set.unit === "lb" ? "kg" : "lb" })}
                      className="min-h-touch px-1 text-xs text-muted"
                    >
                      {set.unit}
                    </button>
                  </div>
                )}
                <TextInput
                  aria-label={s.workout.reps}
                  placeholder="10–15"
                  value={set.reps}
                  onChange={(e) => updateSet(exercise.key, set.key, { reps: e.target.value })}
                  className="px-1 text-center font-numeric"
                />
                <button
                  type="button"
                  aria-label={s.workout.removeSet}
                  onClick={() =>
                    updateExercise(exercise.key, (x) => ({ ...x, sets: x.sets.filter((y) => y.key !== set.key) }))
                  }
                  className="min-h-touch text-muted"
                >
                  ✕
                </button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                updateExercise(exercise.key, (x) => {
                  const last = x.sets.at(-1);
                  const set: DraftSet = last
                    ? { ...last, key: key(), setType: "normal" }
                    : { key: key(), setType: "normal", weight: "", unit: "lb", reps: "" };
                  return { ...x, sets: [...x.sets, set] };
                })
              }
            >
              + {s.workout.addSet}
            </Button>
            {bodyOnly && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => updateExercise(exercise.key, (x) => ({ ...x, addedWeight: true }))}
              >
                + {s.workout.addWeight}
              </Button>
            )}
          </section>
        );
      })}

      <ExercisePicker
        catalogue={entries}
        onPick={addExercise}
        onCreated={(exercise) => {
          setCreated((all) => [...all, exercise]);
          addExercise(exercise.id);
        }}
      />

      {error && (
        <p role="alert" className="text-danger">
          {s.routines.invalid}
        </p>
      )}
      <div className="flex gap-2">
        <Button className="min-h-touch-lg flex-1" disabled={saving} onClick={submit}>
          {s.routines.save}
        </Button>
        <Link href="/routines" className={linkButtonClass("ghost", "min-h-touch-lg")}>
          {s.routines.cancel}
        </Link>
      </div>
    </div>
  );
}
