import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { resolveImageUrl } from "../../src/domain/catalogue";
import { networkSwitch } from "./network-switch";
import { E2E_DATABASE_URL, E2E_OWNER } from "./owner";

async function signIn(page: Page, origin: string) {
  await page.goto(`${origin}/sign-in`);
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

// A 1×1 PNG stands in for the catalogue images (raw.githubusercontent.com), so the test never hits the network.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function fakeCatalogueImages(context: BrowserContext) {
  await context.route("https://raw.githubusercontent.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PIXEL }),
  );
}

const bench = "Barbell Bench Press - Medium Grip";

test("a cold launch with no network opens the logger from cache and starts a routine", async ({ page, context }) => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
  const network = await networkSwitch();
  const at = (path: string) => `${network.origin}${path}`;
  try {
    const [exercise] = await sql<{ id: string; image_paths: string[] }[]>`
      select id, image_paths from public.exercises where name = ${bench}`;
    const imageUrl = resolveImageUrl(exercise!.image_paths[0]!);
    const [routine] = await sql<{ id: string }[]>`insert into public.routines (name) values ('Gym Day') returning id`;
    const [routineExercise] = await sql<{ id: string }[]>`
      insert into public.routine_exercises (routine_id, exercise_id, position)
      values (${routine!.id}, ${exercise!.id}, 0) returning id`;
    await sql`insert into public.routine_sets (routine_exercise_id, position, weight, reps)
      values (${routineExercise!.id}, 0, 135, 5)`;
    await sql`insert into public.workouts (id, name, started_at, finished_at)
      values (${randomUUID()}, 'Last Week', now() - interval '7 days', now() - interval '7 days' + interval '1 hour')`;

    await fakeCatalogueImages(context);

    // Online once: the service worker installs and warms its caches in the background.
    await signIn(page, network.origin);
    await page.goto(at("/workout"));
    await expect(page.getByRole("button", { name: "Gym Day" })).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
      .poll(
        () =>
          page.evaluate(
            async (urls) => (await Promise.all(urls.map((u) => caches.match(u)))).every(Boolean),
            ["/", "/workout", "/workouts", "/routines", "/offline", imageUrl],
          ),
        { timeout: 30_000 },
      )
      .toBe(true);

    // In the gym: no signal at all, and the app is launched from the home screen.
    network.setOnline(false);
    await context.setOffline(true);
    await page.close();
    const gym = await context.newPage();
    await gym.goto(at("/"));
    await expect(gym.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
    await expect(gym.getByText("No connection. Logging still works")).toBeVisible();
    await gym.getByRole("link", { name: "Workout", exact: true }).click();
    await gym.waitForURL(/\/workout$/);

    await expect(gym.getByRole("button", { name: "Gym Day" })).toBeVisible();

    // Routines come from cache too, and start a workout from there.
    await gym.goto(at("/routines"));
    await gym.getByRole("link", { name: "Start Gym Day" }).click();
    await gym.waitForURL(/\/workout$/);
    const card = gym.getByRole("region", { name: bench });
    const set = card.getByRole("group", { name: "Set 1" });
    await expect(set.getByLabel(/Weight/)).toHaveValue("135");
    await expect
      .poll(() =>
        card
          .locator("img")
          .first()
          .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && img.currentSrc),
      )
      .toBe(imageUrl);
    await set.getByRole("button", { name: "Complete set" }).click();
    await expect(set.getByRole("button", { name: "Complete set" })).toHaveAttribute("aria-pressed", "true");

    // Recent history comes from cache.
    await gym.goto(at("/workouts"));
    await expect(gym.getByRole("article")).toContainText("Last Week");

    // Screens that need the network say so instead of failing.
    await gym.goto(at("/workout?planned=00000000-0000-4000-8000-000000000000"));
    await expect(gym.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await gym.goto(at("/export"));
    await expect(gym.getByRole("heading", { name: "You're offline" })).toBeVisible();
    await gym.getByRole("link", { name: "Open the logger" }).click();
    await gym.waitForURL(/\/workout$/);
    await expect(gym.getByRole("region", { name: bench })).toBeVisible();
  } finally {
    await context.setOffline(false);
    await network.close();
    await sql`delete from public.workouts`;
    await sql`delete from public.routines`;
    await sql.end();
  }
});
