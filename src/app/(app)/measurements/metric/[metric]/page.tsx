import Link from "next/link";
import { notFound } from "next/navigation";
import { BODY_METRIC_KEYS, type BodyMetricPoint } from "@/domain/body-measurement";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";

const WIDTH = 320;
const HEIGHT = 120;
const PAD = 8;

/** Line chart of points over real time (uneven gaps between dates stay uneven). */
function TrendChart({ points, label }: { points: BodyMetricPoint[]; label: string }) {
  const times = points.map((p) => Date.parse(p.date));
  const values = points.map((p) => p.value);
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  const [v0, v1] = [Math.min(...values), Math.max(...values)];
  const x = (t: number) => (t1 === t0 ? WIDTH / 2 : PAD + ((t - t0) / (t1 - t0)) * (WIDTH - 2 * PAD));
  const y = (v: number) =>
    v1 === v0 ? HEIGHT / 2 : HEIGHT - PAD - ((v - v0) / (v1 - v0)) * (HEIGHT - 2 * PAD);
  const coords = points.map((p, i) => [x(times[i]!), y(p.value)] as const);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
      className="h-40 w-full rounded-card border border-border bg-surface text-accent"
      preserveAspectRatio="none"
    >
      <polyline
        points={coords.map(([cx, cy]) => `${cx},${cy}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
      {coords.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={3} fill="currentColor" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

export default async function MetricPage({ params }: PageProps<"/measurements/metric/[metric]">) {
  const s = await getRequestStrings();
  const { metric: raw } = await params;
  const metric = BODY_METRIC_KEYS.find((m) => m === raw);
  if (!metric) notFound();

  const commands = await requireCommands();
  const { unit, points, trend } = await commands.getBodyMetricHistory({ metric });
  const name = s.bodyMetrics[metric];

  return (
    <div className="flex flex-col gap-4">
      <Link href="/measurements" className="flex min-h-touch items-center text-sm text-muted">
        ← {s.measurements.back}
      </Link>
      <h1 className="text-2xl font-semibold">{name}</h1>

      {!trend || !unit ? (
        <p className="text-muted">{s.measurements.noHistory}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2">
            {(
              [
                [s.measurements.latest, s.measurements.value(trend.latest.value, unit)],
                [s.measurements.sincePrevious, s.measurements.change(trend.changeSincePrevious, unit)],
                [s.measurements.sinceFirst, s.measurements.change(trend.changeSinceFirst, unit)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-card border border-border bg-surface p-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="font-numeric font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <TrendChart points={points} label={s.measurements.chartLabel(name)} />
          <section>
            <h2 className="mb-2 font-semibold">{s.measurements.history}</h2>
            <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
              {points.toReversed().map((p) => (
                <li key={p.date} className="flex min-h-touch items-center justify-between px-3 font-numeric">
                  <span>{p.date}</span>
                  <span>{s.measurements.value(p.value, unit)}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
