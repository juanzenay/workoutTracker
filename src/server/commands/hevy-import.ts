import { randomUUID } from "node:crypto";
import postgres, { type JSONValue, type TransactionSql } from "postgres";
import { z } from "zod";
import type { Exercise } from "@/domain/exercise";
import type {
  HevyExerciseTemplate,
  HevyRoutine,
  HevyRoutineExercise,
  HevyRoutineFolder,
  HevyWorkout,
  HevyWorkoutExercise,
} from "../hevy/client";
import { kgToLb, toBodyMeasurementValues, toHevyExerciseDraft, toSetType } from "../hevy/map";
import { createCatalogueMatcher, type CatalogueEntry } from "../hevy/match";
import { replan } from "./replan";
import { CommandError, defineCommand } from "./define";
import { upsertImportedBodyMeasurement } from "./body-measurements";
import { toExercise, type ExerciseRow } from "./exercises";
import { writeExercises, type RoutineInput } from "./routines";

/**
 * Hevy importer. Pulls the owner's whole Hevy history and upserts it, keyed on
 * Hevy ids, so it can be re-run any number of times until cutover:
 * - exercise templates → `hevy_exercise_matches` (template id → workout tracker exercise).
 *   A template is matched once; later runs reuse the row, so the owner's review
 *   decisions persist. Hevy custom exercises always become `hevy` exercises.
 * - workouts → `workouts.hevy_workout_id`. A workout whose Hevy `updated_at`
 *   hasn't changed is skipped; a changed one has its exercises and sets replaced.
 * - routine folders → `routine_folders.hevy_folder_id`, routines →
 *   `routines.hevy_routine_id`, skipped the same way when Hevy's `updated_at`
 *   is unchanged. Routine exercises resolve through the same template matches.
 * - body measurements → `body_measurements.date`; entries logged or edited in
 *   workout tracker win over Hevy's.
 * Nothing deleted in Hevy is deleted in workout tracker.
 */

type UpsertCounts = { imported: number; updated: number; unchanged: number };
type Upserted = keyof UpsertCounts;

export interface HevyImportResult {
  workouts: UpsertCounts;
  routineFolders: UpsertCounts;
  routines: UpsertCounts;
  bodyMeasurements: UpsertCounts;
  /** Hevy exercises seen for the first time in this run, by how they were matched. */
  exercises: { matched: number; review: number; custom: number };
  /** Matches still waiting for the owner (across all runs). */
  pendingReview: number;
}

type MatchStatus = "matched" | "review" | "confirmed" | "custom";

async function apiKeyFor(tx: TransactionSql, apiKey: string | undefined): Promise<string> {
  if (apiKey) {
    await tx`
      insert into public.hevy_connection (api_key) values (${apiKey})
      on conflict (id) do update set api_key = excluded.api_key, updated_at = now()`;
    return apiKey;
  }
  const [row] = await tx<{ api_key: string }[]>`select api_key from public.hevy_connection`;
  if (!row) throw new CommandError("invalid_input", "Enter your Hevy API key to import");
  return row.api_key;
}

async function createHevyExercise(tx: TransactionSql, template: HevyExerciseTemplate): Promise<string> {
  const d = toHevyExerciseDraft(template);
  const [inserted] = await tx<{ id: string }[]>`
    insert into public.exercises
      (source, source_ref, hevy_template_id, name, primary_muscles, secondary_muscles, equipment, category)
    values (
      'hevy', ${d.hevyTemplateId}, ${d.hevyTemplateId}, ${d.name},
      ${tx.array(d.primaryMuscles)}::text[], ${tx.array(d.secondaryMuscles)}::text[], ${d.equipment}, ${d.category}
    )
    on conflict (hevy_template_id) do nothing
    returning id`;
  if (inserted) return inserted.id;
  const [existing] = await tx<{ id: string }[]>`
    select id from public.exercises where hevy_template_id = ${d.hevyTemplateId}`;
  return existing!.id;
}

/**
 * Templates the import needs: every custom one, plus any built-in a workout or
 * routine uses. Deleted ones are rebuilt from the workout or routine exercise.
 */
function neededTemplates(
  templates: HevyExerciseTemplate[],
  uses: { exercises: (HevyWorkoutExercise | HevyRoutineExercise)[] }[],
): HevyExerciseTemplate[] {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const needed = new Map(templates.filter((t) => t.is_custom).map((t) => [t.id, t]));
  for (const use of uses) {
    for (const e of use.exercises) {
      if (needed.has(e.exercise_template_id)) continue;
      needed.set(
        e.exercise_template_id,
        byId.get(e.exercise_template_id) ?? {
          id: e.exercise_template_id,
          title: e.title,
          type: null,
          primary_muscle_group: null,
          secondary_muscle_groups: [],
          is_custom: true,
        },
      );
    }
  }
  return [...needed.values()];
}

/** Maps every needed Hevy template to a workout tracker exercise id, creating matches for new templates. Reuse for routines. */
export async function resolveExercises(
  tx: TransactionSql,
  templates: HevyExerciseTemplate[],
  counts: HevyImportResult["exercises"],
): Promise<Map<string, string>> {
  const existing = await tx<{ hevy_template_id: string; exercise_id: string }[]>`
    select hevy_template_id, exercise_id from public.hevy_exercise_matches`;
  const exerciseIdByTemplate = new Map(existing.map((r) => [r.hevy_template_id, r.exercise_id]));
  const fresh = templates.filter((t) => !exerciseIdByTemplate.has(t.id));
  if (fresh.length === 0) return exerciseIdByTemplate;

  const catalogue = await tx<CatalogueEntry[]>`
    select id, name, equipment from public.exercises where source in ('free-exercise-db', 'wger')`;
  const match = createCatalogueMatcher(catalogue);

  for (const template of fresh) {
    const result = template.is_custom ? ({ kind: "none" } as const) : match(template.title);
    let status: MatchStatus;
    let exerciseId: string;
    let candidateIds: string[] = [];
    if (result.kind === "certain") {
      status = "matched";
      exerciseId = result.exerciseId;
    } else {
      // Uncertain matches keep their history on a `hevy` placeholder until the owner reviews them.
      status = result.kind === "uncertain" ? "review" : "custom";
      exerciseId = await createHevyExercise(tx, template);
      if (result.kind === "uncertain") candidateIds = result.candidateIds;
    }
    await tx`
      insert into public.hevy_exercise_matches (hevy_template_id, hevy_title, exercise_id, status, candidate_ids)
      values (${template.id}, ${template.title}, ${exerciseId}, ${status}, ${tx.array(candidateIds)}::uuid[])`;
    counts[status === "matched" ? "matched" : status === "review" ? "review" : "custom"]++;
    exerciseIdByTemplate.set(template.id, exerciseId);
  }
  return exerciseIdByTemplate;
}

/** Inserts or replaces one Hevy workout. Returns what happened to it. */
async function upsertWorkout(
  tx: TransactionSql,
  workout: HevyWorkout,
  exerciseIdByTemplate: Map<string, string>,
): Promise<Upserted> {
  const hevyUpdatedAt = workout.updated_at ? new Date(workout.updated_at) : null;
  const [current] = await tx<{ id: string; hevy_updated_at: Date | null }[]>`
    select id, hevy_updated_at from public.workouts where hevy_workout_id = ${workout.id}`;
  if (current && hevyUpdatedAt && current.hevy_updated_at?.getTime() === hevyUpdatedAt.getTime()) return "unchanged";

  const name = workout.title?.slice(0, 120) ?? null;
  const startedAt = new Date(workout.start_time);
  const finishedAt = workout.end_time ? new Date(workout.end_time) : startedAt;
  let workoutId: string;
  if (current) {
    workoutId = current.id;
    await tx`
      update public.workouts
      set name = ${name}, started_at = ${startedAt}, finished_at = ${finishedAt}, notes = ${workout.description},
        hevy_updated_at = ${hevyUpdatedAt}, updated_at = now()
      where id = ${workoutId}`;
    await tx`delete from public.workout_exercises where workout_id = ${workoutId}`;
  } else {
    workoutId = randomUUID();
    await tx`
      insert into public.workouts (id, name, started_at, finished_at, notes, hevy_workout_id, hevy_updated_at)
      values (${workoutId}, ${name}, ${startedAt}, ${finishedAt}, ${workout.description}, ${workout.id}, ${hevyUpdatedAt})`;
  }

  const exercises = [...workout.exercises].sort((a, b) => a.index - b.index);
  const exerciseRows = exercises.map((e, position) => ({
    id: randomUUID(),
    workout_id: workoutId,
    exercise_id: exerciseIdByTemplate.get(e.exercise_template_id)!,
    position,
    superset_group: e.supersetId,
    notes: e.notes,
  }));
  const setRows = exercises.flatMap((e, i) =>
    [...e.sets]
      .sort((a, b) => a.index - b.index)
      .map((s, position) => ({
        id: randomUUID(),
        workout_exercise_id: exerciseRows[i]!.id,
        position,
        set_type: toSetType(s.type),
        weight: kgToLb(s.weight_kg),
        unit: "lb",
        reps: s.reps === null ? null : Math.round(s.reps),
        duration_seconds: s.duration_seconds === null ? null : Math.round(s.duration_seconds),
        distance_meters: s.distance_meters,
        completed: true,
      })),
  );
  if (exerciseRows.length > 0) await tx`insert into public.workout_exercises ${tx(exerciseRows)}`;
  if (setRows.length > 0) await tx`insert into public.workout_sets ${tx(setRows)}`;
  return current ? "updated" : "imported";
}

/** Do we already hold this Hevy revision? */
function sameRevision(held: Date | null | undefined, hevyUpdatedAt: string | null | undefined): boolean {
  return !!held && !!hevyUpdatedAt && held.getTime() === new Date(hevyUpdatedAt).getTime();
}

const nameOf = (title: string, fallback: string) => title.trim().slice(0, 120) || fallback;

/** Upserts Hevy folders (ordered by Hevy's index). Returns Hevy folder id → workout tracker folder id. */
async function upsertFolders(
  tx: TransactionSql,
  folders: HevyRoutineFolder[],
  counts: UpsertCounts,
): Promise<Map<number, string>> {
  const idByHevyId = new Map<number, string>();
  const ordered = [...folders].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const [i, folder] of ordered.entries()) {
    const [current] = await tx<{ id: string; hevy_updated_at: Date | null }[]>`
      select id, hevy_updated_at from public.routine_folders where hevy_folder_id = ${folder.id}`;
    const name = nameOf(folder.title, "Folder");
    const position = folder.index ?? i;
    const hevyUpdatedAt = folder.updated_at ? new Date(folder.updated_at) : null;
    if (current && sameRevision(current.hevy_updated_at, folder.updated_at)) {
      counts.unchanged++;
      idByHevyId.set(folder.id, current.id);
    } else if (current) {
      await tx`
        update public.routine_folders
        set name = ${name}, position = ${position}, hevy_updated_at = ${hevyUpdatedAt}, updated_at = now()
        where id = ${current.id}`;
      counts.updated++;
      idByHevyId.set(folder.id, current.id);
    } else {
      const [row] = await tx<{ id: string }[]>`
        insert into public.routine_folders (name, position, hevy_folder_id, hevy_updated_at)
        values (${name}, ${position}, ${folder.id}, ${hevyUpdatedAt})
        returning id`;
      counts.imported++;
      idByHevyId.set(folder.id, row!.id);
    }
  }
  return idByHevyId;
}

const wholeOrNull = (n: number | null) => (n === null ? null : Math.max(0, Math.round(n)));

function toRoutineExercises(
  exercises: HevyRoutineExercise[],
  exerciseIdByTemplate: Map<string, string>,
): RoutineInput["exercises"] {
  return [...exercises]
    .sort((a, b) => a.index - b.index)
    .map((e) => ({
      exerciseId: exerciseIdByTemplate.get(e.exercise_template_id)!,
      restSeconds: wholeOrNull(e.rest_seconds),
      supersetGroup: wholeOrNull(e.supersetId),
      notes: e.notes,
      sets: [...e.sets]
        .sort((a, b) => a.index - b.index)
        .map((s) => {
          const start = wholeOrNull(s.rep_range?.start ?? null);
          const end = wholeOrNull(s.rep_range?.end ?? null);
          const ranged = start !== null || end !== null;
          return {
            setType: toSetType(s.type),
            weight: kgToLb(s.weight_kg),
            unit: "lb" as const,
            reps: ranged ? null : wholeOrNull(s.reps),
            repRangeStart: start,
            repRangeEnd: start !== null && end !== null && end < start ? null : end,
          };
        }),
    }));
}

/** Upserts Hevy routines, each placed in its folder in Hevy's listing order. */
async function upsertRoutines(
  tx: TransactionSql,
  routines: HevyRoutine[],
  folderIdByHevyId: Map<number, string>,
  exerciseIdByTemplate: Map<string, string>,
  counts: UpsertCounts,
) {
  const nextPosition = new Map<string | null, number>();
  for (const routine of routines) {
    const folderId = (routine.folder_id !== null && folderIdByHevyId.get(routine.folder_id)) || null;
    const position = nextPosition.get(folderId) ?? 0;
    nextPosition.set(folderId, position + 1);

    const [current] = await tx<{ id: string; hevy_updated_at: Date | null }[]>`
      select id, hevy_updated_at from public.routines where hevy_routine_id = ${routine.id}`;
    if (current && sameRevision(current.hevy_updated_at, routine.updated_at)) {
      counts.unchanged++;
      continue;
    }
    const name = nameOf(routine.title, "Routine");
    const hevyUpdatedAt = routine.updated_at ? new Date(routine.updated_at) : null;
    let routineId: string;
    if (current) {
      routineId = current.id;
      await tx`
        update public.routines
        set name = ${name}, notes = ${routine.notes}, folder_id = ${folderId}, position = ${position},
          hevy_updated_at = ${hevyUpdatedAt}, updated_at = now()
        where id = ${routineId}`;
      counts.updated++;
    } else {
      const [row] = await tx<{ id: string }[]>`
        insert into public.routines (folder_id, name, notes, position, hevy_routine_id, hevy_updated_at)
        values (${folderId}, ${name}, ${routine.notes}, ${position}, ${routine.id}, ${hevyUpdatedAt})
        returning id`;
      routineId = row!.id;
      counts.imported++;
    }
    await writeExercises(tx, routineId, toRoutineExercises(routine.exercises, exerciseIdByTemplate));
  }
}

async function pendingReviewCount(tx: TransactionSql): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    select count(*)::int as n from public.hevy_exercise_matches where status = 'review'`;
  return row!.n;
}

/**
 * Imports the owner's Hevy history: workouts, exercises, routines and folders, body measurements. Pass `apiKey` the
 * first time (it is remembered); later runs reuse the saved key.
 */
export const importFromHevy = defineCommand({
  input: z.object({ apiKey: z.string().trim().min(1).max(200).optional() }),
  async run({ tx, hevy, engine, push, now }, input) {
    const apiKey = await apiKeyFor(tx, input.apiKey);
    const templates = await hevy.listExerciseTemplates(apiKey);
    const workouts = await hevy.listWorkouts(apiKey);
    const folders = await hevy.listRoutineFolders(apiKey);
    const routines = await hevy.listRoutines(apiKey);
    const measurements = await hevy.listBodyMeasurements(apiKey);

    const result: HevyImportResult = {
      workouts: { imported: 0, updated: 0, unchanged: 0 },
      routineFolders: { imported: 0, updated: 0, unchanged: 0 },
      routines: { imported: 0, updated: 0, unchanged: 0 },
      bodyMeasurements: { imported: 0, updated: 0, unchanged: 0 },
      exercises: { matched: 0, review: 0, custom: 0 },
      pendingReview: 0,
    };
    const exerciseIdByTemplate = await resolveExercises(
      tx,
      neededTemplates(templates, [...workouts, ...routines]),
      result.exercises,
    );
    for (const workout of workouts) result.workouts[await upsertWorkout(tx, workout, exerciseIdByTemplate)]++;
    const folderIdByHevyId = await upsertFolders(tx, folders, result.routineFolders);
    await upsertRoutines(tx, routines, folderIdByHevyId, exerciseIdByTemplate, result.routines);
    for (const measurement of measurements) {
      const values = toBodyMeasurementValues(measurement);
      if (!values) continue;
      result.bodyMeasurements[await upsertImportedBodyMeasurement(tx, measurement.date.slice(0, 10), values)]++;
    }
    result.pendingReview = await pendingReviewCount(tx);
    // Imported workouts are history the engine progresses from.
    await replan(tx, engine, push, now());

    await tx`
      update public.hevy_connection
      set last_imported_at = now(), last_result = ${tx.json(result as unknown as JSONValue)}`;
    return result;
  },
});

export interface HevyMatchReview {
  hevyTemplateId: string;
  hevyTitle: string;
  /** The `hevy` exercise holding this exercise's history until the owner decides. */
  exercise: Exercise;
  /** Catalogue suggestions, best first. */
  candidates: Exercise[];
}

export interface HevyImportStatus {
  /** An API key is saved, so the import can be re-run without entering it. */
  connected: boolean;
  lastImportedAt: string | null;
  lastResult: HevyImportResult | null;
  reviews: HevyMatchReview[];
}

/** The import screen: whether Hevy is connected, the last run, and the uncertain matches awaiting review. */
export const getHevyImport = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    const [connection] = await tx<{ last_imported_at: Date | null; last_result: HevyImportResult | null }[]>`
      select last_imported_at, last_result from public.hevy_connection`;
    const rows = await tx<
      { hevy_template_id: string; hevy_title: string; exercise: ExerciseRow; candidates: ExerciseRow[] }[]
    >`
      select m.hevy_template_id, m.hevy_title, to_jsonb(e) as exercise,
        coalesce((
          select jsonb_agg(to_jsonb(c) order by array_position(m.candidate_ids, c.id))
          from public.exercises c where c.id = any(m.candidate_ids)
        ), '[]'::jsonb) as candidates
      from public.hevy_exercise_matches m join public.exercises e on e.id = m.exercise_id
      where m.status = 'review'
      order by lower(m.hevy_title), m.hevy_template_id`;
    const status: HevyImportStatus = {
      connected: connection !== undefined,
      lastImportedAt: connection?.last_imported_at?.toISOString() ?? null,
      lastResult: connection?.last_result ?? null,
      reviews: rows.map((r) => ({
        hevyTemplateId: r.hevy_template_id,
        hevyTitle: r.hevy_title,
        exercise: toExercise(r.exercise),
        candidates: r.candidates.map(toExercise),
      })),
    };
    return status;
  },
});

/**
 * The owner's decision on an uncertain match: `exerciseId` moves the exercise's
 * history onto that catalogue exercise; null keeps it as its own `hevy`
 * exercise. Either way the decision is kept for every later import.
 */
export const resolveHevyMatch = defineCommand({
  input: z.object({ hevyTemplateId: z.string().min(1).max(100), exerciseId: z.uuid().nullable() }),
  async run({ tx }, { hevyTemplateId, exerciseId }) {
    const [match] = await tx<{ exercise_id: string }[]>`
      select exercise_id from public.hevy_exercise_matches
      where hevy_template_id = ${hevyTemplateId} and status = 'review'`;
    if (!match) throw new CommandError("not_found", `No Hevy match awaiting review for ${hevyTemplateId}`);
    const placeholderId = match.exercise_id;

    if (exerciseId && exerciseId !== placeholderId) {
      const [target] = await tx`select id from public.exercises where id = ${exerciseId}`;
      if (!target) throw new CommandError("not_found", `Exercise ${exerciseId} not found`);
      await tx`update public.workout_exercises set exercise_id = ${exerciseId} where exercise_id = ${placeholderId}`;
      await tx`update public.routine_exercises set exercise_id = ${exerciseId} where exercise_id = ${placeholderId}`;
    }
    const finalId = exerciseId ?? placeholderId;
    await tx`
      update public.hevy_exercise_matches
      set exercise_id = ${finalId}, status = 'confirmed', candidate_ids = '{}', updated_at = now()
      where hevy_template_id = ${hevyTemplateId}`;
    if (finalId !== placeholderId) {
      // Drop the placeholder unless something else (e.g. a routine made in workout tracker) still points at it.
      await tx
        .savepoint((sp) => sp`delete from public.exercises where id = ${placeholderId}`)
        .catch((error: unknown) => {
          if (!(error instanceof postgres.PostgresError && error.code === "23503")) throw error; // foreign_key_violation
        });
    }
    return { hevyTemplateId, exerciseId: finalId };
  },
});
