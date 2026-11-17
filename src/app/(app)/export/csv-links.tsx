"use client";

import { useSyncExternalStore } from "react";
import { useStrings } from "@/strings/provider";

const noSubscribe = () => () => {};
const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** CSV download links; times are written in this device's time zone (Hevy's CSV has no offsets). */
export function CsvLinks() {
  const s = useStrings();
  const timeZone = useSyncExternalStore(noSubscribe, deviceTimeZone, () => "UTC");
  const href = (unit: "lb" | "kg") => `/api/export/csv?${new URLSearchParams({ tz: timeZone, unit })}`;
  const linkClass = "flex min-h-touch items-center rounded-control border border-border-strong px-4 font-medium";

  return (
    <>
      <p className="text-sm">{s.export.csvBody(timeZone)}</p>
      <div className="flex flex-wrap gap-2">
        <a href={href("lb")} download className={linkClass}>
          {s.export.csvDownloadLb}
        </a>
        <a href={href("kg")} download className={linkClass}>
          {s.export.csvDownloadKg}
        </a>
      </div>
    </>
  );
}
