import { describe, expect, it } from "vitest";
import type { WorkoutOpInput } from "@/domain/workout";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return {
    owner,
    commands: db().commandsAs({ kind: "user", userId: owner.id }),
  };
}

type Commands = Awaited<ReturnType<typeof signedInOwner>>["commands"];

async function exerciseId(commands: Commands, name: string) {
  const { items } = await commands.listExercises({ query: name });
  const exercise = items.find((e) => e.name === name);
  if (!exercise) throw new Error(`No catalogue exercise ${name}`);
  return exercise.id;
}

const ids = {
  workout: "00000000-0000-4000-8000-000000000001",
  bench: "00000000-0000-4000-8000-000000000011",
  row: "00000000-0000-4000-8000-000000000012",
  set1: "00000000-0000-4000-8000-000000000101",
  set2: "00000000-0000-4000-8000-000000000102",
  set3: "00000000-0000-4000-8000-000000000103",
  set4: "00000000-0000-4000-8000-000000000104",
  older: "00000000-0000-4000-8000-000000000002",
  olderEx: "00000000-0000-4000-8000-000000000021",
  olderSet: "00000000-0000-4000-8000-000000000201",
};

/** A finished upper-body session: bench in lb (incl. a decimal weight), rows in kg. */
function upperSession(benchId: string, rowId: string): WorkoutOpInput[] {
  const lb = {
    workoutExerciseId: ids.bench,
    unit: "lb",
    completed: true,
  } as const;
  const kg = {
    workoutExerciseId: ids.row,
    unit: "kg",
    completed: true,
  } as const;
  return [
    {
      type: "startWorkout",
      id: ids.workout,
      name: "Upper",
      startedAt: "2026-10-09T17:27:00.000Z",
    },
    {
      type: "addExercise",
      id: ids.bench,
      workoutId: ids.workout,
      exerciseId: benchId,
      position: 0,
    },
    {
      type: "addExercise",
      id: ids.row,
      workoutId: ids.workout,
      exerciseId: rowId,
      position: 1,
    },
    {
      type: "putSet",
      id: ids.set1,
      position: 0,
      setType: "warmup",
      weight: 95,
      reps: 10,
      ...lb,
    },
    {
      type: "putSet",
      id: ids.set2,
      position: 1,
      setType: "normal",
      weight: 182.5,
      reps: 8,
      ...lb,
    },
    {
      type: "putSet",
      id: ids.set3,
      position: 2,
      setType: "drop",
      weight: null,
      reps: 12,
      ...lb,
    },
    {
      type: "putSet",
      id: ids.set4,
      position: 0,
      setType: "failure",
      weight: 60,
      reps: 9,
      ...kg,
    },
    {
      type: "finishWorkout",
      id: ids.workout,
      finishedAt: "2026-10-09T19:01:00.000Z",
    },
  ];
}

describe("exporting everything as JSON", () => {
  it("contains every entity the owner has data in, values as stored", async () => {
    const { owner, commands } = await signedInOwner();
    const benchId = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const custom = await commands.createCustomExercise({
      name: "Seal Row (Gym Rig)",
      primaryMuscles: ["middle back"],
      equipment: "barbell",
    });
    await commands.applyWorkoutOps({ ops: upperSession(benchId, custom.id) });
    await commands.logBodyMeasurement({
      date: "2026-10-09",
      values: { weight: 181.4 },
    });

    const exported = await commands.exportJson({});

    expect(exported.format).toBe("workout-tracker-export");
    expect(exported.version).toBe(1);
    expect(Date.parse(exported.exportedAt)).not.toBeNaN();
    const { tables } = exported;
    expect(tables.owner).toEqual([expect.objectContaining({ user_id: owner.id })]);
    expect(tables.workouts).toEqual([
      expect.objectContaining({
        id: ids.workout,
        name: "Upper",
        started_at: expect.any(String),
      }),
    ]);
    expect(tables.workout_exercises).toHaveLength(2);
    expect(tables.workout_sets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ids.set2,
          weight: 182.5,
          unit: "lb",
          reps: 8,
          set_type: "normal",
        }),
        expect.objectContaining({
          id: ids.set4,
          weight: 60,
          unit: "kg",
          set_type: "failure",
        }),
      ]),
    );
    expect(tables.body_measurements).toEqual([
      expect.objectContaining({
        date: "2026-10-09",
        weight: 181.4,
        weight_unit: "lb",
      }),
    ]);
    expect(tables.exercises).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: custom.id,
          source: "custom",
          name: "Seal Row (Gym Rig)",
        }),
      ]),
    );
  });

  it("picks up tables added by later migrations without code changes", async () => {
    const { commands } = await signedInOwner();
    await db().sql.unsafe(`
      create table public.future_things (id serial primary key, name text not null);
      alter table public.future_things enable row level security;
      create policy "owner manages future_things" on public.future_things
        for all to authenticated using (public.is_owner()) with check (public.is_owner());
      grant all on public.future_things to anon, authenticated, service_role;
      insert into public.future_things (name) values ('Chicago Marathon');
    `);

    const { tables } = await commands.exportJson({});

    expect(tables.future_things).toEqual([{ id: 1, name: "Chicago Marathon" }]);
  });

  it("works for the backup job (service actor)", async () => {
    const { commands } = await signedInOwner();
    await commands.logBodyMeasurement({
      date: "2026-10-09",
      values: { weight: 181.4 },
    });

    const { tables } = await db().commandsAs({ kind: "service" }).exportJson({});

    expect(tables.body_measurements).toHaveLength(1);
  });

  it("refuses signed-out callers", async () => {
    await signedInOwner();
    await expect(db().commandsAs({ kind: "anon" }).exportJson({})).rejects.toMatchObject({ code: "unauthorized" });
  });
});

const HEADER =
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_lbs","reps","distance_miles","duration_seconds","rpe"';

describe("exporting workouts as Hevy-format CSV", () => {
  it("writes one row per completed set, newest workout first, in the owner's time zone", async () => {
    const { commands } = await signedInOwner();
    const benchId = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const custom = await commands.createCustomExercise({
      name: "Seal Row (Gym Rig)",
      primaryMuscles: ["middle back"],
      equipment: "barbell",
    });
    await commands.applyWorkoutOps({
      ops: [
        ...upperSession(benchId, custom.id),
        // An older, unnamed workout with a set that was never completed.
        {
          type: "startWorkout",
          id: ids.older,
          startedAt: "2026-10-01T11:00:00.000Z",
        },
        {
          type: "addExercise",
          id: ids.olderEx,
          workoutId: ids.older,
          exerciseId: benchId,
          position: 0,
        },
        {
          type: "putSet",
          id: ids.olderSet,
          workoutExerciseId: ids.olderEx,
          position: 0,
          setType: "normal",
          weight: 135,
          unit: "lb",
          reps: 5,
          completed: false,
        },
        {
          type: "putSet",
          id: "00000000-0000-4000-8000-000000000202",
          workoutExerciseId: ids.olderEx,
          position: 1,
          setType: "normal",
          weight: 135,
          unit: "lb",
          reps: 5,
          completed: true,
        },
        {
          type: "finishWorkout",
          id: ids.older,
          finishedAt: "2026-10-01T11:45:00.000Z",
        },
        // Still in progress: not exported.
        {
          type: "startWorkout",
          id: "00000000-0000-4000-8000-000000000003",
          startedAt: "2026-10-11T07:00:00.000Z",
        },
      ],
    });

    const { filename, csv } = await commands.exportWorkoutsCsv({
      timeZone: "America/Chicago",
    });

    expect(filename).toBe("workouts.csv");
    expect(csv.split("\n")).toEqual([
      HEADER,
      '"Upper","9 Oct 2026, 12:27","9 Oct 2026, 14:01","","Barbell Bench Press - Medium Grip","","","0","warmup","95","10","","",""',
      '"Upper","9 Oct 2026, 12:27","9 Oct 2026, 14:01","","Barbell Bench Press - Medium Grip","","","1","normal","182.5","8","","",""',
      '"Upper","9 Oct 2026, 12:27","9 Oct 2026, 14:01","","Barbell Bench Press - Medium Grip","","","2","dropset","","12","","",""',
      '"Upper","9 Oct 2026, 12:27","9 Oct 2026, 14:01","","Seal Row (Gym Rig)","","","0","failure","132.28","9","","",""',
      '"Workout","1 Oct 2026, 06:00","1 Oct 2026, 06:45","","Barbell Bench Press - Medium Grip","","","0","normal","135","5","","",""',
      "",
    ]);
  });

  it("can use Hevy's kg columns, keeping kg sets as entered", async () => {
    const { commands } = await signedInOwner();
    const benchId = await exerciseId(commands, "Barbell Bench Press - Medium Grip");
    const rowId = await exerciseId(commands, "Bent Over Barbell Row");
    await commands.applyWorkoutOps({ ops: upperSession(benchId, rowId) });

    const { csv } = await commands.exportWorkoutsCsv({
      timeZone: "UTC",
      unit: "kg",
    });
    const lines = csv.split("\n");

    expect(lines[0]).toBe(HEADER.replace("weight_lbs", "weight_kg").replace("distance_miles", "distance_km"));
    expect(lines[2]).toContain('"normal","82.78","8"'); // 182.5 lb
    expect(lines[4]).toBe(
      '"Upper","9 Oct 2026, 17:27","9 Oct 2026, 19:01","","Bent Over Barbell Row","","","0","failure","60","9","","",""',
    );
  });

  it("escapes quotes in names", async () => {
    const { commands } = await signedInOwner();
    const custom = await commands.createCustomExercise({
      name: 'Bench "Paused"',
      primaryMuscles: ["chest"],
      equipment: "barbell",
    });
    await commands.applyWorkoutOps({
      ops: [
        {
          type: "startWorkout",
          id: ids.workout,
          name: "Push, heavy",
          startedAt: "2026-10-09T17:27:00.000Z",
        },
        {
          type: "addExercise",
          id: ids.bench,
          workoutId: ids.workout,
          exerciseId: custom.id,
          position: 0,
        },
        {
          type: "putSet",
          id: ids.set1,
          workoutExerciseId: ids.bench,
          position: 0,
          setType: "normal",
          weight: 100,
          unit: "lb",
          reps: 3,
          completed: true,
        },
        {
          type: "finishWorkout",
          id: ids.workout,
          finishedAt: "2026-10-09T18:00:00.000Z",
        },
      ],
    });

    const { csv } = await commands.exportWorkoutsCsv({ timeZone: "UTC" });

    expect(csv.split("\n")[1]).toMatch(/^"Push, heavy","9 Oct 2026, 17:27","9 Oct 2026, 18:00","","Bench ""Paused""",/);
  });

  it("rejects an unknown time zone", async () => {
    const { commands } = await signedInOwner();
    await expect(commands.exportWorkoutsCsv({ timeZone: "Mars/Olympus" })).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});
