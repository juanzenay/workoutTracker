"use client";

import { useEffect, useState } from "react";
import type { Strings } from "@/strings";
import { useStrings } from "@/strings/provider";
import { copyText } from "./copy-text";
import { Button } from "./ui/button";

const CONFIRM_MS = 2500;

export type CopyFieldKey = keyof Strings["summary"]["copyField"];
const FIELDS: readonly CopyFieldKey[] = ["title", "date", "duration", "description"];

/**
 * One copy button per field of a finished workout (#82), so each value can be pasted into its own
 * field of Strava's manual activity form. Each button copies only its own value.
 */
export function CopyFieldButtons({ fields }: { fields: Record<CopyFieldKey, string> }) {
  const s = useStrings();
  const [failed, setFailed] = useState<boolean | null>(null);

  useEffect(() => {
    if (failed === null) return;
    const timer = setTimeout(() => setFailed(null), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  const message = failed === null ? "" : failed ? s.summary.copyFailed : s.summary.copied;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {FIELDS.map((key) => (
          <Button
            key={key}
            variant="secondary"
            onClick={async () => setFailed(!(await copyText(fields[key], navigator.clipboard)))}
          >
            {s.summary.copyField[key]}
          </Button>
        ))}
      </div>
      <p role="status" className={`min-h-5 text-sm ${failed ? "text-danger" : "text-success-text"}`}>
        {message}
      </p>
    </div>
  );
}
