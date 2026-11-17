import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import type { JSONValue } from "postgres";
import { groupInbox, INBOX_LEVELS, type InboxItem, type InboxLevel } from "@/domain/inbox";
import type { Text } from "@/domain/message";
import { getStrings } from "@/strings";
import { renderText } from "@/strings/render";
import { withActor, type Actor } from "../db/actor";
import type { PushMessage, PushSender } from "../push/sender";
import { CommandError, defineCommand, type Push } from "./define";

/**
 * Inbox and Web Push. Every notification is an inbox item; important ones (they
 * need the owner: pending confirmations, backup failures) are also pushed to
 * every subscribed device. Minor ones are never pushed.
 */

interface InboxRow {
  id: string;
  kind: string;
  level: InboxLevel;
  title: Text;
  body: Text[] | null;
  url: string | null;
  created_at: Date;
}

const toItem = (row: InboxRow): InboxItem => ({
  id: row.id,
  kind: row.kind,
  level: row.level,
  title: row.title,
  body: row.body,
  url: row.url,
  createdAt: row.created_at.toISOString(),
});

const inboxItemInput = z.object({
  /** What raised it (snake_case), e.g. `backup_failed`. */
  kind: z.string().regex(/^[a-z][a-z0-9_]*$/),
  level: z.enum(INBOX_LEVELS),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(1000).nullish(),
  /** In-app path the item and its notification open, e.g. `/plan-changes/<id>`. */
  url: z
    .string()
    .regex(/^\/(?![/\\])/, "an in-app path like /plan-changes/<id>")
    .max(500)
    .nullish(),
});

/** A new item as the command layer raises it: title and body as Text (rendered at display time). */
export interface NewInboxItem {
  kind: string;
  level: InboxLevel;
  title: Text;
  /** Paragraphs (e.g. a plan change's reasons); null = none. */
  body?: Text[] | null;
  url?: string | null;
}

const asJson = (value: unknown) => value as JSONValue;

/**
 * Records an inbox item; an important one is also pushed (after commit). Use this
 * from any command that notifies the owner; outside the command layer, call the
 * `raiseInboxItem` command (e.g. the backup job, as `{ kind: "service" }`).
 */
export async function raiseInbox(ctx: { tx: TransactionSql; push: Push }, input: NewInboxItem): Promise<InboxItem> {
  const parsed = inboxItemInput.omit({ title: true, body: true }).safeParse(input);
  if (!parsed.success) throw new CommandError("invalid_input", "Invalid inbox item", parsed.error.issues);
  const item = parsed.data;
  const body = input.body && input.body.length > 0 ? input.body : null;
  const [row] = await ctx.tx<InboxRow[]>`
    insert into public.inbox_items (kind, level, title, body, url)
    values (${item.kind}, ${item.level}, ${ctx.tx.json(asJson(input.title))}, ${body && ctx.tx.json(asJson(body))},
      ${item.url ?? null})
    returning id, kind, level, title, body, url, created_at`;
  const raised = toItem(row!);
  if (raised.level === "important") {
    // A notification leaves workout tracker: rendered now, in the standard words (a push can't know the device's skin).
    const s = getStrings();
    ctx.push({
      title: renderText(s, raised.title),
      body: raised.body?.map((t) => renderText(s, t)).join(" ") || undefined,
      url: raised.url ?? "/inbox",
      tag: raised.id,
    });
  }
  return raised;
}

/** Raises an inbox item (important → also Web Push). */
export const raiseInboxItem = defineCommand({
  input: inboxItemInput,
  async run(ctx, { body, ...input }) {
    return raiseInbox(ctx, { ...input, body: body ? [body] : null });
  },
});

/** The inbox, newest first: important items on their own, back-to-back minor items grouped. */
export const listInbox = defineCommand({
  input: z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  async run({ tx }, { limit }) {
    const rows = await tx<InboxRow[]>`
      select id, kind, level, title, body, url, created_at from public.inbox_items
      order by created_at desc, id desc
      limit ${limit}`;
    return { entries: groupInbox(rows.map(toItem)) };
  },
});

const subscriptionInput = z.object({
  endpoint: z.url().startsWith("https://").max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

/** Saves this device's push subscription (PushSubscription.toJSON(); extra fields ignored). Re-saving refreshes its keys. */
export const savePushSubscription = defineCommand({
  input: subscriptionInput,
  async run({ tx }, { endpoint, keys }) {
    await tx`
      insert into public.push_subscriptions (endpoint, p256dh, auth)
      values (${endpoint}, ${keys.p256dh}, ${keys.auth})
      on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, updated_at = now()`;
    return { endpoint };
  },
});

/** Forgets a device's push subscription (owner turned notifications off there). */
export const deletePushSubscription = defineCommand({
  input: z.object({ endpoint: z.string().min(1) }),
  async run({ tx }, { endpoint }) {
    await tx`delete from public.push_subscriptions where endpoint = ${endpoint}`;
    return { endpoint };
  },
});

/** Whether the server still has this device's subscription (the push service may have dropped it). */
export const getPushSubscription = defineCommand({
  input: z.object({ endpoint: z.string().min(1) }),
  async run({ tx }, { endpoint }) {
    const [row] = await tx<{ id: string }[]>`select id from public.push_subscriptions where endpoint = ${endpoint}`;
    return { subscribed: Boolean(row) };
  },
});

/**
 * Sends queued push messages to every subscribed device, after the command committed.
 * Subscriptions the push service reports gone are deleted. Failures never fail the command:
 * the inbox item is already recorded.
 */
export async function deliverPush(sql: Sql, actor: Actor, sender: PushSender, messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return;
  try {
    const subscriptions = await withActor(sql, actor, (tx) =>
      tx<{ endpoint: string; p256dh: string; auth: string }[]>`
        select endpoint, p256dh, auth from public.push_subscriptions order by created_at`,
    );
    const gone: string[] = [];
    for (const message of messages) {
      await Promise.all(
        subscriptions.map(async ({ endpoint, p256dh, auth }) => {
          try {
            if ((await sender.send({ endpoint, keys: { p256dh, auth } }, message)) === "gone") gone.push(endpoint);
          } catch (error) {
            console.error("Web Push failed", endpoint, error);
          }
        }),
      );
    }
    if (gone.length > 0) {
      await withActor(sql, actor, (tx) => tx`delete from public.push_subscriptions where endpoint = any(${tx.array(gone)}::text[])`);
    }
  } catch (error) {
    console.error("Web Push delivery failed", error);
  }
}
