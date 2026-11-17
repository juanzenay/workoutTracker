import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Route {
  status: number;
  /** JSON file next to routes.json holding the recorded response body. */
  file?: string;
  /** Inline body (JSON value, or a plain-text string). */
  body?: unknown;
  /** Only this Authorization header gets the response; any other gets a 401 (an expired or revoked token). */
  authorization?: string;
}

/**
 * A `fetch` that answers only from recorded responses in `dir/routes.json`
 * (keyed by path + query string). Anything unrecorded throws, so tests can
 * never reach the live network. A key may hold an array of responses: they are
 * served in order, one per call, and the last one repeats (e.g. a token
 * exchange followed by a refresh, or an activity before and after an edit).
 * The sequence position lives in the returned function, so reuse one instance.
 */
/** A request a recorded fetch answered (or refused), for asserting what was sent. */
export interface RecordedRequest {
  method: string;
  /** Path + query string, as routes.json keys it. */
  path: string;
  /** The request body as text (form-encoded or JSON), if any. */
  body: string | null;
}

export function recordedFetch(dir: string, log?: RecordedRequest[]): typeof fetch {
  const routes = JSON.parse(readFileSync(join(dir, "routes.json"), "utf8")) as Record<string, Route | Route[]>;
  const calls = new Map<string, number>();
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const key = url.pathname + url.search;
    const method = (input instanceof Request ? input.method : init?.method) ?? "GET";
    log?.push({ method, path: key, body: typeof init?.body === "string" ? init.body : null });
    const recorded = routes[key];
    if (!recorded) throw new Error(`No recorded response for ${key} in ${dir}/routes.json`);
    const n = calls.get(key) ?? 0;
    calls.set(key, n + 1);
    const route = Array.isArray(recorded) ? recorded[Math.min(n, recorded.length - 1)]! : recorded;
    const sent = new Headers(input instanceof Request ? input.headers : init?.headers).get("authorization");
    if (route.authorization !== undefined && sent !== route.authorization) {
      return Response.json({ message: "Authorization Error" }, { status: 401 });
    }
    const text = route.file
      ? readFileSync(join(dir, route.file), "utf8")
      : typeof route.body === "string"
        ? route.body
        : JSON.stringify(route.body);
    return new Response(text, {
      status: route.status,
      headers: { "content-type": typeof route.body === "string" ? "text/plain" : "application/json" },
    });
  };
}

export const WGER_FIXTURES = join(import.meta.dirname, "wger");
export const HEVY_FIXTURES = join(import.meta.dirname, "hevy");
export const STRAVA_FIXTURES = join(import.meta.dirname, "strava");
