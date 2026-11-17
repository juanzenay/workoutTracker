"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { useStrings } from "@/strings/provider";
import { claimDeployment, type ClaimState } from "./actions";

/** Shown instead of sign-in while nobody owns the deployment: the account created here becomes the owner. */
export function ClaimForm() {
  const s = useStrings();
  const [state, action, pending] = useActionState<ClaimState, FormData>(claimDeployment, { status: "idle" });

  if (state.status === "check-email") {
    return (
      <p role="status" className="text-muted">
        {s.claim.checkEmail}
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label={s.claim.email}>
        <TextInput name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={s.claim.password}>
        <TextInput name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>
      {(state.status === "refused" || state.status === "failed") && (
        <p role="alert" className="text-sm text-danger">
          {state.status === "refused" ? s.claim.refused : s.claim.failed}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {s.claim.submit}
      </Button>
    </form>
  );
}
