import type { IsoDate, Weekday } from "@/domain/block";

/** Calendar-date arithmetic on "YYYY-MM-DD" strings (no time zones: dates are already local). */

const DAY_MS = 86_400_000;
const toMs = (date: IsoDate) => Date.parse(`${date}T00:00:00Z`);
const fromMs = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: IsoDate, days: number): IsoDate => fromMs(toMs(date) + days * DAY_MS);

export const daysBetween = (from: IsoDate, to: IsoDate): number => Math.round((toMs(to) - toMs(from)) / DAY_MS);

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: IsoDate): Weekday => (((new Date(toMs(date)).getUTCDay() + 6) % 7) + 1) as Weekday;
