import { z } from "zod";
import { PLACEHOLDER_IMAGE_URL, resolveImageUrl } from "@/domain/catalogue";
import {
  CATEGORIES,
  EQUIPMENT,
  MUSCLES,
  type Category,
  type Equipment,
  type Exercise,
  type ExerciseSource,
  type Muscle,
} from "@/domain/exercise";
import { CommandError, defineCommand } from "./define";

export interface ExerciseRow {
  id: string;
  name: string;
  source: ExerciseSource;
  hevy_template_id: string | null;
  primary_muscles: Muscle[];
  secondary_muscles: Muscle[];
  equipment: Equipment | null;
  category: Category;
  instructions: string[];
  image_paths: string[];
}

export function toExercise(row: ExerciseRow): Exercise {
  const imageUrls = row.image_paths.map(resolveImageUrl);
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    hevyTemplateId: row.hevy_template_id,
    primaryMuscles: row.primary_muscles,
    secondaryMuscles: row.secondary_muscles,
    equipment: row.equipment,
    category: row.category,
    instructions: row.instructions,
    imageUrl: imageUrls[0] ?? PLACEHOLDER_IMAGE_URL,
    imageUrls,
  };
}

function likePattern(token: string): string {
  return `%${token.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export const listExercises = defineCommand({
  input: z.object({
    /** Whitespace-separated words; every word must appear in the name (any order, case-insensitive). */
    query: z.string().trim().max(200).optional(),
    muscle: z.enum(MUSCLES).optional(),
    equipment: z.enum(EQUIPMENT).optional(),
    limit: z.number().int().min(1).max(2000).default(100),
    offset: z.number().int().min(0).default(0),
  }),
  async run({ tx }, input) {
    const words = input.query ? input.query.split(/\s+/).filter(Boolean) : [];
    const rows = await tx<ExerciseRow[]>`
      select * from public.exercises
      where name ilike all (${tx.array(words.map(likePattern))}::text[])
        ${input.muscle ? tx`and ${input.muscle} = any(primary_muscles)` : tx``}
        ${input.equipment ? tx`and equipment = ${input.equipment}` : tx``}
      order by lower(name), id
      limit ${input.limit} offset ${input.offset}`;
    return { items: rows.map(toExercise) };
  },
});

export const getExercise = defineCommand({
  input: z.object({ id: z.uuid() }),
  async run({ tx }, { id }) {
    const [row] = await tx<ExerciseRow[]>`select * from public.exercises where id = ${id}`;
    if (!row) throw new CommandError("not_found", `Exercise ${id} not found`);
    return toExercise(row);
  },
});

const muscleList = z.array(z.enum(MUSCLES)).transform((muscles) => [...new Set(muscles)]);

export const createCustomExercise = defineCommand({
  input: z.object({
    /** Optional client-generated id, so offline clients can reference the exercise before sync. */
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(120),
    primaryMuscles: muscleList.refine((m) => m.length > 0, "Pick at least one primary muscle"),
    secondaryMuscles: muscleList.default([]),
    equipment: z.enum(EQUIPMENT).nullable(),
    category: z.enum(CATEGORIES).default("strength"),
  }),
  async run({ tx }, input) {
    const [row] = await tx<ExerciseRow[]>`
      insert into public.exercises
        (id, source, name, primary_muscles, secondary_muscles, equipment, category)
      values (
        coalesce(${input.id ?? null}::uuid, gen_random_uuid()), 'custom', ${input.name},
        ${tx.array(input.primaryMuscles)}::text[], ${tx.array(input.secondaryMuscles)}::text[],
        ${input.equipment}, ${input.category}
      )
      returning *`;
    return toExercise(row!);
  },
});
