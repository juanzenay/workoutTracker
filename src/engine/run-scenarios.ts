import type { RunActivity } from "@/domain/availability";
import type { Block, IsoDate, Weekday } from "@/domain/block";
import { upperLower4Day } from "./scenarios";
import type { Race, RunPlan, RunPlanRow } from "@/domain/running";
import type { EngineInput } from "./plan";
import { anchorRunPlans } from "./runs";
import { planBlocks } from "./plan";

/**
 * Synthetic running fixtures for engine tests (no real, copyrighted plan):
 * an 18-week marathon-shaped plan — Mon cross, Tue/Wed/Thu easy, Fri rest,
 * Sat race pace, Sun long — ending in a Sunday race.
 */

export const MARATHON_M = 42_195;
const MILE_M = 1_609;

export const springMarathon = (overrides: Partial<Race> = {}): Race => ({
  id: "race-spring-marathon",
  name: "Spring Marathon",
  date: "2027-04-25", // a Sunday
  distanceMeters: MARATHON_M,
  priority: "A",
  ...overrides,
});

const row = (week: number, day: Weekday, type: RunPlanRow["type"], miles: number | null, extra: Partial<RunPlanRow> = {}) => ({
  week,
  day,
  type,
  distanceMeters: miles === null ? null : Math.round(miles * MILE_M),
  durationSeconds: null,
  paceTarget: null,
  structure: null,
  notes: null,
  ...extra,
});

export function marathon18Weeks(overrides: Partial<RunPlan> = {}): RunPlan {
  const rows: RunPlanRow[] = [];
  for (let week = 1; week <= 18; week++) {
    const last = week === 18;
    rows.push(
      row(week, 1, "cross", null, { durationSeconds: 45 * 60 }),
      row(week, 2, "easy", 3),
      row(week, 3, "easy", last ? 3 : 5),
      row(week, 4, "easy", 3),
      row(week, 5, "rest", null),
      row(week, 6, last ? "rest" : "race_pace", last ? null : 5, last ? {} : { paceTarget: { perKmSeconds: [326, 336] } }),
      last ? row(week, 7, "race", null, { distanceMeters: MARATHON_M }) : row(week, 7, "long", 6 + week * 0.75),
    );
  }
  return {
    id: "plan-marathon-18",
    name: "Synthetic marathon 18",
    weeks: 18,
    raceId: "race-spring-marathon",
    timeZone: "America/Los_Angeles",
    rows,
    ...overrides,
  };
}

/**
 * "Peak-mileage week cuts lower volume": the owner's upper/lower split for 4
 * weeks from Monday 2027-03-01 = plan weeks 11–14. The plan peaks at 34.7 mi in
 * week 17; from week 13 (31.7 mi) on, weeks are within 90% of it = block weeks 3–4.
 */
export function peakMileageBlock(): { block: Block; races: Race[]; runPlans: RunPlan[] } {
  return {
    block: upperLower4Day({ startDate: "2027-03-01", weeks: 4 }),
    races: [springMarathon()],
    runPlans: [marathon18Weeks()],
  };
}

/**
 * "No heavy legs before long run": the owner's upper/lower split with Hamstring
 * Lower moved to Saturday, for 4 weeks from Monday 2027-01-18 = plan weeks 5–8
 * (no peak weeks), so every Hamstring Lower lands the day before a Sunday long run.
 */
export function hamstringsBeforeLongRun(): { block: Block; races: Race[]; runPlans: RunPlan[] } {
  const block = upperLower4Day({ startDate: "2027-01-18", weeks: 4 });
  block.sessions = block.sessions.map((s) => (s.id === "s-ham" ? { ...s, weekday: 6 } : s));
  return { block, races: [springMarathon()], runPlans: [marathon18Weeks()] };
}

/**
 * "Deload aligns with taper": the owner's upper/lower split as a 6-week block
 * from Monday 2027-03-22 with the owner's deload in week 4, running into the
 * Spring Marathon (Sunday 2027-04-25): week 5 is race week, week 6 the week after.
 */
export function deloadAlignsWithTaper(): { block: Block; races: Race[]; runPlans: RunPlan[] } {
  return {
    block: upperLower4Day({ startDate: "2027-03-22", weeks: 6, deloadWeeks: [4] }),
    races: [springMarathon()],
    runPlans: [marathon18Weeks()],
  };
}

/** A Strava run for every planned run (not rest or cross) before `today`, at full distance, except on `missed` dates. */
export function ranEverythingBut(runPlans: RunPlan[], races: Race[], today: IsoDate, missed: IsoDate[]): RunActivity[] {
  return anchorRunPlans(runPlans, races)
    .filter((r) => r.date < today && r.type !== "rest" && r.type !== "cross" && !missed.includes(r.date))
    .map((r) => ({ date: r.date, meters: r.distanceMeters ?? 0, seconds: r.durationSeconds ?? 3600 }));
}

/**
 * "Missed long run in week 14": the owner's upper/lower split for 6 weeks from
 * Monday 2027-03-01 (plan weeks 11–16) and the marathon plan, every run done
 * from Strava except week 14's 16.5 mi long run (Sunday 2027-03-28). Today is
 * Monday 2027-03-29; the planned runs are persisted as anchored.
 */
export function missedLongRunInWeek14(): EngineInput {
  const races = [springMarathon()];
  const runPlans = [marathon18Weeks()];
  const today = "2027-03-29";
  return {
    blocks: [upperLower4Day({ startDate: "2027-03-01", weeks: 6 })],
    history: [],
    today,
    races,
    runPlans,
    runActivities: ranEverythingBut(runPlans, races, today, ["2027-03-28"]),
    currentRuns: anchorRunPlans(runPlans, races),
  };
}

/**
 * "Race moved two weeks earlier": the "deload aligns with taper" block (6 weeks
 * from 2027-03-22, owner deload in week 4) after the Spring Marathon moves from
 * 2027-04-25 to 2027-04-11. `currentPlan` / `currentRuns` are the plan as
 * persisted for the old date. Today is 2027-03-15.
 */
export function raceMovedTwoWeeksEarlier(): EngineInput {
  const { block, races, runPlans } = deloadAlignsWithTaper();
  const today = "2027-03-15";
  const old = planBlocks({ blocks: [block], history: [], today, races, runPlans });
  return {
    blocks: [block],
    history: [],
    today,
    races: [springMarathon({ date: "2027-04-11" })],
    runPlans,
    currentPlan: old.plannedSessions,
    currentRuns: old.plannedRuns,
  };
}
