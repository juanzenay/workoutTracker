"use client";

import { useState } from "react";
import { ManualRunForm } from "@/app/(app)/runs/manual-run-form";
import type { CommandOutput } from "@/server/commands";
import type { Strings } from "@/strings";
import { useStrings } from "@/strings/provider";
import { formatMiles } from "./planned-run";
import { formatPlanDate } from "./planned-session";

type Home = CommandOutput<"getHome">;
type ItemState = keyof Strings["home"]["states"];

const STATE_CLASS: Record<ItemState, string> = {
  done: "text-success-text",
  partial: "text-fg",
  missed: "text-danger",
  planned: "text-muted",
  rest: "text-muted",
  not_recorded: "text-muted",
};

function Mark({ label, state, s }: { label: string; state: ItemState; s: Strings }) {
  return (
    <span className={`flex items-center gap-1 text-xs ${STATE_CLASS[state]}`} data-state={state}>
      <span aria-hidden>{s.home.marks[state]}</span>
      <span className="text-muted">{label}</span>
    </span>
  );
}

/**
 * Mon–Sun: each day's planned lifts and runs, marked done / missed / still to come. Tap a day (today or earlier) to
 * see its run and log miles for it: a forgotten run is a tap and a number away.
 */
export function WeekStrip({ home }: { home: Home }) {
  const s = useStrings();
  const [selected, setSelected] = useState<string | null>(null);
  const day = home.week.find((d) => d.date === selected);

  return (
    <section aria-labelledby="home-week" className="flex flex-col gap-3 rounded-card bg-surface p-4">
      <h2 id="home-week" className="font-semibold">
        {s.home.week}
      </h2>
      <ol className="grid grid-cols-7 gap-1">
        {home.week.map((d, i) => {
          const lifts = d.sessions.map((session) => ({
            label: s.home.itemLabel(session.name, s.home.states[session.status === "completed" ? "done" : session.status]),
            state: (session.status === "completed" ? "done" : session.status) as ItemState,
          }));
          const runs = d.runs
            .filter((run) => run.type !== "rest")
            .map((run) => ({
              label: s.home.itemLabel(
                run.distanceMeters ? `${s.running.runTypes[run.type]}, ${formatMiles(run.distanceMeters, s)}` : s.running.runTypes[run.type],
                s.home.states[run.status],
              ),
              state: run.status as ItemState,
              meters: run.distanceMeters,
            }));
          const weekday = s.home.weekday[i]!;
          const isToday = d.date === home.today;
          const isSelected = d.date === selected;
          return (
            <li
              key={d.date}
              aria-label={s.home.dayLabel(`${weekday} ${formatPlanDate(d.date)}`, [...lifts, ...runs].map((x) => x.label).join("; "))}
              aria-current={isToday ? "date" : undefined}
              data-date={d.date}
              className="flex"
            >
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelected(isSelected ? null : d.date)}
                className={`flex min-h-touch-lg w-full flex-col items-center gap-1 rounded-control p-1 ${
                  isSelected ? "border-2 border-accent" : isToday ? "border border-accent" : ""
                } bg-surface-raised`}
              >
                <span className="text-xs text-muted">{weekday}</span>
                <span className="font-numeric text-sm font-semibold">{Number(d.date.slice(8))}</span>
                {lifts.map((lift, j) => (
                  <Mark key={`l${j}`} label={s.home.lift} state={lift.state} s={s} />
                ))}
                {runs.map((run, j) => (
                  <div key={`r${j}`} className="flex flex-col items-center">
                    <Mark label={s.home.run} state={run.state} s={s} />
                    {run.meters ? <span className="font-numeric text-xs text-muted">{formatMiles(run.meters, s)}</span> : null}
                  </div>
                ))}
              </button>
            </li>
          );
        })}
      </ol>
      {day && (
        <div className="flex flex-col gap-3 rounded-control bg-surface-raised p-3" data-testid="day-panel">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">{formatPlanDate(day.date)}</h3>
            <button type="button" onClick={() => setSelected(null)} className="min-h-touch px-2 text-sm text-muted">
              {s.home.day.close}
            </button>
          </div>
          {(() => {
            const planned = day.runs.filter((run) => run.type !== "rest");
            if (planned.length === 0) return <p className="text-sm text-muted">{s.home.day.noRun}</p>;
            return planned.map((run) => (
              <div key={run.id} className="flex flex-col gap-0.5 text-sm">
                <span className="font-medium">
                  {s.home.day.planned(s.running.runTypes[run.type], run.distanceMeters ? formatMiles(run.distanceMeters, s) : null)}
                </span>
                {run.actualMeters ? (
                  <span className={STATE_CLASS[run.status as ItemState]}>
                    {s.home.day.ran(formatMiles(run.actualMeters, s))}
                    {run.gapMeters ? ` ${s.home.day.gap(formatMiles(run.gapMeters, s))}` : ""}
                  </span>
                ) : null}
              </div>
            ));
          })()}
          {day.date <= home.today && (
            <>
              <h4 className="text-sm font-medium">{s.home.day.logTitle}</h4>
              <ManualRunForm key={day.date} date={day.date} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
