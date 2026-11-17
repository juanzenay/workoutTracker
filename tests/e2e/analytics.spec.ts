import { expect, test, type Page } from "@playwright/test";
import { E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

const BENCH = "Barbell Bench Press - Medium Grip";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

test.beforeAll(resetOwnerData);
test.afterAll(resetOwnerData);

test("Analytics shades the muscles just trained, charts weekly load and links to exercise charts", async ({ page }) => {
  await signIn(page);
  await page.goto("/workout");
  await page.getByRole("button", { name: /Start (empty|another) workout/ }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: BENCH }).click();
  const card = page.getByRole("region", { name: BENCH });
  for (const n of [1, 2]) {
    await card.getByRole("button", { name: "Add set" }).click();
    const row = card.getByRole("group", { name: `Set ${n}` });
    await row.getByLabel(/Weight/).fill("135");
    await row.getByLabel("Reps").fill("10");
    await row.getByRole("button", { name: "Complete set" }).click();
  }
  await page.getByRole("button", { name: "Finish workout" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "History" }).click();
  await page.getByRole("link", { name: "Analytics" }).click();
  await expect(page.getByRole("heading", { name: "Analytics", level: 1 })).toBeVisible();

  // Bench: chest primary (2 sets); triceps and shoulders secondary (half a set each).
  await expect(page.getByRole("img", { name: /^Front of the body.*Chest 2 sets/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Back of the body.*Triceps 1 set/ })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Calves" })).toContainText("Not trained");

  // Tapping a row narrows the body to that muscle and says where it is.
  await page.getByRole("button", { name: /^Chest/ }).click();
  await expect(page.getByRole("region", { name: "Chest" })).toContainText("middle and lower chest");
  await page.getByRole("button", { name: "Show all" }).click();
  await expect(page.getByRole("region", { name: "Chest" })).toHaveCount(0);

  await page.getByRole("link", { name: "90 days" }).click();
  await expect(page.getByRole("link", { name: "90 days" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("img", { name: /Chest 2 sets/ })).toBeVisible();

  await expect(page.getByRole("img", { name: "Lifting volume" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Running distance" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Running time" })).toBeVisible();
  await page.getByText("Show as a table").click();
  await expect(page.getByRole("cell", { name: "2,700 lb" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("analytics.png"), fullPage: true });

  await page.getByRole("link", { name: BENCH }).click();
  await expect(page.getByRole("img", { name: "Estimated 1RM" })).toBeVisible();
});
