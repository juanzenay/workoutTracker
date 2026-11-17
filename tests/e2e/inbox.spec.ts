import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

// Specs share one database: start from and leave behind no plan changes or inbox items.
test.beforeEach(resetOwnerData);
test.afterEach(resetOwnerData);

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

test("the inbox keeps important items in view, folds back-to-back minor ones, and opens a pending change to confirm", async ({
  page,
}) => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  await signIn(page);
  try {
    // A pending change (fixture: no planned sessions touched) and its notifications, oldest first.
    const [revision] = await sql<{ id: string }[]>`
      insert into public.plan_revisions (key, source, status, summary, reasons, diff)
      values ('e2e-inbox', 'coach', 'pending', ${sql.json("Taper starts: volume drops 40%")}, ${sql.json(["Race in 2 weeks"])},
        '[]'::jsonb)
      returning id`;
    let minute = 0;
    const raise = (level: string, kind: string, title: string, url: string | null = null) =>
      sql`insert into public.inbox_items (kind, level, title, url, created_at)
          values (${kind}, ${level}, ${sql.json(title)}, ${url}, now() - make_interval(mins => ${60 - minute++}))`;
    await raise("minor", "plan_change_applied", "Leg press goes up to 300 lb");
    await raise("important", "plan_change_pending", "Taper starts: volume drops 40%", `/plan-changes/${revision!.id}`);
    await raise("minor", "plan_change_applied", "Bench press goes up to 185 lb");
    await raise("minor", "plan_change_applied", "Row goes up to 140 lb");
    await raise("minor", "plan_change_applied", "Curl goes up to 40 lb");

    // Headless Chromium reports notifications as "denied" whatever is granted; act like a fresh install.
    await page.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "default" }));
    await page.goto("/inbox");
    await expect(page.getByRole("region", { name: "Notifications" }).getByRole("button", { name: "Enable notifications" })).toBeVisible();

    const important = page.getByRole("article", { name: "Taper starts: volume drops 40%" });
    await expect(important).toContainText("Needs you");
    await expect(page.getByRole("article", { name: "Leg press goes up to 300 lb" })).toBeVisible();

    // The three newest minor items fold into one group, closed until tapped.
    const group = page.getByText("3 minor updates");
    await expect(group).toBeVisible();
    await expect(page.getByRole("article", { name: "Row goes up to 140 lb" })).toBeHidden();
    await group.click();
    for (const title of ["Curl goes up to 40 lb", "Row goes up to 140 lb", "Bench press goes up to 185 lb"]) {
      await expect(page.getByRole("article", { name: title })).toBeVisible();
    }

    // Tapping the important item (as a push notification would) opens the change to confirm.
    await important.getByRole("link", { name: "Taper starts: volume drops 40%" }).click();
    await page.waitForURL(`**/plan-changes/${revision!.id}`);
    const change = page.getByRole("article", { name: "Taper starts: volume drops 40%" });
    await expect(change).toContainText("Needs your OK");
    await change.getByRole("button", { name: "Confirm" }).click();
    await expect(change).toContainText("Plan updated");
    await expect(change.getByRole("button", { name: "Undo" })).toBeVisible();
  } finally {
    await sql.end();
  }
});
