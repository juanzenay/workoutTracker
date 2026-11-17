import { setSkin, setTheme } from "@/app/actions";
import { getPreferences, THEMES, type Theme } from "@/server/preferences";
import { getRequestStrings } from "@/server/strings";
import { RestTimerModeSelect } from "./rest-timer-mode-select";

/** Per-device settings. Dumb Mode (#28) swaps tokens and copy only: never layout or touch targets. */
export default async function SettingsPage() {
  const s = await getRequestStrings();
  const { skin, theme } = await getPreferences();
  const themeLabel: Record<Theme, string> = {
    system: s.nav.themeSystem,
    light: s.nav.themeLight,
    dark: s.nav.themeDark,
  };
  const segment =
    "min-h-touch rounded-control bg-surface-raised px-4 font-medium text-muted aria-pressed:bg-accent aria-pressed:text-accent-fg";
  const options = [
    { value: "dumb", label: s.settings.dumbModeOn },
    { value: "standard", label: s.settings.dumbModeOff },
  ] as const;

  return (
    <article className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{s.settings.title}</h1>
      <section aria-labelledby="theme" className="flex flex-col gap-2">
        <h2 id="theme" className="font-semibold">
          {s.nav.theme}
        </h2>
        <form action={setTheme} className="flex gap-2" aria-labelledby="theme">
          {THEMES.map((t) => (
            <button key={t} name="theme" value={t} aria-pressed={t === theme} className={segment}>
              {themeLabel[t]}
            </button>
          ))}
        </form>
      </section>
      <section aria-labelledby="dumb-mode" className="flex flex-col gap-2">
        <h2 id="dumb-mode" className="font-semibold">
          {s.settings.dumbMode}
        </h2>
        <p className="text-sm text-muted">{s.settings.dumbModeHint}</p>
        <form action={setSkin} className="flex gap-2" aria-labelledby="dumb-mode">
          {options.map((option) => (
            <button
              key={option.value}
              name="skin"
              value={option.value}
              aria-pressed={option.value === skin}
              className={segment}
            >
              {option.label}
            </button>
          ))}
        </form>
        <p className="text-xs text-muted">{s.settings.deviceOnly}</p>
      </section>
      <RestTimerModeSelect />
    </article>
  );
}
