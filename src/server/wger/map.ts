import type { Category, Equipment, Muscle } from "@/domain/exercise";
import {
  WGER_CARDIO_CATEGORY_ID,
  WGER_ENGLISH_LANGUAGE_ID,
  WGER_EQUIPMENT,
  WGER_MUSCLES,
  type WgerAttribution,
} from "@/domain/wger";
import type { WgerExerciseInfo } from "./client";

/** A wger exercise translated into workout tracker's vocabulary, ready to become a catalogue exercise. */
export interface WgerExerciseDraft {
  wgerId: number;
  /** Stable across wger instances (the numeric id is instance-local); stored as the exercise's source_ref. */
  wgerUuid: string;
  name: string;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  equipment: Equipment | null;
  category: Category;
  instructions: string[];
  imageUrls: string[];
  attribution: WgerAttribution;
}

function muscles(ids: { id: number }[], exclude: Muscle[] = []): Muscle[] {
  const mapped = ids.map(({ id }) => WGER_MUSCLES[id]?.muscle).filter((m): m is Muscle => !!m);
  return [...new Set(mapped)].filter((m) => !exclude.includes(m));
}

function equipment(items: { id: number }[]): Equipment | null {
  const mapped = items.map(({ id }) => WGER_EQUIPMENT[id]).filter((e) => !!e);
  return (mapped.find((e) => !e.accessory) ?? mapped[0])?.equipment ?? null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** wger descriptions are HTML; workout tracker keeps plain-text steps (one per paragraph or list item). */
export function htmlToSteps(html: string): string[] {
  return html
    .split(/<\/?(?:p|li|ol|ul|div|h\d)\b[^>]*>|<br\s*\/?>/i)
    .map((chunk) => decodeEntities(chunk.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function toWgerDraft(info: WgerExerciseInfo, baseUrl: string): WgerExerciseDraft {
  const translation =
    info.translations.find((t) => t.language === WGER_ENGLISH_LANGUAGE_ID) ?? info.translations[0];
  const primaryMuscles = muscles(info.muscles);
  const images = [...info.images].sort((a, b) => Number(b.is_main) - Number(a.is_main));
  return {
    wgerId: info.id,
    wgerUuid: info.uuid,
    name: (translation?.name ?? `wger exercise ${info.id}`).trim().slice(0, 120),
    primaryMuscles,
    secondaryMuscles: muscles(info.muscles_secondary, primaryMuscles),
    equipment: equipment(info.equipment),
    category: info.category.id === WGER_CARDIO_CATEGORY_ID ? "cardio" : "strength",
    instructions: translation ? htmlToSteps(translation.description) : [],
    imageUrls: images.map((i) => new URL(i.image, baseUrl).toString()),
    attribution: {
      licenseShortName: info.license.short_name,
      licenseName: info.license.full_name,
      licenseUrl: info.license.url,
      authors: info.total_authors_history.length
        ? info.total_authors_history
        : [info.license_author].filter((a): a is string => !!a),
      sourceUrl: `${baseUrl}/exercise/${info.id}/view-base`,
    },
  };
}
