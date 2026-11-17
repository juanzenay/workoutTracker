"use client";

import { useActionState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { useStrings } from "@/strings/provider";
import { addManualRun, type ManualRunState } from "./actions";

/** Today on this device (the server doesn't know the owner's clock). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const subscribe = () => () => {};

/** Types in a run: a day and the miles run. Several on a day add up toward that day's goal. */
export function ManualRunForm({ date: fixedDate }: { date?: string } = {}) {
  const s = useStrings();
  const [state, action, pending] = useActionState(addManualRun, { status: "idle" } as ManualRunState);
  const deviceToday = useSyncExternalStore(subscribe, today, () => "");
  const date = fixedDate ?? deviceToday;

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className={fixedDate ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
        {fixedDate ? (
          <input type="hidden" name="date" value={fixedDate} />
        ) : (
          <Field label={s.runImport.manualDate}>
            <TextInput name="date" type="date" required defaultValue={date} key={date} />
          </Field>
        )}
        <Field label={s.runImport.manualMiles}>
          <TextInput name="miles" type="number" inputMode="decimal" step="any" min="0.01" required className="font-numeric" />
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {s.runImport.manualAdd}
      </Button>
      {state.status === "added" && (
        <p role="status" className="text-sm">
          {s.runImport.manualAdded}
        </p>
      )}
      {state.status === "invalid" && (
        <p role="alert" className="text-sm text-danger">
          {s.runImport.manualInvalid}
        </p>
      )}
    </form>
  );
}
