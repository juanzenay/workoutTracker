import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import type { PlannedExercise } from "@/domain/block";
import { E2E_DATABASE_URL, E2E_OWNER } from "./owner";
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

async function createBlockStartingToday(page: Page) {
  await page.goto("/blocks/new");
  await page.getByLabel("Name", { exact: true }).fill("E2E Plan Updates");
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
  return page.url();
}

async function doTodayAt15Reps(page: Page) {
  await page.goto("/");
  const todayCard = page.getByRole("region", { name: "Chest Upper" });
  await todayCard.locator("summary").click();
  await todayCard.getByRole("link", { name: "Start" }).click();
  await page.waitForURL(/\/workout$/);
  const logged = page.getByRole("region", { name: press });
  for (const n of [1, 2, 3]) {
    const set = logged.getByRole("group", { name: `Set ${n}` });
    await set.getByLabel("Reps").fill("15");
    await set.getByRole("button", { name: "Complete set" }).click();
    await expect(set.getByRole("button", { name: "Complete set" })).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Finish workout" }).click();
  // The logger already reads "Synced" before Finish lands; wait for the finished view so "Synced" covers the finish.
  await expect(page.getByText("Workout finished")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });
}

test("a progression bump shows a Plan updated card on Analytics that undoes in one tap; a pending change waits for Confirm there", async ({
  page,
}) => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  await signIn(page);
  try {
    const blockUrl = await createBlockStartingToday(page);
    await doTodayAt15Reps(page);

    // Analytics: a "Plan updated" card with the reason. Today no longer lists plan changes.
    await page.goto("/analytics");
    const card = page.getByRole("article", { name: `${press} goes up to 185 lb` });
    await expect(card).toContainText("Plan updated");
    await expect(card).toContainText("Hit 15 reps on all 3 sets at 180 lb, so next time is 185 lb");
    await page.goto(blockUrl);
    await expect(page.getByRole("region", { name: "Week 2" })).toContainText("185 lb × 10, 10, 10");

    // One tap undoes it.
    await page.goto("/analytics");
    await card.getByRole("button", { name: "Undo" }).click();
    await expect(card).toBeHidden();
    await page.goto(blockUrl);
    await expect(page.getByRole("region", { name: "Week 2" })).toContainText("180 lb × 10, 10, 10");

    // A fixture change that needs confirmation (the rules that flag these come later).
    const [row] = await sql<{ block_id: string; block_session_id: string; date: string; name: string; exercises: PlannedExercise[] }[]>`
      select block_id, block_session_id, to_char(date, 'YYYY-MM-DD') as date, name, exercises
      from public.planned_sessions where block_id = ${blockUrl.split("/").at(-1)!} and week = 2`;
    const before = row!.exercises[0]!;
    const after = { ...before, sets: before.sets.map((s) => ({ ...s, weight: 190 })) };
    const diff = [
      {
        type: "exercise",
        blockId: row!.block_id,
        blockSessionId: row!.block_session_id,
        date: row!.date,
        sessionName: row!.name,
        blockExerciseId: before.blockExerciseId,
        before,
        after,
      },
    ];
    await sql`
      insert into public.plan_revisions (key, block_id, source, status, summary, reasons, diff)
      values ('e2e-fixture', ${row!.block_id}, 'coach', 'pending', ${sql.json(`${press} jumps to 190 lb`)},
        ${sql.json(["Fixture change for the confirmation flow"])}, ${sql.json(diff as never)})`;

    // Today points at the waiting change, and nothing else about plan changes; the change itself is on Analytics.
    await page.goto("/");
    await page.getByRole("link", { name: "1 plan change waiting" }).click();
    await page.waitForURL(/\/analytics#plan-changes$/);
    const pending = page.getByRole("article", { name: `${press} jumps to 190 lb` });
    await expect(pending).toContainText("Needs your OK");
    await page.goto(blockUrl);
    await expect(page.getByRole("region", { name: "Week 2" })).toContainText("180 lb × 10, 10, 10");

    await page.goto("/analytics");
    await pending.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("article", { name: `${press} jumps to 190 lb` })).toContainText("Plan updated");
    await page.goto("/");
    await expect(page.getByRole("link", { name: /plan changes? waiting/ })).toBeHidden();
    await page.goto(blockUrl);
    await expect(page.getByRole("region", { name: "Week 2" })).toContainText("190 lb × 10, 10, 10");
  } finally {
    await sql.end();
  }
});
