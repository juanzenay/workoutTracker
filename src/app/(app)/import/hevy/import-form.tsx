"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { useStrings } from "@/strings/provider";
import { runHevyImport, type ImportState } from "./actions";

export function HevyImportForm({ connected }: { connected: boolean }) {
  const s = useStrings();
  const [state, action, pending] = useActionState<ImportState, FormData>(runHevyImport, { status: "idle" });

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={s.hevyImport.apiKey}>
        <TextInput
          name="apiKey"
          type="password"
          autoComplete="off"
          required={!connected}
          maxLength={200}
          placeholder={connected ? s.hevyImport.apiKeySaved : undefined}
        />
      </Field>
      <p className="text-sm text-muted">{s.hevyImport.apiKeyHint}</p>
      {state.status === "error" && (
        <p role="alert" className="text-sm text-danger">
          {s.hevyImport.errors[state.error]}
        </p>
      )}
      {state.status === "done" && (
        <p role="status" className="text-sm">
          {s.hevyImport.result(state.result.workouts)} {s.hevyImport.exercisesResult(state.result.exercises)}{" "}
          {s.hevyImport.routinesResult(state.result.routines, state.result.bodyMeasurements)}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? s.hevyImport.running : s.hevyImport.run}
      </Button>
    </form>
  );
}
