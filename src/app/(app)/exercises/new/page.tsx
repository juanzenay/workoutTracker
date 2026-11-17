import Link from "next/link";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { CustomExerciseForm } from "./custom-exercise-form";

export default async function NewExercisePage() {
  await requireCommands();
  const s = await getRequestStrings();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/exercises" className="flex min-h-touch items-center text-sm text-muted">
        ← {s.catalogue.back}
      </Link>
      <h1 className="text-2xl font-semibold">{s.customExercise.title}</h1>
      <CustomExerciseForm />
    </div>
  );
}
