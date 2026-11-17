import { timingSafeEqual } from "node:crypto";

/**
 * Strava's subscription validation (GET on the callback URL): answer 200 with
 * `{"hub.challenge": ...}` within 2 s when `hub.verify_token` is ours
 * (STRAVA_WEBHOOK_VERIFY_TOKEN), else 403.
 */
export function answerSubscriptionChallenge(
  params: URLSearchParams,
  verifyToken: string | undefined,
): { status: 200; body: { "hub.challenge": string } } | { status: 403 } {
  const challenge = params.get("hub.challenge");
  const sent = params.get("hub.verify_token") ?? "";
  if (params.get("hub.mode") !== "subscribe" || !challenge || !verifyToken || !sameSecret(sent, verifyToken)) {
    return { status: 403 };
  }
  return { status: 200, body: { "hub.challenge": challenge } };
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
