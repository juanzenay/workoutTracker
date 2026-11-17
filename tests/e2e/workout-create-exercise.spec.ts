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

test("a search with no match creates a custom exercise that joins the workout and the picker", async ({ page }) => {
  const name = "Zzz Rope Lever Crunch";
  await signIn(page);
  await page.goto("/workout");
  await expect(page.getByRole("button", { name: "Start empty workout" })).toBeEnabled();
  await page.getByRole("button", { name: "Start empty workout" }).click();

  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill(name);
  await page.getByRole("button", { name: `Create '${name}'` }).click();

  // The quick form opens with the typed search as its name.
  await expect(page.getByLabel("Name")).toHaveValue(name);

  // Validation matches the Exercises page: at least one primary muscle.
  await page.getByRole("button", { name: "Create exercise" }).click();
  await expect(page.getByText("Give it a name and at least one primary muscle.")).toBeVisible();

  await page.getByRole("group", { name: "Primary muscles" }).getByText("Abs", { exact: true }).click();
  await page.getByLabel("Equipment").selectOption({ label: "Cable" });
  await page.getByRole("button", { name: "Create exercise" }).click();

  // Saved and added to the current workout.
  await expect(page.getByRole("region", { name })).toBeVisible();

  // Findable in the picker for later searches.
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("zzz rope");
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();

  const sql = postgres(E2E_DATABASE_URL);
  try {
    const rows = await sql<{ source: string; equipment: string }[]>`
      select source, equipment from public.exercises where name = ${name}`;
    expect(rows).toEqual([{ source: "custom", equipment: "cable" }]);
  } finally {
    await sql.end();
  }
});
