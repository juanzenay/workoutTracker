"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Count down (the default) shows time left; count up shows time elapsed. */
export type RestTimerMode = "down" | "up";

export const REST_TIMER_MODE_KEY = "workout-tracker-rest-timer-mode";

type KeyValueStore = Pick<globalThis.Storage, "getItem" | "setItem">;

/** The device's localStorage, or null where it can't be reached (blocked site data, no window). */
function deviceStorage(): KeyValueStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the saved mode. Anything unexpected, including storage that throws, counts down. */
export function readRestTimerMode(storage: Pick<KeyValueStore, "getItem"> | null): RestTimerMode {
  try {
    return storage?.getItem(REST_TIMER_MODE_KEY) === "up" ? "up" : "down";
  } catch {
    return "down";
  }
}

/** Saves the mode for this device. Returns false when it could not be saved, so the caller can keep it for the session. */
export function writeRestTimerMode(storage: Pick<KeyValueStore, "setItem"> | null, mode: RestTimerMode): boolean {
  try {
    storage?.setItem(REST_TIMER_MODE_KEY, mode);
    return storage !== null;
  } catch {
    return false;
  }
}

// Same-tab writes don't fire the `storage` event, so listeners are kept here too.
const listeners = new Set<() => void>();

// The choice when storage can't keep it: it lasts until the page is reloaded.
let sessionMode: RestTimerMode | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The device's rest timer mode, and a setter that saves it. Server rendering and the first client
 * render both see count down, so a saved "up" never causes a hydration mismatch.
 */
export function useRestTimerMode(): [RestTimerMode, (mode: RestTimerMode) => void] {
  const mode = useSyncExternalStore(
    subscribe,
    () => sessionMode ?? readRestTimerMode(deviceStorage()),
    (): RestTimerMode => "down",
  );
  const setMode = useCallback((next: RestTimerMode) => {
    sessionMode = writeRestTimerMode(deviceStorage(), next) ? null : next;
    listeners.forEach((notify) => notify());
  }, []);
  return [mode, setMode];
}
