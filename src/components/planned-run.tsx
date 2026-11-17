import type { Intensity, PaceTarget, PlannedRun, RunStep, RunStructure } from "@/domain/running";
import { METERS_PER_MILE } from "@/domain/distance";
import type { Strings } from "@/strings";
import { formatMiles } from "@/strings/render";

/** Display helpers for planned runs. Stored in meters / seconds / s per km; shown in miles and min/mile. */

export { formatMiles };

/** Short distances (track reps) in meters, longer in miles. */
function formatStepDistance(meters: number, s: Strings): string {
  return meters < 1500 ? s.running.meters(meters) : formatMiles(meters, s);
}

export function formatDuration(seconds: number, s: Strings): string {
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? s.running.minutes(minutes) : s.running.hoursMinutes(Math.floor(minutes / 60), minutes % 60);
}

const minSec = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** "9:00–9:30 /mi" from seconds per km. */
export function formatPace(target: PaceTarget, s: Strings): string {
  const [lo, hi] = target.perKmSeconds.map((perKm) => Math.round(perKm * (METERS_PER_MILE / 1000)));
  return s.running.pace(lo === hi ? minSec(lo!) : `${minSec(lo!)}–${minSec(hi!)}`);
}

function formatIntensity(intensity: Intensity, s: Strings): string {
  switch (intensity.kind) {
    case "pace":
      return formatPace({ perKmSeconds: intensity.perKmSeconds }, s);
    case "hr_zone":
      return s.running.hrZone(intensity.zone);
    case "hr":
      return s.running.hr(...intensity.bpm);
    case "pct_threshold_pace":
      return s.running.pctThreshold(...intensity.pct);
  }
}

function formatStep(step: RunStep, s: Strings): string {
  const target =
    step.distanceMeters !== undefined
      ? formatStepDistance(step.distanceMeters, s)
      : step.durationSeconds !== undefined
        ? formatDuration(step.durationSeconds, s)
        : s.running.open;
  return step.intensity ? `${target} @ ${formatIntensity(step.intensity, s)}` : target;
}

/** "Warm-up 1 mi @ HR zone 2 · 6 × (800 m work @ 6:40–6:55 /mi, 400 m recovery) · Cool-down 10 min". */
export function formatStructure(structure: RunStructure, s: Strings): string {
  return [
    structure.warmup && `${s.running.warmup} ${formatStep(structure.warmup, s)}`,
    structure.main && `${s.running.main} ${formatStep(structure.main, s)}`,
    ...(structure.repeats ?? []).map(
      (repeat) =>
        `${repeat.count} × (${repeat.steps.map((step) => `${formatStep(step, s)} ${s.running[step.kind]}`).join(", ")})`,
    ),
    structure.cooldown && `${s.running.cooldown} ${formatStep(structure.cooldown, s)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Race pace · 5 mi · 8:45–9:01 /mi". */
export function runHeadline(run: PlannedRun, s: Strings): string {
  return [
    s.running.runTypes[run.type],
    run.distanceMeters !== null && formatMiles(run.distanceMeters, s),
    run.durationSeconds !== null && formatDuration(run.durationSeconds, s),
    run.paceTarget && formatPace(run.paceTarget, s),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** One planned run: headline, structure and notes. */
export function PlannedRunDetails({ run, s }: { run: PlannedRun & RunOutcome; s: Strings }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{runHeadline(run, s)}</span>
      {run.structure && <span className="text-sm">{formatStructure(run.structure, s)}</span>}
      {run.notes && <span className="text-sm text-muted">{run.notes}</span>}
      <RunOutcomeLine run={run} s={s} />
    </div>
  );
}

/** How a planned run went, from Strava or imported files (see run-matching.ts). */
export interface RunOutcome {
  status?: "done" | "partial" | "missed" | null;
  actualMeters?: number | null;
  gapMeters?: number | null;
}

const STATUS_CLASS = { done: "text-success-text", partial: "text-fg", missed: "text-danger" } as const;

/** "Done · ran 10.0 mi", "Partial · ran 4 mi · 1 mi short", "Missed"; nothing while the run is still to come. */
export function RunOutcomeLine({ run, s }: { run: RunOutcome; s: Strings }) {
  if (!run.status) return null;
  const parts = [
    s.running.status[run.status],
    run.actualMeters ? s.running.ran(formatMiles(run.actualMeters, s)) : null,
    run.gapMeters ? s.running.short(formatMiles(run.gapMeters, s)) : null,
  ].filter(Boolean);
  return (
    <span className={`text-sm font-medium ${STATUS_CLASS[run.status]}`} data-run-status={run.status}>
      {parts.join(" · ")}
    </span>
  );
}
