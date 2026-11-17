"use client";

import { createContext, useContext, type ReactNode } from "react";
import { getStrings, type Skin, type Strings } from ".";

const StringsContext = createContext<Strings>(getStrings());

/** Client components read copy with useStrings(); the pack is resolved client-side because packs contain functions. */
export function StringsProvider({ skin, children }: { skin: Skin; children: ReactNode }) {
  return <StringsContext.Provider value={getStrings(skin)}>{children}</StringsContext.Provider>;
}

export function useStrings(): Strings {
  return useContext(StringsContext);
}
