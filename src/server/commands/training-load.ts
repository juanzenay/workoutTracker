import { z } from "zod";
import type { IsoDate, PlannedExercise } from "@/domain/block";
import { convertWeight } from "@/domain/records";
import type { SetType, WeightUnit } from "@/domain/workout";
import { addDays, isoWeekday } from "@/engine/dates";
import { planTimeZone, planToday } from "./blocks";
import { defineCommand } from "./define";
import { RUN_SPORT_TYPES } from "./run-matching";

export interface WeekLoad {
  /** Monday. */
  weekStart: IsoDate;
  /** Sunday. */
  weekEnd: IsoDate;
  lifting: {
    /** Finished workouts started this week. */
    workouts: number;
    /** Completed, non-warm-up sets with reps. */
    workingSets: number;
    /** Σ weight × reps of working sets, in lb (1 decimal). */
    volume: number;
    /** Working sets per primary muscle. */
    setsByMuscle: Record<string, number>;
    plannedSessions: number;
    /** Planned sessions on a day with a finished workout. */
    completedSessions: number;
    /** Σ weight × reps of the planned sessions' non-warm-up sets, in lb (1 decimal). */
    plannedVolume: number;
  };
  running: {
    /** Planned runs other than rest days. */
    plannedRuns: number;
    /** Planned distance; race rows without a distance count the race's. */
    plannedDistanceMeters: number;
    plannedDurationSeconds: number;
    /** Runs recorded on Strava (Run, TrailRun, VirtualRun) on their local date. */
    runs: number;
    /** Their distance (1 decimal). */
    distanceMeters: number;
    /** Their moving time. */
    movingSeconds: number;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Weekly training load (Monday–Sunday, plan time zone) for the `weeks` weeks
 * ending with the week containing `through` (default today), oldest first:
 * lifting done and planned (workouts, working sets, volume, sets per muscle,
 * planned sessions completed, planned volume) and running planned and run
 * (Strava activities).
 */
export const getTrainingLoad = defineCommand({
  input: z.object({ weeks: z.number().int().min(1).max(52).default(8), through: z.iso.date().optional() }),
  async run({ tx }, input) {
    const zone = await planTimeZone(tx);
    const today = await planToday(tx, zone);
    const through = input.through ?? today;
    const lastMonday = addDays(through, 1 - isoWeekday(through));
    const from = addDays(lastMonday, -7 * (input.weeks - 1));
    const to = addDays(lastMonday, 6);

    const sets = await tx<
      {
        workout_id: string;
        date: string;
        set_type: SetType;
        weight: string | null;
        unit: WeightUnit;
        reps: number | null;
        completed: boolean;
        muscles: string[];
      }[]
    >`
      select w.id as workout_id, to_char(w.started_at at time zone ${zone}, 'YYYY-MM-DD') as date,
        s.set_type, s.weight, s.unit, s.reps, s.completed, e.primary_muscles as muscles
      from public.workouts w
      left join public.workout_exercises we on we.workout_id = w.id
      left join public.exercises e on e.id = we.exercise_id
      left join public.workout_sets s on s.workout_exercise_id = we.id
      where w.finished_at is not null and w.discarded_at is null
        and (w.started_at at time zone ${zone})::date between ${from}::date and ${to}::date`;
    const sessions = await tx<{ date: string; done: boolean; exercises: PlannedExercise[] }[]>`
      select to_char(p.date, 'YYYY-MM-DD') as date, p.exercises,
        exists (
          select 1 from public.workouts w
          where w.finished_at is not null and w.discarded_at is null and (w.started_at at time zone b.time_zone)::date = p.date
        ) as done
      from public.planned_sessions p join public.blocks b on b.id = p.block_id
      where p.date between ${from}::date and ${to}::date`;
    const runs = await tx<{ date: string; type: string; distance_meters: number | null; duration_seconds: number | null }[]>`
      select to_char(r.date, 'YYYY-MM-DD') as date, r.type, r.duration_seconds,
        coalesce(r.distance_meters, case when r.type = 'race' then race.distance_meters end) as distance_meters
      from public.planned_runs r
      join public.run_plans p on p.id = r.run_plan_id
      left join public.races race on race.id = p.race_id
      where r.date between ${from}::date and ${to}::date and r.type <> 'rest'`;
    const activities = await tx<{ date: string; distance_meters: string; moving_seconds: number | null }[]>`
      select to_char(local_date, 'YYYY-MM-DD') as date, distance_meters::text, moving_seconds
      from public.activities
      where sport_type = any(${tx.array([...RUN_SPORT_TYPES])}::text[])
        and local_date between ${from}::date and ${to}::date`;

    const weeks: WeekLoad[] = Array.from({ length: input.weeks }, (_, i) => {
      const weekStart = addDays(from, 7 * i);
      const weekEnd = addDays(weekStart, 6);
      const inWeek = (date: IsoDate) => date >= weekStart && date <= weekEnd;

      const weekSets = sets.filter((s) => inWeek(s.date));
      const working = weekSets.filter(
        (s) => s.completed && s.set_type !== "warmup" && s.reps !== null && s.reps > 0,
      );
      const setsByMuscle: Record<string, number> = {};
      for (const s of working) for (const m of s.muscles ?? []) setsByMuscle[m] = (setsByMuscle[m] ?? 0) + 1;
      const volume = working.reduce(
        (sum, s) => (s.weight === null ? sum : sum + convertWeight(Number(s.weight), s.unit, "lb") * s.reps!),
        0,
      );
      const weekSessions = sessions.filter((s) => inWeek(s.date));
      const weekRuns = runs.filter((r) => inWeek(r.date));
      const weekActivities = activities.filter((a) => inWeek(a.date));
      const plannedVolume = weekSessions
        .flatMap((s) => s.exercises.flatMap((e) => e.sets))
        .filter((set) => set.setType !== "warmup" && set.weight !== null)
        .reduce((sum, set) => sum + convertWeight(set.weight!, set.unit, "lb") * set.reps, 0);
      return {
        weekStart,
        weekEnd,
        lifting: {
          workouts: new Set(weekSets.map((s) => s.workout_id)).size,
          workingSets: working.length,
          volume: round1(volume),
          setsByMuscle,
          plannedSessions: weekSessions.length,
          completedSessions: weekSessions.filter((s) => s.done).length,
          plannedVolume: round1(plannedVolume),
        },
        running: {
          plannedRuns: weekRuns.length,
          plannedDistanceMeters: weekRuns.reduce((sum, r) => sum + (r.distance_meters ?? 0), 0),
          plannedDurationSeconds: weekRuns.reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0),
          runs: weekActivities.length,
          distanceMeters: round1(weekActivities.reduce((sum, a) => sum + Number(a.distance_meters), 0)),
          movingSeconds: weekActivities.reduce((sum, a) => sum + (a.moving_seconds ?? 0), 0),
        },
      };
    });
    return { unit: "lb" as const, today, weeks };
  },
});
