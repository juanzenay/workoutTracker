import { z } from "zod";
import type { IsoDate } from "@/domain/block";
import type { Race } from "@/domain/running";
import { addDays, daysBetween, isoWeekday } from "@/engine/dates";
import { planToday } from "./blocks";
import { getCalendar, type CalendarDay } from "./calendar";
import { defineCommand } from "./define";
import { loadRaces } from "./plan-data";
import { listRecentPrs, type RecentPr } from "./records";
import { getTrainingLoad, type WeekLoad } from "./training-load";

/** Days to the next A race, and where its run plan is (null before the plan starts or without one). */
export interface RaceCountdown {
  race: Race;
  days: number;
  plan: { id: string; name: string; week: number; weeks: number } | null;
}

export const RECENT_PRS_ON_HOME = 5;

const monday = (date: IsoDate) => addDays(date, 1 - isoWeekday(date));

/**
 * The home dashboard around `date` (default today in the plan's time zone):
 * the Monday–Sunday week's planned lifts and runs with their completion
 * state, the countdown to the next A race (today or later) with its run
 * plan's week, the week's lifting volume and mileage against plan, and the
 * most recent PRs.
 */
export const getHome = defineCommand({
  input: z.object({ date: z.iso.date().optional() }),
  async run(ctx, input) {
    const { tx } = ctx;
    const date: IsoDate = input.date ?? (await planToday(tx));
    const weekStart = monday(date);

    const calendar = await getCalendar.run(ctx, { from: weekStart, to: addDays(weekStart, 6) });
    const training = await getTrainingLoad.run(ctx, { weeks: 1, through: date });
    const prs = await listRecentPrs.run(ctx, { limit: RECENT_PRS_ON_HOME });

    const race = (await loadRaces(tx)).find((r) => r.priority === "A" && r.date >= date);
    let countdown: RaceCountdown | null = null;
    if (race) {
      const [plan] = await tx<{ id: string; name: string; weeks: number }[]>`
        select id, name, weeks from public.run_plans where race_id = ${race.id} order by created_at desc limit 1`;
      const week = plan ? plan.weeks - daysBetween(weekStart, monday(race.date)) / 7 : 0;
      countdown = {
        race,
        days: daysBetween(date, race.date),
        plan: plan && week >= 1 ? { id: plan.id, name: plan.name, week, weeks: plan.weeks } : null,
      };
    }

    const week: CalendarDay[] = calendar.days;
    const load: WeekLoad = training.weeks[0]!;
    const recentPrs: RecentPr[] = prs.items;
    return { date, today: calendar.today, unit: training.unit, week, countdown, load, recentPrs };
  },
});
