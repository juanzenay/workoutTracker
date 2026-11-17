import "server-only";
import { cookies } from "next/headers";
import { SKINS, type Skin } from "@/strings";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const THEME_COOKIE = "workout-tracker-theme";
const SKIN_COOKIE = "workout-tracker-skin";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Per-device display preferences, kept in cookies so the first paint is already themed (and so the
 * service worker's cached pages carry them offline). `skin` is "dumb" while Dumb Mode is on.
 */
export async function getPreferences(): Promise<{ theme: Theme; skin: Skin }> {
  const store = await cookies();
  const theme = THEMES.find((t) => t === store.get(THEME_COOKIE)?.value) ?? "system";
  const skin = SKINS.find((s) => s === store.get(SKIN_COOKIE)?.value) ?? "standard";
  return { theme, skin };
}

export async function saveTheme(theme: Theme): Promise<void> {
  const store = await cookies();
  store.set(THEME_COOKIE, theme, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
}

export async function saveSkin(skin: Skin): Promise<void> {
  const store = await cookies();
  store.set(SKIN_COOKIE, skin, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
}
