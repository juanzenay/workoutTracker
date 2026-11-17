import FitParser from "fit-file-parser";

/**
 * Reads activity files exported from a watch's app (Coros: FIT, GPX or TCX)
 * into what workout tracker stores about a completed activity. FIT goes through
 * fit-file-parser (MIT); GPX and TCX are small XML formats read directly.
 * Sports are named as Strava names them ("Run", "TrailRun", "Ride", …), so
 * file and Strava activities match runs alike (RUN_SPORT_TYPES).
 */

export interface FileActivity {
  /** When it started (UTC). */
  startDate: Date;
  /**
   * Wall-clock start where it happened ("2026-10-11T08:05:00"), when the file says (FIT records the watch's
   * local time); null = unknown (GPX, TCX), and the plan's time zone decides the day.
   */
  startLocal: string | null;
  sportType: string;
  name: string | null;
  distanceMeters: number;
  movingSeconds: number | null;
  elapsedSeconds: number | null;
}

/** Why a file couldn't be read: not a format workout tracker reads, damaged, or no activity in it. */
export type ActivityFileProblem = "format" | "corrupt" | "empty";

export class ActivityFileError extends Error {
  constructor(
    readonly problem: ActivityFileProblem,
    message: string,
  ) {
    super(message);
    this.name = "ActivityFileError";
  }
}

/** The activities in one file (usually one; a multisport FIT or a GPX with several tracks has more). */
export async function parseActivityFile(name: string, data: Uint8Array): Promise<FileActivity[]> {
  const format = formatOf(name, data);
  const activities =
    format === "fit" ? await parseFit(data) : format === "gpx" ? parseGpx(text(data)) : parseTcx(text(data));
  if (activities.length === 0) throw new ActivityFileError("empty", `No activity in ${name}`);
  return activities;
}

function formatOf(name: string, data: Uint8Array): "fit" | "gpx" | "tcx" {
  const extension = name.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (extension === "fit" || extension === "gpx" || extension === "tcx") return extension;
  // No telling extension: FIT files carry ".FIT" at byte 8; the XML formats name their root element.
  if (String.fromCharCode(...data.subarray(8, 12)) === ".FIT") return "fit";
  const head = text(data.subarray(0, 1024));
  if (/<gpx[\s>]/.test(head)) return "gpx";
  if (/<TrainingCenterDatabase[\s>]/.test(head)) return "tcx";
  throw new ActivityFileError("format", `${name} isn't a FIT, GPX or TCX file`);
}

const text = (data: Uint8Array) => new TextDecoder().decode(data);

// ---- FIT ----

const FIT_SPORTS: Record<string, string> = {
  running: "Run",
  cycling: "Ride",
  walking: "Walk",
  hiking: "Hike",
  swimming: "Swim",
  training: "Workout",
  fitness_equipment: "Workout",
  rowing: "Rowing",
  cross_country_skiing: "NordicSki",
  alpine_skiing: "AlpineSki",
};

function fitSport(sport: unknown, subSport: unknown): string {
  if (sport === "running") {
    if (subSport === "trail") return "TrailRun";
    if (subSport === "virtual_activity") return "VirtualRun";
    return "Run";
  }
  return (typeof sport === "string" && FIT_SPORTS[sport]) || "Workout";
}

async function parseFit(data: Uint8Array): Promise<FileActivity[]> {
  const parser = new FitParser({ force: false, lengthUnit: "m", speedUnit: "m/s", mode: "list" });
  let fit;
  try {
    fit = await parser.parseAsync(Buffer.from(data));
  } catch (error) {
    throw new ActivityFileError("corrupt", `Unreadable FIT file: ${error instanceof Error ? error.message : String(error)}`);
  }
  // The activity message records the watch's local time at the end; its offset from UTC places the run's day.
  const { timestamp, local_timestamp: local } = fit.activity ?? {};
  const offsetMs = timestamp && local ? local.getTime() - timestamp.getTime() : null;
  return (fit.sessions ?? [])
    .filter((s) => s.start_time instanceof Date && !Number.isNaN(s.start_time.getTime()))
    .map((s) => ({
      startDate: s.start_time!,
      startLocal: offsetMs === null ? null : wallClock(new Date(s.start_time!.getTime() + offsetMs)),
      sportType: fitSport(s.sport, s.sub_sport),
      name: null,
      distanceMeters: round1(s.total_distance ?? 0),
      movingSeconds: seconds(s.total_timer_time),
      elapsedSeconds: seconds(s.total_elapsed_time),
    }));
}

// ---- GPX ----

/** GPX <type> values (Strava, Garmin, Coros exports) that are runs; any other type is not; none = a run. */
const GPX_RUN_TYPES = new Set(["running", "run", "9", "trail_running", "trailrun", "treadmill_running", "track_running"]);
/** Below this speed a stretch of track counts as standing still (not moving time). */
const MOVING_SPEED = 0.5;

function parseGpx(xml: string): FileActivity[] {
  if (!/<gpx[\s>]/.test(xml) || !/<\/gpx>/.test(xml)) throw new ActivityFileError("corrupt", "Unreadable GPX file");
  return [...xml.matchAll(/<trk>([\s\S]*?)<\/trk>/g)].flatMap(([, trk]) => {
    const points = [...trk!.matchAll(/<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/g)].map(([, attrs, body]) => ({
      lat: Number(attrs!.match(/lat="([^"]+)"/)?.[1]),
      lon: Number(attrs!.match(/lon="([^"]+)"/)?.[1]),
      time: Date.parse(body!.match(/<time>([^<]+)<\/time>/)?.[1] ?? ""),
    }));
    if (points.some((p) => Number.isNaN(p.lat) || Number.isNaN(p.lon))) {
      throw new ActivityFileError("corrupt", "GPX track point without a position");
    }
    const timed = points.filter((p) => !Number.isNaN(p.time));
    if (timed.length < 2) return [];
    const type = trk!.match(/<type>([^<]*)<\/type>/)?.[1]?.trim().toLowerCase();
    let distance = 0;
    let moving = 0;
    for (let i = 1; i < timed.length; i++) {
      const meters = haversine(timed[i - 1]!, timed[i]!);
      const secs = (timed[i]!.time - timed[i - 1]!.time) / 1000;
      distance += meters;
      if (secs > 0 && meters / secs >= MOVING_SPEED) moving += secs;
    }
    return [
      {
        startDate: new Date(timed[0]!.time),
        startLocal: null,
        sportType: !type || GPX_RUN_TYPES.has(type) ? (type?.includes("trail") ? "TrailRun" : "Run") : gpxSport(type),
        name: decodeXml(trk!.match(/<name>([^<]*)<\/name>/)?.[1]?.trim() ?? "") || null,
        distanceMeters: round1(distance),
        movingSeconds: Math.round(moving),
        elapsedSeconds: Math.round((timed.at(-1)!.time - timed[0]!.time) / 1000),
      },
    ];
  });
}

function gpxSport(type: string): string {
  if (/cycl|bik|ride/.test(type)) return "Ride";
  if (/walk/.test(type)) return "Walk";
  if (/hik/.test(type)) return "Hike";
  if (/swim/.test(type)) return "Swim";
  return "Workout";
}

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6_371_008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---- TCX ----

function parseTcx(xml: string): FileActivity[] {
  if (!/<TrainingCenterDatabase[\s>]/.test(xml) || !/<\/TrainingCenterDatabase>/.test(xml)) {
    throw new ActivityFileError("corrupt", "Unreadable TCX file");
  }
  return [...xml.matchAll(/<Activity\b([^>]*)>([\s\S]*?)<\/Activity>/g)].flatMap(([, attrs, body]) => {
    const laps = [...body!.matchAll(/<Lap\b[^>]*StartTime="([^"]+)"[^>]*>([\s\S]*?)<\/Lap>/g)].map(([, start, lap]) => {
      // The lap's own totals come before its <Track> (trackpoints repeat <DistanceMeters> cumulatively).
      const head = lap!.split(/<Track>/)[0]!;
      return {
        start: Date.parse(start!),
        seconds: Number(head.match(/<TotalTimeSeconds>([^<]+)</)?.[1] ?? 0),
        meters: Number(head.match(/<DistanceMeters>([^<]+)</)?.[1] ?? 0),
      };
    });
    if (laps.length === 0 || laps.some((l) => Number.isNaN(l.start) || Number.isNaN(l.seconds) || Number.isNaN(l.meters))) {
      throw new ActivityFileError("corrupt", "TCX activity without readable laps");
    }
    const times = [...body!.matchAll(/<Time>([^<]+)<\/Time>/g)].map(([, t]) => Date.parse(t!)).filter((t) => !Number.isNaN(t));
    const sport = attrs!.match(/Sport="([^"]+)"/)?.[1] ?? "";
    const moving = laps.reduce((sum, l) => sum + l.seconds, 0);
    const end = Math.max(...times, laps.at(-1)!.start + laps.at(-1)!.seconds * 1000);
    return [
      {
        startDate: new Date(laps[0]!.start),
        startLocal: null,
        sportType: sport === "Running" ? "Run" : sport === "Biking" ? "Ride" : "Workout",
        name: null,
        distanceMeters: round1(laps.reduce((sum, l) => sum + l.meters, 0)),
        movingSeconds: Math.round(moving),
        elapsedSeconds: Math.round((end - laps[0]!.start) / 1000),
      },
    ];
  });
}

// ---- Helpers ----

const round1 = (n: number) => Math.round(n * 10) / 10;
const seconds = (n: number | undefined) => (n === undefined ? null : Math.round(n));
/** A Date whose UTC fields are a wall-clock time, as "YYYY-MM-DDTHH:MM:SS". */
const wallClock = (date: Date) => date.toISOString().slice(0, 19);

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
