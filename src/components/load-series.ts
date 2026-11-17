import { formatMiles } from "@/components/planned-run";
import { formatPlanDate } from "@/components/planned-session";
import type { CommandOutput } from "@/server/commands";
import type { Strings } from "@/strings";

/** One weekly series of the training load, ready for WeeklyBars. */
export interface LoadSeries {
  label: string;
  format: (value: number) => string;
  weeks: { week: string; value: number }[];
}

/** Lifting volume, running distance and running time, week by week (the Analytics charts and Today's summary). */
export function loadSeries(load: CommandOutput<"getTrainingLoad">, s: Strings): LoadSeries[] {
  const week = (start: string) => s.analytics.weekOf(formatPlanDate(start));
  const minutes = (seconds: number) => s.history.duration(Math.round(seconds / 60));
  return [
    {
      label: s.analytics.liftingVolume,
      format: s.analytics.pounds,
      weeks: load.weeks.map((w) => ({ week: week(w.weekStart), value: w.lifting.volume })),
    },
    {
      label: s.analytics.runningDistance,
      format: (m: number) => formatMiles(m, s),
      weeks: load.weeks.map((w) => ({ week: week(w.weekStart), value: w.running.distanceMeters })),
    },
    {
      label: s.analytics.runningTime,
      format: minutes,
      weeks: load.weeks.map((w) => ({ week: week(w.weekStart), value: w.running.movingSeconds })),
    },
  ];
}
