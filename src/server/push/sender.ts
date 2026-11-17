import webpush from "web-push";

/** A device's subscription, as the browser's `PushSubscription.toJSON()` gives it. */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** What the service worker shows (public/sw.js `push` listener). */
export interface PushMessage {
  title: string;
  body?: string;
  /** In-app path opened when the notification is tapped. */
  url: string;
  /** Same tag replaces an earlier notification on the device. */
  tag: string;
}

/** `gone`: the push service says the subscription no longer exists (404/410) — delete it. */
export type PushResult = "sent" | "gone";

/** Sends one Web Push message. The command layer only talks to this port; tests inject a fake (no network). */
export interface PushSender {
  send(subscription: PushSubscriptionJson, message: PushMessage): Promise<PushResult>;
}

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` contact; Apple rejects pushes without a valid one. */
  subject: string;
}

/** VAPID keys from the environment (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`), or null when push isn't set up. */
export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  const subject = env.VAPID_SUBJECT;
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/** Live sender (web-push, VAPID). Without VAPID config, nothing is sent (inbox items are still recorded). */
export function createWebPushSender(vapid: VapidConfig | null = vapidFromEnv()): PushSender {
  return {
    async send(subscription, message) {
      if (!vapid) return "sent";
      try {
        await webpush.sendNotification(subscription, JSON.stringify(message), {
          TTL: 60 * 60 * 24,
          urgency: "high",
          vapidDetails: vapid,
        });
        return "sent";
      } catch (error) {
        if (error instanceof webpush.WebPushError && (error.statusCode === 404 || error.statusCode === 410)) return "gone";
        throw error;
      }
    },
  };
}
