import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { deleteMeasurement, updateMeasurement } from "../actions";
import { MeasurementForm } from "../measurement-form";

export default async function EditMeasurementPage({ params }: PageProps<"/measurements/[id]">) {
  const s = await getRequestStrings();
  const { id } = await params;
  const commands = await requireCommands();
  const { items } = await commands.listBodyMeasurements({});
  const entry = items.find((m) => m.id === id);
  if (!entry) notFound();

  return (
    <div className="flex flex-col gap-4">
      <Link href="/measurements" className="flex min-h-touch items-center text-sm text-muted">
        ← {s.measurements.back}
      </Link>
      <h1 className="text-2xl font-semibold">{s.measurements.editTitle}</h1>
      <MeasurementForm action={updateMeasurement.bind(null, entry.id)} initial={entry} />
      <form action={deleteMeasurement.bind(null, entry.id)}>
        <SubmitButton confirm variant="ghost" className="w-full text-danger">
          {s.measurements.delete}
        </SubmitButton>
      </form>
    </div>
  );
}
