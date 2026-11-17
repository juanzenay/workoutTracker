import { describe, expect, it } from "vitest";
import { readRestTimerMode, REST_TIMER_MODE_KEY, writeRestTimerMode } from "./rest-timer-mode";

/** An in-memory stand-in for window.localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

/** Storage that throws on every access, as Safari private mode and blocked site data do. */
const brokenStorage = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("denied", "QuotaExceededError");
  },
};

describe("rest timer mode", () => {
  it("counts down by default when nothing is saved", () => {
    expect(readRestTimerMode(fakeStorage())).toBe("down");
    expect(readRestTimerMode(null)).toBe("down");
  });

  it("returns a saved count-up choice and persists it under the device key", () => {
    const storage = fakeStorage();
    writeRestTimerMode(storage, "up");

    expect(storage.getItem(REST_TIMER_MODE_KEY)).toBe("up");
    expect(readRestTimerMode(storage)).toBe("up");
  });

  it("ignores a saved value it does not recognise and counts down", () => {
    expect(readRestTimerMode(fakeStorage({ [REST_TIMER_MODE_KEY]: "sideways" }))).toBe("down");
  });

  it("falls back to count down when storage throws on read", () => {
    expect(readRestTimerMode(brokenStorage)).toBe("down");
  });

  it("reports whether the choice was saved, without throwing when storage throws on write", () => {
    expect(writeRestTimerMode(fakeStorage(), "up")).toBe(true);
    expect(() => writeRestTimerMode(brokenStorage, "up")).not.toThrow();
    expect(writeRestTimerMode(brokenStorage, "up")).toBe(false);
    expect(writeRestTimerMode(null, "up")).toBe(false);
  });
});
