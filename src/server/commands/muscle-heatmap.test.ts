import { describe, expect, it } from "vitest";
import { MUSCLE_DETAILS } from "@/domain/muscle-detail";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>;

type LoggedSet = { weight: number | null; reps: number; setType?: "normal" | "warmup"; completed?: boolean };

async function logWorkout(commands: Commands, exerciseId: string, startedAt: string, sets: LoggedSet[], finished = true) {
  const workoutId = crypto.randomUUID();
  const workoutExerciseId = crypto.randomUUID();
  await commands.applyWorkoutOps({
    ops: [
      { type: "startWorkout", id: workoutId, startedAt },
      { type: "addExercise", id: workoutExerciseId, workoutId, exerciseId, position: 0 },
      ...sets.map((set, position) => ({
        type: "putSet" as const,
        id: crypto.randomUUID(),
        workoutExerciseId,
        position,
        setType: set.setType ?? "normal",
        weight: set.weight,
        unit: "lb" as const,
        reps: set.reps,
        completed: set.completed ?? true,
      })),
      ...(finished ? [{ type: "finishWorkout" as const, id: workoutId, finishedAt: startedAt }] : []),
    ],
  });
}

async function customExercise(commands: Commands, name: string, primaryMuscles: string[], secondaryMuscles: string[] = []) {
  const exercise = await commands.createCustomExercise({
    name,
    primaryMuscles: primaryMuscles as never,
    secondaryMuscles: secondaryMuscles as never,
    equipment: "barbell",
  });
  return exercise.id;
}

describe("muscle heatmap", () => {
  it("counts working sets per muscle over the window: a primary muscle a full set, a secondary one half", async () => {
    const commands = await signedInOwner();
    const bench = await customExercise(commands, "Test Bench", ["chest"], ["triceps", "shoulders"]);
    const squat = await customExercise(commands, "Test Squat", ["quadriceps"], ["glutes"]);

    // Inside the 7 days ending Sun 2026-03-08 (Mon 03-02 … Sun 03-08, UTC: no plan yet).
    await logWorkout(commands, bench, "2026-03-02T10:00:00Z", [
      { weight: 45, reps: 10, setType: "warmup" },
      { weight: 185, reps: 8 },
      { weight: 185, reps: 8 },
      { weight: 185, reps: 6, completed: false },
    ]);
    await logWorkout(commands, squat, "2026-03-08T23:00:00Z", [
      { weight: 225, reps: 5 },
      { weight: 225, reps: 5 },
      { weight: 225, reps: 5 },
    ]);
    // Outside the window: the day before it, and a workout still in progress.
    await logWorkout(commands, bench, "2026-03-01T10:00:00Z", [{ weight: 185, reps: 8 }]);
    await logWorkout(commands, squat, "2026-03-07T10:00:00Z", [{ weight: 225, reps: 5 }], false);

    const heatmap = await commands.getMuscleHeatmap({ days: 7, through: "2026-03-08" });

    expect(heatmap).toMatchObject({ from: "2026-03-02", through: "2026-03-08", days: 7 });
    const byMuscle = Object.fromEntries(heatmap.muscles.map((m) => [m.muscle, m]));
    expect(byMuscle.chest).toEqual({ muscle: "chest", primarySets: 2, secondarySets: 0, sets: 2, weeklySets: 2, level: 1 });
    expect(byMuscle.triceps).toEqual({ muscle: "triceps", primarySets: 0, secondarySets: 2, sets: 1, weeklySets: 1, level: 1 });
    expect(byMuscle.shoulders).toMatchObject({ sets: 1 });
    expect(byMuscle.quadriceps).toMatchObject({ primarySets: 3, sets: 3 });
    expect(byMuscle.glutes).toMatchObject({ secondarySets: 3, sets: 1.5 });
    expect(heatmap).toMatchObject({ weeklyTarget: 15, windowTarget: 15 });
  });

  it("grades each muscle 0 (untrained) to 4 (the 15-a-week target) for shading, whatever the other muscles did", async () => {
    const commands = await signedInOwner();
    const bench = await customExercise(commands, "Test Bench", ["chest"], ["triceps"]);
    const curl = await customExercise(commands, "Test Curl", ["biceps"]);
    await logWorkout(commands, bench, "2026-03-05T10:00:00Z", Array(8).fill({ weight: 185, reps: 8 }));
    await logWorkout(commands, curl, "2026-03-05T11:00:00Z", [{ weight: 30, reps: 12 }]);

    const heatmap = await commands.getMuscleHeatmap({ days: 7, through: "2026-03-08" });

    const level = Object.fromEntries(heatmap.muscles.map((m) => [m.muscle, m.level]));
    // Over 7 days against 15 a week: chest 8 sets (2.1 quarters), triceps 4 (1.1), biceps 1 (still visible), calves none.
    expect([level.chest, level.triceps, level.biceps, level.calves]).toEqual([3, 2, 1, 0]);
  });

  it("shades against the weekly target, not the most-trained muscle, and scales to the window", async () => {
    const commands = await signedInOwner();
    const curl = await customExercise(commands, "Test Curl", ["biceps"]);
    await logWorkout(commands, curl, "2026-03-05T11:00:00Z", Array(2).fill({ weight: 30, reps: 12 }));

    const week = await commands.getMuscleHeatmap({ days: 7, through: "2026-03-08" });
    const fortnight = await commands.getMuscleHeatmap({ days: 14, through: "2026-03-08" });

    // The only trained muscle is not "the max": 2 sets a week is under a seventh of the target.
    expect(week.muscles.find((m) => m.muscle === "biceps")).toMatchObject({ weeklySets: 2, level: 1 });
    expect(fortnight.muscles.find((m) => m.muscle === "biceps")).toMatchObject({ sets: 2, weeklySets: 1, level: 1 });
    expect(fortnight.windowTarget).toBe(30);
  });

  it("lists every muscle, untrained ones at zero, so neglected muscles show up", async () => {
    const commands = await signedInOwner();
    const heatmap = await commands.getMuscleHeatmap({ days: 28, through: "2026-03-08" });
    expect(heatmap.from).toBe("2026-02-09");
    expect(heatmap.muscles.map((m) => m.muscle)).toEqual([...MUSCLE_DETAILS]);
    expect(heatmap.muscles.every((m) => m.sets === 0)).toBe(true);
    expect(heatmap.muscles.every((m) => m.level === 0)).toBe(true);
  });

  it("credits finer muscles when the exercise has them, and plain muscles when it doesn't", async () => {
    const commands = await signedInOwner();
    const raise = await customExercise(commands, "Test Lateral Raise", ["shoulders"]);
    const press = await customExercise(commands, "Test Press", ["shoulders"], ["triceps"]);
    await db().sql`
      update public.exercises set primary_detail = '{side delts}', secondary_detail = '{}'
      where id = ${raise}`;
    await logWorkout(commands, raise, "2026-03-05T10:00:00Z", Array(3).fill({ weight: 20, reps: 12 }));
    await logWorkout(commands, press, "2026-03-05T11:00:00Z", Array(2).fill({ weight: 95, reps: 8 }));

    const heatmap = await commands.getMuscleHeatmap({ days: 7, through: "2026-03-08" });

    const byMuscle = Object.fromEntries(heatmap.muscles.map((m) => [m.muscle, m]));
    // The raise only trains the side delts; the press has no detail, so it credits plain shoulders and triceps.
    expect(byMuscle["side delts"]).toMatchObject({ primarySets: 3, sets: 3 });
    expect(byMuscle["front delts"]).toMatchObject({ sets: 0 });
    expect(byMuscle.shoulders).toMatchObject({ primarySets: 2, sets: 2 });
    expect(byMuscle.triceps).toMatchObject({ secondarySets: 2, sets: 1 });
  });

  it("splits catalogue exercises into finer muscles", async () => {
    const commands = await signedInOwner();
    const catalogueId = async (name: string) => {
      const [row] = await db().sql<{ id: string }[]>`select id from public.exercises where name = ${name}`;
      expect(row, name).toBeDefined();
      return row!.id;
    };
    const raise = await catalogueId("Side Lateral Raise");
    const incline = await catalogueId("Barbell Incline Bench Press - Medium Grip");
    const curl = await catalogueId("Reverse Barbell Curl");
    await logWorkout(commands, raise, "2026-03-05T10:00:00Z", [{ weight: 20, reps: 12 }]);
    await logWorkout(commands, incline, "2026-03-05T11:00:00Z", [{ weight: 135, reps: 8 }]);
    await logWorkout(commands, curl, "2026-03-05T12:00:00Z", [{ weight: 60, reps: 10 }]);

    const heatmap = await commands.getMuscleHeatmap({ days: 7, through: "2026-03-08" });

    const sets = Object.fromEntries(heatmap.muscles.map((m) => [m.muscle, m.sets]));
    expect(sets["side delts"]).toBeGreaterThanOrEqual(1);
    expect(sets["upper chest"]).toBe(1);
    expect(sets.chest).toBe(0);
    // A reverse curl loads the brachialis (counted with the biceps) and brachioradialis (with the forearms).
    expect(sets.biceps).toBe(1);
    expect(sets.forearms).toBe(1);
  });

  it("defaults to the 14 days through today", async () => {
    const commands = await signedInOwner();
    const heatmap = await commands.getMuscleHeatmap({});
    expect(heatmap.days).toBe(14);
    expect(heatmap.through).toBe(heatmap.today);
  });
});
