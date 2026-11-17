import type { IsoDate, Weekday } from "@/domain/block";
import { milesFigure } from "@/domain/distance";
import { isMessage, type Message, type Text } from "@/domain/message";
import type { Strings } from "./en";
import type { Format } from "./format";

/** ISO weekday of a "YYYY-MM-DD" date: 1 = Monday … 7 = Sunday. */
const weekdayOf = (date: IsoDate) => ((((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) as Weekday);

/** Meters in miles, in the pack's words: "13 mi", "9.7 mi". The one miles formatter (plans, reasons, dashboards). */
export function formatMiles(meters: number, s: Strings): string {
  return s.running.miles(milesFigure(meters));
}

/** The pack's formatting for message renderers. */
function formatFor(s: Strings): Format {
  const p = s.planText;
  const f: Format = {
    text: (text) => renderText(s, text),
    weekday: (date) => s.weekdays[weekdayOf(date)],
    day: (date) => p.day(s.weekdays[weekdayOf(date)], p.months[Number(date.slice(5, 7)) - 1]!, Number(date.slice(8))),
    range: (from, to) => (from === to ? f.day(from) : p.range(f.day(from), f.day(to))),
    miles: (meters) => formatMiles(meters, s),
    weight: (weight, unit) => (weight === null ? p.bodyweight : p.weight(weight, unit ?? "")),
    weeks: (weeks) => {
      const sorted = weeks.toSorted((a, b) => a - b);
      if (sorted.length === 1) return p.week(sorted[0]!);
      const consecutive = sorted.every((w, i) => i === 0 || w === sorted[i - 1]! + 1);
      return consecutive ? p.weekSpan(sorted[0]!, sorted.at(-1)!) : p.weekList(sorted.slice(0, -1).join(", "), sorted.at(-1)!);
    },
  };
  return f;
}

/** Text in the pack's words: a message rendered by its code; free text (and rows from before messages) as is. */
export function renderText(s: Strings, text: Text): string {
  if (!isMessage(text)) return String(text);
  const render = s.planText.messages[text.code] as ((m: Message, f: Format) => string) | undefined;
  return render ? render(text, formatFor(s)) : text.code;
}

/** Messages anywhere in `value` replaced by their text (for output that leaves workout tracker, e.g. MCP tool results). */
export function renderMessages(s: Strings, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => renderMessages(s, v));
  if (!value || typeof value !== "object") return value;
  if (isMessage(value) && value.code in s.planText.messages) return renderText(s, value);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderMessages(s, v)]));
}
