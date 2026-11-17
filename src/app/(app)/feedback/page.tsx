import { LocalDateTime } from "@/components/local-date-time";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { addFeedback, deleteFeedback, setFeedbackDone } from "./actions";

/** Issues and ideas jotted down to tackle later: open ones first, then what's done. */
export default async function FeedbackPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { items } = await commands.listFeedback({});
  const open = items.filter((item) => item.doneAt === null);
  const done = items.filter((item) => item.doneAt !== null);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{s.feedback.title}</h1>
      <p className="text-muted">{s.feedback.hint}</p>
      <form action={addFeedback} className="flex flex-col gap-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {s.feedback.label}
          <textarea
            name="body"
            required
            rows={3}
            maxLength={4000}
            placeholder={s.feedback.placeholder}
            className="w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-fg placeholder:text-muted"
          />
        </label>
        <SubmitButton>{s.feedback.add}</SubmitButton>
      </form>

      {items.length === 0 ? (
        <EmptyState>{s.feedback.empty}</EmptyState>
      ) : (
        <>
          {open.length > 0 && (
            <section aria-label={s.feedback.open} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted">{s.feedback.open}</h2>
              <ul className="flex flex-col gap-2">
                {open.map((item) => (
                  <Item key={item.id} item={item} s={s} />
                ))}
              </ul>
            </section>
          )}
          {done.length > 0 && (
            <section aria-label={s.feedback.done} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted">{s.feedback.done}</h2>
              <ul className="flex flex-col gap-2">
                {done.map((item) => (
                  <Item key={item.id} item={item} s={s} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Item({
  item,
  s,
}: {
  item: { id: string; body: string; createdAt: string; doneAt: string | null };
  s: Awaited<ReturnType<typeof getRequestStrings>>;
}) {
  const finished = item.doneAt !== null;
  return (
    <li className="flex flex-col gap-2 rounded-card bg-surface p-4">
      <p className={`whitespace-pre-wrap ${finished ? "text-muted line-through" : ""}`}>{item.body}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <LocalDateTime iso={item.createdAt} />
        <div className="flex gap-2">
          <form action={setFeedbackDone.bind(null, item.id, !finished)}>
            <SubmitButton variant="outline" className="text-sm">
              {finished ? s.feedback.reopen : s.feedback.markDone}
            </SubmitButton>
          </form>
          <form action={deleteFeedback.bind(null, item.id)}>
            <SubmitButton variant="ghost" className="text-sm" confirm>
              {s.feedback.remove}
            </SubmitButton>
          </form>
        </div>
      </div>
    </li>
  );
}
