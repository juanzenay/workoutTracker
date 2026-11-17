import type { JSONValue, TransactionSql } from "postgres";
import { z } from "zod";
import type { PlannedSession } from "@/domain/block";
import type { Message, Text } from "@/domain/message";
import type { ExerciseDiff, PlanDiffItem, RunDiff, SessionDiff } from "@/domain/plan-change";
import { RUN_PLAN_FORMATS } from "@/domain/run-plan-file";
import { RACE_PRIORITIES, type PlannedRun } from "@/domain/running";
import { markUnavailable } from "./availability";
import { CommandError, defineCommand, type CommandContext } from "./define";
import { loadRaces, plannedColumns, toPlanned, type PlannedRow } from "./plan-data";
import { announceRevision, getPlanRevision, sameJson, texts } from "./plan-revisions";
import { loadPlannedRuns, planTimeZone, replan } from "./replan";
import { createRace, importRunPlan, updateRace } from "./running";

/**
 * Coach changes: what the coach (the owner's Claude, through the MCP server)
 * may do to the plan. Never silent:
 *
 * 1. `proposeCoachChange` tries the action out (in a savepoint that is rolled
 *    back) and stores a `proposed` revision: summary, reasons (the coach's own
 *    and the engine's), and the diff the plan would get. The plan is untouched.
 * 2. `applyCoachChange` — only once the owner approves in chat — performs the
 *    action through the same commands the PWA uses (which re-plan through the
 *    engine). It becomes one applied revision with source `coach`: a "Plan
 *    updated" card in workout tracker. The engine changes it causes are folded into it
 *    (child revisions), approved with it.
 * 3. Undo (`undoPlanRevision`, in workout tracker or the MCP undo tool) puts the engine's
 *    inputs (races, run plans, unavailable days) back as they were before the
 *    change — rows changed since are left alone — and re-plans.
 */

const isoDate = z.iso.date();

export const COACH_ACTION = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("mark_unavailable"),
    startDate: isoDate,
    endDate: isoDate,
    note: z.string().trim().min(1).max(200).optional(),
  }),
  z.object({
    type: z.literal("add_race"),
    name: z.string().trim().min(1).max(120),
    date: isoDate,
    distanceMeters: z.number().int().positive().max(1_000_000),
    priority: z.enum(RACE_PRIORITIES),
  }),
  z.object({
    type: z.literal("update_race"),
    id: z.uuid(),
    name: z.string().trim().min(1).max(120).optional(),
    date: isoDate.optional(),
    distanceMeters: z.number().int().positive().max(1_000_000).optional(),
    priority: z.enum(RACE_PRIORITIES).optional(),
  }),
  z.object({
    type: z.literal("import_run_plan"),
    format: z.enum(RUN_PLAN_FORMATS),
    content: z.string().max(1_000_000),
    name: z.string().trim().min(1).max(120).optional(),
    raceId: z.uuid().optional(),
    timeZone: z.string().optional(),
  }),
]);

export type CoachAction = z.output<typeof COACH_ACTION>;

/** The engine's inputs a coach action can change, in foreign-key order (parents first). */
const INPUT_TABLES = ["races", "run_plans", "unavailability"] as const;
type InputTable = (typeof INPUT_TABLES)[number];
type Row = Record<string, unknown> & { id: string };
type InputRows = Record<InputTable, Map<string, Row>>;
/** Per table, the rows an applied change touched: before (null = it created the row) and after (null = it deleted it). */
type InputChanges = Partial<Record<InputTable, { id: string; before: Row | null; after: Row | null }[]>>;

/** What is stored in plan_revisions.coach. */
export interface CoachData {
  action: CoachAction;
  reason: string | null;
  /** Set once applied. */
  inputs?: InputChanges;
}

// ---- Commands ----

/** Tries an action out and stores it as a proposed coach change; the plan is not modified. */
export const proposeCoachChange = defineCommand({
  input: z.object({
    action: COACH_ACTION,
    /** The coach's own reason, in plain language (shown first). */
    reason: z.string().trim().min(1).max(500).optional(),
  }),
  async run(ctx, { action, reason }) {
    const { tx } = ctx;
    const [row] = await tx<{ id: string }[]>`
      insert into public.plan_revisions (key, source, status, summary, diff, coach)
      values (${`coach:${crypto.randomUUID()}`}, 'coach', 'proposed', '""'::jsonb, '[]'::jsonb,
        ${tx.json({ action, reason: reason ?? null } as unknown as JSONValue)})
      returning id`;
    const id = row!.id;
    let tried: Outcome;
    try {
      await tx.savepoint(async (sp) => {
        throw new DryRun(await perform({ ...ctx, tx: sp, push: () => {}, coachChangeId: id }, action));
      });
      throw new Error("unreachable");
    } catch (error) {
      if (!(error instanceof DryRun)) throw error;
      tried = error.outcome;
    }
    await tx`
      update public.plan_revisions
      set summary = ${texts(tx, tried.summary)}, reasons = ${texts(tx, reasonsFor(reason ?? null, tried))},
        diff = ${tx.json(tried.diff as unknown as JSONValue)}
      where id = ${id}`;
    return getPlanRevision.run(ctx, { id });
  },
});

/** Applies a proposed coach change (the owner approved it in chat): one applied revision with source coach. */
export const applyCoachChange = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run(ctx, { id }) {
    const { tx } = ctx;
    const [row] = await tx<{ status: string; coach: CoachData | null }[]>`
      select status, coach from public.plan_revisions where id = ${id} and parent_id is null for update`;
    if (!row?.coach) throw new CommandError("not_found", "No such proposed change");
    if (row.status !== "proposed") throw new CommandError("conflict", `That change is ${row.status}, not proposed`);
    const outcome = await perform({ ...ctx, coachChangeId: id }, row.coach.action);
    const reasons = reasonsFor(row.coach.reason, outcome);
    const coach: CoachData = { ...row.coach, inputs: outcome.inputs };
    await tx`
      update public.plan_revisions
      set status = 'applied', summary = ${texts(tx, outcome.summary)}, reasons = ${texts(tx, reasons)},
        diff = ${tx.json(outcome.diff as unknown as JSONValue)}, coach = ${tx.json(coach as unknown as JSONValue)},
        created_at = now(), updated_at = now()
      where id = ${id}`;
    await announceRevision(ctx, { id, status: "applied", summary: outcome.summary, reasons });
    return getPlanRevision.run(ctx, { id });
  },
});

/**
 * Undoes an applied coach change (called by `undoPlanRevision`): restores the
 * engine inputs it changed — where they still are as it left them — and
 * re-plans; what the engine changed with it is undone with it.
 */
export async function undoCoachChange(ctx: CommandContext, id: string, coach: CoachData): Promise<void> {
  const { tx } = ctx;
  await restoreInputs(tx, coach.inputs ?? {});
  await replan(tx, ctx.engine, ctx.push, ctx.now(), id);
  // Its engine changes are history now; the same change may be made (and recorded) again later.
  await tx`update public.plan_revisions set status = 'superseded', updated_at = now() where parent_id = ${id}`;
}

// ---- Performing an action ----

interface Outcome {
  summary: Message;
  diff: PlanDiffItem[];
  /** Summaries of the engine changes it caused. */
  engineChanges: Text[];
  inputs: InputChanges;
}

class DryRun extends Error {
  constructor(readonly outcome: Outcome) {
    super("dry run");
  }
}

/** Runs the action through its command (which re-plans) and reports what changed. `ctx.coachChangeId` must be set. */
async function perform(ctx: CommandContext, action: CoachAction): Promise<Outcome> {
  const { tx } = ctx;
  const [inputsBefore, planBefore] = [await loadInputs(tx), await loadPlan(tx)];
  const summary = await run(ctx, action);
  const [inputsAfter, planAfter] = [await loadInputs(tx), await loadPlan(tx)];
  const children = await tx<{ summary: Text }[]>`
    select summary from public.plan_revisions where parent_id = ${ctx.coachChangeId!} order by summary, key`;
  return {
    summary,
    diff: planDiff(planBefore, planAfter),
    engineChanges: children.map((c) => c.summary),
    inputs: inputChanges(inputsBefore, inputsAfter),
  };
}

/** Validates `input` with a command's own schema (so the coach can never pass what the PWA couldn't). */
function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new CommandError("invalid_input", "Invalid change", parsed.error.issues);
  return parsed.data;
}

/** Performs the action; returns its one-line summary. (Command schemas drop the action's `type`.) */
async function run(ctx: CommandContext, action: CoachAction): Promise<Message> {
  switch (action.type) {
    case "mark_unavailable": {
      const u = await markUnavailable.run(ctx, parse(markUnavailable.input, action));
      return { code: "coachUnavailable", from: u.startDate, to: u.endDate, note: u.note ?? null };
    }
    case "add_race": {
      const race = await createRace.run(ctx, parse(createRace.input, action));
      return { code: "coachNewRace", priority: race.priority, name: race.name, date: race.date };
    }
    case "update_race": {
      const current = (await loadRaces(ctx.tx)).find((r) => r.id === action.id);
      if (!current) throw new CommandError("not_found", "No such race");
      const changes = Object.fromEntries(Object.entries(action).filter(([, v]) => v !== undefined));
      const race = await updateRace.run(ctx, parse(updateRace.input, { ...current, ...changes }));
      return {
        code: "coachRaceUpdated",
        name: race.name,
        date: race.date !== current.date ? race.date : null,
        priority: race.priority !== current.priority ? race.priority : null,
        distanceMeters: race.distanceMeters !== current.distanceMeters ? race.distanceMeters : null,
        renamedFrom: race.name !== current.name ? current.name : null,
      };
    }
    case "import_run_plan": {
      const timeZone = action.timeZone ?? (await planTimeZone(ctx.tx));
      const { plan } = await importRunPlan.run(ctx, parse(importRunPlan.input, { ...action, timeZone }));
      return { code: "coachRunPlan", plan: plan.name, weeks: plan.weeks, race: plan.race?.name ?? null };
    }
  }
}

/** The coach's reason first, then what the engine changed, else what the plan gains or loses. */
function reasonsFor(reason: string | null, outcome: Outcome): Text[] {
  const reasons: Text[] = reason ? [reason] : [];
  if (outcome.engineChanges.length > 0) return [...reasons, ...outcome.engineChanges];
  return [...reasons, effect(outcome.diff)];
}

type EffectPart = Extract<Message, { code: "coachEffect" }>["parts"][number];

/** "12 planned runs added, 2 planned runs moved" — or that nothing on the plan changes. */
function effect(diff: PlanDiffItem[]): Message {
  const parts: EffectPart[] = [];
  const count = (what: EffectPart["what"], how: EffectPart["how"]) => {
    const part = parts.find((p) => p.what === what && p.how === how);
    if (part) part.count++;
    else parts.push({ what, how, count: 1 });
  };
  for (const item of diff) {
    const what = item.type === "run" ? "run" : "session";
    if (item.type === "exercise") count("targets", null);
    else if (!item.before) count(what, "added");
    else if (!item.after) count(what, "off");
    else count(what, item.before.date === item.after.date ? "changed" : "moved");
  }
  return { code: "coachEffect", parts };
}

// ---- Plan snapshots and diffs ----

interface PlanSnapshot {
  sessions: PlannedSession[];
  runs: PlannedRun[];
}

async function loadPlan(tx: TransactionSql): Promise<PlanSnapshot> {
  const rows = await tx<PlannedRow[]>`select ${plannedColumns(tx)} from public.planned_sessions order by date, name`;
  // As the engine plans them (no row id; `deload` only when set), so diffs read like engine diffs.
  const sessions = rows.map((row): PlannedSession => {
    const { blockId, blockSessionId, date, week, name, exercises, deload } = toPlanned(row);
    return { blockId, blockSessionId, date, week, name, exercises, ...(deload && { deload }) };
  });
  return { sessions, runs: await loadPlannedRuns(tx) };
}

/** What changed between two snapshots of the plan: sessions moved / added / dropped, targets changed, runs. */
export function planDiff(before: PlanSnapshot, after: PlanSnapshot): PlanDiffItem[] {
  const slot = (s: PlannedSession) => `${s.blockSessionId}|${s.date}`;
  const afterBySlot = new Map(after.sessions.map((s) => [slot(s), s]));
  const beforeSlots = new Set(before.sessions.map(slot));
  const removed = before.sessions.filter((s) => !afterBySlot.has(slot(s)));
  const added = after.sessions.filter((s) => !beforeSlots.has(slot(s)));

  const items: PlanDiffItem[] = [];
  for (const was of before.sessions) {
    const now = afterBySlot.get(slot(was));
    if (!now) continue;
    for (const exercise of now.exercises) {
      const previous = was.exercises.find((e) => e.blockExerciseId === exercise.blockExerciseId);
      if (previous && !sameJson(previous, exercise)) {
        items.push({
          type: "exercise",
          blockId: now.blockId,
          blockSessionId: now.blockSessionId,
          date: now.date,
          sessionName: now.name,
          blockExerciseId: exercise.blockExerciseId,
          before: previous,
          after: exercise,
        } satisfies ExerciseDiff);
      }
    }
  }
  // A session gone from one day and planned on another the same week moved.
  for (const was of removed) {
    const i = added.findIndex((s) => s.blockSessionId === was.blockSessionId && s.week === was.week);
    const now = i >= 0 ? added.splice(i, 1)[0]! : null;
    items.push(sessionItem(was, now));
  }
  for (const now of added) items.push(sessionItem(null, now));

  const runKey = (r: PlannedRun) => `${r.runPlanId}:${r.rowIndex}`;
  const runsBefore = new Map(before.runs.map((r) => [runKey(r), r]));
  const runsAfter = new Map(after.runs.map((r) => [runKey(r), r]));
  for (const key of new Set([...runsBefore.keys(), ...runsAfter.keys()])) {
    const was = runsBefore.get(key) ?? null;
    const now = runsAfter.get(key) ?? null;
    if (was && now && sameJson(was, now)) continue;
    const { runPlanId, rowIndex } = (now ?? was)!;
    items.push({ type: "run", runPlanId, rowIndex, before: was, after: now } satisfies RunDiff);
  }

  const date = (item: PlanDiffItem) => (item.type === "exercise" ? item.date : (item.before ?? item.after)!.date);
  return items.sort((a, b) => date(a).localeCompare(date(b)));
}

function sessionItem(before: PlannedSession | null, after: PlannedSession | null): SessionDiff {
  const { blockId, blockSessionId, name } = (before ?? after)!;
  return { type: "session", blockId, blockSessionId, sessionName: name, before, after };
}

// ---- Engine inputs: snapshot and restore ----

async function loadInputs(tx: TransactionSql): Promise<InputRows> {
  const entries = await Promise.all(
    INPUT_TABLES.map(async (table) => {
      const rows = await tx<{ row: Row }[]>`select to_jsonb(t) as row from ${tx(`public.${table}`)} t`;
      return [table, new Map(rows.map(({ row }) => [row.id, row]))] as const;
    }),
  );
  return Object.fromEntries(entries) as InputRows;
}

function inputChanges(before: InputRows, after: InputRows): InputChanges {
  const changes: InputChanges = {};
  for (const table of INPUT_TABLES) {
    const ids = new Set([...before[table].keys(), ...after[table].keys()]);
    const touched = [...ids]
      .map((id) => ({ id, before: before[table].get(id) ?? null, after: after[table].get(id) ?? null }))
      .filter((c) => !sameJson(c.before, c.after));
    if (touched.length > 0) changes[table] = touched;
  }
  return changes;
}

/** Puts every touched row back to `before` — only where it still is as the change left it (`after`). */
async function restoreInputs(tx: TransactionSql, changes: InputChanges): Promise<void> {
  const current = await loadInputs(tx);
  const untouchedSince = (table: InputTable, c: { id: string; after: Row | null }) =>
    sameJson(current[table].get(c.id) ?? null, c.after);
  // Rows it created go first, children before parents.
  for (const table of [...INPUT_TABLES].reverse()) {
    for (const c of changes[table] ?? []) {
      if (c.before === null && untouchedSince(table, c)) {
        await tx`delete from ${tx(`public.${table}`)} where id = ${c.id}`;
      }
    }
  }
  for (const table of INPUT_TABLES) {
    for (const c of changes[table] ?? []) {
      if (c.before === null || !untouchedSince(table, c)) continue;
      const record = tx`jsonb_populate_record(null::${tx(`public.${table}`)}, ${tx.json(c.before as JSONValue)})`;
      if (c.after === null) {
        await tx`insert into ${tx(`public.${table}`)} select * from ${record}`;
      } else {
        const columns = Object.keys(c.before).filter((k) => k !== "id");
        await tx`
          update ${tx(`public.${table}`)} set (${tx(columns)}) = (select ${tx(columns)} from ${record} r)
          where id = ${c.id}`;
      }
    }
  }
}
