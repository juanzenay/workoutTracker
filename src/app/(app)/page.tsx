import { linkButtonClass } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import Link from "next/link";
import { MovePlan, RaceCountdown, RecentPrs, WeekVsPlan } from "@/components/home-dashboard";
import { WeekStrip } from "@/components/week-strip";
import { PlannedRunDetails } from "@/components/planned-run";
import { formatPlanDate, PlannedExerciseList } from "@/components/planned-session";
import { TodayAnalytics } from "@/components/today-analytics";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";


/** The compact analytics on Today: the last few weeks of load, and the muscles trained over the heatmap window. */
const LOAD_WEEKS = 8;
const HEATMAP_DAYS = 14;

/**
 * Home opens on Today: the day's planned session with Start, or a rest day and what's next; then the
 * week strip, race countdown, this week against plan and recent PRs. Cached by the service worker
 * (public/sw.js) so it still opens offline.
 */
export default async function TodayPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const [{ date, block, session, next, runs, plan }, home, load, heatmap, pending] = await Promise.all([
    commands.getToday({}),
    commands.getHome({}),
    commands.getTrainingLoad({ weeks: LOAD_WEEKS }),
    commands.getMuscleHeatmap({ days: HEATMAP_DAYS }),
    commands.listPlanRevisions({ status: ["pending"] }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">{s.today.title}</h1>
        <span className="text-muted">{formatPlanDate(date)}</span>
      </div>

      {/* Always in view: importing a run is a frequent action and must not hide inside a card. */}
      <Link href="/runs" className={linkButtonClass("secondary", "min-h-touch-lg")}>
        {s.today.importRun}
      </Link>

      {pending.revisions.length > 0 && (
        <Link href="/analytics#plan-changes" className="text-sm font-medium text-accent">
          {s.today.planChangesWaiting(pending.revisions.length)}
        </Link>
      )}

      {!block ? (
        <section className="flex flex-col gap-3 rounded-card bg-surface p-4">
          <p className="text-muted">{s.today.noBlock}</p>
          <Link href="/blocks/new" className={linkButtonClass("primary", "min-h-touch-lg")}>
            {s.today.designBlock}
          </Link>
        </section>
      ) : session ? (
        <section aria-labelledby="today-session" className="rounded-card bg-surface p-4">
          <Disclosure
            summary={
              <span className="flex min-w-0 flex-col">
                <h2 id="today-session" className="text-xl font-semibold">
                  {session.name}
                </h2>
                <span className="text-sm text-muted">
                  {block.name} · {s.today.weekOf(block.week, block.weeks)}
                </span>
              </span>
            }
          >
            <PlannedExerciseList exercises={session.exercises} s={s} />
            <Link href={`/workout?planned=${session.id}`} className={linkButtonClass("primary", "min-h-touch-lg")}>
              {s.today.start}
            </Link>
          </Disclosure>
        </section>
      ) : (
        <section aria-labelledby="today-rest" className="flex flex-col gap-2 rounded-card bg-surface p-4">
          <h2 id="today-rest" className="text-xl font-semibold">
            {s.today.restDay}
          </h2>
          <Link href={`/blocks/${block.id}`} className="text-sm text-muted">
            {block.name} · {s.today.weekOf(block.week, block.weeks)}
          </Link>
          {next && <p className="text-muted">{s.today.next(next.name, formatPlanDate(next.date))}</p>}
        </section>
      )}

      {(runs.length > 0 || plan) && (
        <section aria-labelledby="today-run" className="flex flex-col gap-3 rounded-card bg-surface p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="today-run" className="text-xl font-semibold">
              {s.running.todayRun}
            </h2>
            {plan && (
              <Link href={`/races/plans/${plan.id}`} className="text-sm text-muted">
                {s.running.planWeek(plan.name, plan.week, plan.weeks)}
              </Link>
            )}
          </div>
          {runs.length === 0 ? (
            <p className="text-muted">{s.running.runTypes.rest}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {runs.map((run) => (
                <li key={run.id}>
                  <PlannedRunDetails run={run} s={s} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <WeekStrip home={home} />
      <MovePlan home={home} s={s} />

      <TodayAnalytics load={load} heatmap={heatmap} s={s} />

      <RaceCountdown home={home} s={s} />
      <WeekVsPlan home={home} s={s} />
      <RecentPrs home={home} s={s} />
    </div>
  );
}
