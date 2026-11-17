import { z } from "zod";
import { CommandError, defineCommand } from "./define";

export interface FeedbackItem {
  id: string;
  body: string;
  createdAt: string;
  /** When it was marked done; null while open. */
  doneAt: string | null;
}

interface FeedbackRow {
  id: string;
  body: string;
  created_at: Date;
  done_at: Date | null;
}

const toItem = (row: FeedbackRow): FeedbackItem => ({
  id: row.id,
  body: row.body,
  createdAt: row.created_at.toISOString(),
  doneAt: row.done_at?.toISOString() ?? null,
});

/** Jots down an issue or idea to tackle later. */
export const addFeedback = defineCommand({
  input: z.object({ body: z.string().trim().min(1).max(4_000) }),
  async run({ tx }, { body }) {
    const [row] = await tx<FeedbackRow[]>`
      insert into public.feedback (body) values (${body})
      returning id, body, created_at, done_at`;
    return toItem(row!);
  },
});

/** Open feedback first (oldest first, so nothing gets buried), then done items, most recently finished first. */
export const listFeedback = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    const rows = await tx<FeedbackRow[]>`
      select id, body, created_at, done_at from public.feedback
      order by (done_at is not null), case when done_at is null then created_at end, done_at desc`;
    return { items: rows.map(toItem) };
  },
});

/** Marks an item done, or reopens it. */
export const setFeedbackDone = defineCommand({
  input: z.object({ id: z.uuid(), done: z.boolean() }),
  async run({ tx, now }, { id, done }) {
    const rows = await tx`
      update public.feedback set done_at = ${done ? now() : null} where id = ${id} returning id`;
    if (rows.length === 0) throw new CommandError("not_found", "No such feedback");
  },
});

export const deleteFeedback = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, { id }) {
    const rows = await tx`delete from public.feedback where id = ${id} returning id`;
    if (rows.length === 0) throw new CommandError("not_found", "No such feedback");
  },
});
