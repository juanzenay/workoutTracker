/** Largest and smallest font sizes (px) a stat value is drawn at on the share card. */
export const STAT_MAX_PX = 46;
export const STAT_MIN_PX = 18;
/** Line spacing, as a multiple of font size, for a value wrapped onto two lines. */
export const STAT_LINE_HEIGHT = 1.2;

/** Rendered width of `text` at `px`. The canvas supplies this, so proportional fonts are measured, not estimated. */
export type MeasureFn = (text: string, px: number) => number;

export type FittedStat = { lines: string[]; px: number };

/** Shrinks a stat value's font until it fits `maxWidth` on one line. */
export function fitStatValue(text: string, maxWidth: number, measure: MeasureFn): FittedStat {
  for (let px = STAT_MAX_PX; px >= STAT_MIN_PX; px -= 2) {
    if (measure(text, px) <= maxWidth) return { lines: [text], px };
  }
  const measureMin = (t: string) => measure(t, STAT_MIN_PX);
  const lines = balancedSplit(text, measureMin) ?? [text];
  // Last resort, only when even the two-line wrap is too wide: cut each line to fit, with an ellipsis.
  return { lines: lines.map((line) => ellipsise(line, maxWidth, measureMin)), px: STAT_MIN_PX };
}

function ellipsise(text: string, maxWidth: number, measure: (text: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  for (let n = text.length - 1; n > 0; n--) {
    const cut = text.slice(0, n) + "…";
    if (measure(cut) <= maxWidth) return cut;
  }
  return "…";
}

/** Splits at the space that makes the wider half narrowest, or returns null when there is no space. */
function balancedSplit(text: string, measure: (text: string) => number): [string, string] | null {
  let best: [string, string] | null = null;
  let bestWidth = Infinity;
  for (let i = text.indexOf(" "); i !== -1; i = text.indexOf(" ", i + 1)) {
    const halves: [string, string] = [text.slice(0, i), text.slice(i + 1)];
    const widest = Math.max(measure(halves[0]), measure(halves[1]));
    if (widest < bestWidth) {
      best = halves;
      bestWidth = widest;
    }
  }
  return best;
}
