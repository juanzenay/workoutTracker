"use client";

import { useRestTimerMode, type RestTimerMode } from "@/client/rest-timer-mode";
import { useStrings } from "@/strings/provider";

const segment =
  "min-h-touch rounded-control bg-surface-raised px-4 font-medium text-muted aria-pressed:bg-accent aria-pressed:text-accent-fg";

/** Per-device rest timer choice, saved through useRestTimerMode. */
export function RestTimerModeSelect() {
  const s = useStrings();
  const [mode, setMode] = useRestTimerMode();
  const options: { value: RestTimerMode; label: string }[] = [
    { value: "down", label: s.settings.restTimerDown },
    { value: "up", label: s.settings.restTimerUp },
  ];

  return (
    <section aria-labelledby="rest-timer" className="flex flex-col gap-2">
      <h2 id="rest-timer" className="font-semibold">
        {s.settings.restTimer}
      </h2>
      <p className="text-sm text-muted">{s.settings.restTimerHint}</p>
      <div role="group" aria-labelledby="rest-timer" className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === mode}
            onClick={() => setMode(option.value)}
            className={segment}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{s.settings.deviceOnly}</p>
    </section>
  );
}
