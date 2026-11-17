import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

// Body-only exercises are logged mostly on a phone, so run the whole flow at the narrowest phone width.
const PHONE_WIDTH = 375;
test.use({ viewport: { width: PHONE_WIDTH, height: 812 } });
test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

test("a body-only exercise logs reps alone, and + add weight logs a weighted set", async ({ page }) => {
  await signIn(page);
  await page.goto("/workout");
  await expect(page.getByRole("button", { name: "Start empty workout" })).toBeEnabled();
  await page.getByRole("button", { name: "Start empty workout" }).click();

  const pushUp = "Push-Up Wide";
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("push-up wide");
  await page.getByRole("button", { name: pushUp, exact: true }).click();

  const card = page.getByRole("region", { name: pushUp });
  await card.getByRole("button", { name: "Add set" }).click();
  const first = card.getByRole("group", { name: "Set 1" });
  await expect(first.getByLabel(/Weight/)).toHaveCount(0);
  await expect(first.getByRole("button", { name: /^Unit:/ })).toHaveCount(0);

  await first.getByLabel("Reps").fill("12");
  await first.getByRole("button", { name: "Complete set" }).click();
  await expect(first.getByRole("button", { name: "Complete set" })).toHaveAttribute("aria-pressed", "true");

  await card.getByRole("button", { name: "Add set" }).click();
  const second = card.getByRole("group", { name: "Set 2" });
  await second.getByLabel("Reps").fill("10");
  await second.getByRole("button", { name: "Complete set" }).click();
  await expect(second.getByRole("button", { name: "Complete set" })).toHaveAttribute("aria-pressed", "true");

  // "+ add weight" brings the weight input back, and a new set can carry a load.
  await card.getByRole("button", { name: "+ Add weight" }).click();
  await expect(first.getByRole("button", { name: /^Unit:/ })).toBeVisible();
  await card.getByRole("button", { name: "Add set" }).click();
  const weighted = card.getByRole("group", { name: "Set 3" });
  await weighted.getByLabel(/Weight/).fill("25");
  await weighted.getByLabel("Reps").fill("6");
  await weighted.getByRole("button", { name: "Complete set" }).click();
  await expect(weighted.getByRole("button", { name: "Complete set" })).toHaveAttribute("aria-pressed", "true");

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE_WIDTH);

  await page.getByRole("button", { name: "Finish workout" }).click();
  // The logger already reads "Synced" before Finish lands; wait for the finished view so "Synced" covers the finish.
  await expect(page.getByText("Workout finished")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const sets = await sql<{ weight: string | null; reps: number }[]>`
      select s.weight::text as weight, s.reps
      from public.workout_sets s
      join public.workout_exercises we on we.id = s.workout_exercise_id
      join public.exercises e on e.id = we.exercise_id
      where e.name = ${pushUp} order by s.position`;
    expect(sets).toEqual([
      { weight: null, reps: 12 },
      { weight: null, reps: 10 },
      { weight: "25", reps: 6 },
    ]);
  } finally {
    await sql.end();
  }
});
