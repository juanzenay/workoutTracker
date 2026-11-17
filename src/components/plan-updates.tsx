import { confirmPlanChange, rejectPlanChange, undoPlanChange } from "@/app/(app)/plan-actions";
import type { PlanRevision } from "@/domain/plan-change";
import type { Strings } from "@/strings";
import { renderText } from "@/strings/render";
import { formatPlanDate } from "./planned-session";
import { Button } from "./ui/button";

/** Dates listed per session or run before "+N more" (a whole imported run plan touches dozens). */
const MAX_DATES = 3;

/** "Chest Upper on Tue, Oct 20; Tue, Oct 27", "Long run on Sun, Mar 28 → Mon, Mar 29" — the planned sessions and runs a change touches. */
function affected(revision: PlanRevision, s: Strings): string {
  const byName = new Map<string, string[]>();
  for (const item of revision.diff) {
    const name = item.type === "run" ? s.running.runTypes[(item.before ?? item.after)!.type] : item.sessionName;
    const dates = byName.get(name) ?? [];
    let when: string;
    if (item.type === "exercise") when = formatPlanDate(item.date);
    else if (item.before && item.after) when = s.planUpdates.movedTo(formatPlanDate(item.before.date), formatPlanDate(item.after.date));
    else if (item.before) when = s.planUpdates.offPlan(formatPlanDate(item.before.date));
    else when = formatPlanDate(item.after!.date);
    if (!dates.includes(when)) dates.push(when);
    byName.set(name, dates);
  }
  return [...byName]
    .map(([name, dates]) => {
      const shown = dates.slice(0, MAX_DATES);
      if (dates.length > MAX_DATES) shown.push(s.planUpdates.more(dates.length - MAX_DATES));
      return s.planUpdates.sessionOn(name, shown.join("; "));
    })
    .join("; ");
}

/** "Plan updated" cards (with one-tap Undo) and pending changes (Confirm / Reject); other statuses just show where they stand. */
export function PlanUpdates({ revisions, s }: { revisions: PlanRevision[]; s: Strings }) {
  if (revisions.length === 0) return null;
  return (
    <section id="plan-changes" aria-label={s.planUpdates.title} className="flex flex-col gap-3">
      {revisions.map((revision) => {
        const pending = revision.status === "pending";
        const headingId = `plan-change-${revision.id}`;
        return (
          <article
            key={revision.id}
            aria-labelledby={headingId}
            className={`flex flex-col gap-2 rounded-card bg-surface p-4 ${pending ? "border border-accent" : ""}`}
          >
            <p className="text-sm font-medium text-muted">
              {s.planUpdates.status[revision.status]}
              {revision.source === "coach" && ` · ${s.planUpdates.fromCoach}`}
            </p>
            <h2 id={headingId} className="text-lg font-semibold">
              {renderText(s, revision.summary)}
            </h2>
            {revision.reasons.map((reason, i) => (
              <p key={i}>{renderText(s, reason)}</p>
            ))}
            {revision.diff.length > 0 && (
              <p className="text-sm text-muted">{s.planUpdates.affects(affected(revision, s))}</p>
            )}
            {pending ? (
              <div className="flex gap-2">
                <form action={confirmPlanChange.bind(null, revision.id)} className="flex-1">
                  <Button className="w-full">{s.planUpdates.confirm}</Button>
                </form>
                <form action={rejectPlanChange.bind(null, revision.id)} className="flex-1">
                  <Button variant="secondary" className="w-full">
                    {s.planUpdates.reject}
                  </Button>
                </form>
              </div>
            ) : revision.status === "applied" ? (
              <form action={undoPlanChange.bind(null, revision.id)}>
                <Button variant="secondary">{s.planUpdates.undo}</Button>
              </form>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
