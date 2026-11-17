"use client";

import Link from "next/link";
import { useStrings } from "@/strings/provider";

/** What a signed-in screen shows when it throws while rendering: retry, or go back to Today. */
export default function ErrorScreen({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const s = useStrings();
  return (
    <div className="flex flex-col gap-4 py-8">
      <h1 className="text-2xl font-semibold">{s.errors.title}</h1>
      <p className="text-muted">{s.errors.body}</p>
      <button
        type="button"
        onClick={reset}
        className="flex min-h-touch-lg items-center justify-center rounded-control bg-accent px-4 font-medium text-accent-fg"
      >
        {s.errors.retry}
      </button>
      <Link href="/" className="text-center text-muted underline">
        {s.errors.home}
      </Link>
    </div>
  );
}
