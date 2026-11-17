import { after } from "next/server";
import { CommandError, createCommands, type CommandInput } from "@/server/commands";
import { getSql } from "@/server/db/client";
import { createStravaClient } from "@/server/strava/client";
import { answerSubscriptionChallenge } from "@/server/strava/webhook";

/**
 * Strava webhook callback (public: Strava has no session). GET is the
 * subscription handshake; POST is an activity/athlete event. Strava wants a
 * 200 within 2 s, so the event is only recorded here and fetched/matched after
 * the response (processStravaEvents; the daily cron retries failures).
 * Without a Strava app on this deployment there is no webhook (404).
 */
export async function GET(request: Request) {
  if (!createStravaClient().configured) return Response.json({ error: "not_found" }, { status: 404 });
  const answer = answerSubscriptionChallenge(new URL(request.url).searchParams, process.env.STRAVA_WEBHOOK_VERIFY_TOKEN);
  if (answer.status !== 200) return Response.json({ error: "forbidden" }, { status: 403 });
  return Response.json(answer.body);
}

export async function POST(request: Request) {
  if (!createStravaClient().configured) return Response.json({ error: "not_found" }, { status: 404 });
  let event: unknown;
  try {
    event = await request.json();
  } catch {
    return Response.json({ error: "invalid_input" }, { status: 400 });
  }
  const commands = createCommands({ sql: getSql(), actor: { kind: "service" } });
  try {
    const result = await commands.receiveStravaEvent(event as CommandInput<"receiveStravaEvent">);
    if (result.accepted) {
      after(async () => {
        await commands.processStravaEvents({});
      });
    }
    // 200 even when ignored, so Strava doesn't retry an event that isn't ours.
    return Response.json(result);
  } catch (error) {
    if (error instanceof CommandError && error.code === "invalid_input") {
      return Response.json({ error: "invalid_input" }, { status: 400 });
    }
    throw error;
  }
}
