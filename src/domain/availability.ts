import type { IsoDate } from "./block";

/**
 * Days the owner marked unavailable (sick, travelling, busy): an inclusive
 * date range in the plan's time zone. The engine re-plans around them.
 */
export interface Unavailability {
  startDate: IsoDate;
  /** Inclusive. */
  endDate: IsoDate;
}

/** A completed run (from Strava or an imported file), by its local date: what the engine reads to tell a missed or short run. */
export interface RunActivity {
  date: IsoDate;
  meters: number;
  seconds: number;
}
