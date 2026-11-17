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

async function addExercise(page: Page, search: string, name: string) {
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill(search);
  await page.getByRole("button", { name, exact: true }).click();
}

test("supersets, notes, RIR and the rest timer work offline and sync", async ({ page, context }) => {
  await signIn(page);
  await page.goto("/workout");
  await expect(page.getByRole("button", { name: "Start empty workout" })).toBeEnabled();
  await context.setOffline(true);

  await page.getByRole("button", { name: "Start empty workout" }).click();
  // Empty notes fold into a "+ Note" chip until tapped.
  await page.getByRole("button", { name: "Workout notes" }).click();
  await page.getByLabel("Workout notes").fill("Slept 5 h");
  await page.getByLabel("Workout notes").blur();

  const bench = "Barbell Bench Press - Medium Grip";
  const row = "Bent Over Barbell Row";
  await addExercise(page, "bench press medium", bench);
  await addExercise(page, "bent over barbell row", row);
  const benchCard = page.getByRole("region", { name: bench });

  await benchCard.getByRole("button", { name: "Superset with next" }).click();
  await expect(benchCard).toContainText("Superset A");
  await expect(page.getByRole("region", { name: row })).toContainText("Superset A");

  await benchCard.getByRole("button", { name: "Exercise notes" }).click();
  await benchCard.getByLabel("Exercise notes").fill("Seat 3");
  await benchCard.getByLabel("Exercise notes").blur();

  // A working set, then RIR on it and tick it: the superset's last exercise has not gone yet, so no rest.
  await benchCard.getByRole("button", { name: "Add set" }).click();
  const working = benchCard.getByRole("group", { name: "Set 1" });
  await working.getByLabel(/Weight/).fill("225");
  await working.getByLabel("Reps").fill("5");
  await working.getByLabel("Reps").blur();
  await benchCard.getByRole("group", { name: "Reps in reserve on the last set" }).getByRole("button", { name: "2" }).click();
  await benchCard.getByRole("group", { name: "Set 1" }).getByRole("button", { name: "Complete set" }).click();
  await expect(page.getByRole("timer")).toHaveCount(0);

  const rowCard = page.getByRole("region", { name: row });
  await rowCard.getByRole("button", { name: "Add set" }).click();
  await rowCard.getByRole("group", { name: "Set 1" }).getByLabel(/Weight/).fill("135");
  await rowCard.getByRole("group", { name: "Set 1" }).getByLabel("Reps").fill("10");
  await rowCard.getByRole("group", { name: "Set 1" }).getByRole("button", { name: "Complete set" }).click();
  const timer = page.getByRole("timer", { name: "Rest timer" });
  await expect(timer).toContainText(/1:[0-2]\d/);

  // Leaving the app and coming back: the timer is derived from its stored end time.
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole("timer", { name: "Rest timer" })).toContainText(/1:[0-2]\d/);
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("timer")).toHaveCount(0);

  await page.getByRole("button", { name: "Finish workout" }).click();
  // The logger already reads "Synced" before Finish lands; wait for the finished view so "Synced" covers the finish.
  await expect(page.getByText("Workout finished")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const [workout] = await sql`select notes from public.workouts where notes = 'Slept 5 h'`;
    expect(workout).toBeDefined();
    const exercises = await sql<{ superset_group: number | null; notes: string | null }[]>`
      select we.superset_group, we.notes from public.workout_exercises we
      join public.workouts w on w.id = we.workout_id where w.notes = 'Slept 5 h' order by we.position`;
    expect(exercises).toEqual([
      { superset_group: 1, notes: "Seat 3" },
      { superset_group: 1, notes: null },
    ]);
    const sets = await sql<{ set_type: string; weight: string; reps: number; rir: number | null }[]>`
      select s.set_type, s.weight::text as weight, s.reps, s.rir
      from public.workout_sets s join public.workout_exercises we on we.id = s.workout_exercise_id
      join public.workouts w on w.id = we.workout_id
      where w.notes = 'Slept 5 h' and we.position = 0 order by s.position`;
    expect(sets).toEqual([{ set_type: "normal", weight: "225", reps: 5, rir: 2 }]);
  } finally {
    // The e2e database is shared by every spec in the run: leave it as we found it.
    await sql`delete from public.workouts where notes = 'Slept 5 h'`;
    await sql.end();
  }
});
