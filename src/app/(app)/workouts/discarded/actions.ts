"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCommands } from "@/server/auth/session";

/**
 * Puts a discarded workout back into history (#61). Restoring is not destructive, so it has no
 * confirm step. The server keeps the original finish time; a workout discarded mid-session finishes now.
 */
export async function restoreDiscardedWorkout(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.applyWorkoutOps({ ops: [{ type: "restoreWorkout", id, finishedAt: new Date().toISOString() }] });
  revalidatePath("/workouts");
  revalidatePath("/workouts/discarded");
  revalidatePath("/");
  redirect("/workouts/discarded");
}
