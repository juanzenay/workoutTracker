import type { TransactionSql } from "postgres";
import { z } from "zod";
import type { IsoDate } from "@/domain/block";
import type { PlanMoves } from "@/domain/plan-move";
import { addDays, isoWeekday } from "@/engine/dates";
import { CommandError, defineCommand } from "./define";
import { planTimeZone, replan } from "./replan";

/** Every move the owner made by hand, as the engine reads them (src/engine/moves.ts). */
export async function loadMoves(tx: TransactionSql): Promise<PlanMoves> {
  const rows = await tx<
    {
      kind: "session" | "run";
      block_session_id: string | null;
      run_plan_id: string | null;
      row_index: number | null;
      from_date: string;
      to_date: string;
    }[]
  >`
    select kind, block_session_id, run_plan_id, row_index, to_char(from_date, 'YYYY-MM-DD') as from_date,
      to_char(to_date, 'YYYY-MM-DD') as to_date
    from public.plan_moves order by from_date`;
  return {
    sessions: rows
      .filter((r) => r.kind === "session")
      .map((r) => ({ blockSessionId: r.block_session_id!, from: r.from_date, to: r.to_date })),
    runs: rows
      .filter((r) => r.kind === "run")
      .map((r) => ({ runPlanId: r.run_plan_id!, rowIndex: r.row_index!, from: r.from_date, to: r.to_date })),
  };
}

const monday = (date: IsoDate) => addDays(date, 1 - isoWeekday(date));

/** The day a move may happen on: today or later, in the same Monday–Sunday week as where the item is now. */
async function checkTarget(tx: TransactionSql, now: Date, current: IsoDate, to: IsoDate) {
  const [row] = await tx<{ today: string }[]>`
    select to_char(${now}::timestamptz at time zone ${await planTimeZone(tx)}, 'YYYY-MM-DD') as today`;
  const today = row!.today;
  if (current < today) throw new CommandError("conflict", "That day is already over, so it can't move");
  if (to < today) throw new CommandError("invalid_input", "Pick today or a day still to come");
  if (monday(to) !== monday(current)) throw new CommandError("invalid_input", "Moves stay within the same week");
}

/** Puts the session `blockSessionId` (now on `current`) on `to`. A move back to the engine's own day removes the move. */
async function setSessionDay(tx: TransactionSql, blockSessionId: string, current: IsoDate, to: IsoDate) {
  const [existing] = await tx<{ from_date: string }[]>`
    select to_char(from_date, 'YYYY-MM-DD') as from_date from public.plan_moves
    where kind = 'session' and block_session_id = ${blockSessionId} and to_date = ${current}::date`;
  // The engine's own day for the item: moving it back there just deletes the move.
  const original = existing?.from_date ?? current;
  await tx`delete from public.plan_moves where kind = 'session' and block_session_id = ${blockSessionId} and from_date = ${original}::date`;
  if (to !== original) {
    await tx`
      insert into public.plan_moves (kind, block_session_id, from_date, to_date)
      values ('session', ${blockSessionId}, ${original}, ${to})`;
  }
}

async function setRunDay(tx: TransactionSql, runPlanId: string, rowIndex: number, current: IsoDate, to: IsoDate) {
  const [existing] = await tx<{ from_date: string }[]>`
    select to_char(from_date, 'YYYY-MM-DD') as from_date from public.plan_moves
    where kind = 'run' and run_plan_id = ${runPlanId} and row_index = ${rowIndex} and to_date = ${current}::date`;
  // The engine's own day for the item: moving it back there just deletes the move.
  const original = existing?.from_date ?? current;
  await tx`delete from public.plan_moves
    where kind = 'run' and run_plan_id = ${runPlanId} and row_index = ${rowIndex} and from_date = ${original}::date`;
  if (to !== original) {
    await tx`
      insert into public.plan_moves (kind, run_plan_id, row_index, from_date, to_date)
      values ('run', ${runPlanId}, ${rowIndex}, ${original}, ${to})`;
  }
}

/**
 * Moves a planned lifting session to another day of the same week (run today instead of tomorrow, lower
 * before upper). A session already on that day of the same block swaps places with it. Finished sessions and
 * days already over stay put. The move is remembered, so later re-plans keep it; moving a session back to the
 * day its block schedules it on forgets the move.
 */
export const movePlannedSession = defineCommand({
  input: z.object({ id: z.uuid(), to: z.iso.date() }),
  async run({ tx, engine, push, now, coachChangeId }, { id, to }) {
    const [session] = await tx<{ block_id: string; block_session_id: string; date: string; done: boolean }[]>`
      select block_id, block_session_id, to_char(date, 'YYYY-MM-DD') as date,
        exists (
          select 1 from public.workouts w, public.blocks b
          where b.id = planned_sessions.block_id and w.finished_at is not null and w.discarded_at is null
            and (w.started_at at time zone b.time_zone)::date = planned_sessions.date
        ) as done
      from public.planned_sessions where id = ${id}`;
    if (!session) throw new CommandError("not_found", "No such planned session");
    if (session.date === to) return { id };
    await checkTarget(tx, now(), session.date, to);
    if (session.done) throw new CommandError("conflict", "That session is already done");

    const partners = await tx<{ block_session_id: string; done: boolean }[]>`
      select block_session_id,
        exists (
          select 1 from public.workouts w, public.blocks b
          where b.id = planned_sessions.block_id and w.finished_at is not null and w.discarded_at is null
            and (w.started_at at time zone b.time_zone)::date = planned_sessions.date
        ) as done
      from public.planned_sessions
      where block_id = ${session.block_id} and date = ${to}::date and block_session_id <> ${session.block_session_id}`;
    if (partners.some((p) => p.done)) throw new CommandError("conflict", "The session on that day is already done");

    await setSessionDay(tx, session.block_session_id, session.date, to);
    for (const partner of partners) await setSessionDay(tx, partner.block_session_id, to, session.date);
    await replan(tx, engine, push, now(), coachChangeId);
    return { id };
  },
});

/** Moves a planned run to another day of the same week; a run of the same plan on that day (rest rows too) swaps places with it. */
export const movePlannedRun = defineCommand({
  input: z.object({ id: z.uuid(), to: z.iso.date() }),
  async run({ tx, engine, push, now, coachChangeId }, { id, to }) {
    const [run] = await tx<{ run_plan_id: string; row_index: number; date: string; status: string | null }[]>`
      select run_plan_id, row_index, to_char(date, 'YYYY-MM-DD') as date, status from public.planned_runs where id = ${id}`;
    if (!run) throw new CommandError("not_found", "No such planned run");
    if (run.date === to) return { id };
    await checkTarget(tx, now(), run.date, to);
    if (run.status === "done" || run.status === "partial") throw new CommandError("conflict", "That run is already done");

    const partners = await tx<{ row_index: number; status: string | null }[]>`
      select row_index, status from public.planned_runs
      where run_plan_id = ${run.run_plan_id} and date = ${to}::date and row_index <> ${run.row_index}`;
    if (partners.some((p) => p.status === "done" || p.status === "partial"))
      throw new CommandError("conflict", "The run on that day is already done");

    await setRunDay(tx, run.run_plan_id, run.row_index, run.date, to);
    for (const partner of partners) await setRunDay(tx, run.run_plan_id, partner.row_index, to, run.date);
    await replan(tx, engine, push, now(), coachChangeId);
    return { id };
  },
});
