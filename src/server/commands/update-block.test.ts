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
/** This week's Monday in Los Angeles. */
const thisMonday = () => {
  const today = todayInLA();
  const isoWeekday = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return addDays(today, 1 - isoWeekday);
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

/** Two leg days (Monday, Friday) and an upper day (Wednesday), one exercise each. */
async function splits(commands: Commands) {
  const [legPress, chestPress, legCurl] = await Promise.all([
    exerciseId(commands, "Leg Press"),
    exerciseId(commands, "Machine Bench Press"),
    exerciseId(commands, "Seated Leg Curl"),
  ]);
  const session = (name: string, weekday: number, id: string, startWeight: number) => ({
    name,
    weekday,
    exercises: [{ exerciseId: id, sets: 3, repRangeStart: 10, repRangeEnd: 15, startWeight }],
  });
  return {
    twoLegDays: [
      session("Lower A", 1, legPress, 270),
      session("Upper", 3, chestPress, 180),
      session("Lower B", 5, legCurl, 130),
    ],
    oneLegDay: [session("Lower", 4, legPress, 270), session("Upper", 3, chestPress, 180)],
  };
}

async function createBlock(commands: Commands, startDate: string, weeks: number, deloadWeeks: number[] = []) {
  const { twoLegDays } = await splits(commands);
  return commands.createBlock({ name: "Base", startDate, weeks, timeZone: LA, deloadWeeks, sessions: twoLegDays });
}

const dated = (sessions: { date: string; name: string }[]) => sessions.map((s) => `${s.date} ${s.name}`);

describe("updateBlock", () => {
  it("changes the split from this week on and leaves the weeks already trained as they were", async () => {
    const commands = await signedInOwner();
    const monday = thisMonday();
    const block = await createBlock(commands, addDays(monday, -14), 6, [5]);
    const trained = dated((await commands.getBlock({ id: block.id })).plannedSessions.filter((s) => s.date < monday));
    expect(trained.length).toBeGreaterThan(0);

    const { oneLegDay } = await splits(commands);
    const updated = await commands.updateBlock({ id: block.id, sessions: oneLegDay });

    // Continues as a new block: same name, from this week, the weeks that are left, the deload renumbered.
    expect(updated.id).not.toBe(block.id);
    expect(updated).toMatchObject({ name: "Base", draft: false, archived: false, startDate: monday, weeks: 4, deloadWeeks: [3] });
    expect(updated.sessions.map((s) => `${s.name} ${s.weekday}`)).toEqual(["Lower 4", "Upper 3"]);
    const { plannedSessions } = await commands.getBlock({ id: updated.id });
    expect(plannedSessions).toHaveLength(8); // Lower + Upper × 4 weeks
    expect(new Set(plannedSessions.map((s) => s.name))).toEqual(new Set(["Lower", "Upper"]));
    expect(plannedSessions.every((s) => s.date >= monday)).toBe(true);

    // The old block ends the day before and keeps exactly what was planned for the weeks already trained.
    const old = await commands.getBlock({ id: block.id });
    expect(old.block).toMatchObject({ archived: true, endDate: addDays(monday, -1) });
    expect(dated(old.plannedSessions)).toEqual(trained);
    expect((await commands.getBlock({})).block.id).toBe(updated.id);
  });

  it("from a later week keeps this week as planned", async () => {
    const commands = await signedInOwner();
    const monday = thisMonday();
    const block = await createBlock(commands, addDays(monday, -14), 6);
    const before = dated((await commands.getBlock({ id: block.id })).plannedSessions.filter((s) => s.date < addDays(monday, 7)));

    const { oneLegDay } = await splits(commands);
    const updated = await commands.updateBlock({ id: block.id, from: addDays(monday, 7), sessions: oneLegDay });

    expect(updated).toMatchObject({ startDate: addDays(monday, 7), weeks: 3 });
    const old = await commands.getBlock({ id: block.id });
    // Ended early, so "archived" as with a replaced block, but it still plans the rest of this week.
    expect(old.block).toMatchObject({ archived: true, endDate: addDays(monday, 6) });
    expect(dated(old.plannedSessions)).toEqual(before);
    expect(old.plannedSessions.some((s) => s.name === "Lower B" && s.date >= monday)).toBe(true);
    expect((await commands.getBlock({ id: updated.id })).plannedSessions.every((s) => s.date >= addDays(monday, 7))).toBe(true);
  });

  it("a block still in its first week is edited in place; name, notes, length and deloads can change too", async () => {
    const commands = await signedInOwner();
    const block = await createBlock(commands, thisMonday(), 3);

    const { oneLegDay } = await splits(commands);
    const updated = await commands.updateBlock({
      id: block.id,
      name: "Base, one leg day",
      notes: "Legs only on Thursday.",
      weeks: 4,
      deloadWeeks: [4],
      sessions: oneLegDay,
    });

    expect(updated).toMatchObject({
      id: block.id,
      name: "Base, one leg day",
      notes: "Legs only on Thursday.",
      weeks: 4,
      deloadWeeks: [4],
    });
    expect(updated.sessions.map((s) => s.name)).toEqual(["Lower", "Upper"]);
    expect((await commands.getBlock({ id: block.id })).plannedSessions).toHaveLength(8);
    expect((await commands.listBlocks({ archived: true })).blocks).toEqual([]);
  });

  it("refuses drafts, ended blocks, weeks already trained, off-week starts and a length with no weeks left", async () => {
    const commands = await signedInOwner();
    const monday = thisMonday();
    const { oneLegDay } = await splits(commands);
    const draft = await commands.draftBlock({
      name: "Later",
      startDate: "2030-01-07",
      weeks: 2,
      timeZone: LA,
      sessions: oneLegDay,
    });
    await expect(commands.updateBlock({ id: draft.id, sessions: oneLegDay })).rejects.toMatchObject({ code: "conflict" });

    const ended = await createBlock(commands, addDays(monday, -28), 2);
    await expect(commands.updateBlock({ id: ended.id, sessions: oneLegDay })).rejects.toMatchObject({ code: "conflict" });

    const running = await createBlock(commands, addDays(monday, -14), 6);
    for (const bad of [{ from: addDays(monday, -7) }, { from: addDays(monday, 1) }, { weeks: 2 }]) {
      await expect(commands.updateBlock({ id: running.id, sessions: oneLegDay, ...bad })).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    await expect(
      commands.updateBlock({ id: crypto.randomUUID(), sessions: oneLegDay }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await commands.getBlock({ id: running.id })).block).toMatchObject({ archived: false, weeks: 6 });
  });
});
