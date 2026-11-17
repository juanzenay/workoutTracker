import { plannedAsRoutine } from "@/domain/block";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { loadCatalogue } from "./catalogue";
import { WorkoutLogger } from "./workout-logger";

/**
 * The logger. The page ships the catalogue, routines and every exercise's
 * Previous sets once; everything after that runs on the device (IndexedDB +
 * outbox), so a workout can be logged with no signal.
 * `?routine=<id>` starts that routine and `?planned=<id>` that planned session, with its targets
 * (unless a workout is already in progress). The logger reads `routine` on the device, so the service
 * worker's cached copy of this page starts routines offline too; `planned` needs the server (planning is online-only).
 */
export default async function WorkoutPage({ searchParams }: PageProps<"/workout">) {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { planned } = await searchParams;
  const [catalogue, records, { routines }, { previous, previousByMachine, lastMachinesByGym }, { machines }, { gyms, lastGymId }] = await Promise.all([
    loadCatalogue(commands, s),
    commands.listRecords({}),
    commands.listRoutines({}),
    commands.getPreviousSets({}),
    commands.listMachines({}),
    commands.listGyms({}),
  ]);
  const plannedSession =
    typeof planned === "string" ? await commands.getPlannedSession({ id: planned }).catch(() => null) : null;

  return (
    <WorkoutLogger
      catalogue={catalogue}
      records={records.items.map((r) => ({ exerciseId: r.exerciseId, bests: r.bests }))}
      routines={routines}
      previous={previous}
      previousByMachine={previousByMachine}
      lastMachinesByGym={lastMachinesByGym}
      gyms={gyms}
      lastGymId={lastGymId}
      machines={machines}
      startPlanned={plannedSession && plannedAsRoutine(plannedSession)}
    />
  );
}
