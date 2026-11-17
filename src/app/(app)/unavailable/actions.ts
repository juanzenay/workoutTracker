"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCommands } from "@/server/auth/session";
import { CommandError } from "@/server/commands";

export async function markUnavailable(formData: FormData): Promise<void> {
  const commands = await requireCommands();
  const note = String(formData.get("note") ?? "").trim();
  try {
    await commands.markUnavailable({
      startDate: String(formData.get("startDate") ?? ""),
      endDate: String(formData.get("endDate") ?? ""),
      ...(note && { note }),
    });
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") redirect("/unavailable?error=invalid");
    throw error;
  }
  revalidatePath("/");
  redirect("/unavailable");
}

export async function clearUnavailable(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.clearUnavailable({ id });
  revalidatePath("/");
  redirect("/unavailable");
}
