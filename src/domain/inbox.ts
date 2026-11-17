import type { Text } from "./message";

/** Inbox: every notification workout tracker raises. Important items need the owner (and are pushed); minor ones are FYI. */

export const INBOX_LEVELS = ["important", "minor"] as const;
export type InboxLevel = (typeof INBOX_LEVELS)[number];

export interface InboxItem {
  id: string;
  /** What raised it, e.g. `plan_change_pending`, `plan_change_applied`, `backup_failed`. */
  kind: string;
  level: InboxLevel;
  title: Text;
  /** Paragraphs (e.g. a plan change's reasons); null = none. */
  body: Text[] | null;
  /** In-app path the item opens. */
  url: string | null;
  createdAt: string;
}

/** What the inbox shows: important items (and lone minor ones) on their own, back-to-back minor items as one expandable group. */
export type InboxEntry = { type: "item"; item: InboxItem } | { type: "group"; items: InboxItem[] };

/** Groups runs of two or more consecutive minor items (in the given order, newest first). */
export function groupInbox(items: InboxItem[]): InboxEntry[] {
  const entries: InboxEntry[] = [];
  let run: InboxItem[] = [];
  const flush = () => {
    if (run.length === 1) entries.push({ type: "item", item: run[0]! });
    else if (run.length > 1) entries.push({ type: "group", items: run });
    run = [];
  };
  for (const item of items) {
    if (item.level === "minor") {
      run.push(item);
    } else {
      flush();
      entries.push({ type: "item", item });
    }
  }
  flush();
  return entries;
}
