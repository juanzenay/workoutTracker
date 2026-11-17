"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, useTransition, type ReactNode, type TransitionStartFunction } from "react";
import { Select, TextInput } from "@/components/ui/field";
import { Spinner } from "@/components/ui/submit-button";
import { EQUIPMENT, MUSCLES } from "@/domain/exercise";
import { useStrings } from "@/strings/provider";

const SearchTransition = createContext<{ pending: boolean; startTransition: TransitionStartFunction } | null>(null);

/**
 * The page's container: shares the search transition between the filters and the results beside them, so the
 * list can react while the server answers. (A keyed Suspense boundary would not: inside a transition React
 * keeps the old UI instead of showing its fallback.)
 */
export function CatalogueSearch({ children, className }: { children: ReactNode; className?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <SearchTransition value={{ pending, startTransition }}>
      <div className={className}>{children}</div>
    </SearchTransition>
  );
}

/** The results: dimmed and marked busy (still readable by assistive tech) while a search or filter is pending. */
export function CatalogueResults({ children }: { children: ReactNode }) {
  const pending = useContext(SearchTransition)?.pending ?? false;
  return (
    <div aria-busy={pending} className={`flex flex-col gap-4 transition-opacity ${pending ? "opacity-50" : ""}`}>
      {children}
    </div>
  );
}

/** Search and filters that apply as you type (debounced) or pick, keeping them in the URL. */
export function CatalogueFilters({ query, muscle, equipment }: { query: string; muscle: string; equipment: string }) {
  const s = useStrings();
  const router = useRouter();
  const path = usePathname();
  const { pending, startTransition } = useContext(SearchTransition)!;
  const [q, setQ] = useState(query);
  const filters = useRef({ muscle, equipment });

  const apply = (next: { q?: string; muscle?: string; equipment?: string }) => {
    const values = { q, ...filters.current, ...next };
    filters.current = { muscle: values.muscle, equipment: values.equipment };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
    const search = params.toString();
    startTransition(() => router.replace(search ? `${path}?${search}` : path, { scroll: false }));
  };

  // Typing settles for a moment before the list updates.
  useEffect(() => {
    if (q === query) return;
    const timer = setTimeout(() => apply({ q }), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change in the text restarts the wait
  }, [q]);

  return (
    <form
      role="search"
      className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_auto_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q });
      }}
    >
      <div className="relative col-span-2 sm:col-span-1">
        <TextInput
          name="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={s.catalogue.searchPlaceholder}
          aria-label={s.catalogue.searchLabel}
          className="pr-9"
        />
        {pending && (
          <span className="absolute top-1/2 right-3 -translate-y-1/2 text-muted">
            <Spinner />
          </span>
        )}
      </div>
      <Select
        name="muscle"
        defaultValue={muscle}
        aria-label={s.catalogue.muscleLabel}
        onChange={(e) => apply({ muscle: e.target.value })}
      >
        <option value="">{s.catalogue.anyMuscle}</option>
        {MUSCLES.map((m) => (
          <option key={m} value={m}>
            {s.muscles[m]}
          </option>
        ))}
      </Select>
      <Select
        name="equipment"
        defaultValue={equipment}
        aria-label={s.catalogue.equipmentLabel}
        onChange={(e) => apply({ equipment: e.target.value })}
      >
        <option value="">{s.catalogue.anyEquipment}</option>
        {EQUIPMENT.map((e) => (
          <option key={e} value={e}>
            {s.equipment[e]}
          </option>
        ))}
      </Select>
    </form>
  );
}
