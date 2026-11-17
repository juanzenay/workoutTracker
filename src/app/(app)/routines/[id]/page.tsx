import { SubmitButton } from "@/components/ui/submit-button";
import { notFound } from "next/navigation";
import { CommandError } from "@/server/commands";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { loadCatalogue } from "../../workout/catalogue";
import { deleteRoutine } from "../actions";
import { RoutineEditor } from "../routine-editor";

export default async function EditRoutinePage({ params }: PageProps<"/routines/[id]">) {
  const s = await getRequestStrings();
  const { id } = await params;
  const commands = await requireCommands();
  const routine = await commands.getRoutine({ id }).catch((error: unknown) => {
    if (error instanceof CommandError && (error.code === "not_found" || error.code === "invalid_input")) notFound();
    throw error;
  });
  const [{ folders }, catalogue] = await Promise.all([commands.listRoutines({}), loadCatalogue(commands, s)]);

  return (
    <div className="flex flex-col gap-2">
      <RoutineEditor routine={routine} folders={folders} catalogue={catalogue} />
      <form action={deleteRoutine.bind(null, routine.id)}>
        <SubmitButton confirm variant="ghost" className="w-full text-danger">
          {s.routines.delete}
        </SubmitButton>
      </form>
    </div>
  );
}
