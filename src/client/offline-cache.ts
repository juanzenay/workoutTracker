"use client";

import { useSyncExternalStore } from "react";

/**
 * Asks the service worker (public/sw.js) to refresh its offline caches: the offline pages and their
 * assets, plus `images` (catalogue image URLs to keep for the gym). Safe to call often: the worker
 * re-fetches pages at most once a minute, unless `force` (the pages changed, e.g. Dumb Mode toggled).
 * No-op without a service worker (dev, old browsers).
 */
export function warmOfflineCache(images: string[] = [], { force = false }: { force?: boolean } = {}): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready.then((registration) =>
    registration.active?.postMessage({ type: "warm", force, images: images.filter((u) => /^https?:/.test(u)) }),
  );
}

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** True while the browser reports no connection (false during server rendering). */
export function useOffline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !navigator.onLine,
    () => false,
  );
}
