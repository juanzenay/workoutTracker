import type { Race, RunPlan, PlannedRun } from "@/domain/running";
import { addDays, isoWeekday } from "./dates";

/**
 * Run-plan anchoring: the plan's final week is the anchor race's week
 * (Monday–Sunday), week k starts (weeks − k) Mondays earlier, and each row
 * lands on its weekday. Race rows in the final week land on the race date
 * itself, whatever weekday the file gave them.
 */
export function anchorRunPlans(runPlans: RunPlan[], races: Race[]): PlannedRun[] {
  return runPlans
    .flatMap((plan) => {
      const race = races.find((r) => r.id === plan.raceId);
      return race ? anchor(plan, race) : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.rowIndex - b.rowIndex);
}

function anchor(plan: RunPlan, race: Race): PlannedRun[] {
  const raceWeekMonday = addDays(race.date, 1 - isoWeekday(race.date));
  return plan.rows.map((row, rowIndex) => {
    const weekMonday = addDays(raceWeekMonday, -7 * (plan.weeks - row.week));
    const date = row.type === "race" && row.week === plan.weeks ? race.date : addDays(weekMonday, row.day - 1);
    return {
      runPlanId: plan.id,
      rowIndex,
      date,
      week: row.week,
      type: row.type,
      distanceMeters: row.distanceMeters,
      durationSeconds: row.durationSeconds,
      paceTarget: row.paceTarget,
      structure: row.structure,
      notes: row.notes,
    };
  });
}
