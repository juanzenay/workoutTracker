const WIDTH = 320;
const HEIGHT = 80;
const GAP = 2;
const RADIUS = 4;

export interface WeekValue {
  /** Shown in the bar's tooltip, e.g. "Week of Mon, Oct 6". */
  week: string;
  value: number;
}

/** A bar with rounded top corners standing on the baseline. */
function barPath(x: number, width: number, height: number): string {
  const r = Math.min(RADIUS, width / 2, height);
  const top = HEIGHT - height;
  return [
    `M${x},${HEIGHT}`,
    `V${top + r}`,
    `Q${x},${top} ${x + r},${top}`,
    `H${x + width - r}`,
    `Q${x + width},${top} ${x + width},${top + r}`,
    `V${HEIGHT}`,
    "Z",
  ].join(" ");
}

/**
 * One weekly series as columns on a zero baseline. Charts with the same number
 * of weeks line up column for column, so stacking several (small multiples)
 * compares measures of different units on the same weeks without a second axis.
 */
export function WeeklyBars({
  label,
  weeks,
  format,
  maxLabel,
  barTitle,
}: {
  label: string;
  weeks: WeekValue[];
  format: (v: number) => string;
  maxLabel: (formatted: string) => string;
  barTitle: (week: string, formatted: string) => string;
}) {
  const max = Math.max(0, ...weeks.map((w) => w.value));
  const column = WIDTH / weeks.length;
  const latest = weeks.at(-1);

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-numeric text-muted">
          {latest && format(latest.value)}
          {max > 0 && ` · ${maxLabel(format(max))}`}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label} className="h-auto w-full text-accent">
        {weeks.map((w, i) => {
          const height = max === 0 ? 0 : (w.value / max) * (HEIGHT - 2);
          const x = i * column + GAP / 2;
          return (
            <g key={i} className="hover:opacity-80">
              <title>{barTitle(w.week, format(w.value))}</title>
              <rect x={i * column} y={0} width={column} height={HEIGHT} fill="transparent" />
              {height > 0 && <path d={barPath(x, column - GAP, Math.max(height, 1))} fill="currentColor" />}
            </g>
          );
        })}
        <line x1={0} x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} className="stroke-border" strokeWidth={1} />
      </svg>
    </figure>
  );
}
