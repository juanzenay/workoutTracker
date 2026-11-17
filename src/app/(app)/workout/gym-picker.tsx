"use client";

import { useState } from "react";
import type { WorkoutStore } from "@/client/workout-store";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/ui/field";
import { gymNameTaken, type Gym } from "@/domain/workout";
import { useStrings } from "@/strings/provider";

export const NEW_GYM = "__new_gym__";

/** The gym with this name if one exists (case-insensitive), else a new one made on the spot. Returns its id. */
export async function gymIdFor(store: WorkoutStore, gyms: Gym[], name: string): Promise<string> {
  const title = name.trim();
  const existing = gymNameTaken(gyms, title)
    ? gyms.find((g) => g.name.trim().toLowerCase() === title.toLowerCase())
    : undefined;
  return existing?.id ?? (await store.createGym(title));
}

/**
 * Where the workout is done. Each gym has its own machines, so picking one changes which machines the
 * exercise cards offer. "New gym…" asks for a name; a name that already exists picks that gym.
 */
export function GymPicker({
  store,
  gyms,
  gymId,
  onPick,
}: {
  store: WorkoutStore;
  /** Every known gym. */
  gyms: Gym[];
  gymId: string | null;
  /** Called with the chosen gym (null = none); the caller sets it on the workout. */
  onPick: (gymId: string | null) => Promise<void> | void;
}) {
  const s = useStrings();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const options = [...gyms].sort((a, b) => a.name.localeCompare(b.name));

  if (naming) {
    return (
      <form
        className="flex basis-full items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void (async () => {
            await onPick(await gymIdFor(store, gyms, name));
            setName("");
            setNaming(false);
          })();
        }}
      >
        <TextInput
          autoFocus
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          aria-label={s.workout.gymNameLabel}
          placeholder={s.workout.gymNamePlaceholder}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="secondary" className="text-sm" disabled={name.trim() === ""}>
          {s.workout.gymSave}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="text-sm"
          onClick={() => {
            setName("");
            setNaming(false);
          }}
        >
          {s.workout.machineCancel}
        </Button>
      </form>
    );
  }

  return (
    <label className="flex min-h-touch min-w-0 items-center gap-1 text-sm text-muted">
      {s.workout.gym}
      <select
        value={gymId ?? ""}
        onChange={(e) => {
          if (e.target.value === NEW_GYM) setNaming(true);
          else void onPick(e.target.value || null);
        }}
        className="min-h-touch min-w-0 rounded-control border border-border-strong bg-surface px-2 text-fg"
      >
        <option value="">{s.workout.gymNone}</option>
        {options.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
        <option value={NEW_GYM}>{s.workout.gymNew}</option>
      </select>
    </label>
  );
}
