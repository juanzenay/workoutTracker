import Link from "next/link";
import { PlanUpdates } from "@/components/plan-updates";
import { requireCommands } from "@/server/auth/session";
import { CommandError } from "@/server/commands";
import { getRequestStrings } from "@/server/strings";

/** One plan change: what an inbox item or push notification opens, to confirm or reject (or undo) it. */
export default async function PlanChangePage({ params }: PageProps<"/plan-changes/[id]">) {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { id } = await params;
  const revision = await commands.getPlanRevision({ id }).catch((error: unknown) => {
    if (error instanceof CommandError && (error.code === "not_found" || error.code === "invalid_input")) return null;
    throw error;
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{s.planUpdates.title}</h1>
      {revision ? <PlanUpdates revisions={[revision]} s={s} /> : <p className="text-muted">{s.planUpdates.notFound}</p>}
      <Link href="/inbox" className="flex min-h-touch items-center text-muted">
        {s.planUpdates.toInbox}
      </Link>
    </div>
  );
}
