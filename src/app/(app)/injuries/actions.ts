"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCommands } from "@/server/auth/session";
import { CommandError } from "@/server/commands";

export async function logInjury(formData: FormData): Promise<void> {
  const commands = await requireCommands();
  const note = String(formData.get("note") ?? "").trim();
  try {
    await commands.logInjury({
      joint: String(formData.get("joint") ?? ""),
      side: String(formData.get("side") ?? ""),
      tissue: String(formData.get("tissue") ?? ""),
      grade: Number(formData.get("grade")),
      startDate: String(formData.get("startDate") ?? ""),
      ...(note && { note }),
    } as Parameters<typeof commands.logInjury>[0]);
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") redirect("/injuries?error=invalid");
    throw error;
  }
  revalidatePath("/");
  redirect("/injuries");
}

export async function updateInjuryGrade(id: string, formData: FormData): Promise<void> {
  const commands = await requireCommands();
  await commands.updateInjury({ id, grade: Number(formData.get("grade")) } as Parameters<typeof commands.updateInjury>[0]);
  revalidatePath("/");
  redirect("/injuries");
}

export async function clearInjury(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.clearInjury({ id });
  revalidatePath("/");
  redirect("/injuries");
}

export async function deleteInjury(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.deleteInjury({ id });
  revalidatePath("/");
  redirect("/injuries");
}
