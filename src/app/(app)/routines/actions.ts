"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CommandError, type CommandInput } from "@/server/commands";
import { requireCommands } from "@/server/auth/session";

export type RoutineFormState = { error: "invalid" | null };

/** The editor's payload: everything but the id. The command validates it. */
export type RoutineDraft = CommandInput<"createRoutine">;

export async function saveRoutine(id: string | null, draft: RoutineDraft): Promise<RoutineFormState> {
  const commands = await requireCommands();
  try {
    if (id) {
      const { folderId, ...rest } = draft;
      const before = await commands.getRoutine({ id });
      await commands.updateRoutine({ id, ...rest });
      if ((folderId ?? null) !== before.folderId) await moveRoutineInto(id, folderId ?? null);
    } else {
      await commands.createRoutine(draft);
    }
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") return { error: "invalid" };
    throw error;
  }
  revalidatePath("/routines");
  redirect("/routines");
}

export async function deleteRoutine(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.deleteRoutine({ id });
  revalidatePath("/routines");
  redirect("/routines");
}

export async function createFolder(formData: FormData): Promise<void> {
  const commands = await requireCommands();
  const name = String(formData.get("name") ?? "").trim();
  if (name) await commands.createRoutineFolder({ name });
  revalidatePath("/routines");
}

export async function renameFolder(id: string, formData: FormData): Promise<void> {
  const commands = await requireCommands();
  const name = String(formData.get("name") ?? "").trim();
  if (name) await commands.renameRoutineFolder({ id, name });
  revalidatePath("/routines");
}

export async function deleteFolder(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.deleteRoutineFolder({ id });
  revalidatePath("/routines");
}

/** Swaps an item with its neighbour; returns the list unchanged at either end. */
function shifted(ids: string[], id: string, by: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export async function moveFolder(id: string, by: -1 | 1): Promise<void> {
  const commands = await requireCommands();
  const { folders } = await commands.listRoutines({});
  await commands.reorderRoutineFolders({ ids: shifted(folders.map((f) => f.id), id, by) });
  revalidatePath("/routines");
}

export async function moveRoutine(id: string, by: -1 | 1): Promise<void> {
  const commands = await requireCommands();
  const { routines } = await commands.listRoutines({});
  const folderId = routines.find((r) => r.id === id)?.folderId ?? null;
  const siblings = routines.filter((r) => r.folderId === folderId).map((r) => r.id);
  await commands.reorderRoutines({ folderId, ids: shifted(siblings, id, by) });
  revalidatePath("/routines");
}

/** Moves a routine to the end of another folder (null = no folder). */
async function moveRoutineInto(id: string, folderId: string | null): Promise<void> {
  const commands = await requireCommands();
  const { routines } = await commands.listRoutines({});
  const siblings = routines.filter((r) => r.folderId === folderId && r.id !== id).map((r) => r.id);
  await commands.reorderRoutines({ folderId, ids: [...siblings, id] });
}

export async function moveRoutineToFolder(id: string, formData: FormData): Promise<void> {
  const folderId = String(formData.get("folderId") ?? "") || null;
  await moveRoutineInto(id, folderId);
  revalidatePath("/routines");
}
