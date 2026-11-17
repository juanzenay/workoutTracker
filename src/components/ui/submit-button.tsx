"use client";

import { useFormStatus } from "react-dom";
import { useStrings } from "@/strings/provider";
import { Button, type ButtonProps } from "./button";
import { useArmed } from "./use-armed";

/**
 * A form's submit button: disabled with a spinner while the form's action runs, so a slow
 * network never looks like a dead tap. With `confirm`, the first tap only arms it ("Tap again
 * to confirm") for a few seconds; use it for actions that destroy data.
 */
export function SubmitButton({ confirm = false, children, onClick, disabled, variant, className = "", ...props }: ButtonProps & { confirm?: boolean }) {
  const s = useStrings();
  const { pending } = useFormStatus();
  const [armed, arm] = useArmed();

  return (
    <Button
      type="submit"
      variant={armed ? "danger" : variant}
      // An armed button is filled with --danger, so a text-danger label would vanish into it.
      className={armed ? className.replace(/\btext-danger\b/g, "") : className}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      onClick={(e) => {
        if (confirm && !armed) {
          e.preventDefault();
          arm();
        }
        onClick?.(e);
      }}
      {...props}
    >
      {pending && <Spinner />}
      {armed ? s.common.confirmDelete : children}
    </Button>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="mr-2 inline-block size-4 animate-spin align-[-0.125em] rounded-full border-2 border-current border-r-transparent"
    />
  );
}
