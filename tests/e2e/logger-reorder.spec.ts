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

async function addExercise(page: Page, search: string, name: string) {
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill(search);
  await page.getByRole("button", { name, exact: true }).click();
}

const rowOf = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });
const names = (page: Page) => page.getByRole("listitem").locator("span.flex-1");
const handleOf = (card: Locator) => card.getByRole("button", { name: /^Move exercise/ });

test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

test("exercises reorder by dragging the handle or with the arrow keys, and the new order syncs", async ({ page }) => {
  const bench = "Barbell Bench Press - Medium Grip";
  const row = "Bent Over Barbell Row";
  const curl = "Barbell Curl";

  await signIn(page);
  await page.goto("/workout");
  await page.getByRole("button", { name: "Start empty workout" }).click();
  await addExercise(page, "bench press medium", bench);
  await addExercise(page, "bent over barbell row", row);
  await addExercise(page, "barbell curl", curl);
  await expect(page.locator("h2[id^='exercise-']")).toHaveText([bench, row, curl]);

  // Reorder mode collapses the cards to one-line rows; the cards have no drag handle of their own.
  await page.getByRole("button", { name: "Resort" }).click();
  await expect(names(page)).toHaveText([bench, row, curl]);

  // Mouse drag: lift the row's handle until its midpoint is above the bench card's midpoint.
  const rowCard = rowOf(page, row);
  const benchBox = await rowOf(page, bench).boundingBox();
  const rowBox = await rowCard.boundingBox();
  const handle = await handleOf(rowCard).boundingBox();
  if (!benchBox || !rowBox || !handle) throw new Error("cards or handle not laid out");
  const startX = handle.x + handle.width / 2;
  const startY = handle.y + handle.height / 2;
  const endY = startY + (benchBox.y + 20 - (rowBox.y + rowBox.height / 2));
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, endY, { steps: 12 });
  await page.mouse.up();
  await expect(names(page)).toHaveText([row, bench, curl]);

  // Keyboard: focus the curl's handle and move it to the top. Focus stays on the handle and the move is announced.
  const curlHandle = handleOf(rowOf(page, curl));
  await curlHandle.focus();
  await curlHandle.press("ArrowUp");
  await curlHandle.press("ArrowUp");
  await curlHandle.press("ArrowUp");
  await expect(names(page)).toHaveText([curl, row, bench]);
  await expect(curlHandle).toBeFocused();
  await expect(page.locator("[aria-live='polite']")).toContainText(`${curl} moved to position 1 of 3`);

  // The arrow buttons nudge one place.
  await rowOf(page, bench).getByRole("button", { name: "Move up" }).click();
  await expect(names(page)).toHaveText([curl, bench, row]);
  await rowOf(page, bench).getByRole("button", { name: "Move down" }).click();
  await expect(names(page)).toHaveText([curl, row, bench]);

  // The order survives a reload (local copy), and the finished workout syncs it to the server.
  await page.reload();
  await expect(page.locator("h2[id^='exercise-']")).toHaveText([curl, row, bench]);
  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    const rows = await sql<{ name: string }[]>`
      select e.name from public.workout_exercises we
      join public.exercises e on e.id = we.exercise_id
      where we.workout_id = (select id from public.workouts order by started_at desc limit 1)
      order by we.position`;
    expect(rows.map((r) => r.name)).toEqual([curl, row, bench]);
  } finally {
    await sql.end();
  }
});
