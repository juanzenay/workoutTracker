import type { Block, BlockExercise, BlockSession, HistoryWorkout, Weekday } from "@/domain/block";
import type { Muscle } from "@/domain/exercise";

/**
 * Named scenario fixtures for engine tests, seeded from the owner's real Hevy
 * history (notes/research/hevy-api.md): a 4-day upper/lower split with rotating
 * emphasis (Lower Body A, Chest Upper, Hamstring Lower, Back Upper), machine-heavy,
 * 10–15 rep ranges, all in lb, no RIR logged. Real loads: Machine Chest Press
 * 180 lb × 11 / 9, Chest Supported Row 180 lb (10–15), Face Pull 90 lb × 16,
 * Lateral Raise (Machine) 124 lb × 12.
 */

export const EX = {
  legPress: "ex-leg-press",
  legExtension: "ex-leg-extension",
  chestPressOnRails: "ex-chest-press-on-rails",
  lateralRaiseMachine: "ex-lateral-raise-machine",
  seatedLegCurl: "ex-seated-leg-curl",
  romanianDeadlift: "ex-romanian-deadlift",
  chestSupportedRow: "ex-chest-supported-row",
  facePull: "ex-face-pull",
} as const;

type ExerciseSpec = [exerciseId: string, name: string, startWeight: number | null, muscles: Muscle[]];

function session(id: string, name: string, weekday: Weekday, position: number, specs: ExerciseSpec[]): BlockSession {
  return {
    id,
    name,
    weekday,
    position,
    exercises: specs.map(
      ([exerciseId, exerciseName, startWeight, muscles], i): BlockExercise => ({
        id: `${id}-${i}`,
        exerciseId,
        name: exerciseName,
        position: i,
        sets: 3,
        repRangeStart: 10,
        repRangeEnd: 15,
        startWeight,
        unit: "lb",
        increment: 5,
        rule: "double",
        muscles,
      }),
    ),
  };
}

/** The owner's 4-day upper/lower split, 10–15 reps, 3 sets each: Mon / Tue / Thu / Fri, starting Monday 2026-10-12. */
export function upperLower4Day(overrides: Partial<Block> = {}): Block {
  return {
    id: "block-ul",
    name: "Upper/Lower",
    startDate: "2026-10-12",
    weeks: 4,
    timeZone: "America/Los_Angeles",
    sessions: [
      session("s-quad", "Lower Body A", 1, 0, [
        [EX.legPress, "Leg Press", 270, ["quadriceps"]],
        [EX.legExtension, "Leg Extension", 150, ["quadriceps"]],
      ]),
      session("s-chest", "Chest Upper", 2, 1, [
        [EX.chestPressOnRails, "Machine Chest Press", 180, ["chest"]],
        [EX.lateralRaiseMachine, "Lateral Raise (Machine)", 124, ["shoulders"]],
      ]),
      session("s-ham", "Hamstring Lower", 4, 2, [
        [EX.seatedLegCurl, "Seated Leg Curl", 130, ["hamstrings"]],
        [EX.romanianDeadlift, "Romanian Deadlift", 135, ["hamstrings"]],
      ]),
      session("s-back", "Back Upper", 5, 3, [
        [EX.chestSupportedRow, "Chest Supported Row", 180, ["middle back"]],
        [EX.facePull, "Face Pull", 90, ["shoulders"]],
      ]),
    ],
    ...overrides,
  };
}

/**
 * "RIR 0 three sessions running": Machine Chest Press on the RIR-informed rule,
 * three Chest Upper sessions in a row at the owner's usual 180 lb, each ending
 * on a grinder (RIR 0) — the fatigue running mileage brings on.
 */
export function rir0ThreeSessionsRunning(): { block: Block; history: HistoryWorkout[] } {
  const block = upperLower4Day();
  for (const session of block.sessions)
    for (const exercise of session.exercises) if (exercise.exerciseId === EX.chestPressOnRails) exercise.rule = "rir";
  const grinder = (date: string, reps: number[]) =>
    did(date, EX.chestPressOnRails, 180, [...reps.slice(0, -1), [reps.at(-1)!, { rir: 0 }]]);
  return {
    block,
    history: [
      grinder("2026-09-22", [12, 11, 10]),
      grinder("2026-09-29", [12, 10, 10]),
      grinder("2026-10-06", [11, 10, 9]),
    ],
  };
}

/**
 * "Deload week": the upper/lower block with its last week (4) set as a deload;
 * Machine Chest Press at the owner's usual 180 lb × 13, 12, 11 in week 3.
 */
export function deloadInWeek4(): { block: Block; history: HistoryWorkout[] } {
  return {
    block: upperLower4Day({ deloadWeeks: [4] }),
    history: [did("2026-10-27", EX.chestPressOnRails, 180, [13, 12, 11])],
  };
}

type SetSpec = number | [reps: number, opts: { weight?: number; setType?: "warmup" | "failure" | "drop"; rir?: number }];

/** One finished workout doing `exerciseId` at `weight` lb with the given reps per set. */
export function did(date: string, exerciseId: string, weight: number, sets: SetSpec[]): HistoryWorkout {
  return {
    date,
    exercises: [
      {
        exerciseId,
        sets: sets.map((spec) => {
          const [reps, opts] = typeof spec === "number" ? [spec, {}] : spec;
          return {
            setType: opts.setType ?? "normal",
            weight: opts.weight ?? weight,
            unit: "lb" as const,
            reps,
            rir: opts.rir ?? null,
            completed: true,
          };
        }),
      },
    ],
  };
}
