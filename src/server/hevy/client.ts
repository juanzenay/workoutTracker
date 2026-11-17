import { z } from "zod";

/**
 * Read-only client for the Hevy public API (https://api.hevyapp.com/docs,
 * needs Hevy Pro). The API is beta, so parsing is defensive: unknown fields
 * are ignored and optional ones tolerated. Pages are fetched one at a time
 * (Hevy rate-limits bursts). Tests pass a `fetch` that serves recorded
 * responses (tests/fixtures/hevy).
 */

const nullableText = z.string().nullish().transform((s) => (s ? s : null));
const nullableNumber = z.number().nullish().transform((n) => n ?? null);

const hevySet = z.object({
  index: z.number().int(),
  type: z.string().nullish(),
  weight_kg: nullableNumber,
  reps: nullableNumber,
  distance_meters: nullableNumber,
  duration_seconds: nullableNumber,
});

const hevyWorkoutExercise = z
  .object({
    index: z.number().int(),
    title: z.string(),
    notes: nullableText,
    exercise_template_id: z.string(),
    // The spec calls it `supersets_id`; the live API sends `superset_id`. 0 is a valid group.
    superset_id: nullableNumber,
    supersets_id: nullableNumber,
    sets: z.array(hevySet).default([]),
  })
  .transform(({ supersets_id, superset_id, ...rest }) => ({
    ...rest,
    supersetId: superset_id ?? supersets_id ?? null,
  }));

const hevyWorkout = z.object({
  id: z.string(),
  title: nullableText,
  description: nullableText,
  start_time: z.string(),
  end_time: z.string().nullish(),
  updated_at: z.string().nullish(),
  exercises: z.array(hevyWorkoutExercise).default([]),
});

const hevyExerciseTemplate = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string().nullish(),
  primary_muscle_group: z.string().nullish(),
  secondary_muscle_groups: z.array(z.string()).nullish(),
  is_custom: z.boolean().default(false),
});

const hevyRoutineSet = hevySet.extend({
  rep_range: z
    .object({ start: nullableNumber, end: nullableNumber })
    .nullish()
    .transform((r) => r ?? null),
});

const hevyRoutineExercise = z
  .object({
    index: z.number().int(),
    title: z.string(),
    notes: nullableText,
    rest_seconds: nullableNumber,
    exercise_template_id: z.string(),
    superset_id: nullableNumber,
    supersets_id: nullableNumber,
    sets: z.array(hevyRoutineSet).default([]),
  })
  .transform(({ supersets_id, superset_id, ...rest }) => ({
    ...rest,
    supersetId: superset_id ?? supersets_id ?? null,
  }));

const hevyRoutine = z.object({
  id: z.string(),
  title: z.string(),
  folder_id: nullableNumber,
  notes: nullableText,
  updated_at: z.string().nullish(),
  exercises: z.array(hevyRoutineExercise).default([]),
});

const hevyRoutineFolder = z.object({
  id: z.number().int(),
  index: z.number().int().nullish(),
  title: z.string(),
  updated_at: z.string().nullish(),
});

/** Keyed by date; no id. Girth fields are cm even where Hevy dropped the `_cm` suffix. */
const hevyBodyMeasurement = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  weight_kg: nullableNumber,
  lean_mass_kg: nullableNumber,
  fat_percent: nullableNumber,
  neck_cm: nullableNumber,
  shoulder_cm: nullableNumber,
  chest_cm: nullableNumber,
  left_bicep_cm: nullableNumber,
  right_bicep_cm: nullableNumber,
  left_forearm_cm: nullableNumber,
  right_forearm_cm: nullableNumber,
  abdomen: nullableNumber,
  waist: nullableNumber,
  hips: nullableNumber,
  left_thigh: nullableNumber,
  right_thigh: nullableNumber,
  left_calf: nullableNumber,
  right_calf: nullableNumber,
});

export type HevyRoutine = z.output<typeof hevyRoutine>;
export type HevyRoutineExercise = HevyRoutine["exercises"][number];
export type HevyRoutineFolder = z.output<typeof hevyRoutineFolder>;
export type HevyBodyMeasurement = z.output<typeof hevyBodyMeasurement>;
export type HevyWorkout = z.output<typeof hevyWorkout>;
export type HevyWorkoutExercise = HevyWorkout["exercises"][number];
export type HevySet = HevyWorkoutExercise["sets"][number];
export type HevyExerciseTemplate = z.output<typeof hevyExerciseTemplate>;

/** Hevy can't be reached or answered something unusable; retrying later may work. */
export class HevyUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "HevyUnavailableError";
  }
}

/** Hevy refused the API key (wrong key, or the account no longer has Pro). */
export class HevyAuthError extends Error {
  constructor(message = "Hevy rejected the API key") {
    super(message);
    this.name = "HevyAuthError";
  }
}

export interface HevyClient {
  /** Every exercise template the account can see: Hevy's built-ins plus its custom exercises. */
  listExerciseTemplates(apiKey: string): Promise<HevyExerciseTemplate[]>;
  /** Every workout in the account (all pages). */
  listWorkouts(apiKey: string): Promise<HevyWorkout[]>;
  listRoutineFolders(apiKey: string): Promise<HevyRoutineFolder[]>;
  listRoutines(apiKey: string): Promise<HevyRoutine[]>;
  listBodyMeasurements(apiKey: string): Promise<HevyBodyMeasurement[]>;
}

export const DEFAULT_HEVY_BASE_URL = "https://api.hevyapp.com";
const MAX_ATTEMPTS = 4;

export function createHevyClient({
  fetch: fetchImpl = globalThis.fetch,
  baseUrl = process.env.HEVY_BASE_URL ?? DEFAULT_HEVY_BASE_URL,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: { fetch?: typeof fetch; baseUrl?: string; sleep?: (ms: number) => Promise<void> } = {}): HevyClient {
  const root = baseUrl.replace(/\/+$/, "");

  /** GET a JSON body; null for 404. Backs off on 429 (Retry-After, else 1 s, 2 s, 4 s). */
  async function getJson(path: string, apiKey: string): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await fetchImpl(`${root}${path}`, {
          headers: { accept: "application/json", "api-key": apiKey },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        throw new HevyUnavailableError(`Hevy request failed: ${path}`, { cause: error });
      }
      if (response.status === 429 && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** (attempt - 1));
        continue;
      }
      if (response.status === 401 || response.status === 403) throw new HevyAuthError();
      if (response.status === 404) return null;
      if (!response.ok) throw new HevyUnavailableError(`Hevy responded ${response.status}: ${path}`);
      return response.json().catch((error: unknown) => {
        throw new HevyUnavailableError(`Hevy sent unreadable JSON: ${path}`, { cause: error });
      });
    }
  }

  async function listAll<T>(path: string, key: string, item: z.ZodType<T>, pageSize: number, apiKey: string) {
    const pageSchema = z.object({ page_count: z.number().int(), [key]: z.array(item) });
    const items: T[] = [];
    for (let page = 1; ; page++) {
      const body = await getJson(`${path}?page=${page}&pageSize=${pageSize}`, apiKey);
      // Past the last page some endpoints answer 404 instead of an empty page.
      if (body === null) {
        if (page > 1) return items;
        throw new HevyUnavailableError(`Hevy has no ${path}`);
      }
      const parsed = pageSchema.safeParse(body);
      if (!parsed.success) {
        throw new HevyUnavailableError(`Unexpected Hevy response for ${path} page ${page}`, { cause: parsed.error });
      }
      items.push(...(parsed.data[key] as T[]));
      if (page >= (parsed.data.page_count as number)) return items;
    }
  }

  return {
    listExerciseTemplates: (apiKey) =>
      listAll("/v1/exercise_templates", "exercise_templates", hevyExerciseTemplate, 100, apiKey),
    listWorkouts: (apiKey) => listAll("/v1/workouts", "workouts", hevyWorkout, 10, apiKey),
    listRoutineFolders: (apiKey) => listAll("/v1/routine_folders", "routine_folders", hevyRoutineFolder, 10, apiKey),
    listRoutines: (apiKey) => listAll("/v1/routines", "routines", hevyRoutine, 10, apiKey),
    listBodyMeasurements: (apiKey) =>
      listAll("/v1/body_measurements", "body_measurements", hevyBodyMeasurement, 10, apiKey),
  };
}
