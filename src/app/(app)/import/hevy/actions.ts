"use server";

import { revalidatePath } from "next/cache";
import { CommandError } from "@/server/commands";
import type { HevyImportResult } from "@/server/commands/hevy-import";
import { requireCommands } from "@/server/auth/session";

export type ImportState =
  | { status: "idle" }
  | { status: "done"; result: HevyImportResult }
  | { status: "error"; error: "invalid" | "missingKey" | "unavailable" };

export async function runHevyImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const commands = await requireCommands();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  try {
    const result = await commands.importFromHevy(apiKey ? { apiKey } : {});
    revalidatePath("/import/hevy");
    return { status: "done", result };
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") {
      return { status: "error", error: apiKey ? "invalid" : "missingKey" };
    }
    if (error instanceof CommandError && error.code === "unavailable") return { status: "error", error: "unavailable" };
    throw error;
  }
}

/** One review decision: `choice` is a catalogue exercise id, or "keep" for the Hevy exercise. */
export async function resolveHevyMatch(formData: FormData): Promise<void> {
  const commands = await requireCommands();
  const choice = String(formData.get("choice") ?? "");
  if (!choice) return;
  await commands.resolveHevyMatch({
    hevyTemplateId: String(formData.get("hevyTemplateId") ?? ""),
    exerciseId: choice === "keep" ? null : choice,
  });
  revalidatePath("/import/hevy");
}
