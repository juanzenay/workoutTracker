"use client";

import { useEffect } from "react";

/** Registers public/sw.js (production only, so dev reloads aren't served stale). */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Non-fatal: the app works online without it.
    });
  }, []);
  return null;
}
