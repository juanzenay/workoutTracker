import { expect, test, type Page } from "@playwright/test";
import { E2E_OWNER } from "./owner";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

test("the Strava webhook answers Strava's handshake without a session, and only with our verify token", async ({ request }) => {
  const ok = await request.get(
    "/api/strava/webhook?hub.mode=subscribe&hub.challenge=15f7d1a91c1f40f8a748fd134752feb3&hub.verify_token=e2e-verify-token",
    { maxRedirects: 0 },
  );
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toEqual({ "hub.challenge": "15f7d1a91c1f40f8a748fd134752feb3" });

  const wrong = await request.get("/api/strava/webhook?hub.mode=subscribe&hub.challenge=abc&hub.verify_token=nope", {
    maxRedirects: 0,
  });
  expect(wrong.status()).toBe(403);

  // An event while Strava isn't connected is acknowledged (so Strava stops retrying) and ignored.
  const event = await request.post("/api/strava/webhook", {
    maxRedirects: 0,
    data: {
      aspect_type: "create",
      event_time: 1760206800,
      object_id: 16012345678,
      object_type: "activity",
      owner_id: 134815,
      subscription_id: 298765,
      updates: {},
    },
  });
  expect(event.status()).toBe(200);
  expect(await event.json()).toEqual({ accepted: false, reason: "not_connected" });
});

test("the Strava page offers to connect, sending the owner to Strava's consent screen", async ({ page }) => {
  await signIn(page);
  await page.goto("/races");
  await page.getByRole("link", { name: "Strava" }).click();
  await expect(page.getByRole("heading", { name: "Strava", level: 1 })).toBeVisible();
  await expect(page.getByText("Not connected.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Strava" })).toHaveAttribute("href", "/api/strava/connect");
  // The e2e deployment has a (fake) Strava app: connecting redirects to Strava with its client id (not followed).
  const connect = await page.request.get("/api/strava/connect", { maxRedirects: 0 });
  expect(connect.status()).toBeGreaterThanOrEqual(300);
  expect(connect.status()).toBeLessThan(400);
  const location = new URL(connect.headers().location!);
  expect(`${location.origin}${location.pathname}`).toBe("https://www.strava.com/oauth/authorize");
  expect(location.searchParams.get("client_id")).toBe("12345");
});
