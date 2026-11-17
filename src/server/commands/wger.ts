import type { JSONValue } from "postgres";
import { z } from "zod";
import { PLACEHOLDER_IMAGE_URL } from "@/domain/catalogue";
import type { Equipment, Muscle } from "@/domain/exercise";
import type { WgerAttribution } from "@/domain/wger";
import { toWgerDraft } from "../wger/map";
import { CommandError, defineCommand } from "./define";
import { toExercise, type ExerciseRow } from "./exercises";

/** A wger search hit, in workout tracker's vocabulary. */
export interface WgerSearchResult {
  wgerId: number;
  name: string;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  equipment: Equipment | null;
  /** First wger image, or the placeholder (many wger exercises have none). */
  imageUrl: string;
  /** Set when this wger exercise is already in the catalogue. */
  exerciseId: string | null;
}

/** Fallback search: wger exercises by (fuzzy) English name, for when the base catalogue has no match. */
export const searchWger = defineCommand({
  input: z.object({ query: z.string().trim().min(2).max(100) }),
  async run({ tx, wger }, { query }) {
    const drafts = (await wger.search(query)).map((info) => toWgerDraft(info, wger.baseUrl));
    const imported = await tx<{ id: string; source_ref: string }[]>`
      select id, source_ref from public.exercises
      where source = 'wger' and source_ref = any(${tx.array(drafts.map((d) => d.wgerUuid))}::text[])`;
    const idByUuid = new Map(imported.map((r) => [r.source_ref, r.id]));
    const items: WgerSearchResult[] = drafts.map((d) => ({
      wgerId: d.wgerId,
      name: d.name,
      primaryMuscles: d.primaryMuscles,
      secondaryMuscles: d.secondaryMuscles,
      equipment: d.equipment,
      imageUrl: d.imageUrls[0] ?? PLACEHOLDER_IMAGE_URL,
      exerciseId: idByUuid.get(d.wgerUuid) ?? null,
    }));
    return { items };
  },
});

export interface WgerCredit extends WgerAttribution {
  exerciseId: string;
  name: string;
}

/** Attribution for every catalogue exercise imported from wger, for the credits screen. */
export const listWgerCredits = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    const rows = await tx<{ id: string; name: string; attribution: WgerAttribution }[]>`
      select id, name, attribution from public.exercises
      where source = 'wger' and attribution is not null
      order by lower(name), id`;
    const items: WgerCredit[] = rows.map((r) => ({ exerciseId: r.id, name: r.name, ...r.attribution }));
    return { items };
  },
});

/** Adds a wger exercise to the catalogue (source `wger`), keeping its license attribution. Adding it again returns the existing entry. */
export const addWgerExercise = defineCommand({
  input: z.object({ wgerId: z.number().int().positive() }),
  async run({ tx, wger }, { wgerId }) {
    const info = await wger.get(wgerId);
    if (!info) throw new CommandError("not_found", `wger has no exercise ${wgerId}`);
    const d = toWgerDraft(info, wger.baseUrl);
    const [inserted] = await tx<ExerciseRow[]>`
      insert into public.exercises
        (source, source_ref, name, primary_muscles, secondary_muscles, equipment, category,
         instructions, image_paths, attribution)
      values (
        'wger', ${d.wgerUuid}, ${d.name},
        ${tx.array(d.primaryMuscles)}::text[], ${tx.array(d.secondaryMuscles)}::text[],
        ${d.equipment}, ${d.category}, ${tx.array(d.instructions)}::text[], ${tx.array(d.imageUrls)}::text[],
        ${tx.json(d.attribution as unknown as JSONValue)}
      )
      on conflict (source, source_ref) do nothing
      returning *`;
    if (inserted) return toExercise(inserted);
    const [existing] = await tx<ExerciseRow[]>`
      select * from public.exercises where source = 'wger' and source_ref = ${d.wgerUuid}`;
    // Conflict on a row this actor can't see: behave as the insert would have.
    if (!existing) throw new CommandError("unauthorized", "Not allowed");
    return toExercise(existing);
  },
});
