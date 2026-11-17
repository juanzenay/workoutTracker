import { expect, test, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** Drags a set row left by `distance` px, starting on its padding so the press lands on the row itself. */
async function swipeLeft(row: Locator, distance: number, page: Page) {
  const box = await row.boundingBox();
  if (!box) throw new Error("set row not laid out");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 2 - distance, y, { steps: 10 });
  await page.mouse.up();
}

/** Swipes an empty set away and taps its remove control. */
async function removeEmptySet(card: Locator, n: number, page: Page) {
  await swipeLeft(card.getByRole("group", { name: `Set ${n}` }), 80, page);
  await card.getByRole("button", { name: "Remove set" }).click();
}

/** Adds a set, sets its type and logs weight and reps on it, then completes it. */
async function logSet(card: Locator, n: number, setType: string, weight: string, reps: string) {
  await card.getByRole("button", { name: "Add set" }).click();
  const row = card.getByRole("group", { name: `Set ${n}` });
  if (setType !== "normal") await row.getByLabel("Set type").selectOption(setType);
  await row.getByLabel(/Weight/).fill(weight);
  await row.getByLabel("Reps").fill(reps);
  await row.getByLabel("Reps").blur();
  await row.getByRole("button", { name: "Complete set" }).click();
}

test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

test("removing a set re-sequences numbers, warm-up badges, Previous and the RIR picker", async ({ page }) => {
  const bench = "Barbell Bench Press - Medium Grip";

  await signIn(page);
  await page.goto("/workout");

  // A finished workout gives the next one its Previous values: a warm-up, then two working sets.
  await page.getByRole("button", { name: "Start empty workout" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: bench, exact: true }).click();
  const finishedCard = page.getByRole("region", { name: bench });
  await logSet(finishedCard, 1, "warmup", "45", "10");
  await logSet(finishedCard, 2, "normal", "100", "5");
  await logSet(finishedCard, 3, "normal", "110", "5");
  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  // The next workout: warm-up, normal, normal, all still empty so each can be swiped away.
  await page.goto("/workout");
  await page.getByRole("button", { name: "Start empty workout" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: bench, exact: true }).click();
  const card = page.getByRole("region", { name: bench });
  for (let n = 1; n <= 3; n++) await card.getByRole("button", { name: "Add set" }).click();
  await card.getByRole("group", { name: "Set 1" }).getByLabel("Set type").selectOption("warmup");
  await expect(card.getByRole("group", { name: "Set 1" }).getByText("W", { exact: true })).toBeVisible();
  await expect(card.getByRole("group", { name: "Set 2" }).getByText("1", { exact: true })).toBeVisible();
  await expect(card.getByRole("group", { name: "Set 3" }).getByText("2", { exact: true })).toBeVisible();

  // Removing the middle set: the last set moves up to position 2, so its numbers shift and RIR follows it.
  await removeEmptySet(card, 2, page);
  await expect(card.getByRole("group", { name: /^Set \d+$/ })).toHaveCount(2);
  await expect(card.getByRole("group", { name: "Set 1" }).getByText("W", { exact: true })).toBeVisible();
  await expect(card.getByRole("group", { name: "Set 2" }).getByText("1", { exact: true })).toBeVisible();
  await expect(card.getByRole("group", { name: "Set 1" }).getByLabel(/^Previous: /)).toContainText("45");
  await expect(card.getByRole("group", { name: "Set 2" }).getByLabel(/^Previous: /)).toContainText("100");
  await expect(card.getByRole("group", { name: "Set 2" }).getByLabel(/^Previous: /)).not.toContainText("110");

  const rir = card.getByRole("group", { name: "Reps in reserve on the last set" });
  await rir.getByRole("button", { name: "2" }).click();
  await expect(rir.getByRole("button", { name: "2" })).toHaveAttribute("aria-pressed", "true");
  await rir.getByRole("button", { name: "2" }).click();

  // Removing the last set: the RIR picker moves to the remaining set.
  await removeEmptySet(card, 2, page);
  await expect(card.getByRole("group", { name: /^Set \d+$/ })).toHaveCount(1);
  await expect(card.getByRole("group", { name: "Set 1" }).getByText("W", { exact: true })).toBeVisible();
  await rir.getByRole("button", { name: "1" }).click();

  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const sets = await sql<{ position: number; set_type: string; rir: number | null }[]>`
      select ws.position, ws.set_type, ws.rir from public.workout_sets ws
      join public.workout_exercises we on we.id = ws.workout_exercise_id
      where we.workout_id = (select id from public.workouts order by started_at desc limit 1)
      order by ws.position`;
    expect(sets).toEqual([{ position: 0, set_type: "warmup", rir: 1 }]);
  } finally {
    await sql.end();
  }
});
