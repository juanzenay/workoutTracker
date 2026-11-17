import { expect, test, type Page } from "@playwright/test";
import { E2E_OWNER } from "./owner";

const BENCH = "Barbell Bench Press - Medium Grip";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function benchWorkout(page: Page, weight: string) {
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
  return row;
}

test("flags a PR as the set is ticked, then offers a share card and lists the record", async ({ page }) => {
  await signIn(page);
  await page.goto("/workout");

  // Baseline (other specs may have logged lighter bench sets already).
  await benchWorkout(page, "200");
  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page.getByRole("img", { name: "Workout summary card" })).toBeVisible();

  // Same session in the same page: compared against the workout just finished.
  const row = await benchWorkout(page, "205");
  await expect(row.getByRole("img", { name: /Personal record: Heaviest weight/ })).toBeVisible();
  await page.getByRole("button", { name: "Finish workout" }).click();

  await expect(page.getByRole("heading", { name: "3 PRs" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Workout summary card" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download image" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  await page.goto("/records");
  const record = page.getByRole("link", { name: new RegExp(BENCH) });
  await expect(record).toContainText("205 lb");

  await record.click();
  await expect(page.getByRole("img", { name: "Estimated 1RM" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Best set weight" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Volume" })).toBeVisible();
});
