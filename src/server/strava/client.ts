import { z } from "zod";

/**
 * Client for the owner's own Strava API app (single-athlete mode).
 * See notes/research/strava-api.md. Base URLs are configurable: Strava
 * announced a new API host (https://api-v3.strava.com) from 2027-01-04, so
 * switching is an env change (STRAVA_API_BASE), not a code change. OAuth
 * stays on www.strava.com (STRAVA_OAUTH_BASE). Tests pass a `fetch` that
 * serves recorded responses (tests/fixtures/strava).
 */

export const DEFAULT_STRAVA_API_BASE = "https://www.strava.com/api/v3";
export const DEFAULT_STRAVA_OAUTH_BASE = "https://www.strava.com";
/** What workout tracker asks for: private runs (matching) and creating Weight Training activities (#17). */
export const STRAVA_SCOPES = ["read", "activity:read_all", "activity:write"] as const;
export const REQUIRED_STRAVA_SCOPES = ["activity:read_all", "activity:write"] as const;
/** Cookie holding the OAuth CSRF state between /api/strava/connect and /api/strava/callback. */
export const STRAVA_STATE_COOKIE = "workout_tracker_strava_state";

const athlete = z.object({
  id: z.number().int(),
  firstname: z.string().nullish(),
  lastname: z.string().nullish(),
  username: z.string().nullish(),
});

const tokens = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.number().int(),
});

const tokenExchange = tokens.extend({ athlete });

const activity = z.object({
  id: z.number().int(),
  athlete: z.object({ id: z.number().int() }),
  name: z.string().nullish(),
  sport_type: z.string().nullish(),
  type: z.string().nullish(),
  distance: z.number().nullish(),
  moving_time: z.number().int().nullish(),
  elapsed_time: z.number().int().nullish(),
  start_date: z.string(),
  // Local wall time with a fake "Z" suffix.
  start_date_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
  manual: z.boolean().nullish(),
  external_id: z.string().nullish(),
  device_name: z.string().nullish(),
  workout_type: z.number().int().nullish(),
});

/** An activity as Strava lists them (SummaryActivity): what workout tracker needs to recognise one it posted. */
const listedActivity = z.object({
  id: z.number().int(),
  name: z.string().nullish(),
  sport_type: z.string().nullish(),
  type: z.string().nullish(),
  start_date: z.string(),
  start_date_local: z.string(),
});

export type StravaListedActivity = z.output<typeof listedActivity>;
export type StravaTokens = z.output<typeof tokens>;
export type StravaTokenExchange = z.output<typeof tokenExchange>;
/** The fields workout tracker reads from a DetailedActivity, plus the whole body as `raw`. */
export type StravaActivity = z.output<typeof activity> & { raw: unknown };

/** A manual activity to create (POST /activities). */
export interface NewStravaActivity {
  name: string;
  /** e.g. "WeightTraining". */
  sportType: string;
  /** Wall-clock start where it happened, no offset ("2026-10-08T07:00:00"). */
  startDateLocal: string;
  elapsedSeconds: number;
  description: string;
}

export interface StravaSubscription {
  id: number;
  callbackUrl: string;
}

/** Strava can't be reached or answered something unusable; retrying later may work. */
export class StravaUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StravaUnavailableError";
  }
}

/** Strava refused the code / token (expired, revoked) or the app credentials. */
export class StravaAuthError extends Error {
  constructor(message = "Strava refused the authorization") {
    super(message);
    this.name = "StravaAuthError";
  }
}

/** STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET aren't set for this deployment. */
export class StravaNotConfiguredError extends Error {
  constructor() {
    super("Strava isn't set up for this deployment (STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET)");
    this.name = "StravaNotConfiguredError";
  }
}

export interface StravaClient {
  /**
   * Whether this deployment has a Strava app (STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET). Strava is optional:
   * without one, nothing Strava shows or runs, and completed runs come in as imported files.
   */
  readonly configured: boolean;
  /** Where to send the owner to approve workout tracker. */
  authorizeUrl(options: { redirectUri: string; state: string }): string;
  exchangeCode(code: string): Promise<StravaTokenExchange>;
  refresh(refreshToken: string): Promise<StravaTokens>;
  /** Best effort: tells Strava to revoke workout tracker's access. */
  deauthorize(accessToken: string): Promise<void>;
  /** The activity, or null when Strava no longer has it (deleted, or private without scope). */
  getActivity(accessToken: string, id: number): Promise<StravaActivity | null>;
  /** Creates a manual activity on the owner's account (needs activity:write); returns its id. */
  createActivity(accessToken: string, activity: NewStravaActivity): Promise<{ id: number }>;
  /** The owner's activities starting between `after` and `before` (epoch seconds), newest first; at most 100. */
  listActivities(accessToken: string, window: { after: number; before: number }): Promise<StravaListedActivity[]>;
  listSubscriptions(): Promise<StravaSubscription[]>;
  /** Strava calls `callbackUrl` with the verification handshake before answering. */
  createSubscription(callbackUrl: string, verifyToken: string): Promise<StravaSubscription>;
  deleteSubscription(id: number): Promise<void>;
}

export function createStravaClient({
  fetch: fetchImpl = globalThis.fetch,
  apiBaseUrl = process.env.STRAVA_API_BASE ?? DEFAULT_STRAVA_API_BASE,
  oauthBaseUrl = process.env.STRAVA_OAUTH_BASE ?? DEFAULT_STRAVA_OAUTH_BASE,
  clientId = process.env.STRAVA_CLIENT_ID,
  clientSecret = process.env.STRAVA_CLIENT_SECRET,
}: {
  fetch?: typeof fetch;
  apiBaseUrl?: string;
  oauthBaseUrl?: string;
  clientId?: string;
  clientSecret?: string;
} = {}): StravaClient {
  const api = apiBaseUrl.replace(/\/+$/, "");
  const oauth = oauthBaseUrl.replace(/\/+$/, "");

  function credentials() {
    if (!clientId || !clientSecret) throw new StravaNotConfiguredError();
    return { client_id: clientId, client_secret: clientSecret };
  }

  async function request(
    url: string,
    init: { method?: string; accessToken?: string; form?: Record<string, string> } = {},
  ): Promise<Response> {
    try {
      return await fetchImpl(url, {
        method: init.method ?? (init.form ? "POST" : "GET"),
        headers: {
          accept: "application/json",
          ...(init.accessToken ? { authorization: `Bearer ${init.accessToken}` } : {}),
          ...(init.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        body: init.form ? new URLSearchParams(init.form).toString() : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new StravaUnavailableError(`Strava request failed: ${new URL(url).pathname}`, { cause: error });
    }
  }

  async function parse<T>(response: Response, schema: z.ZodType<T>, what: string): Promise<T> {
    const body: unknown = await response.json().catch((error: unknown) => {
      throw new StravaUnavailableError(`Strava sent unreadable JSON for ${what}`, { cause: error });
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new StravaUnavailableError(`Unexpected Strava response for ${what}`, { cause: parsed.error });
    return parsed.data;
  }

  function check(response: Response, what: string) {
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new StravaAuthError(`Strava refused ${what} (${response.status})`);
    }
    if (!response.ok) throw new StravaUnavailableError(`Strava responded ${response.status} for ${what}`);
  }

  async function token(form: Record<string, string>, what: string) {
    const response = await request(`${oauth}/oauth/token`, { form: { ...credentials(), ...form } });
    check(response, what);
    return response;
  }

  return {
    configured: Boolean(clientId && clientSecret),
    authorizeUrl({ redirectUri, state }) {
      const url = new URL(`${oauth}/oauth/authorize`);
      url.search = new URLSearchParams({
        client_id: credentials().client_id,
        redirect_uri: redirectUri,
        response_type: "code",
        approval_prompt: "auto",
        scope: STRAVA_SCOPES.join(","),
        state,
      }).toString();
      return url.toString();
    },
    async exchangeCode(code) {
      const response = await token({ code, grant_type: "authorization_code" }, "the authorization code");
      return parse(response, tokenExchange, "the token exchange");
    },
    async refresh(refreshToken) {
      const response = await token({ refresh_token: refreshToken, grant_type: "refresh_token" }, "the token refresh");
      return parse(response, tokens, "the token refresh");
    },
    async deauthorize(accessToken) {
      await request(`${oauth}/oauth/deauthorize`, { form: { access_token: accessToken } }).catch(() => undefined);
    },
    async getActivity(accessToken, id) {
      const response = await request(`${api}/activities/${id}`, { accessToken });
      if (response.status === 404) return null;
      check(response, `activity ${id}`);
      const raw: unknown = await response.json().catch((error: unknown) => {
        throw new StravaUnavailableError(`Strava sent unreadable JSON for activity ${id}`, { cause: error });
      });
      const parsed = activity.safeParse(raw);
      if (!parsed.success) throw new StravaUnavailableError(`Unexpected Strava activity ${id}`, { cause: parsed.error });
      return { ...parsed.data, raw };
    },
    async createActivity(accessToken, a) {
      const response = await request(`${api}/activities`, {
        accessToken,
        form: {
          name: a.name,
          sport_type: a.sportType,
          // Older clients (and the docs' required list) still read `type`.
          type: a.sportType,
          start_date_local: a.startDateLocal,
          elapsed_time: String(a.elapsedSeconds),
          description: a.description,
        },
      });
      check(response, "the new activity");
      const { id } = await parse(response, z.object({ id: z.number().int() }), "the new activity");
      return { id };
    },
    async listActivities(accessToken, { after, before }) {
      const query = new URLSearchParams({ after: String(after), before: String(before), per_page: "100" });
      const response = await request(`${api}/athlete/activities?${query}`, { accessToken });
      check(response, "the activity list");
      return parse(response, z.array(listedActivity), "the activity list");
    },
    async listSubscriptions() {
      const response = await request(`${api}/push_subscriptions?${new URLSearchParams(credentials())}`);
      check(response, "the webhook subscription list");
      const subs = await parse(
        response,
        z.array(z.object({ id: z.number().int(), callback_url: z.string() })),
        "the webhook subscription list",
      );
      return subs.map((s) => ({ id: s.id, callbackUrl: s.callback_url }));
    },
    async createSubscription(callbackUrl, verifyToken) {
      const response = await request(`${api}/push_subscriptions`, {
        form: { ...credentials(), callback_url: callbackUrl, verify_token: verifyToken },
      });
      check(response, "the webhook subscription");
      const { id } = await parse(response, z.object({ id: z.number().int() }), "the webhook subscription");
      return { id, callbackUrl };
    },
    async deleteSubscription(id) {
      const response = await request(`${api}/push_subscriptions/${id}?${new URLSearchParams(credentials())}`, {
        method: "DELETE",
      });
      if (response.status !== 404) check(response, "deleting the webhook subscription");
    },
  };
}
