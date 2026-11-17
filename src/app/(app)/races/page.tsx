import { linkButtonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { PendingLink } from "@/components/ui/pending-link";
import { formatMiles } from "@/components/planned-run";
import { formatPlanDate } from "@/components/planned-session";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { createRace, deleteRace, importRunPlan, updateRace } from "./actions";
import { ImportPlanForm, RaceForm } from "./race-forms";

/** Races (A/B/C) and imported run plans, each anchored to its race. */
export default async function RacesPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const [{ races }, { plans }, sources] = await Promise.all([
    commands.listRaces({}),
    commands.listRunPlans({}),
    commands.getActivitySources({}),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{s.running.title}</h1>
        <div className="flex gap-2">
          <Link href="/runs" className={linkButtonClass("outline", "px-3 text-sm")}>
            {s.running.runsLink}
          </Link>
          {/* Strava is optional: only a deployment with a Strava app shows it. */}
          {sources.strava.configured && (
            <Link href="/strava" className={linkButtonClass("outline", "px-3 text-sm")}>
              {s.running.stravaLink}
            </Link>
          )}
        </div>
      </div>

      <section aria-labelledby="races" className="flex flex-col gap-3">
        {/* The page title already says Races; the heading stays for screen readers. */}
        <h2 id="races" className="sr-only">
          {s.running.races}
        </h2>
        {races.length === 0 && <EmptyState>{s.running.noRaces}</EmptyState>}
        <ul className="flex flex-col gap-2">
          {races.map((race) => (
            <li key={race.id} className="flex flex-col gap-2 rounded-card bg-surface p-3">
              <span className="font-semibold">{race.name}</span>
              <span className="text-sm text-muted">
                {s.running.raceLine(formatPlanDate(race.date), formatMiles(race.distanceMeters, s), race.priority)}
              </span>
              <details>
                <summary className="flex min-h-touch cursor-pointer items-center text-sm">{s.running.editRace}</summary>
                <div className="flex flex-col gap-3 pt-2">
                  <RaceForm action={updateRace.bind(null, race.id)} race={race} submitLabel={s.running.saveRace} />
                  <form action={deleteRace.bind(null, race.id)}>
                    <SubmitButton confirm variant="secondary">
                      {s.running.deleteRace}
                    </SubmitButton>
                  </form>
                </div>
              </details>
            </li>
          ))}
        </ul>
        <details className="rounded-card bg-surface p-3" open={races.length === 0}>
          <summary className="flex min-h-touch cursor-pointer items-center font-medium">{s.running.addRace}</summary>
          <div className="pt-2">
            <RaceForm action={createRace} submitLabel={s.running.addRace} />
          </div>
        </details>
      </section>

      <section aria-labelledby="plans" className="flex flex-col gap-3">
        <h2 id="plans" className="text-xl font-semibold">
          {s.running.plans}
        </h2>
        {plans.length === 0 && <EmptyState>{s.running.noPlans}</EmptyState>}
        <ul className="flex flex-col gap-2">
          {plans.map((plan) => (
            <li key={plan.id}>
              <PendingLink href={`/races/plans/${plan.id}`} className="flex min-h-touch flex-col rounded-card bg-surface p-3">
                <span className="font-semibold">{plan.name}</span>
                <span className="text-sm text-muted">
                  {plan.race ? s.running.planLine(plan.weeks, plan.race.name) : s.running.unanchored}
                </span>
              </PendingLink>
            </li>
          ))}
        </ul>
        {races.length > 0 && (
          <div className="flex flex-col gap-2 rounded-card bg-surface p-3">
            <h3 className="font-medium">{s.running.importPlan}</h3>
            <ImportPlanForm action={importRunPlan} races={races} />
          </div>
        )}
      </section>
    </div>
  );
}
