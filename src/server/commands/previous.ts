import { z } from "zod";
import { NO_GYM_KEY, type LastMachinesByGym, type PreviousByMachine, type PreviousSet, type PreviousSets } from "@/domain/routine";
import type { SetType, WeightUnit } from "@/domain/workout";
import { defineCommand } from "./define";

interface PreviousRow {
  exercise_id: string;
  machine_id: string | null;
  finished_at: Date;
  sets: { set_type: SetType; weight: number | string | null; unit: WeightUnit; reps: number | null }[];
}

/**
 * "Previous" for the logger: the completed sets of the most recent finished workout that included
 * an exercise, numbered from 0 in set order (so set row N shows previous[N]). Unfinished workouts
 * never count. With no `exerciseIds`, returns every exercise ever done.
 *
 * Weights differ between machines, so history is kept per machine:
 * - `previous`: by exercise, from the last time it was done with no machine;
 * - `previousByMachine`: by machine, from the last time that machine was used;
 * - `lastMachinesByGym`: by gym (NO_GYM_KEY = a workout with no gym), then exercise, the machine it was last
 *   done on there (null = none), which new workouts at that gym pre-select.
 */
export const getPreviousSets = defineCommand({
  input: z.object({ exerciseIds: z.array(z.uuid()).max(2_000).optional() }),
  async run({ tx }, { exerciseIds }) {
    const rows = await tx<PreviousRow[]>`
      with latest as (
        select distinct on (we.exercise_id, we.machine_id) we.exercise_id, we.machine_id, we.id, w.finished_at
        from public.workout_exercises we
        join public.workouts w on w.id = we.workout_id
        where w.finished_at is not null and w.discarded_at is null
          and exists (select 1 from public.workout_sets s where s.workout_exercise_id = we.id and s.completed)
          ${exerciseIds ? tx`and we.exercise_id = any(${tx.array(exerciseIds)}::uuid[])` : tx``}
        order by we.exercise_id, we.machine_id, w.finished_at desc, we.position
      )
      select l.exercise_id, l.machine_id, l.finished_at,
        (select json_agg(json_build_object(
            'set_type', s.set_type, 'weight', s.weight, 'unit', s.unit, 'reps', s.reps
          ) order by s.position, s.created_at)
          from public.workout_sets s where s.workout_exercise_id = l.id and s.completed) as sets
      from latest l
      order by l.finished_at desc`;

    const lastRows = await tx<{ exercise_id: string; gym_id: string | null; machine_id: string | null }[]>`
      select distinct on (we.exercise_id, w.gym_id) we.exercise_id, w.gym_id, we.machine_id
      from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id
      where w.finished_at is not null and w.discarded_at is null
        and exists (select 1 from public.workout_sets s where s.workout_exercise_id = we.id and s.completed)
        ${exerciseIds ? tx`and we.exercise_id = any(${tx.array(exerciseIds)}::uuid[])` : tx``}
      order by we.exercise_id, w.gym_id, w.finished_at desc, we.position`;

    const toSets = (row: PreviousRow): PreviousSet[] =>
      row.sets.map((s, position) => ({
        position,
        setType: s.set_type,
        weight: s.weight === null ? null : Number(s.weight),
        unit: s.unit,
        reps: s.reps,
      }));

    const previous: PreviousSets = {};
    const previousByMachine: PreviousByMachine = {};
    const lastMachinesByGym: LastMachinesByGym = {};
    for (const row of lastRows) {
      (lastMachinesByGym[row.gym_id ?? NO_GYM_KEY] ??= {})[row.exercise_id] = row.machine_id;
    }
    for (const row of rows) {
      if (row.machine_id === null) previous[row.exercise_id] = toSets(row);
      else previousByMachine[row.machine_id] = toSets(row);
    }
    return { previous, previousByMachine, lastMachinesByGym };
  },
});
