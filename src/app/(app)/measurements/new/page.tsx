import Link from "next/link";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { logMeasurement } from "../actions";
import { MeasurementForm } from "../measurement-form";

export default async function NewMeasurementPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  // Start with the units of the latest entry, so a lb/in owner never has to switch them.
  const {
    items: [latest],
  } = await commands.listBodyMeasurements({});

  return (
    <div className="flex flex-col gap-4">
      <Link href="/measurements" className="flex min-h-touch items-center text-sm text-muted">
        ← {s.measurements.back}
      </Link>
      <h1 className="text-2xl font-semibold">{s.measurements.log}</h1>
      <MeasurementForm
        action={logMeasurement}
        initial={{ weightUnit: latest?.weightUnit ?? "lb", lengthUnit: latest?.lengthUnit ?? "cm" }}
      />
    </div>
  );
}
