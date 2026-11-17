import { dumb } from "./dumb";
import { en, type Strings } from "./en";

export type { Strings } from "./en";

/**
 * Copy packs, one per skin. The skin is chosen per request (see
 * src/server/preferences.ts); "dumb" is Dumb Mode (#28).
 */
export const SKINS = ["standard", "dumb"] as const;
export type Skin = (typeof SKINS)[number];

const packs: Record<Skin, Strings> = {
  standard: en,
  dumb,
};

export function getStrings(skin: Skin = "standard"): Strings {
  return packs[skin];
}
