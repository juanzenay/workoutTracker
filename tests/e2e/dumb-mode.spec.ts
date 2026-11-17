import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { networkSwitch } from "./network-switch";
import { E2E_OWNER } from "./owner";
import { resetOwnerData } from "./owner-data";

/**
 * Dumb Mode (#28): a per-device toggle in settings that swaps design tokens and copy, never layout or
 * touch targets, and works offline.
 */

const BENCH = "Barbell Bench Press - Medium Grip";

async function signIn(page: Page, origin = "") {
  await page.goto(`${origin}/sign-in`);
  await page.getByLabel("Email").fill(E2E_OWNER.email);
  await page.getByLabel("Password").fill(E2E_OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

async function turnOnDumbMode(page: Page, origin = "") {
  await page.goto(`${origin}/settings`);
  await page.getByRole("form", { name: /Dumb Mode/ }).getByRole("button", { name: "On" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "dumb");
}

/** Logs `sets` sets of bench in a new workout; finishes it unless `finish` is false. */
async function logBench(page: Page, { sets, finish }: { sets: number; finish: boolean }) {
  await page.goto("/workout");
  await page.getByRole("button", { name: /Start (empty|another) workout/ }).click();
  await page.getByRole("button", { name: "Add exercise" }).click();
  await page.getByRole("searchbox", { name: "Search exercises" }).fill("bench press medium");
  await page.getByRole("button", { name: BENCH }).click();
  const card = page.getByRole("region", { name: BENCH });
  for (let n = 1; n <= sets; n++) {
    await card.getByRole("button", { name: "Add set" }).click();
    const row = card.getByRole("group", { name: `Set ${n}` });
    await row.getByLabel(/Weight/).fill("135");
    await row.getByLabel("Reps").fill(String(8 + n));
    if (n < sets) await row.getByRole("button", { name: "Complete set" }).click();
  }
  if (finish) {
    await card.getByRole("group", { name: `Set ${sets}` }).getByRole("button", { name: "Complete set" }).click();
    await page.getByRole("button", { name: "Finish workout" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Synced" })).toBeVisible({ timeout: 20_000 });
  }
}

/**
 * Layout-relevant computed style properties: everything that sizes or spaces a box. (Insets are left
 * out: for positioned elements the browser reports where they ended up, which follows the copy above.)
 */
const LAYOUT_PROPS = [
  "display",
  "position",
  "float",
  "box-sizing",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "font-size",
  "line-height",
  "row-gap",
  "column-gap",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "align-items",
  "justify-content",
  "white-space",
  "overflow-x",
  "overflow-y",
];

type Box = {
  tag: string;
  layout: Record<string, string>;
  interactive: boolean;
  text: string;
  width: number;
  height: number;
};

/** Every rendered element of the page, in document order, with its layout styles and box size. */
async function layoutOf(page: Page): Promise<Box[]> {
  return page.evaluate((props) => {
    const skip = new Set(["SCRIPT", "STYLE", "LINK", "META", "TEMPLATE", "NOSCRIPT", "NEXT-ROUTE-ANNOUNCER"]);
    const interactive = "a[href], button, input, select, textarea, summary, [role=button], [tabindex]";
    return [...document.body.querySelectorAll("*")]
      .filter((el) => !skip.has(el.tagName.toUpperCase()) && !el.closest("next-route-announcer"))
      .map((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          layout: Object.fromEntries(props.map((p) => [p, style.getPropertyValue(p)])),
          interactive: el.matches(interactive),
          text: (el.textContent ?? "").trim(),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        };
      });
  }, LAYOUT_PROPS);
}

async function layoutWithSkin(context: BrowserContext, page: Page, path: string, skin: "standard" | "dumb") {
  await context.addCookies([{ name: "workout-tracker-skin", value: skin, url: page.url() }]);
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-skin", skin);
  // A page with a loading screen reveals its content a beat after the load event.
  await expect(page.locator("[data-loading]")).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  return layoutOf(page);
}

/**
 * Same elements in the same order with the same layout styles; every touch target (link, button,
 * input…) the same height, and the same width wherever its content is the same in both skins
 * (inputs, ✓ buttons, number cells: everything that isn't sized by its words).
 */
function expectSameLayout(standard: Box[], dumb: Box[]) {
  expect(dumb.map((b) => b.tag)).toEqual(standard.map((b) => b.tag));
  const differences: string[] = [];
  standard.forEach((a, i) => {
    const b = dumb[i]!;
    for (const prop of LAYOUT_PROPS) {
      if (a.layout[prop] !== b.layout[prop]) {
        differences.push(`#${i} <${a.tag}> "${a.text.slice(0, 30)}": ${prop} ${a.layout[prop]} → ${b.layout[prop]}`);
      }
    }
    if (!a.interactive) return;
    if (a.height !== b.height) {
      differences.push(`#${i} <${a.tag}> "${a.text.slice(0, 30)}" → "${b.text.slice(0, 30)}": height ${a.height} → ${b.height}`);
    }
    if (a.text === b.text && a.width !== b.width) {
      differences.push(`#${i} <${a.tag}> "${a.text.slice(0, 30)}": width ${a.width} → ${b.width}`);
    }
  });
  expect(differences).toEqual([]);
}

test.beforeAll(resetOwnerData);
test.afterAll(resetOwnerData);

test("Dumb Mode is a per-device setting that swaps fonts, colours, clip-art and copy", async ({ page, browser }) => {
  await signIn(page);
  await page.getByRole("link", { name: "More" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  const toggle = page.getByRole("form", { name: "Dumb Mode" });
  await expect(toggle.getByRole("button", { name: "Off" })).toHaveAttribute("aria-pressed", "true");

  await toggle.getByRole("button", { name: "On" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "dumb");
  await expect(page.getByRole("heading", { name: "Knobs", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("form", { name: /Dumb Mode/ }).getByRole("button", { name: "On (yes)" }),
  ).toHaveAttribute("aria-pressed", "true");
  const body = await page.locator("body").evaluate((el) => {
    const style = getComputedStyle(el);
    return { font: style.fontFamily, image: style.backgroundImage, colour: style.color };
  });
  expect(body.font).toContain("Comic Sans MS");
  expect(body.image).toContain("/images/dumb/star.svg");
  expect(body.colour).toBe("rgb(0, 0, 0)");
  expect(await page.evaluate(() => fetch("/images/dumb/dumbbell.svg").then((r) => r.ok))).toBe(true);

  // Every screen talks dumb, the workout screen included.
  await page.goto("/workout");
  await expect(page.getByRole("button", { name: "Just start lifting" })).toBeVisible();
  await page.getByRole("link", { name: "2day" }).click();
  await expect(page.getByRole("heading", { name: "2day", level: 1 })).toBeVisible();

  // Persists on this device…
  const again = await page.context().newPage();
  await again.goto("/analytics");
  await expect(again.getByRole("heading", { name: "Graphs", level: 1 })).toBeVisible();

  // …and only on this device.
  const otherDevice = await browser.newContext();
  const other = await otherDevice.newPage();
  await signIn(other);
  await expect(other.locator("html")).toHaveAttribute("data-skin", "standard");
  await expect(other.getByRole("heading", { name: "Today", level: 1 })).toBeVisible();
  await otherDevice.close();

  // Off again.
  await page.goto("/settings");
  await page.getByRole("form", { name: /Dumb Mode/ }).getByRole("button", { name: "Off (boring)" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-skin", "standard");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
});

test("Dumb Mode leaves layout and touch targets identical on home, the workout screen and analytics", async ({
  page,
  context,
}) => {
  await signIn(page);
  await logBench(page, { sets: 2, finish: true });
  // Leave a workout in progress, mid-set, for the workout screen.
  await logBench(page, { sets: 3, finish: false });

  for (const path of ["/", "/workout", "/analytics"]) {
    const standard = await layoutWithSkin(context, page, path, "standard");
    const dumb = await layoutWithSkin(context, page, path, "dumb");
    expect(standard.filter((b) => b.interactive).length, path).toBeGreaterThan(10);
    await test.step(path, () => expectSameLayout(standard, dumb));
  }

  // The workout screen really is in Dumb Mode (not a cached standard copy) while being compared.
  await expect(page.locator("html")).toHaveAttribute("data-skin", "dumb");
  await page.goto("/workout");
  await expect(page.getByRole("group", { name: "Try 3" }).getByRole("button", { name: "I did it" })).toBeVisible();
});

test("Dumb Mode works offline: the cached logger stays dumb and usable mid-set", async ({ page, context }) => {
  const network = await networkSwitch();
  const at = (path: string) => `${network.origin}${path}`;
  try {
    await signIn(page, network.origin);
    await page.goto(at("/workout"));
    await page.evaluate(() => navigator.serviceWorker.ready);
    await turnOnDumbMode(page, network.origin);

    // Toggling re-warms the service worker's cached pages straight away, with the clip-art.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const cached = await caches.match("/workout");
            const clipart = await Promise.all(
              ["/images/dumb/star.svg", "/images/dumb/dumbbell.svg", "/images/dumb/sun.svg"].map((u) => caches.match(u)),
            );
            return Boolean(cached && (await cached.text()).includes('data-skin="dumb"') && clipart.every(Boolean));
          }),
        { timeout: 30_000 },
      )
      .toBe(true);

    network.setOnline(false);
    await context.setOffline(true);
    await page.close();
    const gym = await context.newPage();
    await gym.goto(at("/workout"));
    await expect(gym.locator("html")).toHaveAttribute("data-skin", "dumb");
    await expect(gym.getByText("no internet. lifting still works.")).toBeVisible();
    expect(await gym.evaluate(() => fetch("/images/dumb/star.svg").then((r) => r.ok))).toBe(true);

    await gym.getByRole("button", { name: /Just start lifting|Lift again/ }).click();
    await gym.getByRole("button", { name: "Add a move" }).click();
    await gym.getByRole("searchbox", { name: "Find moves" }).fill("bench press medium");
    await gym.getByRole("button", { name: BENCH }).click();
    const card = gym.getByRole("region", { name: BENCH });
    await card.getByRole("button", { name: "Again" }).click();
    const row = card.getByRole("group", { name: "Try 1" });
    await row.getByLabel(/How heavy/).fill("135");
    await row.getByLabel("How many times").fill("5");
    await row.getByRole("button", { name: "I did it" }).click();
    await expect(row.getByRole("button", { name: "I did it" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await context.setOffline(false);
    await network.close();
  }
});
