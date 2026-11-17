"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { CustomExerciseFields } from "@/components/custom-exercise-fields";
import { useStrings } from "@/strings/provider";
import { createExercise, type CreateExerciseState } from "./actions";

export function CustomExerciseForm() {
  const s = useStrings();
  const [state, action, pending] = useActionState<CreateExerciseState, FormData>(createExercise, {
    invalid: false,
  });

  return (
    <form action={action} className="flex flex-col gap-5">
      <CustomExerciseFields />
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
