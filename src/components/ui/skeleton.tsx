"use client";

import type { ReactNode } from "react";
import { useStrings } from "@/strings/provider";

/** A placeholder shaped like the content that is loading. Decorative: its LoadingRegion says "loading". */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rounded-control bg-surface-raised motion-safe:animate-pulse ${className}`} />;
}

/**
 * What a route's `loading.tsx` renders: marks the region busy and tells screen readers it is loading.
 * A client component so every loading screen stays static, and shows the instant a link is tapped.
 */
export function LoadingRegion({ children, className = "" }: { children: ReactNode; className?: string }) {
  const s = useStrings();
  return (
    // Not role="status": the e2e specs look the sync and import notices up by that role.
    <div data-loading aria-busy="true" className={`flex flex-col gap-4 ${className}`}>
      <span aria-live="polite" className="sr-only">
        {s.common.loading}
      </span>
      {children}
    </div>
  );
}

/** A page title placeholder. */
export function SkeletonTitle({ className = "" }: { className?: string }) {
  return <Skeleton className={`h-8 w-1/2 ${className}`} />;
}

/** A card placeholder (the rounded surface most pages are built from). */
export function SkeletonCard({ className = "h-24" }: { className?: string }) {
  return <Skeleton className={`w-full rounded-card ${className}`} />;
}

/** A list of rows, each a thumbnail and two lines of text, like the exercise and workout lists. */
export function SkeletonList({ rows = 6, thumbnail = true }: { rows?: number; thumbnail?: boolean }) {
  return (
    <ul aria-hidden className="flex flex-col divide-y divide-border">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-3 py-3">
          {thumbnail && <Skeleton className="h-14 w-20 shrink-0" />}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
