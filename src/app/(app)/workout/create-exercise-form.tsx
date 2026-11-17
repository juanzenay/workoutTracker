"use client";

import { useActionState } from "react";
import { CustomExerciseFields } from "@/components/custom-exercise-fields";
import { Button } from "@/components/ui/button";
import { useStrings } from "@/strings/provider";
import { createWorkoutExercise, type CreateWorkoutExerciseState } from "@/app/(app)/exercises/new/actions";
import type { CatalogueEntry } from "./workout-logger";

/** The picker's quick form for a search that matched nothing: creates the exercise, then hands it to `onCreated`. */
export function CreateExerciseForm({
  name,
  onCreated,
}: {
  name: string;
  onCreated: (exercise: CatalogueEntry) => void;
}) {
  const s = useStrings();
  const [state, action, pending] = useActionState<CreateWorkoutExerciseState, FormData>(
    async (prev, formData) => {
      const next = await createWorkoutExercise(prev, formData);
      if (next.exercise) onCreated(next.exercise);
      return next;
    },
    { invalid: false },
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <CustomExerciseFields defaultName={name} />
      {state.invalid && (
        <p role="alert" className="text-sm text-danger">
          {s.customExercise.invalid}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {s.customExercise.submit}
      </Button>
    </form>
  );
}
