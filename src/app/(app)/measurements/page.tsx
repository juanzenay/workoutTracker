import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { PendingLink } from "@/components/ui/pending-link";
import {
  BODY_METRIC_KEYS,
  bodyMetricHistory,
  unitFor,
} from "@/domain/body-measurement";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";

export default async function MeasurementsPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { items } = await commands.listBodyMeasurements({});
  const trends = BODY_METRIC_KEYS.map((metric) => bodyMetricHistory(items, metric)).filter(
    (h) => h.trend !== null,
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{s.measurements.title}</h1>
        <Link
          href="/measurements/new"
          className="flex min-h-touch items-center rounded-control bg-accent px-4 text-sm font-medium text-accent-fg"
        >
          {s.measurements.log}
        </Link>
      </div>

      {items.length === 0 ? (
        <EmptyState>{s.measurements.empty}</EmptyState>
      ) : (
        <>
          <section>
            <h2 className="mb-2 font-semibold">{s.measurements.trends}</h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {trends.map(({ metric, unit, trend }) => (
                <li key={metric}>
                  <PendingLink
                    href={`/measurements/metric/${metric}`}
                    className="flex min-h-touch-lg flex-col rounded-card border border-border bg-surface p-3"
                  >
                    <span className="text-sm text-muted">{s.bodyMetrics[metric]}</span>
                    <span className="font-numeric text-lg font-semibold">
                      {s.measurements.value(trend!.latest.value, unit!)}
                    </span>
                    <span className="font-numeric text-xs text-muted">
                      {s.measurements.change(trend!.changeSincePrevious, unit!)}
                    </span>
                  </PendingLink>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">{s.measurements.entries}</h2>
            <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
              {items.map((entry) => (
                <li key={entry.id}>
                  <PendingLink
                    href={`/measurements/${entry.id}`}
                    className="flex min-h-touch flex-col gap-0.5 px-3 py-2"
                    aria-label={`${s.measurements.edit} ${entry.date}`}
                  >
                    <span className="font-numeric font-medium">{entry.date}</span>
                    <span className="text-sm text-muted">
                      {BODY_METRIC_KEYS.filter((m) => entry.values[m] != null)
                        .map(
                          (m) =>
                            `${s.bodyMetrics[m]} ${s.measurements.value(entry.values[m]!, unitFor(m, entry))}`,
                        )
                        .join(" · ")}
                    </span>
                  </PendingLink>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
