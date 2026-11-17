import type { TransactionSql } from "postgres";
import { z } from "zod";
import { GRADES, JOINTS, SIDES, TISSUES, type Grade, type Injury } from "@/domain/injury";
import { CommandError, defineCommand } from "./define";
import { planTimeZone, replan } from "./replan";

/** An injury as stored. */
export interface StoredInjury extends Injury {
  note: string | null;
}

interface Row {
  id: string;
  joint: Injury["joint"];
  side: Injury["side"];
  tissue: Injury["tissue"];
  grade: Grade;
  start_date: string;
  cleared_date: string | null;
  note: string | null;
}

const columns = (tx: TransactionSql) =>
  tx`id, joint, side, tissue, grade, to_char(start_date, 'YYYY-MM-DD') as start_date,
    to_char(cleared_date, 'YYYY-MM-DD') as cleared_date, note`;

const toInjury = (row: Row): StoredInjury => ({
  id: row.id,
  joint: row.joint,
  side: row.side,
  tissue: row.tissue,
  grade: row.grade,
  startDate: row.start_date,
  clearedDate: row.cleared_date,
  note: row.note,
});

/** Every injury, open ones first (what the engine reads). */
export async function loadInjuries(tx: TransactionSql): Promise<StoredInjury[]> {
  const rows = await tx<Row[]>`
    select ${columns(tx)} from public.injuries
    order by cleared_date is not null, start_date desc, created_at desc`;
  return rows.map(toInjury);
}

const grade = z.number().pipe(z.literal(GRADES));

/** Logs an injury and re-plans: exercises that load the joint are cut back while it is open. */
export const logInjury = defineCommand({
  input: z.object({
    joint: z.enum(JOINTS),
    side: z.enum(SIDES),
    tissue: z.enum(TISSUES),
    grade,
    startDate: z.iso.date(),
    note: z.string().trim().min(1).max(200).optional(),
  }),
  async run({ tx, engine, push, now, coachChangeId }, input) {
    const [row] = await tx<Row[]>`
      insert into public.injuries (joint, side, tissue, grade, start_date, note)
      values (${input.joint}, ${input.side}, ${input.tissue}, ${input.grade}, ${input.startDate}, ${input.note ?? null})
      returning ${columns(tx)}`;
    await replan(tx, engine, push, now(), coachChangeId);
    return toInjury(row!);
  },
});

export const listInjuries = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    return { injuries: await loadInjuries(tx) };
  },
});

/** Changes how bad an injury is (they get better, or worse) and re-plans. */
export const updateInjury = defineCommand({
  input: z.object({ id: z.uuid(), grade }),
  async run({ tx, engine, push, now, coachChangeId }, { id, grade }) {
    const [row] = await tx<Row[]>`
      update public.injuries set grade = ${grade} where id = ${id} returning ${columns(tx)}`;
    if (!row) throw new CommandError("not_found", "No such injury");
    await replan(tx, engine, push, now(), coachChangeId);
    return toInjury(row);
  },
});

/** Marks an injury healed from `clearedDate` (default today in the plan's time zone) and re-plans. */
export const clearInjury = defineCommand({
  input: z.object({ id: z.uuid(), clearedDate: z.iso.date().optional() }),
  async run({ tx, engine, push, now, coachChangeId }, { id, clearedDate }) {
    const [today] = await tx<{ today: string }[]>`
      select to_char(${now()}::timestamptz at time zone ${await planTimeZone(tx)}, 'YYYY-MM-DD') as today`;
    const [row] = await tx<Row[]>`
      update public.injuries set cleared_date = greatest(${clearedDate ?? today!.today}::date, start_date)
      where id = ${id} returning ${columns(tx)}`;
    if (!row) throw new CommandError("not_found", "No such injury");
    await replan(tx, engine, push, now(), coachChangeId);
    return toInjury(row);
  },
});

/** Deletes an injury logged by mistake and re-plans. */
export const deleteInjury = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx, engine, push, now, coachChangeId }, { id }) {
    const deleted = await tx`delete from public.injuries where id = ${id} returning id`;
    if (deleted.length === 0) throw new CommandError("not_found", "No such injury");
    await replan(tx, engine, push, now(), coachChangeId);
    return { id };
  },
});
