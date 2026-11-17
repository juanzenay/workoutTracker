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

/** A date `days` from today as YYYY-MM-DD, in this machine's zone (the browser's too). */
function fromToday(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** A synthetic 2-week plan: an easy run every day of week 1, the race on Sunday of week 2. */
const goodPlan = [
  "week,day,type,distance_mi,duration_min,pace,notes",
  ...DAYS.map((day) => `1,${day},easy,3,,9:00-9:30/mi,Keep it chatty`),
  "2,sun,race,26.2,,,",
].join("\n");

const badPlan = ["week,day,type,distance_mi,duration_min,pace,notes", "1,mon,easy,3,,,", "1,funday,easy,3,,,"].join("\n");

test("adds an A race, imports a run plan (reporting bad rows), and Today shows the day's run", async ({ page }) => {
  await signIn(page);
  try {
    await page.goto("/races");
    const add = page.locator("details", { hasText: "Add race" });
    await add.getByLabel("Name", { exact: true }).fill("E2E Marathon");
    await add.getByLabel("Date").fill(fromToday(7)); // next week, so today is in week 1
    await add.getByLabel("Distance").fill("26.2");
    await add.getByRole("button", { name: "Add race" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "E2E Marathon" })).toContainText("26.2 mi · A race");

    const upload = (name: string, content: string) =>
      page.getByLabel("Plan file").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(content) });

    await upload("bad.csv", badPlan);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    const alert = page.getByRole("alert").filter({ hasText: "problem" });
    await expect(alert).toContainText("The plan has 1 problem; nothing was imported.");
    await expect(alert).toContainText("Row 2: day must be mon, tue, wed, thu, fri, sat or sun");

    await upload("plan.csv", goodPlan);
    await page.getByLabel("Name (optional)").fill("E2E Plan");
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.waitForURL(/\/races\/plans\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "E2E Plan" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Week 2" })).toContainText("Race · 26.2 mi");

    await page.goto("/");
    const run = page.getByRole("region", { name: "Run" });
    await expect(run).toContainText("Easy · 3 mi · 9:00–9:30 /mi");
    await expect(run).toContainText("Keep it chatty");
    await expect(run).toContainText("E2E Plan · Week 1 of 2");

    // Below the fold: the countdown to the A race, the week strip with today's run, mileage against plan.
    const countdown = page.getByRole("region", { name: "Race countdown" });
    await expect(countdown).toContainText(/\d+ days? to E2E Marathon/);
    await expect(countdown).toContainText("E2E Plan · Week 1 of 2");
    const today = page.getByRole("region", { name: "This week", exact: true }).locator('li[aria-current="date"]');
    await expect(today).toContainText("Run");
    // Tapping the day opens its panel; typing miles there logs a run for it.
    await today.getByRole("button").click();
    const panel = page.getByTestId("day-panel");
    await expect(panel).toContainText("Easy, 3 mi");
    await panel.getByLabel("Miles").fill("1");
    await panel.getByRole("button", { name: "Add run" }).click();
    await expect(panel).toContainText("Logged 1 mi.");
    await expect(page.getByRole("region", { name: "This week vs plan" })).toContainText("Mileage");
  } finally {
    const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
    await sql`delete from public.run_plans`;
    await sql`delete from public.races`;
    await sql.end();
  }
});
