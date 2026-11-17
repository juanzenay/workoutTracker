import { describe, expect, it } from "vitest";
import { deriveSubscriptionState, isIosOutsideInstalledApp } from "./push-state";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("isIosOutsideInstalledApp", () => {
  it("is true for iPhone Safari in a browser tab", () => {
    expect(isIosOutsideInstalledApp({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5, standalone: false })).toBe(true);
  });

  it("is false for the installed iPhone home-screen app", () => {
    expect(isIosOutsideInstalledApp({ userAgent: IPHONE_SAFARI, maxTouchPoints: 5, standalone: true })).toBe(false);
  });

  it("is true for iPadOS Safari in desktop mode (reports Macintosh, has touch points) in a browser tab", () => {
    expect(isIosOutsideInstalledApp({ userAgent: IPAD_DESKTOP_SAFARI, maxTouchPoints: 5, standalone: false })).toBe(true);
  });

  it("is false for a real Mac, which has no touch points", () => {
    expect(isIosOutsideInstalledApp({ userAgent: MAC_CHROME, maxTouchPoints: 0, standalone: false })).toBe(false);
  });

  it("is false for Android in a browser tab", () => {
    expect(isIosOutsideInstalledApp({ userAgent: ANDROID_CHROME, maxTouchPoints: 5, standalone: false })).toBe(false);
  });
});

describe("deriveSubscriptionState", () => {
  it("is off until the browser has been granted permission", () => {
    expect(deriveSubscriptionState({ permission: "default", hasBrowserSubscription: false, serverSubscribed: false })).toBe(
      "off",
    );
  });

  it("is on when the browser has a subscription and the server still pushes to it", () => {
    expect(deriveSubscriptionState({ permission: "granted", hasBrowserSubscription: true, serverSubscribed: true })).toBe(
      "on",
    );
  });

  it("is granted-but-not-subscribed when permission is granted but this device has no browser subscription", () => {
    expect(deriveSubscriptionState({ permission: "granted", hasBrowserSubscription: false, serverSubscribed: false })).toBe(
      "grantedNotSubscribed",
    );
  });

  it("is granted-but-not-subscribed when the browser has a subscription the server no longer pushes to", () => {
    expect(deriveSubscriptionState({ permission: "granted", hasBrowserSubscription: true, serverSubscribed: false })).toBe(
      "grantedNotSubscribed",
    );
  });
});
