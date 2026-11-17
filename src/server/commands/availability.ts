import type { TransactionSql } from "postgres";
import { z } from "zod";
import type { Unavailability } from "@/domain/availability";
import { CommandError, defineCommand } from "./define";
import { replan } from "./replan";

/** Days marked unavailable, as stored. */
export interface StoredUnavailability extends Unavailability {
  id: string;
  note: string | null;
}

interface Row {
  id: string;
  start_date: string;
  end_date: string;
  note: string | null;
}

const columns = (tx: TransactionSql) =>
  tx`id, to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date, note`;

const toUnavailability = (row: Row): StoredUnavailability => ({
  id: row.id,
  startDate: row.start_date,
  endDate: row.end_date,
  note: row.note,
});

/** Every range marked unavailable, earliest first (what the engine reads). */
export async function loadUnavailability(tx: TransactionSql): Promise<StoredUnavailability[]> {
  const rows = await tx<Row[]>`select ${columns(tx)} from public.unavailability order by start_date, end_date, created_at`;
  return rows.map(toUnavailability);
}

/**
 * Marks a date range (inclusive, plan's time zone) unavailable — sick, away,
 * busy — and re-plans around it: sessions move to free days later that week
 * (or drop), runs come off, long runs move or drop (src/engine/replan.ts).
 */
export const markUnavailable = defineCommand({
  input: z
    .object({
      startDate: z.iso.date(),
      endDate: z.iso.date(),
      note: z.string().trim().min(1).max(200).optional(),
    })
    .refine((u) => u.endDate >= u.startDate, { message: "The range ends before it starts", path: ["endDate"] }),
  async run({ tx, engine, push, now, coachChangeId }, input) {
    const [row] = await tx<Row[]>`
      insert into public.unavailability (start_date, end_date, note)
      values (${input.startDate}, ${input.endDate}, ${input.note ?? null})
      returning ${columns(tx)}`;
    await replan(tx, engine, push, now(), coachChangeId);
    return toUnavailability(row!);
  },
});

export const listUnavailability = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    return { unavailability: await loadUnavailability(tx) };
  },
});

/** Removes a range (back to available) and re-plans. */
export const clearUnavailable = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx, engine, push, now, coachChangeId }, { id }) {
    const deleted = await tx`delete from public.unavailability where id = ${id} returning id`;
    if (deleted.length === 0) throw new CommandError("not_found", "No such unavailable days");
    await replan(tx, engine, push, now(), coachChangeId);
    return { id };
  },
});
