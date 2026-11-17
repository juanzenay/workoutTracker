import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { loadCatalogue } from "../../workout/catalogue";
import { RoutineEditor } from "../routine-editor";

export default async function NewRoutinePage() {
  const commands = await requireCommands();
  const [{ folders }, catalogue] = await Promise.all([
    commands.listRoutines({}),
    loadCatalogue(commands, await getRequestStrings()),
  ]);
  return <RoutineEditor routine={null} folders={folders} catalogue={catalogue} defaultFolderId={folders[0]?.id} />;
}
