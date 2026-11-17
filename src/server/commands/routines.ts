import type { PendingQuery, Row, TransactionSql } from "postgres";
import { z } from "zod";
import type { Routine, RoutineFolder } from "@/domain/routine";
import { SET_TYPES, WEIGHT_UNITS, type SetType, type WeightUnit } from "@/domain/workout";
import { CommandError, defineCommand } from "./define";

const name = z.string().trim().min(1).max(120);

interface FolderRow {
  id: string;
  name: string;
  position: number;
}

const toFolder = (row: FolderRow): RoutineFolder => ({ id: row.id, name: row.name, position: row.position });

export const createRoutineFolder = defineCommand({
  input: z.object({ name }),
  async run({ tx }, input) {
    const [row] = await tx<FolderRow[]>`
      insert into public.routine_folders (name, position)
      values (${input.name}, (select coalesce(max(position) + 1, 0) from public.routine_folders))
      returning id, name, position`;
    return toFolder(row!);
  },
});

export const renameRoutineFolder = defineCommand({
  input: z.object({ id: z.uuid(), name }),
  async run({ tx }, input) {
    const [row] = await tx<FolderRow[]>`
      update public.routine_folders set name = ${input.name}, updated_at = now()
      where id = ${input.id}
      returning id, name, position`;
    if (!row) throw new CommandError("not_found", "No such folder");
    return toFolder(row);
  },
});

/** Routines in a deleted folder are kept, unfiled. */
export const deleteRoutineFolder = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, input) {
    const rows = await tx`delete from public.routine_folders where id = ${input.id} returning id`;
    if (rows.length === 0) throw new CommandError("not_found", "No such folder");
    return { deleted: true };
  },
});

/** Sets the folder order to `ids` (every folder, in the new order). */
export const reorderRoutineFolders = defineCommand({
  input: z.object({ ids: z.array(z.uuid()).max(500) }),
  async run({ tx }, input) {
    await tx`
      update public.routine_folders f set position = o.position - 1, updated_at = now()
      from unnest(${tx.array(input.ids)}::uuid[]) with ordinality as o(id, position)
      where f.id = o.id`;
    return { reordered: input.ids.length };
  },
});

const count = z.number().int().min(0).max(1_000).nullable().default(null);

const routineSetInput = z
  .object({
    setType: z.enum(SET_TYPES).default("normal"),
    weight: z.number().finite().min(0).max(10_000).nullable().default(null),
    unit: z.enum(WEIGHT_UNITS).default("lb"),
    reps: count,
    repRangeStart: count,
    repRangeEnd: count,
  })
  .refine(
    (s) => s.repRangeStart === null || s.repRangeEnd === null || s.repRangeEnd >= s.repRangeStart,
    "Rep range ends before it starts",
  );

const routineInput = z.object({
  name,
  folderId: z.uuid().nullable().default(null),
  notes: z.string().trim().max(2_000).nullable().default(null),
  exercises: z
    .array(
      z.object({
        exerciseId: z.uuid(),
        restSeconds: z.number().int().min(0).max(3_600).nullable().default(null),
        supersetGroup: z.number().int().min(0).max(999).nullable().default(null),
        notes: z.string().trim().max(2_000).nullable().default(null),
        sets: z.array(routineSetInput).max(50),
      }),
    )
    .max(50),
});

export type RoutineInput = z.output<typeof routineInput>;

/** Replaces a routine's exercises and sets with `exercises` (positions follow array order). Also used by the Hevy importer. */
export async function writeExercises(tx: TransactionSql, routineId: string, exercises: RoutineInput["exercises"]) {
  await tx`delete from public.routine_exercises where routine_id = ${routineId}`;
  for (const [position, exercise] of exercises.entries()) {
    const [row] = await tx<{ id: string }[]>`
      insert into public.routine_exercises (routine_id, exercise_id, position, rest_seconds, superset_group, notes)
      values (${routineId}, ${exercise.exerciseId}, ${position}, ${exercise.restSeconds}, ${exercise.supersetGroup},
        ${exercise.notes || null})
      returning id`;
    for (const [setPosition, set] of exercise.sets.entries()) {
      await tx`
        insert into public.routine_sets
          (routine_exercise_id, position, set_type, weight, unit, reps, rep_range_start, rep_range_end)
        values (${row!.id}, ${setPosition}, ${set.setType}, ${set.weight}, ${set.unit}, ${set.reps},
          ${set.repRangeStart}, ${set.repRangeEnd})`;
    }
  }
}

interface RoutineRow {
  id: string;
  folder_id: string | null;
  name: string;
  notes: string | null;
  position: number;
  exercises: {
    exercise_id: string;
    name: string;
    position: number;
    rest_seconds: number | null;
    superset_group: number | null;
    notes: string | null;
    sets: {
      position: number;
      set_type: SetType;
      weight: number | string | null;
      unit: WeightUnit;
      reps: number | null;
      rep_range_start: number | null;
      rep_range_end: number | null;
    }[];
  }[];
}

function toRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    notes: row.notes,
    position: row.position,
    exercises: row.exercises.map((e) => ({
      exerciseId: e.exercise_id,
      name: e.name,
      position: e.position,
      restSeconds: e.rest_seconds,
      supersetGroup: e.superset_group,
      notes: e.notes,
      sets: e.sets.map((s) => ({
        position: s.position,
        setType: s.set_type,
        weight: s.weight === null ? null : Number(s.weight),
        unit: s.unit,
        reps: s.reps,
        repRangeStart: s.rep_range_start,
        repRangeEnd: s.rep_range_end,
      })),
    })),
  };
}

/** Routines with their exercises and sets; `where` narrows (pass tx`` for all). */
function selectRoutines(tx: TransactionSql, where: PendingQuery<Row[]>) {
  return tx<RoutineRow[]>`
    select r.id, r.folder_id, r.name, r.notes, r.position,
      coalesce((
        select json_agg(json_build_object(
          'exercise_id', re.exercise_id, 'name', e.name, 'position', re.position,
          'rest_seconds', re.rest_seconds, 'superset_group', re.superset_group, 'notes', re.notes,
          'sets', coalesce((
            select json_agg(json_build_object(
              'position', s.position, 'set_type', s.set_type, 'weight', s.weight, 'unit', s.unit,
              'reps', s.reps, 'rep_range_start', s.rep_range_start, 'rep_range_end', s.rep_range_end
            ) order by s.position)
            from public.routine_sets s where s.routine_exercise_id = re.id
          ), '[]'::json)
        ) order by re.position)
        from public.routine_exercises re join public.exercises e on e.id = re.exercise_id
        where re.routine_id = r.id
      ), '[]'::json) as exercises
    from public.routines r
    ${where}
    order by (select f.position from public.routine_folders f where f.id = r.folder_id) nulls last,
      r.position, r.created_at`;
}

async function loadRoutine(tx: TransactionSql, id: string): Promise<Routine> {
  const [row] = await selectRoutines(tx, tx`where r.id = ${id}`);
  if (!row) throw new CommandError("not_found", "No such routine");
  return toRoutine(row);
}

export const getRoutine = defineCommand({
  input: z.object({ id: z.uuid() }),
  run: ({ tx }, input) => loadRoutine(tx, input.id),
});

/** Creates a routine at the end of its folder. */
export const createRoutine = defineCommand({
  input: routineInput,
  async run({ tx }, input) {
    const [row] = await tx<{ id: string }[]>`
      insert into public.routines (folder_id, name, notes, position)
      values (${input.folderId}, ${input.name}, ${input.notes || null}, (
        select coalesce(max(position) + 1, 0) from public.routines
        where folder_id is not distinct from ${input.folderId}::uuid))
      returning id`;
    await writeExercises(tx, row!.id, input.exercises);
    return loadRoutine(tx, row!.id);
  },
});

/** Replaces a routine's name, notes and exercises (folder and position are changed by reorderRoutines). */
export const updateRoutine = defineCommand({
  input: routineInput.omit({ folderId: true }).extend({ id: z.uuid() }),
  async run({ tx }, input) {
    const rows = await tx`
      update public.routines set name = ${input.name}, notes = ${input.notes || null}, updated_at = now()
      where id = ${input.id}
      returning id`;
    if (rows.length === 0) throw new CommandError("not_found", "No such routine");
    await writeExercises(tx, input.id, input.exercises);
    return loadRoutine(tx, input.id);
  },
});

export const deleteRoutine = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, input) {
    const rows = await tx`delete from public.routines where id = ${input.id} returning id`;
    if (rows.length === 0) throw new CommandError("not_found", "No such routine");
    return { deleted: true };
  },
});

/**
 * Puts `ids` in `folderId` (null = unfiled), in that order. Routines may come
 * from other folders, so this both reorders within a folder and moves between them.
 */
export const reorderRoutines = defineCommand({
  input: z.object({ folderId: z.uuid().nullable(), ids: z.array(z.uuid()).max(500) }),
  async run({ tx }, input) {
    await tx`
      update public.routines r
      set folder_id = ${input.folderId}, position = o.position - 1, updated_at = now()
      from unnest(${tx.array(input.ids)}::uuid[]) with ordinality as o(id, position)
      where r.id = o.id`;
    return { reordered: input.ids.length };
  },
});

/** Every folder (in order) and every routine (by folder, then position; unfiled last), with exercises and sets. */
export const listRoutines = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    const folders = await tx<FolderRow[]>`
      select id, name, position from public.routine_folders order by position, created_at`;
    const routines = await selectRoutines(tx, tx``);
    return { folders: folders.map(toFolder), routines: routines.map(toRoutine) };
  },
});
