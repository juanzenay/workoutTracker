import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

const LA = "America/Los_Angeles";
const todayInLA = () => new Intl.DateTimeFormat("en-CA", { timeZone: LA }).format(new Date());
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

async function exerciseId(commands: Commands, name: string) {
  const { items } = await commands.listExercises({ query: name });
  const exercise = items.find((e) => e.name === name);
  if (!exercise) throw new Error(`No catalogue exercise ${name}`);
  return exercise.id;
}

/** The next block the coach drafts: a 5-week upper/lower with a set ramp, RIR-informed legs and a week-5 deload. */
async function nextBlockDraft(commands: Commands, startDate = "2030-01-07") {
  const [legPress, chestPress] = await Promise.all([
    exerciseId(commands, "Leg Press"),
    exerciseId(commands, "Machine Bench Press"),
  ]);
  return {
    name: "Hypertrophy C",
    startDate,
    weeks: 5,
    timeZone: LA,
    deloadWeeks: [5],
    notes: "Built from your last 8 weeks: legs stalled at 270, so RIR-informed there.",
    sessions: [
      {
        name: "Lower",
        weekday: 1,
        exercises: [
          {
            exerciseId: legPress,
            sets: 3,
            repRangeStart: 10,
            repRangeEnd: 15,
            startWeight: 270,
            rule: "rir" as const,
          },
        ],
      },
      {
        name: "Upper",
        weekday: 3,
        exercises: [
          {
            exerciseId: chestPress,
            sets: 2,
            repRangeStart: 8,
            repRangeEnd: 12,
            startWeight: 180,
            rule: "ramp" as const,
            rampTo: 4,
          },
        ],
      },
    ],
  };
}

describe("draft blocks", () => {
  it("a draft block keeps its split, exercises, progression rules, length and deloads, and plans no sessions", async () => {
    const commands = await signedInOwner();
    const draft = await commands.draftBlock(await nextBlockDraft(commands));

    expect(draft).toMatchObject({
      name: "Hypertrophy C",
      startDate: "2030-01-07",
      weeks: 5,
      deloadWeeks: [5],
      draft: true,
      archived: false,
      notes: "Built from your last 8 weeks: legs stalled at 270, so RIR-informed there.",
      sessions: [
        {
          name: "Lower",
          weekday: 1,
          exercises: [{ name: "Leg Press", rule: "rir", startWeight: 270 }],
        },
        {
          name: "Upper",
          weekday: 3,
          exercises: [{ name: "Machine Bench Press", rule: "ramp", sets: 2, rampTo: 4 }],
        },
      ],
    });
    expect((await commands.getBlock({ id: draft.id })).plannedSessions).toEqual([]);
    expect((await commands.listBlocks({})).blocks.map((b) => [b.name, b.draft])).toEqual([["Hypertrophy C", true]]);
    expect(
      (await commands.getCalendar({ from: "2030-01-07", to: "2030-01-13" })).days.flatMap((d) => d.sessions),
    ).toEqual([]);
  });

  it("the owner edits a draft with the block designer; it still plans nothing", async () => {
    const commands = await signedInOwner();
    const input = await nextBlockDraft(commands);
    const draft = await commands.draftBlock(input);

    const edited = await commands.updateDraftBlock({
      ...input,
      id: draft.id,
      name: "Hypertrophy C (mine)",
      weeks: 6,
      deloadWeeks: [4, 6],
      sessions: [input.sessions[1]!, { ...input.sessions[0]!, name: "Lower Body A", weekday: 2 }],
    });

    expect(edited).toMatchObject({
      id: draft.id,
      name: "Hypertrophy C (mine)",
      weeks: 6,
      deloadWeeks: [4, 6],
      draft: true,
      sessions: [
        {
          name: "Upper",
          weekday: 3,
          exercises: [{ name: "Machine Bench Press", rule: "ramp" }],
        },
        {
          name: "Lower Body A",
          weekday: 2,
          exercises: [{ name: "Leg Press", rule: "rir" }],
        },
      ],
    });
    expect((await commands.getBlock({ id: draft.id })).plannedSessions).toEqual([]);
  });

  it("only drafts can be edited or discarded", async () => {
    const commands = await signedInOwner();
    const input = await nextBlockDraft(commands);
    const started = await commands.createBlock(input);

    await expect(commands.updateDraftBlock({ ...input, id: started.id })).rejects.toMatchObject({ code: "conflict" });
    await expect(commands.deleteDraftBlock({ id: started.id })).rejects.toMatchObject({ code: "conflict" });
    await expect(commands.updateDraftBlock({ ...input, id: crypto.randomUUID() })).rejects.toMatchObject({
      code: "not_found",
    });

    const draft = await commands.draftBlock(input);
    await commands.deleteDraftBlock({ id: draft.id });
    expect((await commands.listBlocks({})).blocks.map((b) => b.id)).toEqual([started.id]);
  });
});

describe("starting a draft", () => {
  /** The block running today: started 10 days ago, 4 weeks, a session every day. */
  async function currentBlock(commands: Commands) {
    const legPress = await exerciseId(commands, "Leg Press");
    return commands.createBlock({
      name: "Current",
      startDate: addDays(todayInLA(), -10),
      weeks: 4,
      timeZone: LA,
      sessions: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        name: `Day ${weekday}`,
        weekday,
        exercises: [
          {
            exerciseId: legPress,
            sets: 3,
            repRangeStart: 10,
            repRangeEnd: 15,
            startWeight: 270,
          },
        ],
      })),
    });
  }

  it("archives the current block and plans the draft's sessions through the engine", async () => {
    const commands = await signedInOwner();
    const today = todayInLA();
    const current = await currentBlock(commands);
    const draft = await commands.draftBlock(await nextBlockDraft(commands, addDays(today, 3)));

    const started = await commands.startBlock({ id: draft.id });

    expect(started).toMatchObject({
      id: draft.id,
      draft: false,
      archived: false,
      startDate: addDays(today, 3),
    });
    const { plannedSessions } = await commands.getBlock({ id: draft.id });
    expect(plannedSessions).toHaveLength(10); // Lower + Upper × 5 weeks
    expect(plannedSessions.every((s) => s.date >= addDays(today, 3))).toBe(true);
    expect(plannedSessions.filter((s) => s.deload).map((s) => s.week)).toEqual([5, 5]);
    expect(plannedSessions.find((s) => s.name === "Upper")).toMatchObject({
      exercises: [{ name: "Machine Bench Press", sets: [{ weight: 180, reps: 8 }, {}] }],
    });

    // The block it replaces is archived and plans nothing past the day before the draft starts.
    const old = await commands.getBlock({ id: current.id });
    expect(old.block).toMatchObject({
      archived: true,
      endDate: addDays(today, 2),
    });
    expect(old.plannedSessions.map((s) => s.date)).toEqual(
      Array.from({ length: 13 }, (_, i) => addDays(today, i - 10)),
    );
    expect((await commands.listBlocks({ archived: true })).blocks.map((b) => b.name)).toEqual(["Current"]);
    expect((await commands.getBlock({})).block.id).toBe(draft.id);
    expect((await commands.getToday({ date: addDays(today, 2) })).session).toMatchObject({
      name: expect.stringMatching(/^Day/),
    });
    expect((await commands.getToday({ date: addDays(today, 3) })).block).toMatchObject({ name: "Hypertrophy C" });
  });

  it("a draft whose start date has passed starts today; a started block can't be started again", async () => {
    const commands = await signedInOwner();
    const draft = await commands.draftBlock(await nextBlockDraft(commands, "2020-01-06"));

    expect(await commands.startBlock({ id: draft.id })).toMatchObject({
      startDate: todayInLA(),
      draft: false,
    });
    await expect(commands.startBlock({ id: draft.id })).rejects.toMatchObject({
      code: "conflict",
    });
  });
});
