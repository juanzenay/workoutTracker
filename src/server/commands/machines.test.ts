import { describe, expect, it } from "vitest";
import { NO_GYM_KEY } from "@/domain/routine";
import type { WorkoutOpInput } from "@/domain/workout";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

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

const uuid = () => crypto.randomUUID();

/** One finished workout of a single exercise on `machineId` (null = none), with completed sets of `weights`. */
async function logWorkout(
  commands: Commands,
  exercise: string,
  machineId: string | null,
  startedAt: string,
  weights: number[],
  { finished = true }: { finished?: boolean } = {},
) {
  const workoutId = uuid();
  const workoutExerciseId = uuid();
  const ops: WorkoutOpInput[] = [
    { type: "startWorkout", id: workoutId, startedAt },
    { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId: exercise, position: 0 },
    ...(machineId ? [{ type: "setMachine" as const, id: workoutExerciseId, machineId }] : []),
    ...weights.map((weight, position) => ({
      type: "putSet" as const,
      id: uuid(),
      workoutExerciseId,
      position,
      setType: "normal" as const,
      weight,
      unit: "lb" as const,
      reps: 10,
      completed: true,
    })),
    ...(finished ? [{ type: "finishWorkout" as const, id: workoutId, finishedAt: startedAt }] : []),
  ];
  await commands.applyWorkoutOps({ ops });
  return { workoutId, workoutExerciseId };
}

describe("machines", () => {
  it("creates machines idempotently, unique per exercise ignoring case, and lists them", async () => {
    const commands = await signedInOwner();
    const row = await exerciseId(commands, "Seated Cable Rows");
    const bench = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const [a, b, c, d] = [uuid(), uuid(), uuid(), uuid()];

    await commands.applyWorkoutOps({
      ops: [
        { type: "createMachine", id: a, exerciseId: row, gymId: null, name: "Leverage Iso Low Row, Gym A" },
        // A replay, and the same name in other case, add nothing.
        { type: "createMachine", id: a, exerciseId: row, gymId: null, name: "Leverage Iso Low Row, Gym A" },
        { type: "createMachine", id: b, exerciseId: row, gymId: null, name: "  leverage iso low row, gym a " },
        { type: "createMachine", id: c, exerciseId: row, gymId: null, name: "Cable Row, Gym B" },
        // The same title under another exercise is its own machine.
        { type: "createMachine", id: d, exerciseId: bench, gymId: null, name: "Cable Row, Gym B" },
      ],
    });

    const { machines } = await commands.listMachines({});
    expect(machines).toEqual([
      { id: c, exerciseId: row, gymId: null, name: "Cable Row, Gym B", notes: null },
      { id: d, exerciseId: bench, gymId: null, name: "Cable Row, Gym B", notes: null },
      { id: a, exerciseId: row, gymId: null, name: "Leverage Iso Low Row, Gym A", notes: null },
    ]);
  });

  it("keeps a separate Previous per machine, and none-selected uses the no-machine history", async () => {
    const commands = await signedInOwner();
    const row = await exerciseId(commands, "Seated Cable Rows");
    const [gymA, gymB] = [uuid(), uuid()];
    await commands.applyWorkoutOps({
      ops: [
        { type: "createMachine", id: gymA, exerciseId: row, gymId: null, name: "Gym A" },
        { type: "createMachine", id: gymB, exerciseId: row, gymId: null, name: "Gym B" },
      ],
    });

    await logWorkout(commands, row, null, "2026-10-01T07:00:00Z", [100]);
    await logWorkout(commands, row, gymA, "2026-10-03T07:00:00Z", [120, 125]);
    await logWorkout(commands, row, gymA, "2026-10-08T07:00:00Z", [130]);
    await logWorkout(commands, row, gymB, "2026-10-05T07:00:00Z", [90]);
    // The workout in progress is not "previous", whatever machine it is on.
    await logWorkout(commands, row, gymB, "2026-10-11T07:00:00Z", [999], { finished: false });

    const { previous, previousByMachine, lastMachinesByGym } = await commands.getPreviousSets({});

    const weights = (sets: { weight: number | null }[] | undefined) => sets?.map((s) => s.weight);
    expect(weights(previous[row])).toEqual([100]);
    expect(weights(previousByMachine[gymA])).toEqual([130]);
    expect(weights(previousByMachine[gymB])).toEqual([90]);
    // The most recent finished workout was on Gym A.
    expect(lastMachinesByGym[NO_GYM_KEY]![row]).toBe(gymA);
  });

  it("remembers that an exercise was last done with no machine", async () => {
    const commands = await signedInOwner();
    const row = await exerciseId(commands, "Seated Cable Rows");
    const gymA = uuid();
    await commands.applyWorkoutOps({ ops: [{ type: "createMachine", id: gymA, exerciseId: row, gymId: null, name: "Gym A" }] });

    await logWorkout(commands, row, gymA, "2026-10-01T07:00:00Z", [120]);
    await logWorkout(commands, row, null, "2026-10-08T07:00:00Z", [100]);

    expect((await commands.getPreviousSets({ exerciseIds: [row] })).lastMachinesByGym).toEqual({ [NO_GYM_KEY]: { [row]: null } });
  });

  it("clears the machine when the exercise is swapped, and ignores a machine of another exercise", async () => {
    const commands = await signedInOwner();
    const row = await exerciseId(commands, "Seated Cable Rows");
    const bench = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const gymA = uuid();
    await commands.applyWorkoutOps({ ops: [{ type: "createMachine", id: gymA, exerciseId: row, gymId: null, name: "Gym A" }] });

    const { workoutId, workoutExerciseId } = await logWorkout(commands, row, gymA, "2026-10-01T07:00:00Z", [120], {
      finished: false,
    });
    const machineOf = async () => {
      const [r] = await db().sql<{ machine_id: string | null }[]>`
        select machine_id from public.workout_exercises where id = ${workoutExerciseId}`;
      return r!.machine_id;
    };
    expect(await machineOf()).toBe(gymA);

    await commands.applyWorkoutOps({ ops: [{ type: "swapExercise", id: workoutExerciseId, exerciseId: bench }] });
    expect(await machineOf()).toBeNull();

    // Gym A belongs to the row, so the bench ignores it; an unknown machine leaves none too.
    await commands.applyWorkoutOps({ ops: [{ type: "setMachine", id: workoutExerciseId, machineId: gymA }] });
    expect(await machineOf()).toBeNull();
    await commands.applyWorkoutOps({ ops: [{ type: "setMachine", id: workoutExerciseId, machineId: uuid() }] });
    expect(await machineOf()).toBeNull();

    // Replaying the whole outbox converges on the same state.
    const replay: WorkoutOpInput[] = [
      { type: "createMachine", id: gymA, exerciseId: row, gymId: null, name: "Gym A" },
      { type: "finishWorkout", id: workoutId, finishedAt: "2026-10-01T08:00:00Z" },
    ];
    await commands.applyWorkoutOps({ ops: replay });
    await commands.applyWorkoutOps({ ops: replay });
    expect((await commands.listMachines({})).machines).toHaveLength(1);
  });

  it("keeps a machine's notes with the machine, and blank clears them", async () => {
    const commands = await signedInOwner();
    const row = await exerciseId(commands, "Seated Cable Rows");
    const gymA = uuid();
    await commands.applyWorkoutOps({
      ops: [
        { type: "createMachine", id: gymA, exerciseId: row, gymId: null, name: "Gym A" },
        { type: "setMachineNotes", id: gymA, notes: "Seat 3, chest pad 2, handles wide" },
      ],
    });
    expect((await commands.listMachines({})).machines[0]!.notes).toBe("Seat 3, chest pad 2, handles wide");

    await commands.applyWorkoutOps({ ops: [{ type: "setMachineNotes", id: gymA, notes: "  " }] });
    expect((await commands.listMachines({})).machines[0]!.notes).toBeNull();
  });

  it("keeps machines per gym, remembers each gym's last machine, and starts at the last gym", async () => {
    const commands = await signedInOwner();
    const row = await exerciseId(commands, "Seated Cable Rows");
    const [home, planet, homeRow, planetRow] = [uuid(), uuid(), uuid(), uuid()];
    await commands.applyWorkoutOps({
      ops: [
        { type: "createGym", id: home, name: "Home Gym" },
        // The same name again, in other case, adds nothing.
        { type: "createGym", id: uuid(), name: "  home gym " },
        { type: "createGym", id: planet, name: "Planet Fitness" },
        // The same machine name at two gyms is two machines; twice at one is one.
        { type: "createMachine", id: homeRow, exerciseId: row, gymId: home, name: "Cable Row" },
        { type: "createMachine", id: planetRow, exerciseId: row, gymId: planet, name: "Cable Row" },
        { type: "createMachine", id: uuid(), exerciseId: row, gymId: planet, name: "cable row" },
      ],
    });
    const { gyms } = await commands.listGyms({});
    expect(gyms.map((g) => g.name)).toEqual(["Home Gym", "Planet Fitness"]);
    expect((await commands.listMachines({})).machines.map((m) => [m.gymId, m.name])).toEqual([
      [home, "Cable Row"],
      [planet, "Cable Row"],
    ]);

    const atGym = async (gymId: string | null, machineId: string | null, startedAt: string) => {
      const { workoutId } = await logWorkout(commands, row, machineId, startedAt, [100], { finished: false });
      await commands.applyWorkoutOps({
        ops: [
          { type: "setGym", id: workoutId, gymId },
          { type: "finishWorkout", id: workoutId, finishedAt: startedAt },
        ],
      });
    };
    await atGym(home, homeRow, "2026-10-01T07:00:00Z");
    await atGym(planet, planetRow, "2026-10-08T07:00:00Z");

    const { lastMachinesByGym } = await commands.getPreviousSets({});
    expect(lastMachinesByGym).toEqual({ [home]: { [row]: homeRow }, [planet]: { [row]: planetRow } });
    // New workouts start at the gym used last.
    expect((await commands.listGyms({})).lastGymId).toBe(planet);
  });

  it("leaves a workout with no gym when the gym does not exist", async () => {
    const commands = await signedInOwner();
    const row = await exerciseId(commands, "Seated Cable Rows");
    const { workoutId } = await logWorkout(commands, row, null, "2026-10-01T07:00:00Z", [100], { finished: false });
    await commands.applyWorkoutOps({ ops: [{ type: "setGym", id: workoutId, gymId: uuid() }] });
    const [w] = await db().sql<{ gym_id: string | null }[]>`select gym_id from public.workouts where id = ${workoutId}`;
    expect(w!.gym_id).toBeNull();
  });
});
