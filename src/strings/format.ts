import type { IsoDate } from "@/domain/block";
import type { Message, MessageCode, Text } from "@/domain/message";
import type { WeightUnit } from "@/domain/workout";

/** What a message renderer gets besides its message: the pack's own formatting (src/strings/render.ts builds it). */
export interface Format {
  /** Any nested text, rendered by the same pack. */
  text(text: Text): string;
  /** "Sunday, Mar 28". */
  day(date: IsoDate): string;
  /** "Sunday". */
  weekday(date: IsoDate): string;
  /** A day, or "Monday, Oct 12 to Wednesday, Oct 14". */
  range(from: IsoDate, to: IsoDate): string;
  /** "13 mi". */
  miles(meters: number): string;
  /** "180 lb"; null = bodyweight. */
  weight(weight: number | null, unit: WeightUnit | null): string;
  /** "week 4", "weeks 5–6", "weeks 2 and 5". */
  weeks(weeks: number[]): string;
}

export type MessageOf<C extends MessageCode> = Extract<Message, { code: C }>;

/** One renderer per message code: every pack has words for every message. */
export type MessageRenderers = { [C in MessageCode]: (message: MessageOf<C>, f: Format) => string };
