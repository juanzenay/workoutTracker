import { requireCommands } from "@/server/auth/session";
import { LocalDateTime } from "@/components/local-date-time";
import { getRequestStrings } from "@/server/strings";
import { CsvLinks } from "./csv-links";

export default async function ExportPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { latest, lastSuccess } = await commands.getBackupStatus({});

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{s.export.title}</h1>
        <p className="text-sm text-muted">{s.export.body}</p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{s.export.jsonTitle}</h2>
        <p className="text-sm">{s.export.jsonBody}</p>
        <div>
          <a
            href="/api/export/json"
            download
            className="inline-flex min-h-touch items-center rounded-control bg-accent px-4 font-medium text-accent-fg"
          >
            {s.export.jsonDownload}
          </a>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{s.export.csvTitle}</h2>
        <CsvLinks />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{s.export.backupTitle}</h2>
        {lastSuccess ? (
          <p className="text-sm">
            {s.export.backupLast} <LocalDateTime iso={lastSuccess.at} /> {s.export.backupTo(lastSuccess.target ?? "github")}
            {lastSuccess.location?.startsWith("https://") ? (
              <>
                {" "}
                (<a href={lastSuccess.location} className="underline">{lastSuccess.location.replace("https://", "")}</a>)
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-muted">{s.export.backupNever}</p>
        )}
        {latest?.status === "failed" ? (
          <p className="text-sm text-danger">
            {s.export.backupFailed} {latest.error} (<LocalDateTime iso={latest.at} />)
          </p>
        ) : null}
      </section>
    </article>
  );
}
