/**
 * What the push toggle shows once permission is granted. "grantedNotSubscribed" is the case where the
 * browser allows notifications but this device has no live subscription the server pushes to, so
 * notifications silently never arrive.
 */
export type SubscriptionState = "off" | "on" | "grantedNotSubscribed";

/**
 * iOS only offers web push to an app installed to the home screen. A browser tab on iOS can look
 * push-capable but can't subscribe, so the toggle should point the user at the home screen instead.
 * iPadOS in desktop mode reports as Macintosh, so touch points tell it apart from a real Mac.
 */
export function isIosOutsideInstalledApp({
  userAgent,
  maxTouchPoints,
  standalone,
}: {
  userAgent: string;
  maxTouchPoints: number;
  standalone: boolean;
}): boolean {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  return ios && !standalone;
}

export function deriveSubscriptionState({
  permission,
  hasBrowserSubscription,
  serverSubscribed,
}: {
  permission: NotificationPermission;
  hasBrowserSubscription: boolean;
  serverSubscribed: boolean;
}): SubscriptionState {
  if (permission !== "granted") return "off";
  return hasBrowserSubscription && serverSubscribed ? "on" : "grantedNotSubscribed";
}
