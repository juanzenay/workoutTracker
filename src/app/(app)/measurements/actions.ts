"use server";

import { redirect } from "next/navigation";
import { BODY_METRIC_KEYS } from "@/domain/body-measurement";
import { CommandError, type CommandInput } from "@/server/commands";
import { requireCommands } from "@/server/auth/session";

export type MeasurementFormState = { error: "invalid" | "conflict" | null };

/** Raw form values; the command validates them. Blank fields are "not measured". */
function entryFrom(formData: FormData) {
  const values: Record<string, number> = {};
  for (const metric of BODY_METRIC_KEYS) {
    const raw = String(formData.get(metric) ?? "").trim();
    if (raw !== "") values[metric] = Number(raw);
  }
  return {
    date: String(formData.get("date") ?? ""),
    weightUnit: String(formData.get("weightUnit") ?? ""),
    lengthUnit: String(formData.get("lengthUnit") ?? ""),
    values,
  } as CommandInput<"logBodyMeasurement">;
}

async function save(write: () => Promise<unknown>): Promise<MeasurementFormState> {
  try {
    await write();
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") return { error: "invalid" };
    if (error instanceof CommandError && error.code === "conflict") return { error: "conflict" };
    throw error;
  }
  redirect("/measurements");
}

export async function logMeasurement(
  _prev: MeasurementFormState,
  formData: FormData,
): Promise<MeasurementFormState> {
  const commands = await requireCommands();
  return save(() => commands.logBodyMeasurement(entryFrom(formData)));
}

export async function updateMeasurement(
  id: string,
  _prev: MeasurementFormState,
  formData: FormData,
): Promise<MeasurementFormState> {
  const commands = await requireCommands();
  return save(() => commands.updateBodyMeasurement({ id, ...entryFrom(formData) }));
}

export async function deleteMeasurement(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.deleteBodyMeasurement({ id });
  redirect("/measurements");
}
