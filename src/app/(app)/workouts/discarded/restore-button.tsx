import { SubmitButton } from "@/components/ui/submit-button";
import { getRequestStrings } from "@/server/strings";
import { restoreDiscardedWorkout } from "./actions";

/** Restore a discarded workout back into history. No confirm: restoring is not destructive (#61). */
export async function RestoreButton({ id, className = "w-full" }: { id: string; className?: string }) {
  const s = await getRequestStrings();
  return (
    <form action={restoreDiscardedWorkout.bind(null, id)}>
      <SubmitButton variant="outline" className={className}>
        {s.archive.restore}
      </SubmitButton>
    </form>
  );
}
