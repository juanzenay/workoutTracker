import type { Muscle } from "./exercise";
import { detailParent, isOtherDetail, type MuscleDetail } from "./muscle-detail";

/**
 * What the heatmap is narrowed to: a muscle tapped on the body (the list shows
 * just its parts) or a row tapped in the list (the body shows just that part).
 */
export type MuscleFocus = { by: "map"; group: Muscle } | { by: "list"; muscle: MuscleDetail };

interface Trained<L extends number = number> {
  muscle: MuscleDetail;
  sets: number;
  level: L;
}

/** The rows the list shows: every part, except empty "other" rows, narrowed to the tapped group. */
export function listMuscles<T extends Trained>(muscles: T[], focus: MuscleFocus | null): T[] {
  return muscles.filter(
    (m) =>
      (m.sets > 0 || !isOtherDetail(m.muscle)) && (focus?.by !== "map" || detailParent(m.muscle) === focus.group),
  );
}

export interface BodyShade<L extends number = number> {
  level: L;
  sets: number;
  /** Drawn faintly because something else is focused. */
  dim: boolean;
}

/**
 * How the body diagram shades each muscle it draws. It draws whole muscles, so
 * by default each is shaded by its most-trained part. A tapped row shows only
 * that part's own shade, and a tapped muscle keeps the rest of the body dimmed.
 */
export function bodyShading<L extends number>(muscles: Trained<L>[], focus: MuscleFocus | null): Map<Muscle, BodyShade<L>> {
  const shades = new Map<Muscle, BodyShade<L>>();
  if (focus?.by === "list") {
    const m = muscles.find((t) => t.muscle === focus.muscle);
    if (m && m.level > 0) shades.set(detailParent(m.muscle), { level: m.level, sets: m.sets, dim: false });
    return shades;
  }
  for (const m of muscles) {
    const group = detailParent(m.muscle);
    const best = shades.get(group);
    if (m.level > 0 && (!best || m.sets > best.sets)) {
      shades.set(group, { level: m.level, sets: m.sets, dim: focus !== null && group !== focus.group });
    }
  }
  return shades;
}
