import { PendingLink } from "@/components/ui/pending-link";
import { signOut } from "@/app/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { getRequestStrings } from "@/server/strings";

/** Everything that isn't a tab: the library, your data, and app settings. */
export default async function MorePage() {
  const s = await getRequestStrings();
  const groups = [
    {
      title: s.more.library,
      links: [
        { href: "/exercises", label: s.nav.catalogue },
        { href: "/measurements", label: s.nav.measurements },
      ],
    },
    {
      title: s.more.data,
      links: [
        { href: "/import/hevy", label: s.nav.hevyImport },
        { href: "/injuries", label: s.nav.injuries },
        { href: "/export", label: s.nav.export },
      ],
    },
    {
      title: s.more.app,
      links: [
        { href: "/settings", label: s.nav.settings },
        { href: "/feedback", label: s.nav.feedback },
        { href: "/credits", label: s.nav.credits },
      ],
    },
  ];

  return (
    <article className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{s.more.title}</h1>
      {groups.map((group) => (
        <section key={group.title} aria-label={group.title} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted">{group.title}</h2>
          <ul className="flex flex-col divide-y divide-border rounded-card bg-surface">
            {group.links.map((link) => (
              <li key={link.href}>
                <PendingLink href={link.href} className="flex min-h-touch-lg items-center justify-between px-4 font-medium">
                  {link.label}
                  <span aria-hidden className="text-muted">
                    ›
                  </span>
                </PendingLink>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <form action={signOut}>
        <SubmitButton variant="outline" className="w-full">
          {s.nav.signOut}
        </SubmitButton>
      </form>
    </article>
  );
}
