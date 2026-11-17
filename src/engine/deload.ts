import type { Block, BlockExercise, IsoDate, PlannedSet } from "@/domain/block";
import type { Race } from "@/domain/running";
import { addDays, daysBetween, isoWeekday } from "./dates";
import type { ProgressionResult } from "./progression";

/**
 * Deloads: planned lighter weeks in a block. Two separate pieces so either can
 * be changed on its own:
 * - **placement** (`alignDeloads`): which weeks are deloads — the weeks the
 *   owner set on the block (`placeDeloads`), moved to line up with A races'
 *   race weeks (end of the taper) and post-race weeks.
 * - **shape** (`deloadTargets` + `DELOAD`): what a deload session looks like.
 */

/** Deload session shape: this share of the sets (rounded up, at least 1) at this share of the load. */
export const DELOAD = { volume: 0.5, intensity: 0.9 } as const;

/** The block's deload weeks as the owner set them (1-based), in order. */
export function placeDeloads(block: Block): number[] {
  return [...new Set(block.deloadWeeks ?? [])].filter((w) => w >= 1 && w <= block.weeks).toSorted((a, b) => a - b);
}

/**
 * Aligning deloads with racing (tunable): every A race's week (the end of the
 * taper) and the week after it are deloads; an owner-set deload within
 * `shiftWithinWeeks` of one of those moves there (it is dropped).
 */
export const DELOAD_ALIGNMENT = { shiftWithinWeeks: 2 } as const;

/** What one A race did to a block's deloads. Week numbers are the block's (1-based); null = outside the block. */
export interface DeloadAlignment {
  race: Race;
  raceWeek: number | null;
  postRaceWeek: number | null;
  /** Owner-set deload weeks that moved to line up with this race. */
  dropped: number[];
}

export interface DeloadPlacement {
  /** Final deload weeks, in order. */
  weeks: number[];
  /** One per A race touching the block. */
  alignments: DeloadAlignment[];
}

/** The block's deloads: the owner's, lined up with A races' race weeks and post-race weeks. */
export function alignDeloads(block: Block, races: Race[]): DeloadPlacement {
  const owner = placeDeloads(block);
  const alignments: DeloadAlignment[] = [];
  for (const race of races.filter((r) => r.priority === "A").toSorted((a, b) => a.date.localeCompare(b.date))) {
    const raceMonday = addDays(race.date, 1 - isoWeekday(race.date));
    const raceWeek = blockWeekOf(block, raceMonday);
    const postRaceWeek = blockWeekOf(block, addDays(raceMonday, 7));
    if (raceWeek === null && postRaceWeek === null) continue;
    alignments.push({ race, raceWeek, postRaceWeek, dropped: [] });
  }
  const aligned = new Set(alignments.flatMap((a) => [a.raceWeek, a.postRaceWeek]).filter((w) => w !== null));
  const kept: number[] = [];
  for (const week of owner) {
    const mover = aligned.has(week)
      ? undefined
      : alignments.find((a) =>
          [a.raceWeek, a.postRaceWeek].some((w) => w !== null && Math.abs(w - week) <= DELOAD_ALIGNMENT.shiftWithinWeeks),
        );
    if (mover) mover.dropped.push(week);
    else kept.push(week);
  }
  return { weeks: [...new Set([...kept, ...aligned])].toSorted((a, b) => a - b), alignments };
}

/** The block week (1-based) holding most of the Monday–Sunday week starting `monday`; null if none does. */
function blockWeekOf(block: Block, monday: IsoDate): number | null {
  const offset = daysBetween(block.startDate, monday);
  const week = Math.round(offset / 7) + 1;
  return week >= 1 && week <= block.weeks ? week : null;
}

/**
 * A deload session's targets from what the session would otherwise have been
 * (`normal`): fewer sets, load cut to ~90% and rounded down to the exercise's
 * increment, reps at the bottom of the range.
 */
export function deloadTargets(exercise: BlockExercise, normal: ProgressionResult): ProgressionResult {
  const base = normal.sets[0]?.weight ?? null;
  const count = Math.max(1, Math.ceil(exercise.sets * DELOAD.volume));
  const weight = base === null ? null : Math.floor((base * DELOAD.intensity) / exercise.increment) * exercise.increment;
  const sets: PlannedSet[] = Array.from({ length: count }, (_, position) => ({
    position,
    setType: "normal",
    weight,
    unit: exercise.unit,
    reps: exercise.repRangeStart,
  }));
  return {
    sets,
    progression: {
      decision: "deload",
      fromWeight: base,
      reason: {
        code: "deloadWeek",
        sets: count,
        reps: exercise.repRangeStart,
        weight,
        from: base,
        unit: exercise.unit,
        share: Math.round(DELOAD.intensity * 100),
      },
    },
  };
}
