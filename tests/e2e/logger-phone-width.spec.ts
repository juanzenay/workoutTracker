import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

// iPhone SE / mini width: the narrowest phone the logger has to fit a set row on.
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

/** The text width of the input's value and its content box, both in CSS pixels, in the input's own font. */
function measureInInput(input: Locator) {
  return input.evaluate((el: HTMLInputElement) => {
    const style = getComputedStyle(el);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = style.font;
    const textWidth = context.measureText(el.value).width;
    const contentWidth = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    return { textWidth, contentWidth };
  });
}

test("a 3-digit weight, or one with a decimal, shows in full on a phone", async ({ page }) => {
  await signIn(page);
  await page.goto("/workout");
  await expect(page.getByRole("button", { name: "Start empty workout" })).toBeEnabled();
  await page.getByRole("button", { name: "Start empty workout" }).click();

  const bench = "Barbell Bench Press - Medium Grip";
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: bench, exact: true }).click();

  const card = page.getByRole("region", { name: bench });
  await card.getByRole("button", { name: "Add set" }).click();
  const set = card.getByRole("group", { name: "Set 1" });
  const weight = set.getByLabel(/Weight/);

  for (const value of ["325", "182.5", "1000", "1000.5"]) {
    await weight.fill(value);
    const { textWidth, contentWidth } = await measureInInput(weight);
    expect(textWidth, `"${value}" fits the weight input`).toBeLessThanOrEqual(contentWidth);
    await weight.blur();
  }

  // The row never widens the page, and the other fields and ✓ stay on screen and tappable.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE_WIDTH);
  for (const control of [set.getByLabel("Reps"), set.getByRole("button", { name: "Complete set" })]) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE_WIDTH);
    expect(box!.width, "touch target width").toBeGreaterThanOrEqual(44);
  }
});

test("a body-only exercise logs reps alone, and its row fits a phone", async ({ page }) => {
  await signIn(page);
  await page.goto("/workout");
  await page.getByRole("button", { name: "Start empty workout" }).click();

  const situp = "3/4 Sit-Up";
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("3/4 sit-up");
  await page.getByRole("button", { name: situp, exact: true }).click();

  const card = page.getByRole("region", { name: situp });
  await card.getByRole("button", { name: "Add set" }).click();
  const set = card.getByRole("group", { name: "Set 1" });
  await expect(set.getByLabel(/Weight/)).toHaveCount(0);
  await expect(set.getByRole("button", { name: /^(kg|lb)$/ })).toHaveCount(0);

  await set.getByLabel("Reps").fill("12");
  await set.getByRole("button", { name: "Complete set" }).click();
  await expect(set.getByRole("button", { name: "Complete set" })).toHaveAttribute("aria-pressed", "true");

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE_WIDTH);
  const reps = await set.getByLabel("Reps").boundingBox();
  expect(reps).not.toBeNull();
  expect(reps!.x + reps!.width).toBeLessThanOrEqual(PHONE_WIDTH);
});
