import Link from "next/link";
import type { ReactNode } from "react";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";

const LINKS = {
  freeExerciseDb: "https://github.com/yuhonas/free-exercise-db",
  unlicense: "https://unlicense.org/",
  wger: "https://wger.de/",
  wgerRepo: "https://github.com/wger-project/wger",
  ccBySa4: "https://creativecommons.org/licenses/by-sa/4.0/",
};

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children}
    </a>
  );
}

export default async function CreditsPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { items } = await commands.listWgerCredits({});

  return (
    <article className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{s.credits.title}</h1>

      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">{s.credits.catalogueTitle}</h2>
        <p className="text-sm">{s.credits.catalogueBody}</p>
        <p className="text-sm text-muted">
          <External href={LINKS.freeExerciseDb}>free-exercise-db</External> ·{" "}
          <External href={LINKS.unlicense}>The Unlicense</External>
        </p>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">{s.credits.wgerTitle}</h2>
        <p className="text-sm">{s.credits.wgerBody}</p>
        <p className="text-sm text-muted">
          <External href={LINKS.wger}>wger.de</External> ·{" "}
          <External href={LINKS.ccBySa4}>CC-BY-SA 4.0</External>
        </p>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="font-semibold">{s.credits.musclesTitle}</h2>
        <p className="text-sm">{s.credits.musclesBody}</p>
        <p className="text-sm text-muted">
          <External href={LINKS.wgerRepo}>wger-project/wger</External> ·{" "}
          <External href={LINKS.ccBySa4}>CC-BY-SA 4.0</External>
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{s.credits.importedTitle}</h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{s.credits.importedEmpty}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((credit) => (
              <li key={credit.exerciseId} className="flex flex-col gap-0.5 py-2 text-sm">
                <Link href={`/exercises/${credit.exerciseId}`} className="font-medium">
                  {credit.name}
                </Link>
                {credit.authors.length > 0 && <span className="text-muted">{s.credits.by(credit.authors)}</span>}
                <span className="text-muted">
                  {s.credits.license}: <External href={credit.licenseUrl}>{credit.licenseShortName}</External> ·{" "}
                  <External href={credit.sourceUrl}>{s.credits.source}</External>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
