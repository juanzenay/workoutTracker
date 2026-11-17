import { loggedWeight, showsWeight, type Equipment } from "@/domain/exercise";
import { parseRepTarget } from "@/domain/routine";
import { type SetType, type WeightUnit } from "@/domain/workout";
import type { RoutineDraft } from "./actions";

/** Editor rows hold text as typed; it is parsed on save. `key` is a local React key only. */
export interface DraftSet {
  key: string;
  setType: SetType;
  weight: string;
  unit: WeightUnit;
  reps: string;
}

export interface DraftExercise {
  key: string;
  exerciseId: string;
  restSeconds: string;
  /** Not editable here yet (Hevy imports carry it); kept as is on save. */
  supersetGroup: number | null;
  notes: string;
  /** Body-only exercises show their weight input only after "+ add weight" (or once a set has a weight). */
  addedWeight: boolean;
  sets: DraftSet[];
}

/** Text → number, null for blank, NaN for nonsense (so the command rejects it). */
function toNumber(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  return trimmed === "" ? null : Number(trimmed);
}

/**
 * Null if a rep target is not one the command can store. Body-only exercises (per `equipmentOf`)
 * save their sets with no weight unless their weight input is shown (added, or already weighted).
 */
export function toPayload(
  name: string,
  folderId: string,
  notes: string,
  exercises: DraftExercise[],
  equipmentOf: (exerciseId: string) => Equipment | null,
): RoutineDraft | null {
  const out: RoutineDraft = { name, folderId: folderId || null, notes: notes || null, exercises: [] };
  for (const e of exercises) {
    const weightShown = showsWeight(
      equipmentOf(e.exerciseId),
      e.addedWeight,
      e.sets.some((s) => s.weight.trim() !== ""),
    );
    const sets = [];
    for (const s of e.sets) {
      const target = parseRepTarget(s.reps);
      if (!target) return null;
      sets.push({ setType: s.setType, weight: loggedWeight(weightShown, toNumber(s.weight)), unit: s.unit, ...target });
    }
    out.exercises!.push({
      exerciseId: e.exerciseId,
      restSeconds: toNumber(e.restSeconds),
      supersetGroup: e.supersetGroup,
      notes: e.notes || null,
      sets,
    });
  }
  return out;
}
