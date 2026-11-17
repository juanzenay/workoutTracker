import type { ReactNode } from "react";

/**
 * Progressive disclosure for optional or rarely used fields. Inputs inside stay in the form when
 * closed, so they still submit.
 */
export function Disclosure({ summary, open, children }: { summary: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group">
      <summary className="flex min-h-touch cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-muted transition-transform group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="flex flex-col gap-3 pt-2">{children}</div>
    </details>
  );
}
