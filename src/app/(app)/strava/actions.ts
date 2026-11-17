"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireCommands } from "@/server/auth/session";
import { CommandError } from "@/server/commands";

export async function disconnectStrava(): Promise<void> {
  const commands = await requireCommands();
  await commands.disconnectStrava({});
  revalidatePath("/strava");
}

/** Subscribes this deployment's /api/strava/webhook (Strava calls it back during the request). */
export async function subscribeStravaWebhook(): Promise<void> {
  const commands = await requireCommands();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
  if (!host || !verifyToken) redirect("/strava?error=webhook");
  try {
    await commands.subscribeStravaWebhook({ callbackUrl: `${proto}://${host}/api/strava/webhook`, verifyToken });
  } catch (error) {
    if (error instanceof CommandError) redirect(`/strava?error=${error.code === "unavailable" ? "unavailable" : "webhook"}`);
    throw error;
  }
  revalidatePath("/strava");
}
