"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Field, Select, TextInput } from "@/components/ui/field";
import {
  BODY_METRIC_KEYS,
  BODY_METRICS,
  LENGTH_UNITS,
  WEIGHT_UNITS,
  type BodyMeasurement,
  type BodyMetric,
} from "@/domain/body-measurement";
import { useStrings } from "@/strings/provider";
import type { MeasurementFormState } from "./actions";

const COMPOSITION = BODY_METRIC_KEYS.filter((m) => BODY_METRICS[m] !== "length");
const GIRTHS = BODY_METRIC_KEYS.filter((m) => BODY_METRICS[m] === "length");

/** Today in the viewer's timezone, YYYY-MM-DD. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function MeasurementForm({
  action: save,
  initial,
}: {
  action: (state: MeasurementFormState, formData: FormData) => Promise<MeasurementFormState>;
  /** Existing entry to edit, or just the units to start a new one with. */
  initial: Pick<BodyMeasurement, "weightUnit" | "lengthUnit"> & Partial<BodyMeasurement>;
}) {
  const s = useStrings();
  const [state, action, pending] = useActionState(save, { error: null });

  const metricInput = (metric: BodyMetric) => (
    <Field key={metric} label={s.bodyMetrics[metric]}>
      <TextInput
        name={metric}
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        defaultValue={initial.values?.[metric] ?? ""}
        className="font-numeric"
      />
    </Field>
  );

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label={s.measurements.date}>
          {/* Server and client may disagree on "today"; the client's value wins. */}
          <TextInput
            name="date"
            type="date"
            required
            defaultValue={initial.date ?? localToday()}
            suppressHydrationWarning
          />
        </Field>
        <Field label={s.measurements.weightUnit}>
          <Select name="weightUnit" defaultValue={initial.weightUnit}>
            {WEIGHT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold">{s.measurements.composition}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{COMPOSITION.map(metricInput)}</div>
      </fieldset>
      {/* Girths are occasional: folded away unless this entry already has some. */}
      <Disclosure summary={s.measurements.girths} open={GIRTHS.some((m) => initial.values?.[m] != null)}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label={s.measurements.lengthUnit}>
            <Select name="lengthUnit" defaultValue={initial.lengthUnit}>
              {LENGTH_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </Field>
          {GIRTHS.map(metricInput)}
        </div>
      </Disclosure>

      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error === "conflict" ? s.measurements.conflict : s.measurements.invalid}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {s.measurements.save}
      </Button>
    </form>
  );
}
