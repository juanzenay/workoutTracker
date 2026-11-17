import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatMiles } from "@/components/planned-run";
import { formatPlanDate } from "@/components/planned-session";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import { sportWords } from "@/strings/en";
import { ActivityImportForm } from "./import-form";
import { deleteManualRun } from "./actions";
import { ManualRunForm } from "./manual-run-form";

/** Completed runs: import activity files exported from the watch's app, and see what came in (files and Strava). */
export default async function RunsPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { activities } = await commands.listActivities({ limit: 30 });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{s.runImport.title}</h1>
      <p className="text-muted">{s.runImport.intro}</p>
      <p className="text-sm text-muted">{s.runImport.howTo}</p>

      <section aria-labelledby="manual" className="flex flex-col gap-3 rounded-card bg-surface p-4">
        <h2 id="manual" className="text-xl font-semibold">
          {s.runImport.manualTitle}
        </h2>
        <ManualRunForm />
      </section>

      <section className="flex flex-col gap-3 rounded-card bg-surface p-4">
        <ActivityImportForm />
        <p className="text-xs text-muted">{s.runImport.lateNote}</p>
      </section>

      <section aria-labelledby="activities" className="flex flex-col gap-2">
        <h2 id="activities" className="text-xl font-semibold">
          {s.runImport.activitiesTitle}
        </h2>
        {activities.length === 0 ? (
          <p className="text-muted">{s.runImport.noActivities}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activities.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 rounded-card bg-surface p-3">
                <span className="font-medium">
                  {[formatPlanDate(a.localDate), a.distanceMeters > 0 && formatMiles(a.distanceMeters, s)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <span className="text-sm text-muted">
                  {[a.name ?? sportWords(a.sportType), a.source === "file" ? s.runImport.fromFile(a.fileName ?? "") : a.source === "manual" ? s.runImport.fromManual : s.runImport.fromStrava]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {a.plannedRunId && <span className="text-sm text-success-text">{s.runImport.matched}</span>}
                {a.source === "manual" && (
                  <form action={deleteManualRun}>
                    <input type="hidden" name="id" value={a.id} />
                    <Button type="submit" variant="ghost" className="text-danger">
                      {s.runImport.manualDelete}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href="/races" className="text-sm text-muted">
        ← {s.running.back}
      </Link>
    </div>
  );
}
