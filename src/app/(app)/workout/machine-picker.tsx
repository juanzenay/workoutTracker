"use client";

import { useState } from "react";
import type { WorkoutStore } from "@/client/workout-store";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { gymIdFor, NEW_GYM } from "./gym-picker";
import { NotesField } from "./logger-extras";
import { machineNameTaken, type Gym, type Machine, type WorkoutExercise } from "@/domain/workout";
import { useStrings } from "@/strings/provider";

const NEW = "__new__";

/**
 * The machine an exercise is done on: none, one of the exercise's machines, or a new one made on the spot.
 * Picking changes the Previous column, since each machine keeps its own history.
 */
export function MachinePicker({
  store,
  exercise,
  machines,
  gyms,
  gymId,
  onGymChange,
}: {
  store: WorkoutStore;
  exercise: WorkoutExercise;
  /** Every known machine; this shows the ones for the exercise. */
  machines: Machine[];
  /** Every known gym, for choosing where a new machine is when the workout has none. */
  gyms: Gym[];
  /** The gym the workout is at; the picker offers only that gym's machines. */
  gymId: string | null;
  /** Sets the workout's gym (and re-points the exercises' machines to it). */
  onGymChange: (gymId: string | null) => Promise<void>;
}) {
  const s = useStrings();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  // With no gym on the workout, a new machine first needs one: an existing gym or a new one.
  const [pickedGym, setPickedGym] = useState("");
  const [gymName, setGymName] = useState("");
  const needsGym = gymId === null;
  const options = machines
    .filter((m) => m.exerciseId === exercise.exerciseId && m.gymId === gymId)
    .sort((a, b) => a.name.localeCompare(b.name));

  async function create() {
    const title = name.trim();
    if (!title) return;
    let atGym = gymId;
    if (needsGym) {
      if (pickedGym === NEW_GYM ? gymName.trim() === "" : pickedGym === "") return;
      atGym = pickedGym === NEW_GYM ? await gymIdFor(store, gyms, gymName) : pickedGym;
      await onGymChange(atGym);
    }
    // A name already used for this exercise at this gym picks that machine instead of making a twin.
    const existing = machineNameTaken(options, exercise.exerciseId, atGym, title)
      ? options.find((m) => m.name.trim().toLowerCase() === title.toLowerCase())
      : undefined;
    const id = existing?.id ?? (await store.createMachine(exercise.exerciseId, atGym, title));
    await store.setMachine(exercise.id, id);
    reset();
  }

  function reset() {
    setName("");
    setPickedGym("");
    setGymName("");
    setNaming(false);
  }

  if (naming) {
    return (
      <form
        className="flex basis-full flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        {needsGym && (
          <div className="flex basis-full flex-col gap-2">
            <select
              value={pickedGym}
              onChange={(e) => setPickedGym(e.target.value)}
              aria-label={s.workout.machineGymLabel}
              className="min-h-touch min-w-0 rounded-control border border-border-strong bg-surface px-2 text-fg"
            >
              <option value="">{s.workout.machineGymChoose}</option>
              {[...gyms]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              <option value={NEW_GYM}>{s.workout.gymNew}</option>
            </select>
            {pickedGym === NEW_GYM && (
              <TextInput
                value={gymName}
                maxLength={120}
                onChange={(e) => setGymName(e.target.value)}
                aria-label={s.workout.gymNameLabel}
                placeholder={s.workout.gymNamePlaceholder}
              />
            )}
          </div>
        )}
        <TextInput
          autoFocus={!needsGym}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          aria-label={s.workout.machineNameLabel}
          placeholder={s.workout.machineNamePlaceholder}
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          className="text-sm"
          disabled={
            name.trim() === "" ||
            (needsGym && (pickedGym === "" || (pickedGym === NEW_GYM && gymName.trim() === "")))
          }
        >
          {s.workout.machineSave}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-sm"
          onClick={reset}
        >
          {s.workout.machineCancel}
        </Button>
      </form>
    );
  }

  const picked = options.find((m) => m.id === exercise.machineId);

  return (
    <>
    <label className="flex min-h-touch min-w-0 items-center gap-1 text-sm text-muted">
      {s.workout.machine}
      <select
        value={exercise.machineId ?? ""}
        onChange={(e) => {
          if (e.target.value === NEW) setNaming(true);
          else void store.setMachine(exercise.id, e.target.value || null);
        }}
        className="min-h-touch min-w-0 rounded-control border border-border-strong bg-surface px-2 text-fg"
      >
        <option value="">{s.workout.machineNone}</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
        <option value={NEW}>{s.workout.machineNew}</option>
      </select>
    </label>
    {picked && (
      <NotesField
        // Remounts per machine, so one machine's unsaved text never lands on another.
        key={picked.id}
        label={s.workout.machineNotes}
        chip={s.workout.machineNote}
        value={picked.notes}
        onSave={(text) => void store.setMachineNotes(picked.id, text)}
        className="basis-full"
      />
    )}
    </>
  );
}
