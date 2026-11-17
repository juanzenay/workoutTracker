import { FitBaseType as B, FitEncoder } from "fit-file-parser";

/**
 * Tiny synthetic activity files, shaped like the Coros app's exports: a FIT
 * file with file_id, one session and the activity summary (its local time
 * offset), and a GPX track. Built per test, so each test says what it ran.
 */

/** FIT sport / sub_sport enum values (FIT profile). */
export const FIT_SPORT = { running: 1, cycling: 2, walking: 11 } as const;
export const FIT_SUB_SPORT = { generic: 0, treadmill: 1, trail: 3 } as const;

export function fitActivity({
  start,
  meters,
  movingSeconds,
  elapsedSeconds = movingSeconds,
  utcOffsetHours = 0,
  sport = FIT_SPORT.running,
  subSport = FIT_SUB_SPORT.generic,
}: {
  /** UTC start. */
  start: string;
  meters: number;
  movingSeconds: number;
  elapsedSeconds?: number;
  /** Where it was run: the watch's local time minus UTC (Chicago in October: -5). */
  utcOffsetHours?: number;
  sport?: number;
  subSport?: number;
}): Uint8Array {
  const startTs = FitEncoder.toFitTimestamp(new Date(start));
  const endTs = startTs + elapsedSeconds;
  const u32 = (number: number, value: number) => ({ number, size: 4, baseType: B.Uint32, value });
  const e8 = (number: number, value: number) => ({ number, size: 1, baseType: B.Enum, value });
  return new FitEncoder()
    .writeMessage(0, [e8(0, 4), { number: 1, size: 2, baseType: B.Uint16, value: 294 }, u32(4, startTs)])
    .writeMessage(18, [
      u32(253, endTs),
      u32(2, startTs),
      e8(5, sport),
      e8(6, subSport),
      u32(7, elapsedSeconds * 1000),
      u32(8, movingSeconds * 1000),
      u32(9, Math.round(meters * 100)),
    ])
    .writeMessage(34, [u32(253, endTs), u32(5, endTs + utcOffsetHours * 3600), { number: 1, size: 2, baseType: B.Uint16, value: 1 }])
    .close();
}

/**
 * A GPX track heading due north from (41.88, -87.63) at a steady pace: `meters` over `seconds`, one point a
 * minute (latitude only changes, so the distance is exact to the metre). `pauseSeconds` adds a standstill
 * in the middle (elapsed, not moving).
 */
export function gpxActivity({
  start,
  meters,
  seconds,
  pauseSeconds = 0,
  type = "running",
}: {
  start: string;
  meters: number;
  seconds: number;
  pauseSeconds?: number;
  /** The track's <type>; null leaves it out. */
  type?: string | null;
}): Uint8Array {
  const EARTH_RADIUS = 6_371_008.8;
  const steps = Math.max(1, Math.round(seconds / 60));
  const t0 = Date.parse(start);
  const points: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const lat = 41.88 + ((meters * (i / steps)) / EARTH_RADIUS) * (180 / Math.PI);
    const pause = i > steps / 2 ? pauseSeconds : 0;
    const time = new Date(t0 + ((seconds * i) / steps + pause) * 1000).toISOString().replace(".000", "");
    points.push(`<trkpt lat="${lat.toFixed(8)}" lon="-87.63000000"><ele>180.0</ele><time>${time}</time></trkpt>`);
    if (pauseSeconds && i === Math.floor(steps / 2)) {
      const still = new Date(t0 + ((seconds * i) / steps + pauseSeconds) * 1000).toISOString().replace(".000", "");
      points.push(`<trkpt lat="${lat.toFixed(8)}" lon="-87.63000000"><ele>180.0</ele><time>${still}</time></trkpt>`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="COROS Wearables" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>${new Date(t0).toISOString()}</time></metadata>
  <trk>
    <name>Morning Run</name>
    ${type === null ? "" : `<type>${type}</type>`}
    <trkseg>
      ${points.join("\n      ")}
    </trkseg>
  </trk>
</gpx>
`;
  return new TextEncoder().encode(xml);
}
