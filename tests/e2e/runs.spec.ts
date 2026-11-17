import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import { fitActivity, FIT_SPORT } from "../fixtures/run-files";
import { E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

test("imports runs exported from the watch's app: runs are stored, other sports skipped, damaged files reported", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/races");
  await page.getByRole("link", { name: "Completed runs" }).click();
  await expect(page.getByRole("heading", { name: "Completed runs", level: 1 })).toBeVisible();
  await expect(page.getByText("No runs yet.")).toBeVisible();

  const run = fitActivity({ start: "2026-10-11T13:05:00Z", utcOffsetHours: -5, meters: 16_093, movingSeconds: 5100 });
  const ride = fitActivity({ start: "2026-10-10T14:00:00Z", utcOffsetHours: -5, sport: FIT_SPORT.cycling, meters: 30_000, movingSeconds: 3600 });
  await page.getByLabel("Activity files").setInputFiles([
    { name: "long.fit", mimeType: "application/octet-stream", buffer: Buffer.from(run) },
    { name: "ride.fit", mimeType: "application/octet-stream", buffer: Buffer.from(ride) },
    { name: "broken.fit", mimeType: "application/octet-stream", buffer: Buffer.from(run.subarray(0, 40)) },
  ]);
  await page.getByRole("button", { name: "Import" }).click();

  await expect(page.getByRole("status").filter({ hasText: "1 run imported." })).toBeVisible();
  const results = page.getByRole("region", { name: "This import" });
  await expect(results.getByRole("listitem").filter({ hasText: "long.fit" })).toContainText(
    "Run on Sunday, Oct 11, 10 mi — imported",
  );
  await expect(results.getByRole("listitem").filter({ hasText: "ride.fit" })).toContainText("Ride on Saturday, Oct 10 — skipped");
  await expect(results.getByRole("listitem").filter({ hasText: "broken.fit" })).toContainText("damaged or incomplete");

  const recent = page.getByRole("region", { name: "Recent activities" });
  await expect(recent.getByRole("listitem")).toHaveCount(1);
  await expect(recent.getByRole("listitem")).toContainText("Imported from long.fit");

  // The same file again is recognised, not counted twice.
  await page.getByLabel("Activity files").setInputFiles({ name: "long.fit", mimeType: "application/octet-stream", buffer: Buffer.from(run) });
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByRole("region", { name: "This import" }).getByRole("listitem")).toContainText("already imported");
  await expect(recent.getByRole("listitem")).toHaveCount(1);
});
