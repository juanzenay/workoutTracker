import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatPlanDate } from "@/components/planned-session";
import { GRADES, JOINTS, SIDES, TISSUES } from "@/domain/injury";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { clearInjury, deleteInjury, logInjury, updateInjuryGrade } from "./actions";

/** Log injuries by joint and grade: lifting re-plans around the open ones. */
export default async function InjuriesPage({ searchParams }: PageProps<"/injuries">) {
  const s = await getRequestStrings();
  const t = s.injuries;
  const commands = await requireCommands();
  const [{ injuries }, { error }] = await Promise.all([commands.listInjuries({}), searchParams]);
  const open = injuries.filter((i) => i.clearedDate === null);
  const cleared = injuries.filter((i) => i.clearedDate !== null);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t.title}</h1>
      <p className="text-muted">{t.intro}</p>

      <form action={logInjury} className="flex flex-col gap-3 rounded-card bg-surface p-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label={t.joint}>
            <Select name="joint" required defaultValue="knee">
              {JOINTS.map((j) => (
                <option key={j} value={j}>
                  {t.joints[j]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.side}>
            <Select name="side" required defaultValue="left">
              {SIDES.map((side) => (
                <option key={side} value={side}>
                  {t.sides[side]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.tissue}>
            <Select name="tissue" required defaultValue="ligament">
              {TISSUES.map((x) => (
                <option key={x} value={x}>
                  {t.tissues[x]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t.grade}>
            <Select name="grade" required defaultValue="1">
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {t.grades[g]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t.started}>
          <TextInput name="startDate" type="date" required />
        </Field>
        <Field label={t.note}>
          <TextInput name="note" maxLength={200} placeholder={t.notePlaceholder} />
        </Field>
        {error === "invalid" && (
          <p role="alert" className="text-danger">
            {t.invalid}
          </p>
        )}
        <SubmitButton type="submit">{t.log}</SubmitButton>
      </form>

      {injuries.length === 0 && <EmptyState>{t.none}</EmptyState>}

      {open.length > 0 && (
        <section aria-labelledby="open" className="flex flex-col gap-3">
          <h2 id="open" className="text-xl font-semibold">
            {t.open}
          </h2>
          <ul className="flex flex-col gap-2">
            {open.map((i) => (
              <li key={i.id} className="flex flex-col gap-3 rounded-card bg-surface p-3">
                <span className="flex flex-col">
                  <span className="font-semibold">
                    {t.sides[i.side]} {t.joints[i.joint].toLowerCase()} · {t.tissues[i.tissue].toLowerCase()} · {t.grades[i.grade]}
                  </span>
                  <span className="text-sm text-muted">{t.since(formatPlanDate(i.startDate))}</span>
                  {i.note && <span className="text-sm text-muted">{i.note}</span>}
                </span>
                <form action={updateInjuryGrade.bind(null, i.id)} className="flex items-end gap-2">
                  <Field label={t.grade}>
                    <Select name="grade" defaultValue={String(i.grade)}>
                      {GRADES.map((g) => (
                        <option key={g} value={g}>
                          {t.grades[g]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <SubmitButton variant="secondary">{t.updateGrade}</SubmitButton>
                </form>
                <div className="flex gap-2">
                  <form action={clearInjury.bind(null, i.id)}>
                    <SubmitButton variant="secondary">{t.clear}</SubmitButton>
                  </form>
                  <form action={deleteInjury.bind(null, i.id)}>
                    <SubmitButton variant="outline">{t.delete}</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cleared.length > 0 && (
        <section aria-labelledby="cleared" className="flex flex-col gap-3">
          <h2 id="cleared" className="text-xl font-semibold">
            {t.cleared}
          </h2>
          <ul className="flex flex-col gap-2">
            {cleared.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 rounded-card bg-surface p-3">
                <span className="flex flex-col">
                  <span className="font-semibold">
                    {t.sides[i.side]} {t.joints[i.joint].toLowerCase()} · {t.tissues[i.tissue].toLowerCase()} · {t.grades[i.grade]}
                  </span>
                  <span className="text-sm text-muted">
                    {t.since(formatPlanDate(i.startDate))}, {t.clearedOn(formatPlanDate(i.clearedDate!))}
                  </span>
                </span>
                <form action={deleteInjury.bind(null, i.id)}>
                  <SubmitButton variant="outline">{t.delete}</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
