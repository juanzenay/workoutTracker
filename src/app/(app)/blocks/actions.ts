"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCommands } from "@/server/auth/session";
import { CommandError, type CommandInput } from "@/server/commands";

export type BlockDraft = CommandInput<"createBlock">;

/** Saves the block designer's block: started right away, or (`asDraft`) as a draft that plans nothing yet. */
export async function createBlock(
  draft: BlockDraft,
  { asDraft = false }: { asDraft?: boolean } = {},
): Promise<{ error: "invalid" } | undefined> {
  const commands = await requireCommands();
  let id: string;
  try {
    ({ id } = asDraft ? await commands.draftBlock(draft) : await commands.createBlock(draft));
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") return { error: "invalid" };
    throw error;
  }
  revalidatePath("/");
  revalidatePath("/blocks");
  redirect(`/blocks/${id}`);
}

/** Saves the block designer's edits to a draft block. */
export async function updateDraftBlock(id: string, draft: BlockDraft): Promise<{ error: "invalid" } | undefined> {
  const commands = await requireCommands();
  try {
    await commands.updateDraftBlock({ ...draft, id });
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") return { error: "invalid" };
    throw error;
  }
  revalidatePath("/blocks");
  redirect(`/blocks/${id}`);
}

/** Starts a draft block: the current block is archived and the draft's sessions are planned. */
export async function startBlock(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.startBlock({ id });
  revalidatePath("/", "layout");
  redirect(`/blocks/${id}`);
}

export async function deleteDraftBlock(id: string): Promise<void> {
  const commands = await requireCommands();
  await commands.deleteDraftBlock({ id });
  revalidatePath("/blocks");
  redirect("/blocks");
}
