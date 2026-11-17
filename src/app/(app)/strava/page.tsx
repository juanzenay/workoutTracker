import { linkButtonClass } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMiles } from "@/components/planned-run";
import { formatPlanDate } from "@/components/planned-session";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { disconnectStrava, subscribeStravaWebhook } from "./actions";


/** Connect the deployment's Strava app, subscribe its webhook, and see what came in. */
export default async function StravaPage({ searchParams }: PageProps<"/strava">) {
  const s = await getRequestStrings();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;
  const commands = await requireCommands();
  // Strava is optional: without a Strava app on this deployment there is no Strava screen.
  if (!(await commands.getActivitySources({})).strava.configured) notFound();
  const [connection, { activities }] = await Promise.all([
    commands.getStravaConnection({}),
    commands.listStravaActivities({ limit: 20 }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{s.strava.title}</h1>
      <p className="text-muted">{s.strava.intro}</p>
      {error && (
        <p role="alert" className="text-danger">
          {s.strava.errors[error] ?? s.strava.errors.denied}
        </p>
      )}
      {params.connected && !error && <p role="status">{s.strava.justConnected}</p>}

      <section className="flex flex-col gap-3 rounded-card bg-surface p-4">
        {connection.connected ? (
          <>
            <p>{s.strava.connected(connection.athleteName ?? String(connection.athleteId))}</p>
            <form action={disconnectStrava}>
              <SubmitButton variant="secondary">
                {s.strava.disconnect}
              </SubmitButton>
            </form>
          </>
        ) : (
          <>
            <p className="text-muted">{s.strava.notConnected}</p>
            {/* A plain link: the route redirects to Strava's consent screen. */}
            <a href="/api/strava/connect" className={linkButtonClass("primary")}>
              {s.strava.connect}
            </a>
          </>
        )}
      </section>

      {connection.connected && (
        <section aria-labelledby="strava-webhook" className="flex flex-col gap-3 rounded-card bg-surface p-4">
          <h2 id="strava-webhook" className="text-xl font-semibold">
            {s.strava.webhookTitle}
          </h2>
          {connection.subscription ? (
            <p className="text-muted">{s.strava.webhookOn}</p>
          ) : (
            <>
              <p className="text-muted">{s.strava.webhookOff}</p>
              <form action={subscribeStravaWebhook}>
                <SubmitButton type="submit">{s.strava.subscribe}</SubmitButton>
              </form>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="strava-activities" className="flex flex-col gap-2">
        <h2 id="strava-activities" className="text-xl font-semibold">
          {s.strava.activitiesTitle}
        </h2>
        {activities.length === 0 ? (
          <p className="text-muted">{s.strava.noActivities}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activities.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 rounded-card bg-surface p-3">
                <span className="font-medium">{a.name ?? a.sportType}</span>
                <span className="text-sm text-muted">
                  {[formatPlanDate(a.localDate), a.sportType, a.distanceMeters > 0 && formatMiles(a.distanceMeters, s)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {a.plannedRunId && <span className="text-sm text-success-text">{s.strava.matched}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href="/races" className="text-sm text-muted">
        ← {s.running.back}
      </Link>
    </div>
  );
}
