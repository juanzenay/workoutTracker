"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { ImportedFile } from "@/server/commands/activity-imports";
import { renderText } from "@/strings/render";
import { useStrings } from "@/strings/provider";

/** Requests stay under this size (the platform's request body limit is 4.5 MB); a bigger file goes on its own. */
const BATCH_BYTES = 3_500_000;

function batches(files: File[]): File[][] {
  const out: File[][] = [];
  let current: File[] = [];
  let size = 0;
  for (const file of files) {
    if (current.length > 0 && size + file.size > BATCH_BYTES) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(file);
    size += file.size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

type State = { status: "idle" } | { status: "running" } | { status: "done"; files: ImportedFile[]; error: boolean };

/** Picks activity files and uploads them (in batches) to /api/activities/import; shows each file's outcome. */
export function ActivityImportForm() {
  const s = useStrings();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const picked = [...((form.elements.namedItem("files") as HTMLInputElement).files ?? [])];
    if (picked.length === 0) return;
    setState({ status: "running" });
    const results: ImportedFile[] = [];
    let error = false;
    for (const batch of batches(picked)) {
      const body = new FormData();
      for (const file of batch) body.append("files", file);
      try {
        const response = await fetch("/api/activities/import", { method: "POST", body });
        if (!response.ok) throw new Error(String(response.status));
        results.push(...((await response.json()) as { files: ImportedFile[] }).files);
      } catch {
        error = true;
      }
    }
    setState({ status: "done", files: results, error });
    form.reset();
    router.refresh();
  }

  const imported = state.status === "done" ? state.files.filter((f) => f.status === "imported").length : 0;
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label={s.runImport.files}>
        <input
          name="files"
          type="file"
          multiple
          required
          accept=".fit,.gpx,.tcx,.FIT,.GPX,.TCX"
          className="min-h-touch w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-fg"
        />
      </Field>
      <Button type="submit" disabled={state.status === "running"}>
        {state.status === "running" ? s.runImport.running : s.runImport.run}
      </Button>
      {state.status === "done" && (
        <section aria-labelledby="import-results" className="flex flex-col gap-2">
          <h2 id="import-results" className="font-semibold">
            {s.runImport.resultsTitle}
          </h2>
          <p role="status" className="text-sm">
            {s.runImport.imported(imported)}
          </p>
          {state.error && (
            <p role="alert" className="text-sm text-danger">
              {s.runImport.failed}
            </p>
          )}
          <ul className="flex flex-col gap-1 text-sm">
            {state.files.map((file, i) => (
              <li key={`${file.name}-${i}`} className={file.status === "failed" ? "text-danger" : undefined}>
                <span className="font-medium">{file.name}</span>: {renderText(s, file.message)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </form>
  );
}
