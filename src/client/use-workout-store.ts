"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { WorkoutOp } from "@/domain/workout";
import { openWorkoutStore, type SyncTransport, type WorkoutStore } from "./workout-store";

/** Posts the outbox to the sync route. Throws on any failure so the ops stay queued. */
export const httpTransport: SyncTransport = async (ops: WorkoutOp[]) => {
  const response = await fetch("/api/workouts/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ops }),
    // A redirect means the session lapsed (proxy sends us to /sign-in): not a success.
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Sync failed with ${response.status}`);
};

const RETRY_MS = 10_000;

let storePromise: Promise<WorkoutStore> | null = null;
function sharedStore(): Promise<WorkoutStore> {
  storePromise ??= openWorkoutStore({ transport: httpTransport });
  return storePromise;
}

export type SyncState = "synced" | "syncing" | "offline" | "failed";

const noop = () => () => {};

/**
 * The device's workout store, opened once per page. Keeps the outbox draining:
 * after every change, when the browser comes back online, when the app
 * returns to the foreground, and on a timer.
 */
export function useWorkoutStore() {
  const [store, setStore] = useState<WorkoutStore | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("synced");

  useEffect(() => {
    let cancelled = false;
    sharedStore().then(
      (s) => !cancelled && setStore(s),
      () => !cancelled && setUnavailable(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const sync = useCallback(async () => {
    if (!store || store.pendingCount() === 0) return;
    if (!navigator.onLine) {
      setSyncState("offline");
      return;
    }
    setSyncState("syncing");
    const { ok, pending } = await store.sync();
    setSyncState(ok && pending === 0 ? "synced" : navigator.onLine ? "failed" : "offline");
  }, [store]);

  useEffect(() => {
    if (!store) return;
    const initial = window.setTimeout(sync, 0);
    const unsubscribe = store.subscribe(() => void sync());
    const onVisible = () => document.visibilityState === "visible" && void sync();
    const onOffline = () => store.pendingCount() > 0 && setSyncState("offline");
    window.addEventListener("online", sync);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(sync, RETRY_MS);
    return () => {
      window.clearTimeout(initial);
      unsubscribe();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [store, sync]);

  const subscribe = useCallback((cb: () => void) => (store ? store.subscribe(cb) : noop()), [store]);
  const active = useSyncExternalStore(
    subscribe,
    () => store?.active() ?? null,
    () => null,
  );
  const pending = useSyncExternalStore(
    subscribe,
    () => store?.pendingCount() ?? 0,
    () => 0,
  );

  const restTimer = useSyncExternalStore(
    subscribe,
    () => store?.restTimer() ?? null,
    () => null,
  );

  return { store, unavailable, active, pending, restTimer, syncState: pending === 0 ? "synced" : syncState };
}
