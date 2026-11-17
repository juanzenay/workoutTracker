import { expect, test, type Page } from "@playwright/test";
import { E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

const press = "Machine Bench Press";

// Specs share one database: start from and leave behind no blocks, workouts, plan changes or inbox items.
test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

/** Today as YYYY-MM-DD and ISO weekday, in this machine's zone (the browser's too). */
function today() {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { date, weekday: String(((d.getDay() + 6) % 7) + 1) };
}

test("picks progression rules and deload weeks; a finished block is archived and browsable", async ({ page }) => {
  await signIn(page);
  await page.goto("/blocks/new");
  await page.getByLabel("Name", { exact: true }).fill("Archive");
  await page.getByLabel("Starts").fill("2020-01-06");
  await page.getByLabel("Weeks").fill("4");
  // Default placement: the last week of a 4+ week block.
  await expect(page.getByRole("checkbox", { name: "Week 4" })).toBeChecked();
  await page.getByLabel("Session name").fill("Chest Upper");
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("machine bench press");
  await page.getByRole("button", { name: press, exact: true }).click();
  const pick = page.getByRole("group", { name: press });
  await pick.getByLabel("Start (lb)").fill("180");
  await pick.getByLabel("Progression").selectOption("ramp");
  await pick.getByLabel("Ramp to sets").fill("5");
  await page.getByRole("button", { name: "Create block" }).click();
  await page.waitForURL(/\/blocks\/[0-9a-f-]{36}$/);

  await expect(page.getByText("Archived")).toBeVisible();
  await expect(page.getByRole("region", { name: "Week 3" })).toContainText("180 lb × 10, 10, 10, 10, 10");
  const deload = page.getByRole("region", { name: "Week 4" });
  await expect(deload).toContainText("Deload");
  await expect(deload).toContainText("160 lb × 10, 10");

  await page.goto("/blocks");
  await expect(page.getByRole("region", { name: "Archive" }).getByRole("link", { name: /Archive/ })).toBeVisible();
});

test("designs a block, starts today's planned session with targets, and progresses the next one", async ({ page }) => {
  await signIn(page);
  await expect(page.getByText("No block running today.")).toBeVisible();

  await page.goto("/blocks/new");
  await page.getByLabel("Name", { exact: true }).fill("E2E Block");
  await page.getByLabel("Starts").fill(today().date);
  await page.getByLabel("Weeks").fill("2");
  await page.getByLabel("Session name").fill("Chest Upper");
  await page.getByLabel("Day").selectOption(today().weekday);
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("machine bench press");
  await page.getByRole("button", { name: press, exact: true }).click();
  const pick = page.getByRole("group", { name: press });
  await pick.getByLabel("Reps").fill("10-15");
  await pick.getByLabel("Start (lb)").fill("180");
  await page.getByRole("button", { name: "Create block" }).click();
  await page.waitForURL(/\/blocks\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: "Week 2" })).toBeVisible();

  // Home opens on Today with the planned session and its targets.
  await page.goto("/");
  const todayCard = page.getByRole("region", { name: "Chest Upper" });
  await expect(todayCard).toContainText(`${press}180 lb × 10, 10, 10`);
  // Import run is on Today itself, in view without opening the session card.
  await expect(page.getByRole("link", { name: "Import run" })).toHaveAttribute("href", "/runs");
  await todayCard.locator("summary").click();
  await todayCard.getByRole("link", { name: "Start" }).click();
  await page.waitForURL(/\/workout$/);

  const logged = page.getByRole("region", { name: press });
  await expect(logged.getByRole("group", { name: /^Set \d+$/ })).toHaveCount(3);
  for (const n of [1, 2, 3]) {
    const set = logged.getByRole("group", { name: `Set ${n}` });
    await expect(set.getByLabel(/Weight/)).toHaveValue("180");
    await expect(set.getByLabel("Reps")).toHaveValue("10");
    await set.getByLabel("Reps").fill("15");
    await set.getByRole("button", { name: "Complete set" }).click();
    await expect(set.getByRole("button", { name: "Complete set" })).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Finish workout" }).click();
  // The logger already reads "Synced" before Finish lands; wait for the finished view so "Synced" covers the finish.
  await expect(page.getByText("Workout finished")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  // Double progression: next week's session adds 5 lb.
  await page.goto("/blocks");
  await page.getByRole("link", { name: /E2E Block/ }).click();
  const week2 = page.getByRole("region", { name: "Week 2" });
  await expect(week2).toContainText("185 lb × 10, 10, 10");
  await expect(week2).toContainText("Hit 15 reps on all 3 sets at 180 lb, so next time is 185 lb");
});
