import type { ReactNode } from "react";

/** What a list shows when it has nothing in it yet: one consistent, quiet box. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-card border border-dashed border-border-strong px-4 py-8 text-center text-muted">{children}</p>
  );
}
