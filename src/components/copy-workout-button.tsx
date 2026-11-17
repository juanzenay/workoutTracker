"use client";

import { useEffect, useState } from "react";
import { useStrings } from "@/strings/provider";
import { copyText } from "./copy-text";
import { Button } from "./ui/button";

const CONFIRM_MS = 2500;

/** Copies a finished workout's paste-ready text (#76) and says whether the copy worked. */
export function CopyWorkoutButton({ text }: { text: string }) {
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
      <Button
        variant="secondary"
        className="w-full"
        onClick={async () => setFailed(!(await copyText(text, navigator.clipboard)))}
      >
        {s.summary.copyText}
      </Button>
      <p role="status" className={`min-h-5 text-sm ${failed ? "text-danger" : "text-success-text"}`}>
        {message}
      </p>
    </div>
  );
}
