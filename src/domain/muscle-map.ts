import type { Muscle } from "./exercise";
import { WGER_MUSCLES } from "./wger";

/**
 * wger's muscle-map diagrams (CC-BY-SA, see vendor/wger-muscles/NOTICE),
 * served from public/images/muscles (npm run muscles:build). Every SVG shares
 * the same 200-unit-wide coordinate space with the origin top-left, so an
 * overlay drawn at the same position and width lines up with its body.
 */

export const MUSCLE_MAP_BODIES = {
  front: "/images/muscles/front.svg",
  back: "/images/muscles/back.svg",
} as const;

export type MuscleMapSide = keyof typeof MUSCLE_MAP_BODIES;

export interface MuscleOverlay {
  wgerId: number;
  side: MuscleMapSide;
  /** Red highlight, for a primary muscle. */
  primaryUrl: string;
  /** Orange highlight, for a secondary muscle. */
  secondaryUrl: string;
}

/** Muscles workout tracker tracks that wger draws as part of another muscle's region. */
const EXTRA_WGER_IDS: Partial<Record<Muscle, number[]>> = { "middle back": [9] };

/** The wger overlays that show `muscle` (empty for muscles wger doesn't draw, e.g. forearms, neck). */
export function muscleMapFor(muscle: Muscle): MuscleOverlay[] {
  const ids = Object.entries(WGER_MUSCLES)
    .filter(([, m]) => m.muscle === muscle)
    .map(([id]) => Number(id));
  return [...ids, ...(EXTRA_WGER_IDS[muscle] ?? [])].map((wgerId) => ({
    wgerId,
    side: WGER_MUSCLES[wgerId]!.isFront ? "front" : "back",
    primaryUrl: `/images/muscles/main/muscle-${wgerId}.svg`,
    secondaryUrl: `/images/muscles/secondary/muscle-${wgerId}.svg`,
  }));
}
