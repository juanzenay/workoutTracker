import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_OWNER } from "./owner";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function logSet(page: Page, exercise: string, index: number, set: { weight: string; reps: string; type?: string }) {
  const card = page.getByRole("region", { name: exercise });
  const row = card.getByRole("group", { name: `Set ${index}` });
  if (set.type) await row.getByLabel("Set type").selectOption({ label: set.type });
  await row.getByLabel(/Weight/).fill(set.weight);
  await row.getByLabel("Reps").fill(set.reps);
  await row.getByRole("button", { name: "Complete set" }).click();
  await expect(row.getByRole("button", { name: "Complete set" })).toHaveAttribute("aria-pressed", "true");
}

test("logs a full workout with the network off, then syncs it exactly once", async ({ page, context }) => {
  await signIn(page);
  await page.goto("/workout");
  await expect(page.getByRole("button", { name: "Start empty workout" })).toBeEnabled();

  await context.setOffline(true);

  await page.getByRole("button", { name: "Start empty workout" }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: "Barbell Bench Press - Medium Grip" }).click();

  const bench = "Barbell Bench Press - Medium Grip";
  await page.getByRole("region", { name: bench }).getByRole("button", { name: "Add set" }).click();
  await logSet(page, bench, 1, { weight: "95", reps: "10", type: "Warm-up" });
  await page.getByRole("region", { name: bench }).getByRole("button", { name: "Add set" }).click();
  await logSet(page, bench, 2, { weight: "182.5", reps: "8" });
  await page.getByRole("region", { name: bench }).getByRole("button", { name: "Add set" }).click();
  await logSet(page, bench, 3, { weight: "182.5", reps: "6", type: "Failure" });

  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Waiting for a connection" })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const workouts = await sql`select id, finished_at from public.workouts`;
    expect(workouts).toHaveLength(1);
    expect(workouts[0]!.finished_at).not.toBeNull();
    const sets = await sql<{ set_type: string; weight: string; unit: string; reps: number; completed: boolean }[]>`
      select s.set_type, s.weight::text as weight, s.unit, s.reps, s.completed
      from public.workout_sets s join public.workout_exercises we on we.id = s.workout_exercise_id
      order by s.position`;
    expect(sets).toEqual([
      { set_type: "warmup", weight: "95", unit: "lb", reps: 10, completed: true },
      { set_type: "normal", weight: "182.5", unit: "lb", reps: 8, completed: true },
      { set_type: "failure", weight: "182.5", unit: "lb", reps: 6, completed: true },
    ]);
  } finally {
    await sql.end();
  }

  await page.getByRole("link", { name: "View history" }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText(bench);
});
