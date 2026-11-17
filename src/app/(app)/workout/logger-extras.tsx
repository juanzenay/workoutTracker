"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkoutStore } from "@/client/workout-store";
import { Button } from "@/components/ui/button";
import { useArmed } from "@/components/ui/use-armed";
import {
  DEFAULT_REST_SECONDS,
  restDisplay,
  RIR_VALUES,
  type RestTimer,
  type WorkoutExercise,
  type WorkoutSet,
} from "@/domain/workout";
import { useStrings } from "@/strings/provider";

/**
 * Logger extras (#6): notes, supersets, RIR and the rest timer. Everything
 * writes through the local workout store, so it all works offline.
 */

/**
 * Free-text notes, saved when the field loses focus. Empty notes fold into a small "+ Note" chip
 * (named after the field) so they don't take a row until wanted.
 */
export function NotesField({
  label,
  chip,
  value,
  onSave,
  className = "",
}: {
  /** What the notes are for, shown above them once written and as their placeholder. */
  label: string;
  /** Short name on the "+" chip while empty, so several note fields on a card can be told apart. */
  chip: string;
  value: string | null;
  onSave: (notes: string | null) => void;
  className?: string;
}) {
  const s = useStrings();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const text = draft ?? value ?? "";
  if (!open && !text) {
    return (
      <Button variant="outline" aria-label={label} className="text-sm" onClick={() => setOpen(true)}>
        + {chip}
      </Button>
    );
  }
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs font-medium uppercase text-muted">{label}</span>
      <textarea
        placeholder={s.loggerExtras.notesPlaceholder}
        autoFocus={open && !value}
        rows={text ? 2 : 1}
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft !== (value ?? "")) onSave(draft.trim() ? draft : null);
          // Stay open while the saved text arrives, so the field doesn't flicker to the chip.
          if (!draft?.trim()) setOpen(false);
          setDraft(null);
        }}
        className="w-full resize-y rounded-control border border-border-strong bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted"
      />
    </label>
  );
}

/** Superset letters in workout order: the first group is A, the next B… */
export function supersetLabels(exercises: WorkoutExercise[]): Map<number, string> {
  const labels = new Map<number, string>();
  for (const e of exercises) {
    if (e.supersetGroup !== null && !labels.has(e.supersetGroup)) {
      labels.set(e.supersetGroup, String.fromCharCode(65 + (labels.size % 26)));
    }
  }
  return labels;
}

/** One-tap RIR (0 / 1 / 2 / 3+) for an exercise's last set. Tapping the chosen value again clears it. */
export function RirPicker({ store, set }: { store: WorkoutStore; set: WorkoutSet }) {
  const s = useStrings();
  return (
    <div role="group" aria-label={s.loggerExtras.rirLabel} className="flex items-center gap-2 px-1">
      <span className="w-12 text-center text-xs uppercase text-muted">{s.loggerExtras.rir}</span>
      {RIR_VALUES.map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={set.rir === value}
          onClick={() => void store.updateSet(set.id, { rir: set.rir === value ? null : value })}
          className="min-h-touch flex-1 rounded-control bg-surface-raised font-numeric text-muted aria-pressed:bg-accent aria-pressed:text-accent-fg"
        >
          {s.loggerExtras.rirValue(value)}
        </button>
      ))}
    </div>
  );
}

const REST_CHOICES = [0, 30, 60, 90, 120, 150, 180, 240, 300];

export function RestLengthSelect({ store, exercise }: { store: WorkoutStore; exercise: WorkoutExercise }) {
  const s = useStrings();
  const value = exercise.restSeconds ?? DEFAULT_REST_SECONDS;
  return (
    <label className="flex min-h-touch items-center gap-1 text-sm text-muted">
      {s.loggerExtras.restLength}
      <select
        value={value}
        onChange={(e) => void store.setRestSeconds(exercise.id, Number(e.target.value))}
        className="min-h-touch rounded-control border border-border-strong bg-surface px-2 text-fg"
      >
        {REST_CHOICES.map((seconds) => (
          <option key={seconds} value={seconds}>
            {seconds === 0 ? s.loggerExtras.restOff : s.loggerExtras.restSeconds(seconds)}
          </option>
        ))}
      </select>
    </label>
  );
}

const formatClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Rest timer pinned to the bottom of the screen. Time is always derived from the
 * stored start and end times, so it is right after the app was in the background
 * (timers there are throttled or frozen). Count up shows elapsed time and cues once
 * at the target length; count down stops at "Rest over".
 */
export function RestTimerBar({
  store,
  timer,
  countUp = false,
  targetSeconds,
}: {
  store: WorkoutStore;
  timer: RestTimer | null;
  countUp?: boolean;
  targetSeconds: number;
}) {
  const s = useStrings();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!timer) return;
    const tick = () => setNow(new Date());
    tick();
    const interval = window.setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [timer]);

  const { seconds, done } = restDisplay(timer, now, countUp ? "up" : "down", targetSeconds);
  // In count up, a reload past the target has already cued, so it must not buzz again on mount.
  const cued = useRef(countUp ? done : false);
  useEffect(() => {
    if (done && !cued.current && typeof navigator.vibrate === "function") navigator.vibrate(200);
    cued.current = done;
  }, [done]);

  if (!timer) return null;
  return (
    <div
      role="timer"
      aria-label={s.loggerExtras.restTimer}
      className={`fixed transform-gpu inset-x-0 bottom-[calc(var(--touch-lg)+env(safe-area-inset-bottom))] z-[5] md:bottom-0 border-t border-border px-4 pt-2 pb-2 md:pb-[max(0.5rem,env(safe-area-inset-bottom))] ${done ? "bg-success text-accent-fg" : "bg-surface-raised"}`}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <span className="flex-1 font-numeric text-2xl font-semibold">
          {done && !countUp ? s.loggerExtras.restDone : formatClock(seconds)}
        </span>
        {!done && !countUp && (
          <>
            <Button variant="ghost" onClick={() => void store.adjustRest(-15)}>
              {s.loggerExtras.restLess}
            </Button>
            <Button variant="ghost" onClick={() => void store.adjustRest(15)}>
              {s.loggerExtras.restMore}
            </Button>
          </>
        )}
        <Button variant={done ? "ghost" : "secondary"} onClick={() => void store.skipRest()}>
          {done ? s.loggerExtras.close : s.loggerExtras.restSkip}
        </Button>
      </div>
    </div>
  );
}

/**
 * Discards the workout in progress (#60), next to Finish. Two taps, like removing an exercise,
 * so a stray tap can't archive a workout; the armed note says where it goes.
 */
export function DiscardWorkoutButton({ store }: { store: WorkoutStore }) {
  const s = useStrings();
  const [armed, arm] = useArmed();
  return (
    <>
      <Button
        variant={armed ? "danger" : "outline"}
        className="shrink-0 text-sm"
        onClick={() => (armed ? void store.discard() : arm())}
      >
        {armed ? s.common.confirmDelete : s.workout.discard}
      </Button>
      {armed && <p className="basis-full text-right text-xs text-muted">{s.workout.discardNote}</p>}
    </>
  );
}
