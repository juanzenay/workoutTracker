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

const row = "Seated Cable Rows";

test("builds a routine in a folder, starts it, and sees last time's sets as Previous", async ({ page }) => {
  await signIn(page);
  await page.goto("/routines");
  await page.getByPlaceholder("New folder").fill("Current");
  await page.getByRole("button", { name: "Add folder" }).click();
  await expect(page.getByRole("heading", { name: "Current" })).toBeVisible();

  await page.getByRole("link", { name: "New routine" }).click();
  await page.waitForURL("**/routines/new");
  await page.getByLabel("Name", { exact: true }).fill("Back Upper");
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("seated cable rows");
  await page.getByRole("button", { name: row, exact: true }).click();
  const card = page.getByRole("region", { name: row });
  await card.getByRole("group", { name: "Set 1" }).getByLabel(/Weight/).fill("150");
  await card.getByRole("group", { name: "Set 1" }).getByLabel("Reps").fill("10-15");
  await card.getByRole("button", { name: "Add set" }).click();
  await page.getByRole("button", { name: "Save routine" }).click();

  await page.waitForURL("**/routines");
  const folder = page.getByRole("region", { name: "Current" });
  await expect(folder).toContainText("Back Upper");
  await expect(folder).toContainText(row);

  // First session from the routine: sets come pre-filled; log them.
  await folder.getByRole("link", { name: "Start Back Upper" }).click();
  await page.waitForURL(/\/workout$/);
  const logged = page.getByRole("region", { name: row });
  await expect(logged.getByRole("group", { name: /^Set \d+$/ })).toHaveCount(2);
  await expect(logged.getByRole("group", { name: "Set 1" }).getByLabel(/Weight/)).toHaveValue("150");
  for (const [n, reps] of [[1, "12"], [2, "11"]] as const) {
    const set = logged.getByRole("group", { name: `Set ${n}` });
    await set.getByLabel("Reps").fill(reps);
    await set.getByRole("button", { name: "Complete set" }).click();
    await expect(set.getByRole("button", { name: "Complete set" })).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Finish workout" }).click();
  // The logger already reads "Synced" before Finish lands; wait for the finished view so "Synced" covers the finish.
  await expect(page.getByText("Workout finished")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  try {
    // Next time, each set row shows what was done at that position last time.
    await page.goto("/routines");
    await page.getByRole("link", { name: "Start Back Upper" }).click();
    await page.waitForURL(/\/workout$/);
    const next = page.getByRole("region", { name: row });
    await expect(next.getByRole("group", { name: "Set 1" }).getByLabel("Previous: 150 × 12 lb")).toBeVisible();
    await expect(next.getByRole("group", { name: "Set 2" }).getByLabel("Previous: 150 × 11 lb")).toBeVisible();

    // Deleting a routine takes a second tap.
    await page.goto("/routines");
    await page.getByRole("link", { name: "Edit Back Upper" }).click();
    await page.waitForURL(/\/routines\/[^/]+$/);
    await page.getByRole("button", { name: "Delete routine" }).click();
    await expect(page).toHaveURL(/\/routines\/[^/]+$/);
    await page.getByRole("button", { name: "Tap again to confirm" }).click();
    await page.waitForURL(/\/routines$/);
    await expect(page.getByText("Back Upper")).toHaveCount(0);
  } finally {
    // Leave the shared e2e database as other specs expect it.
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    await sql`delete from public.workouts`;
    await sql`delete from public.routines`;
    await sql`delete from public.routine_folders`;
    await sql.end();
  }
});

test("a body-only exercise in a routine has no weight input, and its sets are saved with no weight", async ({ page }) => {
  const situp = "3/4 Sit-Up";
  await signIn(page);
  await page.goto("/routines/new");
  await page.getByLabel("Name", { exact: true }).fill("Bodyweight Day");
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("3/4 sit-up");
  await page.getByRole("button", { name: situp, exact: true }).click();

  const card = page.getByRole("region", { name: situp });
  const set = card.getByRole("group", { name: "Set 1" });
  await expect(set.getByLabel(/Weight/)).toHaveCount(0);
  await expect(set.getByRole("button", { name: /^(kg|lb)$/ })).toHaveCount(0);
  await set.getByLabel("Reps").fill("12");
  await page.getByRole("button", { name: "Save routine" }).click();
  await page.waitForURL("**/routines");

  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const sets = await sql`
      select rs.weight, rs.reps
      from public.routine_sets rs
      join public.routine_exercises re on re.id = rs.routine_exercise_id
      join public.routines r on r.id = re.routine_id
      where r.name = 'Bodyweight Day'
      order by rs.position`;
    expect(sets).toEqual([{ weight: null, reps: 12 }]);
  } finally {
    await sql`delete from public.routines`;
    await sql.end();
  }
});
