import { describe, expect, it } from "vitest";
import { answerSubscriptionChallenge } from "./webhook";

const query = (params: Record<string, string>) => new URLSearchParams(params);

describe("Strava webhook verification handshake", () => {
  it("echoes the challenge when the verify token matches", () => {
    expect(
      answerSubscriptionChallenge(
        query({ "hub.mode": "subscribe", "hub.challenge": "15f7d1a91c1f40f8a748fd134752feb3", "hub.verify_token": "STRAVA" }),
        "STRAVA",
      ),
    ).toEqual({ status: 200, body: { "hub.challenge": "15f7d1a91c1f40f8a748fd134752feb3" } });
  });

  it("refuses a wrong or missing verify token, and any deployment without one configured", () => {
    const challenge = { "hub.mode": "subscribe", "hub.challenge": "abc" };
    expect(answerSubscriptionChallenge(query({ ...challenge, "hub.verify_token": "nope" }), "STRAVA").status).toBe(403);
    expect(answerSubscriptionChallenge(query(challenge), "STRAVA").status).toBe(403);
    expect(answerSubscriptionChallenge(query({ ...challenge, "hub.verify_token": "" }), undefined).status).toBe(403);
    expect(
      answerSubscriptionChallenge(query({ "hub.mode": "unsubscribe", "hub.challenge": "abc", "hub.verify_token": "STRAVA" }), "STRAVA")
        .status,
    ).toBe(403);
  });
});
