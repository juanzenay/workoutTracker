import { z } from "zod";
import type { PlanDiffItem, PlanRevision } from "@/domain/plan-change";
import { corosWorkout, withWholeSecondPaces } from "@/domain/running";
import { getStrings } from "@/strings";
import type { Commands } from "../commands";
import { BLOCK_INPUT, updateBlock } from "../commands/blocks";
import { COACH_ACTION } from "../commands/coach";

/**
 * One MCP tool: a thin adapter that calls the command layer. Tools never touch
 * the database themselves; the command layer validates input again and
 * enforces RLS. Write tools set `readOnly: false` and go through the coach
 * commands (../commands/coach.ts): propose, apply on approval, undo.
 */
export interface McpTool<Input extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  /** What Claude reads to decide when and how to call the tool. */
  description: string;
  input: Input;
  readOnly: boolean;
  /** Returns the tool's structured result (a JSON object). CommandErrors become tool errors. */
  run(commands: Commands, input: z.output<Input>): Promise<Record<string, unknown>>;
}

export function defineTool<Input extends z.ZodObject>(tool: McpTool<Input>): McpTool {
  return tool as unknown as McpTool;
}

const isoDate = z.iso.date();

export const getCalendarTool = defineTool({
  name: "get_calendar",
  title: "Get calendar",
  description:
    "The owner's training calendar, day by day: planned lifting sessions (exercises with target sets, reps and loads, " +
    "status completed | missed | planned) and planned runs (type, distance in meters, duration in seconds, pace targets in " +
    "seconds per km rounded to whole seconds, structure with warm-up / repeats / cool-down ready to become a Coros structured " +
    "workout; status done | partial | missed (from Strava or imported run files; gapMeters on partial) | planned | rest | not_recorded), plus the workouts logged each day. " +
    "Each run's `corosWorkout` lists its Coros structured-workout sections in order (warmup / training / recovery / cooldown, " +
    "repeat groups with a count; target distanceMeters | durationSeconds | open; intensity pace in whole seconds per km, " +
    "hr_zone, hr bpm or pct_threshold_pace); null on rest and cross-training days. Defaults to today and the next 13 days; " +
    "at most 92 days per call. Dates are YYYY-MM-DD in the plan's time zone.",
  input: z.object({
    from: isoDate.optional().describe("First day (YYYY-MM-DD). Default: today."),
    to: isoDate.optional().describe("Last day, inclusive (YYYY-MM-DD). Default: 13 days after `from`."),
  }),
  readOnly: true,
  async run(commands, input) {
    const calendar = await commands.getCalendar(input);
    return {
      ...calendar,
      days: calendar.days.map((day) => ({
        ...day,
        runs: day.runs.map((run) => ({ ...withWholeSecondPaces(run), corosWorkout: corosWorkout(run) })),
      })),
    };
  },
});

export const getTrainingLoadTool = defineTool({
  name: "get_training_load",
  title: "Get training load",
  description:
    "Weekly training load (Monday–Sunday), oldest week first: lifting done (finished workouts, working sets, volume in lb, " +
    "working sets per primary muscle, planned sessions and how many were completed), lifting planned (volume in lb), and " +
    "running planned (runs, distance in meters, duration in seconds) and run (completed runs, Strava or imported: count, distance in meters, moving time in seconds).",
  input: z.object({
    weeks: z.number().int().min(1).max(52).optional().describe("How many weeks (default 8)."),
    through: isoDate.optional().describe("A day in the last week to include (YYYY-MM-DD). Default: today."),
  }),
  readOnly: true,
  run: (commands, input) => commands.getTrainingLoad(input),
});

export const getExerciseHistoryTool = defineTool({
  name: "get_exercise_history",
  title: "Get exercise history",
  description:
    "Lifting history. Without `exerciseId`: every exercise the owner has logged, with its id and personal bests. " +
    "With `exerciseId`: that exercise's sessions oldest first (estimated 1RM, best set, volume, sets) and its bests.",
  input: z.object({
    exerciseId: z.uuid().optional().describe("An exercise id from the list this tool returns without arguments."),
  }),
  readOnly: true,
  async run(commands, { exerciseId }) {
    if (exerciseId) return commands.getExerciseHistory({ exerciseId });
    const { items } = await commands.listRecords({});
    return { exercises: items };
  },
});

export const getBlockTool = defineTool({
  name: "get_block",
  title: "Get block",
  description:
    "A lifting block (mesocycle): its weekly sessions with exercises, rep ranges, progression rules and deload weeks, and " +
    "every dated planned session with targets and the reason for each load. Without `id`: the block running today, else " +
    "the next one, else the most recent one.",
  input: z.object({ id: z.uuid().optional().describe("Block id (default: the current block).") }),
  readOnly: true,
  run: (commands, input) => commands.getBlock(input),
});

export const listRacesTool = defineTool({
  name: "list_races",
  title: "List races",
  description:
    "Every race (name, date, distance in meters, priority A/B/C), soonest first, and the run plans with the race each " +
    "is anchored to and their first and last dates.",
  input: z.object({}),
  readOnly: true,
  async run(commands) {
    const [{ races }, { plans }] = await Promise.all([commands.listRaces({}), commands.listRunPlans({})]);
    return { races, runPlans: plans };
  },
});

// ---- Coach write tools: propose (nothing changes) → the owner approves in chat → apply; undo any time ----

const MAX_EFFECTS = 40;

/** One planned item a change touches: a session or run moved (from → to), added (from null) or off the plan (to null). */
function effect(item: PlanDiffItem) {
  if (item.type === "exercise") return { what: `${item.after.name} (${item.sessionName})`, date: item.date, change: "targets" };
  const what = item.type === "run" ? getStrings().running.runTypes[(item.before ?? item.after)!.type] : item.sessionName;
  return { what, from: item.before?.date ?? null, to: item.after?.date ?? null };
}

const NEXT_STEP: Partial<Record<PlanRevision["status"], string>> = {
  proposed:
    "Nothing has changed yet. Tell the owner the summary, reasons and effects; call apply_change with this changeId only " +
    "after they approve in chat.",
  applied: "Applied: it shows in workout tracker as a \"Plan updated\" card the owner can undo; undo_change with this changeId takes it back.",
};

function changeResult(revision: PlanRevision): Record<string, unknown> {
  const effects = revision.diff.map(effect);
  return {
    changeId: revision.id,
    source: revision.source,
    status: revision.status,
    summary: revision.summary,
    reasons: revision.reasons,
    effects: effects.slice(0, MAX_EFFECTS),
    ...(effects.length > MAX_EFFECTS && { moreEffects: effects.length - MAX_EFFECTS }),
    ...(NEXT_STEP[revision.status] && { next: NEXT_STEP[revision.status] }),
  };
}

const reason = z
  .string()
  .max(500)
  .optional()
  .describe("Why, in one plain sentence for the owner (shown first on the change).");

const PROPOSES =
  " Only proposes: returns a change (summary, reasons, effects on the plan) and changes nothing until apply_change is " +
  "called with its changeId after the owner approves in chat.";

const [unavailableAction, addRaceAction, updateRaceAction, importPlanAction] = COACH_ACTION.options;

export const markUnavailableTool = defineTool({
  name: "mark_unavailable",
  title: "Mark unavailable",
  description:
    "Marks days the owner can't train (sick, travelling, busy): inclusive YYYY-MM-DD range in the plan's time zone. " +
    "The engine re-plans around them: sessions move to free days that week or drop, runs come off, long runs move or drop." +
    PROPOSES,
  input: unavailableAction.omit({ type: true }).extend({ reason }),
  readOnly: false,
  async run(commands, { reason, ...input }) {
    return changeResult(await commands.proposeCoachChange({ action: { type: "mark_unavailable", ...input }, reason }));
  },
});

export const addRaceTool = defineTool({
  name: "add_race",
  title: "Add race",
  description:
    "Adds a race: name, date (YYYY-MM-DD), distance in meters (marathon 42195, half 21097), priority A (goal race: the " +
    "run plan anchors to it, deloads line up with it), B or C." + PROPOSES,
  input: addRaceAction.omit({ type: true }).extend({ reason }),
  readOnly: false,
  async run(commands, { reason, ...input }) {
    return changeResult(await commands.proposeCoachChange({ action: { type: "add_race", ...input }, reason }));
  },
});

export const updateRaceTool = defineTool({
  name: "update_race",
  title: "Update race",
  description:
    "Changes a race (id from list_races): any of name, date, distance in meters, priority. Moving an A race re-anchors its " +
    "run plan." + PROPOSES,
  input: updateRaceAction.omit({ type: true }).extend({ reason }),
  readOnly: false,
  async run(commands, { reason, ...input }) {
    return changeResult(await commands.proposeCoachChange({ action: { type: "update_race", ...input }, reason }));
  },
});

export const importPlanTool = defineTool({
  name: "import_plan",
  title: "Import run plan",
  description:
    "Imports a run plan in the same format as workout tracker's file import, anchored so its last week is the race's week (`raceId`, " +
    "default: the next A race; replaces that race's current plan). JSON: {\"name\", \"runs\": [row, …]}; CSV: a header " +
    "row. Row: week, day (mon..sun), type (easy | long | tempo | intervals | race_pace | cross | rest | race), distance_m | " +
    "distance_km | distance_mi or duration_s | duration_min, optional pace (\"8:30/mi\", \"8:20-8:40/mi\", \"5:10/km\"), " +
    "optional structure (JSON: warmup / main / repeats [{count, steps: [{kind: work|recovery, distance_m | duration_s, " +
    "intensity}]}] / cooldown; intensity {kind: pace, pace} | {kind: hr_zone, zone} | {kind: hr, bpm: [lo, hi]} | " +
    "{kind: pct_threshold_pace, pct: [lo, hi]}), notes. Write out every week of the plan; workout tracker never bundles plans. " +
    "timeZone defaults to the plan's." + PROPOSES,
  input: importPlanAction.omit({ type: true }).extend({ reason }),
  readOnly: false,
  async run(commands, { reason, ...input }) {
    return changeResult(await commands.proposeCoachChange({ action: { type: "import_run_plan", ...input }, reason }));
  },
});

export const proposeChangeTool = defineTool({
  name: "propose_change",
  title: "Propose change",
  description:
    "Proposes any coach change as `action` (type mark_unavailable | add_race | update_race | import_run_plan, with the " +
    "same fields as the tool of that name)." + PROPOSES,
  input: z.object({ action: COACH_ACTION, reason }),
  readOnly: false,
  async run(commands, input) {
    return changeResult(await commands.proposeCoachChange(input));
  },
});

const changeId = z.uuid().describe("The changeId a propose tool returned.");

export const applyChangeTool = defineTool({
  name: "apply_change",
  title: "Apply change",
  description:
    "Applies a proposed change. Call only after the owner has approved that exact change in chat. It goes through the " +
    "engine and shows in workout tracker as a \"Plan updated\" card from the coach, undoable there or with undo_change.",
  input: z.object({ changeId }),
  readOnly: false,
  async run(commands, { changeId }) {
    return changeResult(await commands.applyCoachChange({ id: changeId }));
  },
});

export const undoChangeTool = defineTool({
  name: "undo_change",
  title: "Undo change",
  description:
    "Undoes an applied plan change (a coach change from apply_change, or any applied change the owner names): the plan " +
    "goes back as it was, except what has changed since.",
  input: z.object({ changeId: z.uuid().describe("The changeId of an applied change.") }),
  readOnly: false,
  async run(commands, { changeId }) {
    return changeResult(await commands.undoPlanRevision({ id: changeId }));
  },
});

export const draftBlockTool = defineTool({
  name: "draft_block",
  title: "Draft block",
  description:
    "Drafts the owner's next lifting block (mesocycle) for them to review in workout tracker: it is saved as a draft, shown in workout tracker's " +
    "block designer where the owner edits it, and plans nothing until the owner starts it there (starting it archives the " +
    "current block). Base it on get_exercise_history, get_block and get_training_load. Fields: name, startDate (YYYY-MM-DD, " +
    "a Monday is usual), weeks (1-52), deloadWeeks (1-based weeks that are deloads, e.g. the last week, or lined up with a " +
    "taper or race week), sessions (the split: name, weekday 1 = Monday ... 7 = Sunday, exercises in order: exerciseId from " +
    "get_exercise_history, working sets, repRangeStart-repRangeEnd, startWeight and unit (lb default) when there is no " +
    "history, increment, progression rule double (default: add load once every set hits the top of the range) | rir " +
    "(RIR-informed: hold or back off when sets are grinders) | ramp (sets climb from `sets` to rampTo across the block)), " +
    "and notes: why the block looks like this, in plain language for the owner. timeZone defaults to the plan's. Pass `id` " +
    "(a draft this tool returned) to revise that draft instead of making a new one.",
  input: BLOCK_INPUT.extend({
    id: z.uuid().optional().describe("A draft block's id to revise instead of drafting a new one."),
    timeZone: z.string().optional().describe("IANA time zone (default: the plan's)."),
  }),
  readOnly: false,
  async run(commands, { id, ...input }) {
    const block = id ? await commands.updateDraftBlock({ id, ...input }) : await commands.draftBlock(input);
    return {
      block,
      next:
        "Saved as a draft in workout tracker: nothing on the plan has changed. Tell the owner to review it in workout tracker (Blocks), edit it " +
        "there if they want, and start it when ready; draft_block with this id revises it.",
    };
  },
});

export const updateBlockTool = defineTool({
  name: "update_block",
  title: "Update running block",
  description:
    "Edits the owner's running (or upcoming) lifting block in place: no draft to review and start, the calendar " +
    "re-plans at once. Call only when the owner has asked for the change. `sessions` is the whole weekly split from " +
    "`from` on, in the same shape as draft_block (name, weekday 1 = Monday ... 7 = Sunday, exercises in order): " +
    "start from get_block, change what the owner asked for, and send every session that stays as well as the new or " +
    "moved ones; a session left out is dropped. `from` is a week start of the block (its start date plus whole " +
    "weeks), this week's or later; default this week's. Weeks already trained keep their plan: the block ends the " +
    "day before `from` and continues, under the same name unless `name` is given, with the new split. Optional: " +
    "`weeks` (the block's total length, as originally numbered), `deloadWeeks` (1-based, original numbering; " +
    "default unchanged) and `notes`. Progression carries over from workout history. Drafts are revised with " +
    "draft_block instead. To change one day only (a missed session, travel), use mark_unavailable.",
  input: updateBlock.input,
  readOnly: false,
  async run(commands, input) {
    const block = await commands.updateBlock(input);
    return {
      block,
      next: "Saved: the calendar in workout tracker already shows the new split from " + block.startDate + ".",
    };
  },
});

/** Every tool the workout tracker MCP server serves. Add new tools here. */
export const TOOLS: McpTool[] = [
  getCalendarTool,
  getTrainingLoadTool,
  getExerciseHistoryTool,
  getBlockTool,
  listRacesTool,
  markUnavailableTool,
  addRaceTool,
  updateRaceTool,
  importPlanTool,
  proposeChangeTool,
  applyChangeTool,
  undoChangeTool,
  draftBlockTool,
  updateBlockTool,
];
