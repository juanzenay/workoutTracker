import type { TransactionSql } from "postgres";
import { z } from "zod";
import { defaultIncrement, PROGRESSION_RULES, type IsoDate } from "@/domain/block";
import { WEIGHT_UNITS } from "@/domain/workout";
import { addDays, daysBetween } from "@/engine/dates";
import { CommandError, defineCommand } from "./define";
import {
  blockEnd,
  loadBlocks,
  plannedColumns,
  toPlanned,
  type PlannedRow,
  type StoredBlock,
  type StoredPlannedSession,
} from "./plan-data";
import { replan } from "./replan";
import { runningOn } from "./running";

export type { StoredBlock, StoredPlannedSession };

const isoDate = z.iso.date();
const timeZone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown time zone");

export const BLOCK_INPUT = z.object({
  name: z.string().trim().min(1).max(120),
  startDate: isoDate,
  weeks: z.number().int().min(1).max(52),
  timeZone,
  sessions: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        weekday: z.number().int().min(1).max(7),
        exercises: z
          .array(
            z
              .object({
                exerciseId: z.uuid(),
                sets: z.number().int().min(1).max(20),
                repRangeStart: z.number().int().min(1).max(100),
                repRangeEnd: z.number().int().min(1).max(100),
                startWeight: z.number().finite().min(0).max(10_000).nullable().default(null),
                unit: z.enum(WEIGHT_UNITS).default("lb"),
                /** Defaults to 5 lb / 2.5 kg. */
                increment: z.number().finite().positive().max(1_000).optional(),
                rule: z.enum(PROGRESSION_RULES).default("double"),
                /** Set ramp target (rule "ramp" only): sets climb from `sets` to this across the block. */
                rampTo: z.number().int().min(2).max(20).nullable().default(null),
              })
              .refine((e) => e.repRangeEnd >= e.repRangeStart, "Rep range ends before it starts")
              .refine(
                (e) => (e.rule === "ramp" ? e.rampTo !== null && e.rampTo > e.sets : true),
                "A set ramp needs a target above its starting sets",
              )
              .transform((e) => ({ ...e, rampTo: e.rule === "ramp" ? e.rampTo : null })),
          )
          .min(1)
          .max(30),
      }),
    )
    .min(1)
    .max(14),
  /** 1-based weeks that are deloads. */
  deloadWeeks: z.array(z.number().int().min(1).max(52)).max(52).default([]),
  /** Why the block is designed this way (the coach's rationale for a draft). */
  notes: z.string().trim().max(2000).nullable().default(null),
});

const blockInput = BLOCK_INPUT;
type BlockInput = z.output<typeof blockInput>;

/** By date, then split order. */
export const sessionOrder = (tx: TransactionSql) =>
  tx`date, (select s.position from public.block_sessions s where s.id = block_session_id)`;

/** Inserts a block (a draft or not) with its sessions and exercises; returns its id. Does not re-plan. */
async function insertBlock(tx: TransactionSql, input: BlockInput, { draft }: { draft: boolean }): Promise<string> {
  checkDeloads(input);
  const [block] = await tx<{ id: string }[]>`
    insert into public.blocks (name, start_date, weeks, time_zone, deload_weeks, notes, draft)
    values (${input.name}, ${input.startDate}, ${input.weeks}, ${input.timeZone}, ${deloadArray(tx, input)},
      ${input.notes || null}, ${draft})
    returning id`;
  await insertSessions(tx, block!.id, input.sessions);
  return block!.id;
}

function checkDeloads(input: Pick<BlockInput, "weeks" | "deloadWeeks">) {
  if (input.deloadWeeks.some((w) => w > input.weeks))
    throw new CommandError("invalid_input", "Deload week outside the block");
}

const deloadArray = (tx: TransactionSql, input: Pick<BlockInput, "deloadWeeks">) =>
  tx`${tx.array([...new Set(input.deloadWeeks)].toSorted((a, b) => a - b))}::integer[]`;

async function insertSessions(tx: TransactionSql, blockId: string, sessions: BlockInput["sessions"]) {
  for (const [position, session] of sessions.entries()) {
    const [row] = await tx<{ id: string }[]>`
      insert into public.block_sessions (block_id, name, weekday, position)
      values (${blockId}, ${session.name}, ${session.weekday}, ${position})
      returning id`;
    for (const [exercisePosition, e] of session.exercises.entries()) {
      await tx`
        insert into public.block_exercises
          (block_session_id, exercise_id, position, sets, rep_range_start, rep_range_end, start_weight, unit, increment, rule, ramp_to)
        values (${row!.id}, ${e.exerciseId}, ${exercisePosition}, ${e.sets}, ${e.repRangeStart}, ${e.repRangeEnd},
          ${e.startWeight}, ${e.unit}, ${e.increment ?? defaultIncrement(e.unit)}, ${e.rule}, ${e.rampTo})`;
    }
  }
}

async function loadBlock(tx: TransactionSql, id: string): Promise<StoredBlock> {
  const [block] = await loadBlocks(tx, { id });
  if (!block) throw new CommandError("not_found", "No such block");
  return block;
}

/** Creates a block and starts planning it right away. */
export const createBlock = defineCommand({
  input: blockInput,
  async run({ tx, engine, push, now }, input) {
    const id = await insertBlock(tx, input, { draft: false });
    await replan(tx, engine, push, now());
    return loadBlock(tx, id);
  },
});

/**
 * Saves a draft block (the coach drafts the next block through the MCP server,
 * or the owner saves one unstarted): reviewed and edited in workout tracker, it plans no
 * sessions until `startBlock`.
 */
export const draftBlock = defineCommand({
  /** `timeZone` defaults to the plan's. */
  input: blockInput.extend({ timeZone: timeZone.optional() }),
  async run({ tx }, input) {
    const zone = input.timeZone ?? (await planTimeZone(tx));
    return loadBlock(tx, await insertBlock(tx, { ...input, timeZone: zone }, { draft: true }));
  },
});

/** A draft block, locked for update; not_found / conflict (started) otherwise. */
async function lockDraft(tx: TransactionSql, id: string) {
  const [row] = await tx<{ draft: boolean; start_date: string; time_zone: string }[]>`
    select draft, to_char(start_date, 'YYYY-MM-DD') as start_date, time_zone
    from public.blocks where id = ${id} for update`;
  if (!row) throw new CommandError("not_found", "No such block");
  if (!row.draft) throw new CommandError("conflict", "That block has started; only drafts can be changed");
  return { startDate: row.start_date, timeZone: row.time_zone };
}

/** Replaces a draft block's design (the block designer saves the whole block). Still plans nothing. */
export const updateDraftBlock = defineCommand({
  /** `timeZone` defaults to the draft's. */
  input: blockInput.extend({ id: z.uuid(), timeZone: timeZone.optional() }),
  async run({ tx }, { id, ...changes }) {
    const current = await lockDraft(tx, id);
    const input = { ...changes, timeZone: changes.timeZone ?? current.timeZone };
    checkDeloads(input);
    await tx`
      update public.blocks
      set name = ${input.name}, start_date = ${input.startDate}, weeks = ${input.weeks}, time_zone = ${input.timeZone},
        deload_weeks = ${deloadArray(tx, input)}, notes = ${input.notes || null}, updated_at = now()
      where id = ${id}`;
    await tx`delete from public.block_sessions where block_id = ${id}`;
    await insertSessions(tx, id, input.sessions);
    return loadBlock(tx, id);
  },
});

/** Discards a draft block. */
export const deleteDraftBlock = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, { id }) {
    await lockDraft(tx, id);
    await tx`delete from public.blocks where id = ${id}`;
    return { id };
  },
});

/**
 * Starts a draft block: it plans from `startDate` (default: its own start date,
 * or today if that has passed). Every started block not yet archived (the
 * current one, and any upcoming) is archived: it plans nothing from the day
 * the draft starts. Then everything re-plans through the engine.
 */
export const startBlock = defineCommand({
  input: z.object({ id: z.uuid(), startDate: isoDate.optional() }),
  async run({ tx, engine, push, now }, { id, startDate }) {
    const draft = await lockDraft(tx, id);
    const today = await planToday(tx, draft.timeZone);
    const start = startDate ?? (draft.startDate < today ? today : draft.startDate);
    if (start < today) throw new CommandError("invalid_input", "A block can't start in the past");

    const replaced = await tx<{ id: string }[]>`
      update public.blocks b
      set ended_on = least(${blockEnd(tx)}, ${start}::date - 1), updated_at = now()
      where not draft and ended_on is null and ${blockEnd(tx)} >= (now() at time zone time_zone)::date
      returning id`;
    // Their sessions from the draft's start on come off the plan (not "Plan updated" changes: the owner chose this).
    await tx`
      delete from public.planned_sessions p
      using public.blocks b
      where b.id = p.block_id and b.id = any(${tx.array(replaced.map((r) => r.id))}::uuid[]) and p.date > b.ended_on`;
    await tx`update public.blocks set draft = false, start_date = ${start}, updated_at = now() where id = ${id}`;
    await replan(tx, engine, push, now());
    return loadBlock(tx, id);
  },
});

/**
 * Edits a started block (running or upcoming) without a draft: the weekly split, and optionally the block's
 * name, notes, length and deload weeks, take effect from `from` and the calendar re-plans through the engine.
 *
 * The engine plans a block from its first day, so changing a started block's split in place would rewrite the
 * weeks already trained. Instead the block is ended the day before `from` (its past stays exactly as it was)
 * and continues as a new block with the new split from `from` on; progression carries over because it reads
 * workout history, not the block. A block still in its first week has no past, so it is edited in place.
 *
 * `from` is a week start of the block (its start date plus whole weeks), this week's or later; default this
 * week's. `weeks` and `deloadWeeks` use the block's original numbering. Drafts are edited with `updateDraftBlock`.
 */
export const updateBlock = defineCommand({
  input: z.object({
    id: z.uuid(),
    from: isoDate.optional(),
    name: BLOCK_INPUT.shape.name.optional(),
    /** Total weeks of the block as originally numbered; default: unchanged. */
    weeks: BLOCK_INPUT.shape.weeks.optional(),
    /** 1-based deload weeks in the block's original numbering; default: unchanged. */
    deloadWeeks: z.array(z.number().int().min(1).max(52)).max(52).optional(),
    /** Default: unchanged; null clears it. */
    notes: z.string().trim().max(2000).nullable().optional(),
    sessions: BLOCK_INPUT.shape.sessions,
  }),
  async run({ tx, engine, push, now }, { id, from, name, weeks, deloadWeeks, notes, sessions }) {
    const [old] = await tx<
      {
        name: string;
        start_date: string;
        end_date: string;
        weeks: number;
        time_zone: string;
        deload_weeks: number[];
        notes: string | null;
        draft: boolean;
        ended: boolean;
      }[]
    >`
      select b.name, to_char(b.start_date, 'YYYY-MM-DD') as start_date, to_char(${blockEnd(tx)}, 'YYYY-MM-DD') as end_date,
        b.weeks, b.time_zone, b.deload_weeks, b.notes, b.draft, b.ended_on is not null as ended
      from public.blocks b where b.id = ${id} for update`;
    if (!old) throw new CommandError("not_found", "No such block");
    if (old.draft) throw new CommandError("conflict", "That block hasn't started; edit the draft instead");
    const today = await planToday(tx, old.time_zone);
    if (old.ended || old.end_date < today) throw new CommandError("conflict", "That block has ended");

    const sinceStart = Math.max(0, daysBetween(old.start_date, today));
    const thisWeek = addDays(old.start_date, sinceStart - (sinceStart % 7));
    const effective = from ?? thisWeek;
    if (effective < thisWeek) throw new CommandError("invalid_input", "Weeks already trained can't be changed");
    if (daysBetween(old.start_date, effective) % 7 !== 0)
      throw new CommandError("invalid_input", "`from` must be a week start of the block");
    const total = weeks ?? old.weeks;
    const elapsed = daysBetween(old.start_date, effective) / 7;
    if (total - elapsed < 1) throw new CommandError("invalid_input", "The block has no weeks left from then");

    const remaining = total - elapsed;
    const deloads = (deloadWeeks ?? old.deload_weeks).map((w) => w - elapsed).filter((w) => w >= 1 && w <= remaining);
    const keptNotes = notes === undefined ? old.notes : notes;
    if (elapsed === 0) {
      checkDeloads({ weeks: total, deloadWeeks: deloads });
      await tx`
        update public.blocks
        set name = ${name ?? old.name}, weeks = ${total}, deload_weeks = ${deloadArray(tx, { deloadWeeks: deloads })},
          notes = ${keptNotes || null}, updated_at = now()
        where id = ${id}`;
      await tx`delete from public.block_sessions where block_id = ${id}`;
      await insertSessions(tx, id, sessions);
      await replan(tx, engine, push, now());
      return loadBlock(tx, id);
    }

    const lastOld = addDays(effective, -1);
    const continued = await insertBlock(
      tx,
      {
        name: name ?? old.name,
        startDate: effective,
        weeks: remaining,
        timeZone: old.time_zone,
        sessions,
        deloadWeeks: deloads,
        notes: keptNotes,
      },
      { draft: false },
    );
    await tx`update public.blocks set ended_on = ${lastOld}, updated_at = now() where id = ${id}`;
    await tx`delete from public.planned_sessions where block_id = ${id} and date > ${lastOld}`;
    await replan(tx, engine, push, now());
    return loadBlock(tx, continued);
  },
});

/** Every block, newest start first; `archived` narrows to finished (true) or current and upcoming (false) blocks. */
export const listBlocks = defineCommand({
  input: z.object({ archived: z.boolean().optional() }),
  async run({ tx }, { archived }) {
    const blocks = await loadBlocks(tx, { archived });
    return { blocks };
  },
});

/** The block running today (latest start), else the next one to start, else the most recent one; never a draft. */
async function currentBlock(tx: TransactionSql): Promise<StoredBlock | undefined> {
  const blocks = await loadBlocks(tx); // newest start first
  const live: { block: StoredBlock; started: boolean }[] = [];
  for (const block of blocks.filter((b) => !b.archived && !b.draft)) {
    live.push({ block, started: block.startDate <= (await planToday(tx, block.timeZone)) });
  }
  return live.find((b) => b.started)?.block ?? live.at(-1)?.block ?? blocks.find((b) => !b.draft);
}

/** One block with its planned sessions; without `id`, the current block (see currentBlock). */
export const getBlock = defineCommand({
  input: z.object({ id: z.uuid().optional() }),
  async run({ tx }, { id }) {
    const block = id ? (await loadBlocks(tx, { id }))[0] : await currentBlock(tx);
    if (!block) throw new CommandError("not_found", id ? "No such block" : "There are no blocks yet");
    id = block.id;
    const rows = await tx<PlannedRow[]>`
      select ${plannedColumns(tx)} from public.planned_sessions where block_id = ${id} order by ${sessionOrder(tx)}`;
    return { block, plannedSessions: rows.map(toPlanned) };
  },
});

/** The plan's time zone: the newest started block's, else the newest run plan's, else UTC. */
export async function planTimeZone(tx: TransactionSql): Promise<string> {
  const [row] = await tx<{ zone: string }[]>`
    select coalesce(
      (select time_zone from public.blocks where not draft order by start_date desc, created_at desc limit 1),
      (select time_zone from public.run_plans order by created_at desc limit 1), 'UTC'
    ) as zone`;
  return row!.zone;
}

/** Today's date in `zone` (default: the plan's time zone). */
export async function planToday(tx: TransactionSql, zone?: string): Promise<IsoDate> {
  const [row] = await tx<{ today: string }[]>`
    select to_char(now() at time zone ${zone ?? (await planTimeZone(tx))}, 'YYYY-MM-DD') as today`;
  return row!.today;
}

/**
 * Today: the active block (the latest-starting block whose weeks include
 * `date`), the day's planned session (null = rest day) and the next one.
 * `date` defaults to today in the newest block's time zone.
 */
export const getToday = defineCommand({
  input: z.object({ date: isoDate.optional() }),
  async run({ tx }, input) {
    const date: IsoDate = input.date ?? (await planToday(tx));
    const running = await runningOn(tx, date);

    const [block] = await tx<{ id: string; name: string; weeks: number; week: number }[]>`
      select id, name, weeks, (${date}::date - start_date) / 7 + 1 as week
      from public.blocks b
      where not draft and start_date <= ${date}::date and ${date}::date <= ${blockEnd(tx)}
      order by start_date desc, created_at desc
      limit 1`;
    if (!block) return { date, block: null, session: null, next: null, ...running };

    const [session] = await tx<PlannedRow[]>`
      select ${plannedColumns(tx)} from public.planned_sessions
      where block_id = ${block.id} and date = ${date}::date
      order by ${sessionOrder(tx)} limit 1`;
    const [next] = await tx<PlannedRow[]>`
      select ${plannedColumns(tx)} from public.planned_sessions
      where block_id = ${block.id} and date > ${date}::date
      order by ${sessionOrder(tx)} limit 1`;
    return {
      date,
      block,
      session: session ? toPlanned(session) : null,
      next: next ? toPlanned(next) : null,
      ...running,
    };
  },
});

export const getPlannedSession = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, { id }) {
    const [row] = await tx<PlannedRow[]>`select ${plannedColumns(tx)} from public.planned_sessions where id = ${id}`;
    if (!row) throw new CommandError("not_found", "No such planned session");
    return toPlanned(row);
  },
});
