"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { useStrings } from "@/strings/provider";
import { signIn, type SignInState } from "./actions";

export function SignInForm({ next }: { next?: string }) {
  const s = useStrings();
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { failed: false });

  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <Field label={s.signIn.email}>
        <TextInput name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label={s.signIn.password}>
        <TextInput name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state.resent && (
        <p role="status" className="text-sm text-muted">
          {s.signIn.unconfirmed}
        </p>
      )}
      {state.failed && (
        <p role="alert" className="text-sm text-danger">
          {s.signIn.failed}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {s.signIn.submit}
      </Button>
    </form>
  );
}
