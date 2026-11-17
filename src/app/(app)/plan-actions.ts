"use server";

import { revalidatePath } from "next/cache";
import { requireCommands } from "@/server/auth/session";
import { CommandError } from "@/server/commands";

type Decision = "undoPlanRevision" | "confirmPlanRevision" | "rejectPlanRevision";

async function decide(command: Decision, id: string) {
  const commands = await requireCommands();
  try {
    await commands[command]({ id });
  } catch (error) {
    // A second tap (or another device) already decided it: the refreshed page shows where it stands.
    if (!(error instanceof CommandError && (error.code === "conflict" || error.code === "not_found"))) throw error;
  }
  revalidatePath("/");
  revalidatePath("/analytics");
  revalidatePath("/blocks", "layout");
  revalidatePath("/plan-changes/[id]", "page");
}

export async function undoPlanChange(id: string) {
  await decide("undoPlanRevision", id);
}

export async function confirmPlanChange(id: string) {
  await decide("confirmPlanRevision", id);
}

export async function rejectPlanChange(id: string) {
  await decide("rejectPlanRevision", id);
}

async function moveTo(command: "movePlannedSession" | "movePlannedRun", formData: FormData) {
  const commands = await requireCommands();
  try {
    await commands[command]({ id: String(formData.get("id") ?? ""), to: String(formData.get("to") ?? "") });
  } catch (error) {
    // A day that is over, another week, or a session finished meanwhile: the refreshed page shows where things stand.
    if (!(error instanceof CommandError && (error.code === "conflict" || error.code === "invalid_input" || error.code === "not_found")))
      throw error;
  }
  revalidatePath("/");
  revalidatePath("/blocks", "layout");
  revalidatePath("/races", "layout");
}

export async function moveSession(formData: FormData) {
  await moveTo("movePlannedSession", formData);
}

export async function moveRun(formData: FormData) {
  await moveTo("movePlannedRun", formData);
}
