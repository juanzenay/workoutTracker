import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import type { InboxItem } from "@/domain/inbox";
import { requireCommands } from "@/server/auth/session";
import { vapidFromEnv } from "@/server/push/sender";
import type { Strings } from "@/strings";
import { renderText } from "@/strings/render";
import { getRequestStrings } from "@/server/strings";
import { PushToggle } from "./push-toggle";

function Item({ item, s }: { item: InboxItem; s: Strings }) {
  const important = item.level === "important";
  const headingId = `inbox-${item.id}`;
  const title = renderText(s, item.title);
  return (
    <article
      aria-labelledby={headingId}
      className={`flex flex-col gap-1 rounded-card bg-surface p-4 ${important ? "border border-accent" : ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted">
        <span className="font-medium">{important ? s.inbox.important : null}</span>
        <LocalDateTime iso={item.createdAt} />
      </div>
      <h2 id={headingId} className={important ? "text-lg font-semibold" : "font-medium"}>
        {item.url ? (
          <Link href={item.url} className="underline-offset-2 hover:underline">
            {title}
          </Link>
        ) : (
          title
        )}
      </h2>
      {item.body && <p className="text-muted">{item.body.map((t) => renderText(s, t)).join(" ")}</p>}
    </article>
  );
}

/** Every notification, newest first. Important items always show; back-to-back minor ones fold into one expandable group. */
export default async function InboxPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { entries } = await commands.listInbox({});
  const vapid = vapidFromEnv();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{s.inbox.title}</h1>
      <PushToggle publicKey={vapid?.publicKey ?? null} />
      {entries.length === 0 ? (
        <EmptyState>{s.inbox.empty}</EmptyState>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((entry) =>
            entry.type === "item" ? (
              <li key={entry.item.id}>
                <Item item={entry.item} s={s} />
              </li>
            ) : (
              <li key={entry.items[0]!.id}>
                <details className="rounded-card border border-border">
                  <summary className="flex min-h-touch cursor-pointer items-center px-4 text-muted">
                    {s.inbox.minorGroup(entry.items.length)}
                  </summary>
                  <ol className="flex flex-col gap-2 p-2">
                    {entry.items.map((item) => (
                      <li key={item.id}>
                        <Item item={item} s={s} />
                      </li>
                    ))}
                  </ol>
                </details>
              </li>
            ),
          )}
        </ol>
      )}
    </div>
  );
}
