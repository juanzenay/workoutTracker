"use client";

import { useEffect, useRef } from "react";
import { useOffline, warmOfflineCache } from "@/client/offline-cache";
import type { Skin } from "@/strings";
import { useStrings } from "@/strings/provider";

/**
 * Lives in the signed-in shell: keeps the service worker's offline caches fresh whenever the app is
 * online (on load and on reconnect), and says so plainly when there is no connection. When the skin
 * changes (Dumb Mode toggled), the cached pages are re-fetched straight away so they match offline.
 */
export function OfflineSupport({ skin }: { skin: Skin }) {
  const s = useStrings();
  const offline = useOffline();
  const warmedSkin = useRef<Skin | null>(null);

  useEffect(() => {
    if (offline) return;
    warmOfflineCache([], { force: warmedSkin.current !== null && warmedSkin.current !== skin });
    warmedSkin.current = skin;
  }, [offline, skin]);

  if (!offline) return null;
  return <p className="bg-surface-raised px-4 py-2 text-center text-sm text-muted">{s.offline.banner}</p>;
}
