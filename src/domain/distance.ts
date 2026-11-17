/** Distances are stored in meters; the owner reads them in miles. */
export const METERS_PER_MILE = 1609.344;

/** Meters as a miles figure for display: one decimal, without a trailing ".0" ("13", "9.7"); the unit is copy (src/strings). */
export const milesFigure = (meters: number): string => (meters / METERS_PER_MILE).toFixed(1).replace(/\.0$/, "");
