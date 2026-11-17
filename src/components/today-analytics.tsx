import Link from "next/link";
import type { CommandOutput } from "@/server/commands";
import type { Strings } from "@/strings";
import { loadSeries } from "./load-series";
import { MuscleHeatmap } from "./muscle-heatmap";
import { WeeklyBars } from "./weekly-bars";

/** Today's compact analytics: recent weekly volume and distance, and the muscle heatmap, linking to the full page. */
export function TodayAnalytics({
  load,
  heatmap,
  s,
}: {
  load: CommandOutput<"getTrainingLoad">;
  heatmap: CommandOutput<"getMuscleHeatmap">;
  s: Strings;
}) {
  // The first two series are volume and distance; running time stays on the Analytics page.
  const series = loadSeries(load, s).slice(0, 2);
  return (
    <section aria-labelledby="today-analytics" className="flex flex-col gap-4 rounded-card bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-analytics" className="text-xl font-semibold">
          {s.analytics.title}
        </h2>
        <Link href="/analytics" className="text-sm text-muted">
          {s.today.allAnalytics}
        </Link>
      </div>
      {series.map((c) => (
        <WeeklyBars
          key={c.label}
          label={c.label}
          weeks={c.weeks}
          format={c.format}
          maxLabel={s.analytics.max}
          barTitle={s.analytics.barTitle}
        />
      ))}
      <MuscleHeatmap heatmap={heatmap} />
    </section>
  );
}
