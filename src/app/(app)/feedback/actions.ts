"use server";

import { revalidatePath } from "next/cache";
import { requireCommands } from "@/server/auth/session";

export async function addFeedback(formData: FormData): Promise<void> {
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;
  const commands = await requireCommands();
  await commands.addFeedback({ body });
  revalidatePath("/feedback");
}

export async function setFeedbackDone(id: string, done: boolean): Promise<void> {
  const commands = await requireCommands();
  await commands.setFeedbackDone({ id, done });
  revalidatePath("/feedback");
}

export async function deleteFeedback(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.deleteFeedback({ id });
  revalidatePath("/feedback");
}
