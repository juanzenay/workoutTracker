"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { METERS_PER_MILE } from "@/domain/distance";
import type { RunPlanFileError } from "@/domain/run-plan-file";
import { requireCommands } from "@/server/auth/session";
import { CommandError, type CommandInput } from "@/server/commands";

export type RaceFormState = { error: "invalid" | null };

const METERS_PER = { km: 1000, mi: METERS_PER_MILE } as const;

function raceFrom(formData: FormData) {
  const unit = formData.get("distanceUnit") === "km" ? "km" : "mi";
  return {
    name: String(formData.get("name") ?? ""),
    date: String(formData.get("date") ?? ""),
    distanceMeters: Math.round(Number(formData.get("distance") ?? 0) * METERS_PER[unit]),
    priority: String(formData.get("priority") ?? "") as CommandInput<"createRace">["priority"],
  };
}

async function saveRace(write: () => Promise<unknown>): Promise<RaceFormState> {
  try {
    await write();
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") return { error: "invalid" };
    throw error;
  }
  revalidatePath("/");
  redirect("/races");
}

export async function createRace(_prev: RaceFormState, formData: FormData): Promise<RaceFormState> {
  const commands = await requireCommands();
  return saveRace(() => commands.createRace(raceFrom(formData)));
}

export async function updateRace(id: string, _prev: RaceFormState, formData: FormData): Promise<RaceFormState> {
  const commands = await requireCommands();
  return saveRace(() => commands.updateRace({ id, ...raceFrom(formData) }));
}

export async function deleteRace(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.deleteRace({ id });
  revalidatePath("/");
  redirect("/races");
}

export type ImportPlanState =
  | { error: null }
  | { error: "rows"; rows: RunPlanFileError[] }
  | { error: "noARace" | "unreadable" | "invalid"; message?: string };

export async function importRunPlan(_prev: ImportPlanState, formData: FormData): Promise<ImportPlanState> {
  const commands = await requireCommands();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "unreadable" };
  const format = file.name.toLowerCase().endsWith(".json") ? "json" : file.name.toLowerCase().endsWith(".csv") ? "csv" : null;
  if (!format) return { error: "unreadable" };
  const name = String(formData.get("name") ?? "").trim();
  const raceId = String(formData.get("raceId") ?? "");
  let id: string;
  try {
    ({
      plan: { id },
    } = await commands.importRunPlan({
      format,
      content: await file.text(),
      name: name || undefined,
      raceId: raceId || undefined,
      timeZone: String(formData.get("timeZone") || "UTC"),
    }));
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") {
      const details = error.details as { errors?: RunPlanFileError[] } | undefined;
      if (details?.errors) return { error: "rows", rows: details.errors };
      if (error.message.startsWith("Add an A race")) return { error: "noARace" };
      return { error: "invalid", message: error.message };
    }
    throw error;
  }
  revalidatePath("/");
  redirect(`/races/plans/${id}`);
}

export async function deleteRunPlan(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.deleteRunPlan({ id });
  revalidatePath("/");
  redirect("/races");
}
