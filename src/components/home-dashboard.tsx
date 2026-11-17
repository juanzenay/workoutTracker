import Link from "next/link";
import { moveRun, moveSession } from "@/app/(app)/plan-actions";
import { Disclosure } from "@/components/ui/disclosure";
import { Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { CommandOutput } from "@/server/commands";
import type { Strings } from "@/strings";
import { formatMiles } from "./planned-run";

/** Home below Today (#24): the week strip, race countdown, this week against plan and recent PRs. */

type Home = CommandOutput<"getHome">;

const card = "flex flex-col gap-3 rounded-card bg-surface p-4";

/** Days to the next A race and the run plan's week. */
export function RaceCountdown({ home, s }: { home: Home; s: Strings }) {
  const { countdown } = home;
  return (
    <section aria-labelledby="home-countdown" className={card}>
      <h2 id="home-countdown" className="font-semibold">
        {s.home.countdown}
      </h2>
      {!countdown ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-muted">{s.home.noARace}</p>
          <Link href="/races" className="text-sm text-accent-text">
            {s.home.addRace}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold" data-testid="race-countdown">
            {s.home.daysTo(countdown.days, countdown.race.name)}
          </p>
          {countdown.plan ? (
            <Link href={`/races/plans/${countdown.plan.id}`} className="text-sm text-muted">
              {countdown.plan.name} · {s.home.planWeek(countdown.plan.week, countdown.plan.weeks)}
            </Link>
          ) : (
            <p className="text-sm text-muted">{s.home.noPlanYet}</p>
          )}
        </div>
      )}
    </section>
  );
}

function VsPlanRow({ label, done, planned, text }: { label: string; done: number; planned: number; text: string }) {
  const pct = planned > 0 ? Math.min(100, Math.round((done / planned) * 100)) : done > 0 ? 100 : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm text-muted">{label}</span>
        <span className="font-numeric text-sm">{text}</span>
      </div>
      <div aria-hidden className="h-2 overflow-hidden rounded-control bg-surface-raised">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** This week's mileage (Strava or imported runs) and lifting volume against plan. */
export function WeekVsPlan({ home, s }: { home: Home; s: Strings }) {
  const { running, lifting } = home.load;
  const text = (done: string, planned: number, plannedText: string) =>
    planned > 0 ? s.home.ofPlanned(done, plannedText) : s.home.unplanned(done);
  return (
    <section aria-labelledby="home-vs-plan" className={card}>
      <h2 id="home-vs-plan" className="font-semibold">
        {s.home.vsPlan}
      </h2>
      <VsPlanRow
        label={s.home.mileage}
        done={running.distanceMeters}
        planned={running.plannedDistanceMeters}
        text={text(
          formatMiles(running.distanceMeters, s),
          running.plannedDistanceMeters,
          formatMiles(running.plannedDistanceMeters, s),
        )}
      />
      <VsPlanRow
        label={s.home.volume}
        done={lifting.volume}
        planned={lifting.plannedVolume}
        text={text(
          s.home.weight(Math.round(lifting.volume), home.unit),
          lifting.plannedVolume,
          s.home.weight(Math.round(lifting.plannedVolume), home.unit),
        )}
      />
    </section>
  );
}

/** The latest PRs, newest first. */
export function RecentPrs({ home, s }: { home: Home; s: Strings }) {
  return (
    <section aria-labelledby="home-prs" className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="home-prs" className="font-semibold">
          {s.home.recentPrs}
        </h2>
        <Link href="/records" className="text-sm text-accent-text">
          {s.home.allRecords}
        </Link>
      </div>
      {home.recentPrs.length === 0 ? (
        <p className="text-sm text-muted">{s.home.noPrs}</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {home.recentPrs.map((pr) => (
            <li key={`${pr.workoutId}:${pr.exerciseId}:${pr.kind}`}>
              <Link href={`/exercises/${pr.exerciseId}`} className="flex flex-wrap items-center gap-x-2">
                <span className="rounded-control bg-accent px-1.5 py-0.5 text-xs font-bold text-accent-fg">
                  {s.records.prBadge}
                </span>
                <span className="font-medium">{pr.name}</span>
                <span className="text-muted">
                  {s.records.kinds[pr.kind]} {s.records.value(pr.kind, pr.set.value, pr.set.unit)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Lifts and runs still to come this week, each with a day picker: moving one onto a day that has one swaps them. */
export function MovePlan({ home, s }: { home: Home; s: Strings }) {
  const days = home.week.filter((day) => day.date >= home.today);
  const label = (date: string) => `${s.home.weekday[home.week.findIndex((d) => d.date === date)]} ${Number(date.slice(8))}`;
  const movable = days.flatMap((day) => [
    ...day.sessions
      .filter((x) => x.status === "planned")
      .map((x) => ({ kind: "session" as const, id: x.id, name: x.name, date: day.date })),
    ...day.runs
      .filter((x) => x.status === "planned")
      .map((x) => ({ kind: "run" as const, id: x.id, name: s.running.runTypes[x.type], date: day.date })),
  ]);
  return (
    <section aria-labelledby="home-move" className={card}>
      <Disclosure
        summary={
          <h2 id="home-move" className="font-semibold">
            {s.home.move.title}
          </h2>
        }
      >
        <p className="text-sm text-muted">{s.home.move.intro}</p>
        {movable.length === 0 && <p className="text-sm text-muted">{s.home.move.none}</p>}
        <ul className="flex flex-col gap-3">
          {movable.map((item) => {
            const kind = item.kind === "session" ? s.home.lift : s.home.run;
            return (
              <li key={`${item.kind}:${item.id}`}>
                <form action={item.kind === "session" ? moveSession : moveRun} className="flex flex-col gap-2">
                  <input type="hidden" name="id" value={item.id} />
                  <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-sm text-muted">
                      {kind} · {label(item.date)}
                    </span>
                  </span>
                  <div className="flex gap-2">
                    <Select name="to" aria-label={`${s.home.move.to}: ${item.name}`} defaultValue="">
                      <option value="" disabled>
                        {s.home.move.to}
                      </option>
                      {days
                        .filter((day) => day.date !== item.date)
                        .map((day) => {
                          const there =
                            item.kind === "session"
                              ? day.sessions.filter((x) => x.status === "planned").map((x) => x.name)
                              : day.runs.filter((x) => x.status === "planned" && x.type !== "rest").map((x) => s.running.runTypes[x.type]);
                          return (
                            <option key={day.date} value={day.date}>
                              {s.home.move.option(label(day.date), there[0] ?? null)}
                            </option>
                          );
                        })}
                    </Select>
                    <SubmitButton variant="secondary">{s.home.move.go}</SubmitButton>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>
      </Disclosure>
    </section>
  );
}
