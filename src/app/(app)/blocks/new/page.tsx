import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { loadCatalogue } from "../../workout/catalogue";
import { BlockEditor } from "./block-editor";

export default async function NewBlockPage() {
  const commands = await requireCommands();
  const [{ routines }, catalogue] = await Promise.all([
    commands.listRoutines({}),
    loadCatalogue(commands, await getRequestStrings()),
  ]);
  return <BlockEditor catalogue={catalogue} routines={routines} />;
}
