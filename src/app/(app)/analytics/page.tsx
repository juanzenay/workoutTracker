import Link from "next/link";
import { MuscleHeatmap } from "@/components/muscle-heatmap";
import { formatPlanDate } from "@/components/planned-session";
import { PlanUpdates } from "@/components/plan-updates";
import { loadSeries } from "@/components/load-series";
import { WeeklyBars } from "@/components/weekly-bars";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";

/** Heatmap windows offered, in days. */
const WINDOWS = [7, 14, 28, 90] as const;
const DEFAULT_WINDOW = 14;
const LOAD_WEEKS = 12;

/** The detailed data, kept out of the way: per-exercise charts, the muscle heatmap and training load over time. */
export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { days: rawDays } = await searchParams;
  const days = WINDOWS.find((w) => String(w) === rawDays) ?? DEFAULT_WINDOW;

  const [heatmap, load, records, pending, applied] = await Promise.all([
    commands.getMuscleHeatmap({ days }),
    commands.getTrainingLoad({ weeks: LOAD_WEEKS }),
    commands.listRecords({}),
    commands.listPlanRevisions({ status: ["pending"] }),
    commands.listPlanRevisions({ status: ["applied"], withinDays: 7, limit: 10 }),
  ]);

  const series = loadSeries(load, s);
  const first = load.weeks[0]!;
  const last = load.weeks.at(-1)!;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-semibold">{s.analytics.title}</h1>

      <PlanUpdates revisions={[...pending.revisions, ...applied.revisions]} s={s} />

      <section aria-labelledby="heatmap" className="flex flex-col gap-3">
        <h2 id="heatmap" className="font-semibold">
          {s.analytics.heatmap}
        </h2>
        <p className="text-sm text-muted">{s.analytics.heatmapIntro}</p>
        <nav aria-label={s.analytics.window} className="flex flex-wrap items-center gap-2 text-sm">
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={`/analytics?days=${w}`}
              aria-current={w === days ? "page" : undefined}
              className="flex min-h-touch items-center rounded-control border border-border-strong px-3 aria-[current=page]:bg-accent aria-[current=page]:text-accent-fg"
            >
              {s.analytics.windowDays(w)}
            </Link>
          ))}
          <span className="text-muted">
            {s.analytics.windowRange(formatPlanDate(heatmap.from), formatPlanDate(heatmap.through))}
          </span>
        </nav>
        <MuscleHeatmap heatmap={heatmap} />
      </section>

      <section aria-labelledby="load" className="flex flex-col gap-3">
        <h2 id="load" className="font-semibold">
          {s.analytics.load}
        </h2>
        <p className="text-sm text-muted">{s.analytics.loadIntro(LOAD_WEEKS)}</p>
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
        <div className="flex justify-between text-xs text-muted">
          <span>{formatPlanDate(first.weekStart)}</span>
          <span>{formatPlanDate(last.weekStart)}</span>
        </div>
        <details className="text-sm">
          <summary className="flex min-h-touch cursor-pointer items-center text-muted">{s.analytics.table}</summary>
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="py-1 font-normal">{s.analytics.week}</th>
                {series.map((c) => (
                  <th key={c.label} className="py-1 text-right font-normal">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-numeric">
              {load.weeks.map((w, i) => (
                <tr key={w.weekStart} className="border-t border-border">
                  <td className="whitespace-nowrap py-1">{formatPlanDate(w.weekStart)}</td>
                  {series.map((c) => (
                    <td key={c.label} className="py-1 text-right">
                      {c.format(c.weeks[i]!.value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section aria-labelledby="exercise-charts" className="flex flex-col gap-3">
        <h2 id="exercise-charts" className="font-semibold">
          {s.analytics.exerciseCharts}
        </h2>
        {records.items.length === 0 ? (
          <p className="text-sm text-muted">{s.analytics.exerciseChartsEmpty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border text-sm">
            {records.items.map((item) => (
              <li key={item.exerciseId}>
                <Link href={`/exercises/${item.exerciseId}`} className="flex min-h-touch items-center px-3">
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
