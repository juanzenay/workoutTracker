import { z } from "zod";
import type { IsoDate } from "@/domain/block";
import { isMuscleDetail, MUSCLE_DETAILS, type MuscleDetail } from "@/domain/muscle-detail";
import { addDays } from "@/engine/dates";
import { planTimeZone, planToday } from "./blocks";
import { defineCommand } from "./define";

export interface MuscleTraining {
  muscle: MuscleDetail;
  /** Working sets of exercises with this as a primary muscle. */
  primarySets: number;
  /** Working sets of exercises with this as a secondary muscle. */
  secondarySets: number;
  /** primarySets + secondarySets / 2 over the window. */
  sets: number;
  /** `sets` scaled to a week: what the heatmap shades by. */
  weeklySets: number;
  /** Shade: 0 = untrained, else 1–4 by quarters of WEEKLY_SET_TARGET. */
  level: HeatLevel;
}

/**
 * Weekly working sets per muscle that earn full colour: the point where
 * hypertrophy dose-response meta-analyses see growth still rising (about
 * 10–20 sets a week, with diminishing returns beyond it).
 */
export const WEEKLY_SET_TARGET = 15;

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Recent training per muscle, for the Analytics muscle heatmap: working sets
 * (completed, non-warm-up, with reps) of finished workouts started in the
 * `days` days ending `through` (default today, plan time zone). Every muscle
 * (finer muscles where the catalogue has them, see muscle-detail.ts) is listed,
 * untrained ones at zero; exercises without a finer assignment count toward
 * their plain muscles. Shading is absolute, against WEEKLY_SET_TARGET, not
 * relative to the most-trained muscle.
 */
export const getMuscleHeatmap = defineCommand({
  input: z.object({ days: z.number().int().min(1).max(365).default(14), through: z.iso.date().optional() }),
  async run({ tx }, input) {
    const zone = await planTimeZone(tx);
    const today = await planToday(tx, zone);
    const through: IsoDate = input.through ?? today;
    const from = addDays(through, 1 - input.days);

    const rows = await tx<
      {
        primary_muscles: string[];
        secondary_muscles: string[];
        primary_detail: string[] | null;
        secondary_detail: string[] | null;
        sets: number;
      }[]
    >`
      select e.primary_muscles, e.secondary_muscles, e.primary_detail, e.secondary_detail, count(*)::int as sets
      from public.workouts w
      join public.workout_exercises we on we.workout_id = w.id
      join public.exercises e on e.id = we.exercise_id
      join public.workout_sets s on s.workout_exercise_id = we.id
      where w.finished_at is not null and w.discarded_at is null
        and (w.started_at at time zone ${zone})::date between ${from}::date and ${through}::date
        and s.completed and s.set_type <> 'warmup' and s.reps > 0
      group by e.id`;

    const totals = new Map<MuscleDetail, { primarySets: number; secondarySets: number }>(
      MUSCLE_DETAILS.map((m) => [m, { primarySets: 0, secondarySets: 0 }]),
    );
    for (const row of rows) {
      for (const m of (row.primary_detail ?? row.primary_muscles).filter(isMuscleDetail)) {
        totals.get(m)!.primarySets += row.sets;
      }
      for (const m of (row.secondary_detail ?? row.secondary_muscles).filter(isMuscleDetail)) {
        totals.get(m)!.secondarySets += row.sets;
      }
    }
    const weeks = input.days / 7;
    const muscles: MuscleTraining[] = MUSCLE_DETAILS.map((muscle) => {
      const { primarySets, secondarySets } = totals.get(muscle)!;
      const sets = primarySets + secondarySets / 2;
      const weeklySets = sets / weeks;
      const level = Math.min(4, Math.ceil((weeklySets / WEEKLY_SET_TARGET) * 4)) as HeatLevel;
      return { muscle, primarySets, secondarySets, sets, weeklySets, level };
    });
    return { today, from, through, days: input.days, muscles, weeklyTarget: WEEKLY_SET_TARGET, windowTarget: WEEKLY_SET_TARGET * weeks };
  },
});
