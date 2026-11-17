import { notFound } from "next/navigation";
import { requireCommands } from "@/server/auth/session";
import { CommandError } from "@/server/commands";
import { getRequestStrings } from "@/server/strings";
import { loadCatalogue } from "../../../workout/catalogue";
import { BlockEditor } from "../../new/block-editor";

/** A draft block in the block designer. Started blocks aren't edited here. */
export default async function EditDraftBlockPage({ params }: PageProps<"/blocks/[id]/edit">) {
  const commands = await requireCommands();
  const { id } = await params;
  const result = await commands.getBlock({ id }).catch((error: unknown) => {
    if (error instanceof CommandError && (error.code === "not_found" || error.code === "invalid_input")) return null;
    throw error;
  });
  if (!result?.block.draft) notFound();
  const [{ routines }, catalogue] = await Promise.all([
    commands.listRoutines({}),
    loadCatalogue(commands, await getRequestStrings()),
  ]);
  return <BlockEditor catalogue={catalogue} routines={routines} initial={result.block} />;
}
