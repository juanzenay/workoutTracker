"use server";

import { redirect } from "next/navigation";
import { requireCommands } from "@/server/auth/session";

/** Adds a wger search result to the catalogue and opens it. */
export async function addWgerExercise(formData: FormData): Promise<void> {
  const commands = await requireCommands();
  const exercise = await commands.addWgerExercise({ wgerId: Number(formData.get("wgerId")) });
  redirect(`/exercises/${exercise.id}`);
}
