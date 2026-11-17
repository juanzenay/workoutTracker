import { expect, test, type Page } from "@playwright/test";
import { E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

test("marks days unavailable, refuses a backwards range, and clears them", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: "Away" }).click();
  await expect(page.getByRole("heading", { name: "Away", level: 1 })).toBeVisible();
  await expect(page.getByText("No days marked.")).toBeVisible();

  await page.getByLabel("First day").fill("2030-03-14");
  await page.getByLabel("Last day").fill("2030-03-12");
  await page.getByRole("button", { name: "Mark unavailable" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Pick" })).toHaveText("Pick a last day on or after the first day.");

  await page.getByLabel("First day").fill("2030-03-12");
  await page.getByLabel("Last day").fill("2030-03-14");
  await page.getByLabel("Note (optional)").fill("Sick");
  await page.getByRole("button", { name: "Mark unavailable" }).click();
  const marked = page.getByRole("region", { name: "Marked days" }).getByRole("listitem");
  await expect(marked).toHaveCount(1);
  await expect(marked).toContainText("Sick");

  await marked.getByRole("button", { name: "Back on" }).click();
  await expect(page.getByText("No days marked.")).toBeVisible();
});
