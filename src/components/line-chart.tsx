const WIDTH = 320;
const HEIGHT = 120;
const PAD = 8;

export interface ChartPoint {
  /** ISO date or timestamp. */
  date: string;
  value: number;
}

/** Small line chart over real time (uneven gaps stay uneven), with the latest value and range as text. */
export function LineChart({ points, label, format }: { points: ChartPoint[]; label: string; format: (v: number) => string }) {
  if (points.length === 0) return null;
  const times = points.map((p) => Date.parse(p.date));
  const values = points.map((p) => p.value);
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  const [v0, v1] = [Math.min(...values), Math.max(...values)];
  const x = (t: number) => (t1 === t0 ? WIDTH / 2 : PAD + ((t - t0) / (t1 - t0)) * (WIDTH - 2 * PAD));
  const y = (v: number) => (v1 === v0 ? HEIGHT / 2 : HEIGHT - PAD - ((v - v0) / (v1 - v0)) * (HEIGHT - 2 * PAD));
  const coords = points.map((p, i) => [x(times[i]!), y(p.value)] as const);

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-numeric text-muted">
          {format(values.at(-1)!)}
          {v1 !== v0 && ` (${format(v0)}–${format(v1)})`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        className="h-32 w-full rounded-card border border-border bg-surface text-accent"
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
    </figure>
  );
}
