import { z } from "zod";

/**
 * Read-only client for the wger REST API (https://wger.de/api/v2/, no auth
 * needed). Only the fields workout tracker uses are parsed; everything else is ignored.
 * Tests pass a `fetch` that serves recorded responses (tests/fixtures/wger).
 */

const named = z.object({ id: z.number(), name: z.string() });

const wgerExerciseInfo = z.object({
  id: z.number(),
  uuid: z.string(),
  category: named,
  muscles: z.array(z.object({ id: z.number() })),
  muscles_secondary: z.array(z.object({ id: z.number() })),
  equipment: z.array(named),
  license: z.object({ full_name: z.string(), short_name: z.string(), url: z.string() }),
  license_author: z.string().nullable(),
  images: z.array(
    z.object({ image: z.string(), is_main: z.boolean(), license_author: z.string().nullable() }),
  ),
  translations: z.array(
    z.object({ name: z.string(), language: z.number(), description: z.string() }),
  ),
  total_authors_history: z.array(z.string()).default([]),
});

export type WgerExerciseInfo = z.infer<typeof wgerExerciseInfo>;

const page = z.object({ results: z.array(wgerExerciseInfo) });

export class WgerUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WgerUnavailableError";
  }
}

/** A response we can't read is as good as no response: report wger as unavailable, not a bug in workout tracker. */
function parse<T>(schema: z.ZodType<T>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new WgerUnavailableError(`Unexpected wger response for ${what}`, { cause: result.error });
  return result.data;
}

export interface WgerClient {
  /** Public site root (also used for exercise source links in attributions). */
  readonly baseUrl: string;
  /** Fuzzy name search over English names and aliases, best match first. */
  search(query: string): Promise<WgerExerciseInfo[]>;
  /** One exercise, or null if wger has no exercise with that id. */
  get(id: number): Promise<WgerExerciseInfo | null>;
}

export const DEFAULT_WGER_BASE_URL = "https://wger.de";
const USER_AGENT = "Workout tracker (+https://github.com/juanzenay/workouttracker)";

export function createWgerClient({
  fetch: fetchImpl = globalThis.fetch,
  baseUrl = process.env.WGER_BASE_URL ?? DEFAULT_WGER_BASE_URL,
}: { fetch?: typeof fetch; baseUrl?: string } = {}): WgerClient {
  const root = baseUrl.replace(/\/+$/, "");

  async function getJson(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new WgerUnavailableError(`wger request failed: ${path}`, { cause: error });
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new WgerUnavailableError(`wger responded ${response.status}: ${path}`);
    return response.json().catch((error: unknown) => {
      throw new WgerUnavailableError(`wger sent unreadable JSON: ${path}`, { cause: error });
    });
  }

  return {
    baseUrl: root,
    async search(query) {
      const params = new URLSearchParams({ name__search: query, language__code: "en", limit: "20" });
      const body = await getJson(`/api/v2/exerciseinfo/?${params}`);
      return body === null ? [] : parse(page, body, "search").results;
    },
    async get(id) {
      const body = await getJson(`/api/v2/exerciseinfo/${id}/`);
      return body === null ? null : parse(wgerExerciseInfo, body, `exercise ${id}`);
    },
  };
}
