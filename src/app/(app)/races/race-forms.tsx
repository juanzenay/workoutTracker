"use client";

import { useActionState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/field";
import { METERS_PER_MILE } from "@/domain/distance";
import { RACE_PRIORITIES, type Race } from "@/domain/running";
import { useStrings } from "@/strings/provider";
import type { ImportPlanState, RaceFormState } from "./actions";

/** Add or edit a race. Distances are entered in mi or km and stored in meters. */
export function RaceForm({
  action: save,
  race,
  submitLabel,
}: {
  action: (state: RaceFormState, formData: FormData) => Promise<RaceFormState>;
  race?: Race;
  submitLabel: string;
}) {
  const s = useStrings();
  const [state, action, pending] = useActionState(save, { error: null });
  const miles = race ? Number((race.distanceMeters / METERS_PER_MILE).toFixed(2)) : undefined;

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={s.running.raceName}>
          <TextInput name="name" required maxLength={120} defaultValue={race?.name} placeholder={s.running.raceNamePlaceholder} />
        </Field>
        <Field label={s.running.raceDate}>
          <TextInput name="date" type="date" required defaultValue={race?.date} />
        </Field>
        <div className="grid grid-cols-[1fr_6rem] gap-2">
          <Field label={s.running.raceDistance}>
            <TextInput
              name="distance"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              required
              defaultValue={miles}
              className="font-numeric"
            />
          </Field>
          <Field label={s.running.distanceUnit}>
            <Select name="distanceUnit" defaultValue="mi">
              <option value="mi">mi</option>
              <option value="km">km</option>
            </Select>
          </Field>
        </div>
        <Field label={s.running.priority}>
          <Select name="priority" defaultValue={race?.priority ?? "A"}>
            {RACE_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {s.running.priorities[p]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {s.running.invalidRace}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {submitLabel}
      </Button>
    </form>
  );
}

const noSubscribe = () => () => {};
const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Upload a run plan file; every invalid row is listed. */
export function ImportPlanForm({
  action: importPlan,
  races,
}: {
  action: (state: ImportPlanState, formData: FormData) => Promise<ImportPlanState>;
  races: Race[];
}) {
  const s = useStrings();
  const [state, action, pending] = useActionState(importPlan, { error: null });
  const timeZone = useSyncExternalStore(noSubscribe, deviceTimeZone, () => "UTC");
  const aRaces = races.filter((r) => r.priority === "A");

  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm text-muted">{s.running.importHelp}</p>
      <input type="hidden" name="timeZone" value={timeZone} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={s.running.planFile}>
          <TextInput name="file" type="file" accept=".csv,.json,text/csv,application/json" required className="py-2" />
        </Field>
        <Field label={s.running.anchorRace}>
          <Select name="raceId" defaultValue={aRaces[0]?.id ?? ""}>
            {races.map((race) => (
              <option key={race.id} value={race.id}>
                {race.name} ({race.priority})
              </option>
            ))}
          </Select>
        </Field>
        <Field label={s.running.planName}>
          <TextInput name="name" maxLength={120} />
        </Field>
      </div>
      {state.error && (
        <div role="alert" className="flex flex-col gap-1 text-sm text-danger">
          {state.error === "rows" ? (
            <>
              <p>{s.running.importProblems(state.rows.length)}</p>
              <ul className="flex flex-col gap-0.5">
                {state.rows.map((problem, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.running.rowProblem(problem.row)}:</span> {problem.message}
                  </li>
                ))}
              </ul>
            </>
          ) : state.error === "noARace" ? (
            <p>{s.running.noARace}</p>
          ) : state.error === "unreadable" ? (
            <p>{s.running.unreadable}</p>
          ) : (
            <p>{state.message}</p>
          )}
        </div>
      )}
      <Button type="submit" disabled={pending || races.length === 0}>
        {pending ? s.running.importing : s.running.importButton}
      </Button>
    </form>
  );
}
