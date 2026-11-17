import type { ReactNode } from "react";
import { AppNav, SectionNav } from "@/components/app-nav";
import { PendingLink } from "@/components/ui/pending-link";
import { OfflineSupport } from "@/components/offline-support";
import { getPreferences } from "@/server/preferences";
import { getRequestStrings } from "@/server/strings";

/** Shell for signed-in pages. Routes here call requireCommands(), which redirects anonymous visitors. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const s = await getRequestStrings();
  const { skin } = await getPreferences();

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border px-4">
        <PendingLink href="/" mark={false} className="flex min-h-touch items-center text-lg font-semibold">
          {s.app.name}
        </PendingLink>
        <AppNav />
        <PendingLink href="/inbox" mark={false} className="flex min-h-touch items-center px-2 text-sm font-medium">
          {s.nav.inbox}
        </PendingLink>
      </header>
      <OfflineSupport skin={skin} />
      {/* Bottom padding clears the phone tab bar. */}
      <main className="flex-1 px-4 pt-4 pb-[calc(var(--touch-lg)+env(safe-area-inset-bottom)+1rem)] md:pb-4">
        <SectionNav />
        {children}
      </main>
    </div>
  );
}
