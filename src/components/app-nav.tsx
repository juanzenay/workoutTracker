"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PendingLink } from "@/components/ui/pending-link";
import { useStrings } from "@/strings/provider";
import type { Strings } from "@/strings";

/*
 * Instant highlight without state: PendingLink renders a [data-pending] marker while its navigation is in
 * flight, and the classes below read it with :has(). The tapped tab takes the active look and the current one
 * gives it up (group/nav); when the navigation ends, fails or is cancelled the marker goes and the real
 * aria-current tab is back. Nothing to reset, so it cannot lie.
 */

/** Whether `path` is `href` or a page under it. */
function within(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

type Tab = { href: string; label: (s: Strings) => string; icon: ReactNode; owns: string[] };

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" aria-hidden className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

/** The five destinations. `owns` lists the other pages that workout tracker up the tab. */
const TABS: Tab[] = [
  {
    href: "/",
    label: (s) => s.nav.today,
    icon: icon("M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"),
    owns: ["/inbox", "/plan-changes"],
  },
  {
    href: "/workout",
    label: (s) => s.nav.workout,
    icon: icon("M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"),
    owns: [],
  },
  {
    href: "/workouts",
    label: (s) => s.nav.history,
    icon: icon("M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"),
    owns: ["/records", "/analytics"],
  },
  {
    href: "/blocks",
    label: (s) => s.nav.plan,
    icon: icon("M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"),
    owns: ["/races", "/runs", "/strava", "/unavailable", "/routines"],
  },
  {
    href: "/more",
    label: (s) => s.nav.more,
    icon: icon("M5 12h.01M12 12h.01M19 12h.01"),
    owns: ["/exercises", "/measurements", "/import", "/export", "/settings", "/feedback", "/credits", "/injuries"],
  },
];

/**
 * Main navigation: a bottom tab bar on phones (where the thumb is), a row in the header from md up.
 * Secondary pages hang off a tab (see SectionNav) or the More page.
 */
export function AppNav() {
  const s = useStrings();
  const path = usePathname();
  const active = TABS.find((t) => within(path, t.href) || t.owns.some((o) => within(path, o)));

  return (
    <nav
      aria-label={s.nav.main}
      className="fixed transform-gpu inset-x-0 bottom-0 z-[8] border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:static md:border-0 md:bg-transparent md:pb-0"
    >
      <ul className="group/nav mx-auto grid max-w-3xl grid-cols-5 md:flex md:gap-1">
        {TABS.map((tab) => (
          <li key={tab.href}>
            <PendingLink
              href={tab.href}
              mark={false}
              aria-current={tab === active ? "page" : undefined}
              className="flex min-h-touch-lg flex-col items-center justify-center gap-0.5 rounded-control px-1 text-xs text-muted aria-[current=page]:font-semibold aria-[current=page]:text-accent-text md:min-h-touch md:flex-row md:gap-2 md:px-3 md:text-sm has-[[data-pending]]:font-semibold has-[[data-pending]]:text-accent-text group-has-[[data-pending]]/nav:aria-[current=page]:font-normal! group-has-[[data-pending]]/nav:aria-[current=page]:text-muted!"
            >
              {tab.icon}
              <span className="max-w-full truncate">{tab.label(s)}</span>
            </PendingLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

type Section = { label: (s: Strings) => string; links: { href: string; label: (s: Strings) => string }[] };

const SECTIONS: Section[] = [
  {
    label: (s) => s.nav.history,
    links: [
      { href: "/workouts", label: (s) => s.nav.workouts },
      { href: "/records", label: (s) => s.nav.records },
      { href: "/analytics", label: (s) => s.nav.analytics },
    ],
  },
  {
    label: (s) => s.nav.plan,
    links: [
      { href: "/blocks", label: (s) => s.nav.blocks },
      { href: "/races", label: (s) => s.nav.races },
      { href: "/unavailable", label: (s) => s.nav.unavailable },
      { href: "/routines", label: (s) => s.nav.routines },
    ],
  },
];

/** Switches between the pages of a tab (History: workouts, records, analytics; Plan: blocks, races…). */
export function SectionNav() {
  const s = useStrings();
  const path = usePathname();
  const section = SECTIONS.find((sec) => sec.links.some((l) => within(path, l.href)));
  if (!section) return null;
  // Only on a section's top-level pages: an editor or detail page has its own way back.
  const current = section.links.find((l) => path === l.href);
  if (!current) return null;

  return (
    <nav aria-label={section.label(s)} className="-mx-4 mb-4 overflow-x-auto px-4">
      <ul className="group/nav flex gap-2">
        {section.links.map((link) => (
          <li key={link.href}>
            <PendingLink
              href={link.href}
              mark={false}
              aria-current={link === current ? "page" : undefined}
              className="flex min-h-touch items-center whitespace-nowrap rounded-control border border-border-strong px-3 text-sm font-medium aria-[current=page]:border-accent aria-[current=page]:bg-accent aria-[current=page]:text-accent-fg has-[[data-pending]]:border-accent has-[[data-pending]]:bg-accent has-[[data-pending]]:text-accent-fg group-has-[[data-pending]]/nav:aria-[current=page]:border-border-strong! group-has-[[data-pending]]/nav:aria-[current=page]:bg-transparent! group-has-[[data-pending]]/nav:aria-[current=page]:text-current!"
            >
              {link.label(s)}
            </PendingLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
