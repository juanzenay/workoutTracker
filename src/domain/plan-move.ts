import type { IsoDate } from "./block";

/**
 * A move the owner made by hand within a week: the item the engine planned on `from` happens on `to` instead.
 * `from` is always the engine's own day, so moving an item back is deleting its move.
 */
export interface SessionMove {
  blockSessionId: string;
  from: IsoDate;
  to: IsoDate;
}

export interface RunMove {
  runPlanId: string;
  rowIndex: number;
  from: IsoDate;
  to: IsoDate;
}

export interface PlanMoves {
  sessions: SessionMove[];
  runs: RunMove[];
}
