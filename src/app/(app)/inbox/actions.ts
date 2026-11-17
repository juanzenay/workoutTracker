"use server";

import { requireCommands } from "@/server/auth/session";

/** Saves this device's PushSubscription.toJSON(). */
export async function subscribeToPush(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  const commands = await requireCommands();
  await commands.savePushSubscription(subscription);
}

export async function unsubscribeFromPush(endpoint: string) {
  const commands = await requireCommands();
  await commands.deletePushSubscription({ endpoint });
}

/** Whether the server still pushes to this device (the push service may have dropped it). */
export async function isSubscribed(endpoint: string) {
  const commands = await requireCommands();
  return (await commands.getPushSubscription({ endpoint })).subscribed;
}
