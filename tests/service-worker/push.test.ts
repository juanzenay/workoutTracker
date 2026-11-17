import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

/**
 * Loads public/sw.js in a bare context (no browser, no network) and returns the handlers it registered.
 * The worker only touches `self` when its listeners fire, so loading it is enough to capture them.
 */
function loadServiceWorker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn(() => Promise.resolve());
  const self = {
    location: { origin: "https://workout-tracker.test" },
    registration: { showNotification },
    addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
  };
  runInNewContext(readFileSync(join(import.meta.dirname, "..", "..", "public", "sw.js"), "utf8"), { self, URL });

  /** Fires a push event, waits until the worker has finished handling it, and returns the notification spy. */
  async function deliver(payload: unknown) {
    let pending: Promise<unknown> = Promise.resolve();
    listeners.get("push")!({
      data: { json: () => payload },
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;
    return showNotification;
  }

  return { deliver };
}

describe("service worker push handler", () => {
  it("shows the notification with the payload's title, tag and url", async () => {
    const { deliver } = loadServiceWorker();

    const notify = await deliver({ title: "Backup failed", body: "GitHub said 401", url: "/export", tag: "item-1" });

    expect(notify).toHaveBeenCalledWith(
      "Backup failed",
      expect.objectContaining({ body: "GitHub said 401", tag: "item-1", data: { url: "/export" } }),
    );
  });

  it("opens the inbox when the payload has no url", async () => {
    const { deliver } = loadServiceWorker();

    const notify = await deliver({ title: "Plan change", tag: "item-2" });

    expect(notify).toHaveBeenCalledWith("Plan change", expect.objectContaining({ data: { url: "/inbox" } }));
  });
});
