import { expect, test, type Page } from "@playwright/test";
import { E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

// The phone tab bar and the rest timer are both pinned to the bottom edge (#70). Chromium can't show
// the iOS Safari drift from #44, so this checks the geometry after scrolling; the device check is manual.
test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

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

/** Sub-pixel rounding allowance for comparing two fixed edges. */
const EDGE_TOLERANCE_PX = 1.5;

/** The tab bar's bottom sits on the bottom of the visible viewport; the rest timer, when shown, sits right above it. */
async function expectBarsAtBottom(page: Page, { timer }: { timer: boolean }) {
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const tabBar = await page.getByRole("navigation", { name: "Main" }).boundingBox();
  expect(tabBar).not.toBeNull();
  expect(Math.abs(tabBar!.y + tabBar!.height - viewportHeight)).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
  if (timer) {
    const restTimer = await page.getByRole("timer", { name: "Rest timer" }).boundingBox();
    expect(restTimer).not.toBeNull();
    expect(Math.abs(restTimer!.y + restTimer!.height - tabBar!.y)).toBeLessThanOrEqual(EDGE_TOLERANCE_PX);
  }
}

/** Scrolls up and down in steps, the way the owner did on the phone, and checks the bars after each step. */
async function scrollUpAndDown(page: Page, { timer }: { timer: boolean }) {
  // The check only means something if the page actually scrolls.
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeGreaterThan(
    await page.evaluate(() => window.innerHeight),
  );
  for (const delta of [400, 400, -300, 500, -900, 300, -400]) {
    await page.mouse.wheel(0, delta);
    await expectBarsAtBottom(page, { timer });
  }
}

test("the tab bar and rest timer stay at the bottom edge while scrolling up and down", async ({ page }) => {
  await signIn(page);
  await page.goto("/workout");
  await page.getByRole("button", { name: "Start empty workout" }).click();

  const bench = "Barbell Bench Press - Medium Grip";
  const row = "Bent Over Barbell Row";
  await addExercise(page, "bench press medium", bench);
  await addExercise(page, "bent over barbell row", row);
  const rowCard = page.getByRole("region", { name: row });
  await rowCard.getByRole("button", { name: "Add set" }).click();
  await rowCard.getByRole("group", { name: "Set 1" }).getByLabel(/Weight/).fill("135");
  await rowCard.getByRole("group", { name: "Set 1" }).getByLabel("Reps").fill("10");
  await rowCard.getByRole("group", { name: "Set 1" }).getByRole("button", { name: "Complete set" }).click();
  await expect(page.getByRole("timer", { name: "Rest timer" })).toBeVisible();

  await scrollUpAndDown(page, { timer: true });
});

test("the tab bar stays at the bottom edge while scrolling up and down with no rest timer", async ({ page }) => {
  await signIn(page);
  await page.goto("/workout");
  await page.getByRole("button", { name: "Start empty workout" }).click();

  const bench = "Barbell Bench Press - Medium Grip";
  const row = "Bent Over Barbell Row";
  await addExercise(page, "bench press medium", bench);
  await addExercise(page, "bent over barbell row", row);
  await expect(page.getByRole("timer")).toHaveCount(0);

  await scrollUpAndDown(page, { timer: false });
});
