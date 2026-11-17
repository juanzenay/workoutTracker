"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { Spinner } from "./submit-button";

/** Rendered inside a Link: shows a spinner from the moment the link is tapped until the next page arrives. */
function PendingMark() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span data-pending aria-hidden className="absolute top-1/2 right-3 -translate-y-1/2 text-muted">
      <Spinner />
    </span>
  );
}

/**
 * A Link that answers a tap at once: it dims and shows a spinner while the page it opens loads, so a slow
 * network never looks like a dead tap. Style it like any Link; pass `mark={false}` to dim without the spinner
 * (for tabs, where there is no room for one).
 */
export function PendingLink({
  mark = true,
  className = "",
  children,
  ...props
}: ComponentProps<typeof Link> & { mark?: boolean }) {
  return (
    <Link
      {...props}
      className={`relative transition-opacity has-[[data-pending]]:opacity-60 ${className}`}
    >
      {children}
      {mark ? <PendingMark /> : <PendingFlag />}
    </Link>
  );
}

/** Marks the link pending (for the dimming) without drawing anything. */
function PendingFlag() {
  const { pending } = useLinkStatus();
  return pending ? <span data-pending aria-hidden className="hidden" /> : null;
}
