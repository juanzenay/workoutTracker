import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatPlanDate } from "@/components/planned-session";
import { Field, TextInput } from "@/components/ui/field";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { clearUnavailable, markUnavailable } from "./actions";

/** Mark days unavailable (sick, away, busy): the plan re-plans around them. */
export default async function UnavailablePage({ searchParams }: PageProps<"/unavailable">) {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const [{ unavailability }, { error }] = await Promise.all([commands.listUnavailability({}), searchParams]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{s.unavailable.title}</h1>
      <p className="text-muted">{s.unavailable.intro}</p>

      <form action={markUnavailable} className="flex flex-col gap-3 rounded-card bg-surface p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label={s.unavailable.from}>
            <TextInput name="startDate" type="date" required />
          </Field>
          <Field label={s.unavailable.to}>
            <TextInput name="endDate" type="date" required />
          </Field>
        </div>
        <Field label={s.unavailable.note}>
          <TextInput name="note" maxLength={200} placeholder={s.unavailable.notePlaceholder} />
        </Field>
        {error === "invalid" && (
          <p role="alert" className="text-danger">
            {s.unavailable.invalid}
          </p>
        )}
        <SubmitButton type="submit">{s.unavailable.mark}</SubmitButton>
      </form>

      <section aria-labelledby="marked" className="flex flex-col gap-3">
        <h2 id="marked" className="text-xl font-semibold">
          {s.unavailable.marked}
        </h2>
        {unavailability.length === 0 && <EmptyState>{s.unavailable.none}</EmptyState>}
        <ul className="flex flex-col gap-2">
          {unavailability.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 rounded-card bg-surface p-3">
              <span className="flex flex-col">
                <span className="font-semibold">
                  {s.unavailable.range(formatPlanDate(u.startDate), formatPlanDate(u.endDate))}
                </span>
                {u.note && <span className="text-sm text-muted">{u.note}</span>}
              </span>
              <form action={clearUnavailable.bind(null, u.id)}>
                <SubmitButton variant="secondary">
                  {s.unavailable.clear}
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
