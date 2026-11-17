import { EmptyState } from "@/components/ui/empty-state";
import { PendingLink } from "@/components/ui/pending-link";
import { RECORD_KINDS } from "@/domain/records";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";

/** Bests per exercise, across every finished workout. */
export default async function RecordsPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { items } = await commands.listRecords({});

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{s.records.title}</h1>
      {items.length === 0 ? (
        <EmptyState>{s.records.empty}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.exerciseId}>
              <PendingLink
                href={`/exercises/${item.exerciseId}`}
                className="flex flex-col gap-2 rounded-card bg-surface p-4"
              >
                <h2 className="font-semibold text-accent-text">{item.name}</h2>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {RECORD_KINDS.map((kind) => {
                    const record = item.bests[kind];
                    if (!record) return null;
                    return (
                      <div key={kind} className="contents">
                        <dt className="text-muted">{s.records.kinds[kind]}</dt>
                        <dd className="font-numeric">
                          {s.records.value(kind, record.value, record.unit)}
                          {kind !== "heaviestWeight" && kind !== "mostReps" && (
                            <span className="text-muted"> · {s.records.set(record.weight, record.unit, record.reps)}</span>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </PendingLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
