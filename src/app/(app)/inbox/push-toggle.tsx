"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useStrings } from "@/strings/provider";
import { isSubscribed, subscribeToPush, unsubscribeFromPush } from "./actions";
import { deriveSubscriptionState, isIosOutsideInstalledApp } from "./push-state";

type State =
  | "checking"
  | "unsupported"
  | "notConfigured"
  | "denied"
  | "off"
  | "grantedNotSubscribed"
  | "on"
  | "failed";

/** VAPID public key (base64url) → the bytes PushManager.subscribe wants. */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const installedApp = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/**
 * Enable/disable Web Push on this device. iOS only allows it in the installed PWA (16.4+), and
 * the permission prompt must come from a tap, so nothing is asked until the button is pressed.
 */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const s = useStrings().inbox.push;
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!publicKey) return "notConfigured" as const;
      if (!supported()) return "unsupported" as const;
      if (
        isIosOutsideInstalledApp({
          userAgent: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints,
          standalone: installedApp(),
        })
      )
        return "unsupported" as const;
      if (Notification.permission === "denied") return "denied" as const;
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      const serverSubscribed = subscription ? await isSubscribed(subscription.endpoint) : false;
      return deriveSubscriptionState({
        permission: Notification.permission,
        hasBrowserSubscription: !!subscription,
        serverSubscribed,
      });
    })()
      .catch(() => "off" as const)
      .then((next) => {
        if (!cancelled) setState(next);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    try {
      // Permission already granted: skip the request so no second prompt appears.
      const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = subscription.toJSON();
      await subscribeToPush({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      });
      setState("on");
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await unsubscribeFromPush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setState("failed");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") return null;
  const message =
    state === "on"
      ? s.enabled
      : state === "denied"
        ? s.denied
        : state === "unsupported"
          ? s.unsupported
          : state === "notConfigured"
            ? s.notConfigured
            : state === "grantedNotSubscribed"
              ? s.grantedNotSubscribed
              : state === "failed"
                ? s.failed
                : s.explain;

  return (
    <section aria-label={s.title} className="flex flex-col gap-2 rounded-card bg-surface p-4">
      <p className="text-sm text-muted">{message}</p>
      {state === "on" ? (
        <Button variant="secondary" onClick={disable} disabled={busy} className="self-start">
          {s.disable}
        </Button>
      ) : state === "off" || state === "grantedNotSubscribed" || state === "failed" ? (
        <Button onClick={enable} disabled={busy} className="self-start">
          {s.enable}
        </Button>
      ) : null}
    </section>
  );
}
