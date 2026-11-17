import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PlannedRunDetails } from "@/components/planned-run";
import { formatPlanDate } from "@/components/planned-session";
import { requireCommands } from "@/server/auth/session";
import { CommandError } from "@/server/commands";
import { getRequestStrings } from "@/server/strings";
import { deleteRunPlan } from "../../actions";

/** A run plan's dated runs, week by week. */
export default async function RunPlanPage({ params }: PageProps<"/races/plans/[id]">) {
  const s = await getRequestStrings();
  const { id } = await params;
  const commands = await requireCommands();
  const result = await commands.getRunPlan({ id }).catch((error: unknown) => {
    if (error instanceof CommandError && (error.code === "not_found" || error.code === "invalid_input")) return null;
    throw error;
  });
  if (!result) notFound();
  const { plan, plannedRuns } = result;
  const weeks = [...new Set(plannedRuns.map((r) => r.week))];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/races" className="text-sm text-muted">
        ← {s.running.back}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{plan.name}</h1>
        <p className="text-muted">
          {plan.race ? s.running.planLine(plan.weeks, `${plan.race.name}, ${formatPlanDate(plan.race.date)}`) : s.running.unanchored}
        </p>
      </div>
      {weeks.map((week) => (
        <section key={week} aria-labelledby={`week-${week}`} className="flex flex-col gap-2 rounded-card bg-surface p-3">
          <h2 id={`week-${week}`} className="font-semibold">
            {s.running.week(week)}
          </h2>
          <ul className="flex flex-col gap-2">
            {plannedRuns
              .filter((r) => r.week === week)
              .map((run) => (
                <li key={run.id} className="grid grid-cols-[6.5rem_1fr] gap-2">
                  <span className="text-sm text-muted">{formatPlanDate(run.date)}</span>
                  <PlannedRunDetails run={run} s={s} />
                </li>
              ))}
          </ul>
        </section>
      ))}
      <form action={deleteRunPlan.bind(null, plan.id)}>
        <SubmitButton confirm variant="secondary">
          {s.running.deletePlan}
        </SubmitButton>
      </form>
    </div>
  );
}
