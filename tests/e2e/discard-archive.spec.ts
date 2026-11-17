import { expect, test, type Page } from "@playwright/test";
import { E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

const BENCH = "Barbell Bench Press - Medium Grip";

test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/**
 * Opens History through the in-app nav. A typed or reloaded /workouts can be answered from the offline page
 * cache (the worker waits 3 s for the network, then falls back to a copy), which would hide the change.
 */
async function openHistory(page: Page) {
  await page.getByRole("link", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(/\/workouts$/);
}

/** The discarded archive holds exactly the one workout: opens it from History and checks its row. */
async function expectArchived(page: Page) {
  await page.getByRole("link", { name: "Discarded" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("1 exercise · 1 set");
}

/** Starts a workout from the Workout tab with one completed bench set (weight × 8). */
async function logBenchSet(page: Page, weight: string) {
  await page.getByRole("link", { name: "Workout", exact: true }).click();
  await page.getByRole("button", { name: /Start (empty|another) workout/ }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: BENCH }).click();
  const card = page.getByRole("region", { name: BENCH });
  await card.getByRole("button", { name: "Add set" }).click();
  const row = card.getByRole("group", { name: "Set 1" });
  await row.getByLabel(/Weight/).fill(weight);
  await row.getByLabel("Reps").fill("8");
  await row.getByRole("button", { name: "Complete set" }).click();
  await expect(row.getByRole("button", { name: "Complete set" })).toHaveAttribute("aria-pressed", "true");
}

/**
 * Discard is two taps: the first arms it, the second confirms. The arm lapses after 4 s, and Playwright's
 * stability wait before a plain click can outlast that (measured: ~4.5 s to a plain click, ~35 ms forced), so
 * the confirm tap is forced.
 */
async function discardWorkout(page: Page) {
  await page.getByRole("button", { name: "Discard workout" }).click();
  await page.getByRole("button", { name: "Tap again to confirm" }).click({ force: true });
  await expect(page.getByRole("button", { name: /Start (empty|another) workout/ })).toBeVisible();
}

test("a discarded workout leaves history and records, sits in the archive, and restores to history", async ({
  page,
}) => {
  await signIn(page);

  // A finished 200 lb set makes the record; the 205 lb workout is the one discarded.
  await logBenchSet(page, "200");
  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page.getByRole("img", { name: "Workout summary card" })).toBeVisible();

  await logBenchSet(page, "205");
  await discardWorkout(page);

  await openHistory(page);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("200");
  await expect(page.getByRole("article")).not.toContainText("205");

  await page.getByRole("link", { name: "Records", exact: true }).click();
  await expect(page.getByRole("link", { name: new RegExp(BENCH) })).toContainText("200 lb");
  await expect(page.getByRole("link", { name: new RegExp(BENCH) })).not.toContainText("205 lb");

  await openHistory(page);
  await expectArchived(page);

  await page.getByRole("article").getByRole("link").first().click();
  await expect(page.getByText("Read-only. Restore it to put it back in your history.")).toBeVisible();
  await expect(page.getByText(BENCH).first()).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByText("No discarded workouts.")).toBeVisible();

  await openHistory(page);
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").filter({ hasText: "205" })).toHaveCount(1);
});

test("a workout discarded offline syncs after reconnect and lands in the archive", async ({ page, context }) => {
  await signIn(page);
  await logBenchSet(page, "200");

  await context.setOffline(true);
  await discardWorkout(page);
  await expect(page.getByRole("status")).toContainText("Waiting for a connection");

  await context.setOffline(false);
  // The empty logger shows sync status only while changes are pending, so it clears once the outbox has synced.
  await expect(page.getByRole("status")).toHaveCount(0, { timeout: 20_000 });

  await openHistory(page);
  await expect(page.getByText("No finished workouts yet.")).toBeVisible();

  await expectArchived(page);
});
