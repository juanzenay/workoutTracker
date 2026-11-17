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

// Specs share one database: start from and leave behind no blocks, workouts, plan changes or inbox items.
test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

/** Adds a custom exercise from a picker's no-match search, then saves it through the quick form. */
async function createFromPicker(page: Page, name: string) {
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill(name);
  await page.getByRole("button", { name: `Create '${name}'` }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Name")).toHaveValue(name);
  await dialog.getByRole("group", { name: "Primary muscles" }).getByText("Abs", { exact: true }).click();
  await dialog.getByLabel("Equipment").selectOption({ label: "Cable" });
  await dialog.getByRole("button", { name: "Create exercise" }).click();
  await expect(dialog).toBeHidden();
}

test("a routine search with no match creates a custom exercise that joins the routine and keeps unsaved edits", async ({
  page,
}) => {
  const name = "Zzz Routine Cable Crunch";
  await signIn(page);
  await page.goto("/routines");
  await page.getByPlaceholder("New folder").fill("Picker Folder");
  await page.getByRole("button", { name: "Add folder" }).click();
  await expect(page.getByRole("heading", { name: "Picker Folder" })).toBeVisible();

  await page.getByRole("link", { name: "New routine" }).click();
  await page.waitForURL("**/routines/new");
  await page.getByLabel("Name", { exact: true }).fill("Core Day");

  await createFromPicker(page, name);

  // The unsaved routine name survives the creation, and the new exercise is on the routine.
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Core Day");
  await expect(page.getByRole("region", { name })).toBeVisible();

  await page.getByRole("button", { name: "Save routine" }).click();
  await page.waitForURL("**/routines");
  const folder = page.getByRole("region", { name: "Picker Folder" });
  await expect(folder).toContainText("Core Day");
  await expect(folder).toContainText(name);
});

test("a block search with no match creates a custom exercise that joins the session and keeps unsaved edits", async ({
  page,
}) => {
  const name = "Zzz Block Cable Crunch";
  await signIn(page);
  await page.goto("/blocks/new");
  await page.getByLabel("Name", { exact: true }).fill("Picker Block");
  await page.getByLabel("Starts").fill("2020-01-06");
  await page.getByLabel("Weeks").fill("4");
  await page.getByLabel("Session name").fill("Core Session");

  await createFromPicker(page, name);

  // The unsaved block name and session name survive the creation, and the new exercise is in the session.
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Picker Block");
  await expect(page.getByLabel("Session name")).toHaveValue("Core Session");
  await expect(page.getByRole("group", { name })).toBeVisible();
});
