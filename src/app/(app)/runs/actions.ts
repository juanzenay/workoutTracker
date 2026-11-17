"use server";

import { revalidatePath } from "next/cache";
import { METERS_PER_MILE } from "@/domain/distance";
import { requireCommands } from "@/server/auth/session";
import { CommandError } from "@/server/commands";

export type ManualRunState = { status: "idle" } | { status: "added" } | { status: "invalid" };

/** Adds a run typed in by hand: a day and a distance in miles. */
export async function addManualRun(_prev: ManualRunState, formData: FormData): Promise<ManualRunState> {
  const commands = await requireCommands();
  const miles = Number(formData.get("miles") ?? 0);
  try {
    await commands.addManualRun({
      date: String(formData.get("date") ?? ""),
      distanceMeters: Math.round(miles * METERS_PER_MILE * 10) / 10,
    });
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") return { status: "invalid" };
    throw error;
  }
  revalidatePath("/", "layout");
  return { status: "added" };
}

export async function deleteManualRun(formData: FormData): Promise<void> {
  const commands = await requireCommands();
  await commands.deleteManualRun({ id: String(formData.get("id") ?? "") });
  revalidatePath("/", "layout");
}
