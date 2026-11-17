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

test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

test("swiping an empty set reveals a remove control that drops it, while logged sets are left alone", async ({
  page,
}) => {
  const bench = "Barbell Bench Press - Medium Grip";

  await signIn(page);
  await page.goto("/workout");
  await page.getByRole("button", { name: "Start empty workout" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: bench, exact: true }).click();

  const card = page.getByRole("region", { name: bench });
  await card.getByRole("button", { name: "Add set" }).click();
  await card.getByRole("button", { name: "Add set" }).click();
  const logged = card.getByRole("group", { name: "Set 1" });
  const empty = card.getByRole("group", { name: "Set 2" });
  await logged.getByLabel("Reps").fill("8");
  await logged.getByLabel("Reps").blur();

  // A logged set does not respond to a swipe.
  await swipeLeft(logged, 80, page);
  await expect(card.getByRole("button", { name: "Remove set" })).toHaveCount(0);

  // An empty set reveals the remove control.
  await swipeLeft(empty, 80, page);
  const remove = card.getByRole("button", { name: "Remove set" });
  await expect(remove).toHaveCount(1);
  await expect(remove).toBeVisible();

  await remove.click();
  await expect(card.getByRole("group", { name: "Set 2" })).toHaveCount(0);
  await expect(card.getByRole("group", { name: /^Set \d+$/ })).toHaveCount(1);
  await expect(logged.getByLabel("Reps")).toHaveValue("8");

  // The removal is queued and syncs with the finished workout.
  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from public.workout_sets ws
      join public.workout_exercises we on we.id = ws.workout_exercise_id
      where we.workout_id = (select id from public.workouts order by started_at desc limit 1)`;
    expect(row!.count).toBe(1);
  } finally {
    await sql.end();
  }
});

test("removing a completed set takes a second tap, and the armed state resets on its own", async ({ page }) => {
  const bench = "Barbell Bench Press - Medium Grip";

  await signIn(page);
  await page.goto("/workout");
  await page.getByRole("button", { name: "Start empty workout" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: bench, exact: true }).click();

  const card = page.getByRole("region", { name: bench });
  await card.getByRole("button", { name: "Add set" }).click();
  const completed = card.getByRole("group", { name: "Set 1" });
  await completed.getByLabel("Reps").fill("8");
  await completed.getByLabel("Reps").blur();
  await completed.getByRole("button", { name: "Complete set" }).click();

  // The first tap arms the control and keeps the set.
  await swipeLeft(completed, 80, page);
  const remove = card.getByRole("button", { name: "Remove set" });
  await remove.click();
  await expect(remove).toHaveText("Sure?");
  await expect(card.getByRole("group", { name: "Set 1" })).toHaveCount(1);

  // The second tap removes it.
  await remove.click();
  await expect(card.getByRole("group", { name: "Set 1" })).toHaveCount(0);
});

test("an unconfirmed remove of a completed set disarms after a few seconds", async ({ page }) => {
  const bench = "Barbell Bench Press - Medium Grip";

  await signIn(page);
  await page.goto("/workout");
  await page.getByRole("button", { name: "Start empty workout" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: bench, exact: true }).click();

  const card = page.getByRole("region", { name: bench });
  await card.getByRole("button", { name: "Add set" }).click();
  const completed = card.getByRole("group", { name: "Set 1" });
  await completed.getByLabel("Reps").fill("8");
  await completed.getByLabel("Reps").blur();
  await completed.getByRole("button", { name: "Complete set" }).click();

  await swipeLeft(completed, 80, page);
  const remove = card.getByRole("button", { name: "Remove set" });
  await remove.click();
  await expect(remove).toHaveText("Sure?");

  // Left alone, the control goes back to ✕ and the set is still there.
  await expect(remove).toHaveText("✕", { timeout: 8_000 });
  await expect(card.getByRole("group", { name: "Set 1" })).toHaveCount(1);
});

test("removals made offline are queued and the saved workout reflects them once back online", async ({
  page,
  context,
}) => {
  const bench = "Barbell Bench Press - Medium Grip";

  await signIn(page);
  await page.goto("/workout");
  await page.getByRole("button", { name: "Start empty workout" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: bench, exact: true }).click();

  const card = page.getByRole("region", { name: bench });
  for (let n = 1; n <= 3; n++) await card.getByRole("button", { name: "Add set" }).click();
  for (const [n, reps] of [
    [1, "8"],
    [2, "5"],
  ] as const) {
    const row = card.getByRole("group", { name: `Set ${n}` });
    await row.getByLabel("Reps").fill(reps);
    await row.getByLabel("Reps").blur();
    await row.getByRole("button", { name: "Complete set" }).click();
  }

  await context.setOffline(true);

  // Remove the empty last set, then a completed set, which still takes the confirm tap.
  await swipeLeft(card.getByRole("group", { name: "Set 3" }), 80, page);
  await card.getByRole("button", { name: "Remove set" }).click();
  await expect(card.getByRole("group", { name: /^Set \d+$/ })).toHaveCount(2);

  await swipeLeft(card.getByRole("group", { name: "Set 1" }), 80, page);
  const remove = card.getByRole("button", { name: "Remove set" });
  await remove.click();
  await expect(remove).toHaveText("Sure?");
  await remove.click();
  await expect(card.getByRole("group", { name: /^Set \d+$/ })).toHaveCount(1);
  await expect(card.getByRole("group", { name: "Set 1" }).getByLabel("Reps")).toHaveValue("5");

  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Waiting for a connection" })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const sets = await sql<{ reps: number }[]>`
      select ws.reps from public.workout_sets ws
      join public.workout_exercises we on we.id = ws.workout_exercise_id
      where we.workout_id = (select id from public.workouts order by started_at desc limit 1)
      order by ws.position`;
    expect(sets).toEqual([{ reps: 5 }]);
  } finally {
    await sql.end();
  }
});
