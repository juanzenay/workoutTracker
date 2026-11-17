import { getRequestStrings } from "@/server/strings";

/**
 * Served by the service worker (public/sw.js) for any navigation it has no cached copy of while
 * offline: online-only screens (planning, coach, import, export…) land here instead of failing.
 * Public (see src/proxy.ts) so the worker can cache it before sign-in. Plain <a> links: offline,
 * a full navigation is answered from the worker's cache.
 */
export default async function OfflinePage() {
  const s = await getRequestStrings();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-semibold">{s.offline.title}</h1>
      <p>{s.offline.body}</p>
      <p className="text-muted">{s.offline.works}</p>
      <a
        href="/workout"
        className="flex min-h-touch-lg items-center justify-center rounded-control bg-accent px-4 font-medium text-accent-fg"
      >
        {s.offline.openLogger}
      </a>
    </main>
  );
}
