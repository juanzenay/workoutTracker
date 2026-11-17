"use server";

import { redirect } from "next/navigation";
import { toCatalogueEntry } from "@/app/(app)/workout/catalogue";
import type { CatalogueEntry } from "@/app/(app)/workout/workout-logger";
import type { Exercise } from "@/domain/exercise";
import { CommandError, type CommandInput } from "@/server/commands";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";

export type CreateExerciseState = { invalid: boolean };

/** The Exercises page form's values, raw: the command validates them. */
function customExerciseInput(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    primaryMuscles: formData.getAll("primaryMuscles").map(String),
    secondaryMuscles: formData.getAll("secondaryMuscles").map(String),
    equipment: String(formData.get("equipment") ?? "") || null,
  } as CommandInput<"createCustomExercise">;
}

/** Creates the custom exercise from the form's values; null when the command rejects them as invalid. */
async function createFromForm(formData: FormData): Promise<Exercise | null> {
  const commands = await requireCommands();
  try {
    return await commands.createCustomExercise(customExerciseInput(formData));
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") return null;
    throw error;
  }
}

export async function createExercise(
  _prev: CreateExerciseState,
  formData: FormData,
): Promise<CreateExerciseState> {
  const exercise = await createFromForm(formData);
  if (!exercise) return { invalid: true };
  redirect(`/exercises/${exercise.id}`);
}

export type CreateWorkoutExerciseState = { invalid: boolean; exercise?: CatalogueEntry };

/** The workout picker's quick form: creates the custom exercise and returns it for the logger to add. */
export async function createWorkoutExercise(
  _prev: CreateWorkoutExerciseState,
  formData: FormData,
): Promise<CreateWorkoutExerciseState> {
  const exercise = await createFromForm(formData);
  if (!exercise) return { invalid: true };
  return { invalid: false, exercise: toCatalogueEntry(exercise, await getRequestStrings()) };
}
