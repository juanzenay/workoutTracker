import type { PushMessage, PushSender, PushSubscriptionJson } from "@/server/push/sender";

/**
 * A PushSender that records what would have been sent instead of calling push services.
 * Endpoints in `gone` answer like an expired subscription (404/410).
 */
export function fakePushSender({ gone = [] as string[] } = {}) {
  const sent: { subscription: PushSubscriptionJson; message: PushMessage }[] = [];
  const sender: PushSender = {
    async send(subscription, message) {
      if (gone.includes(subscription.endpoint)) return "gone";
      sent.push({ subscription, message });
      return "sent";
    },
  };
  return { sender, sent };
}

/** A subscription as the browser's PushSubscription.toJSON() returns it. */
export const testSubscription = (endpoint = "https://web.push.apple.com/test-device") => ({
  endpoint,
  expirationTime: null,
  keys: {
    p256dh: "BLc4xRzKlKORKWlbdgFaBrrPK3ydWAHo4M0gs0i1oEKgPpWC5cW8OCzVrOQRv-1npXRWk8udnW3oYhIO4475rds",
    auth: "5I2Bu2oKdyy9CwL8QVF0NQ",
  },
});
