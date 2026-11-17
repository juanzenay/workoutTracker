import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { PendingLink } from "@/components/ui/pending-link";
import { formatPlanDate } from "@/components/planned-session";
import { requireCommands } from "@/server/auth/session";
import type { StoredBlock } from "@/server/commands/blocks";
import type { Strings } from "@/strings";
import { getRequestStrings } from "@/server/strings";

function BlockList({ blocks, s }: { blocks: StoredBlock[]; s: Strings }) {
  return (
    <ul className="flex flex-col gap-2">
      {blocks.map((block) => (
        <li key={block.id}>
          <PendingLink href={`/blocks/${block.id}`} className="flex min-h-touch flex-col rounded-card bg-surface p-3">
            <span className="font-semibold">{block.name}</span>
            <span className="text-sm text-muted">
              {s.blocks.dates(formatPlanDate(block.startDate), block.weeks)} ·{" "}
              {block.sessions.map((session) => session.name).join(", ")}
            </span>
          </PendingLink>
        </li>
      ))}
    </ul>
  );
}

export default async function BlocksPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { blocks } = await commands.listBlocks({});
  const drafts = blocks.filter((block) => block.draft);
  const current = blocks.filter((block) => !block.archived && !block.draft);
  const archived = blocks.filter((block) => block.archived);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{s.blocks.title}</h1>
        <Link
          href="/blocks/new"
          className="flex min-h-touch items-center rounded-control bg-accent px-3 text-sm font-medium text-accent-fg"
        >
          {s.blocks.newBlock}
        </Link>
      </div>
      {blocks.length === 0 && <EmptyState>{s.blocks.empty}</EmptyState>}
      {drafts.length > 0 && (
        <section aria-labelledby="blocks-drafts" className="flex flex-col gap-2">
          <h2 id="blocks-drafts" className="font-semibold text-muted">
            {s.blocks.drafts}
          </h2>
          <BlockList blocks={drafts} s={s} />
        </section>
      )}
      {current.length > 0 && <BlockList blocks={current} s={s} />}
      {blocks.length > 0 && (
        <section aria-labelledby="blocks-archive" className="flex flex-col gap-2">
          <h2 id="blocks-archive" className="font-semibold text-muted">
            {s.blocks.archive}
          </h2>
          {archived.length === 0 ? (
            <p className="text-sm text-muted">{s.blocks.archiveEmpty}</p>
          ) : (
            <BlockList blocks={archived} s={s} />
          )}
        </section>
      )}
    </div>
  );
}
