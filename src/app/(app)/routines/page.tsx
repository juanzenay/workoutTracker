import { EmptyState } from "@/components/ui/empty-state";
import { linkButtonClass } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import Link from "next/link";
import type { Routine, RoutineFolder } from "@/domain/routine";
import { TextInput } from "@/components/ui/field";
import { requireCommands } from "@/server/auth/session";
import { getRequestStrings } from "@/server/strings";
import {
  createFolder,
  deleteFolder,
  moveFolder,
  moveRoutine,
  moveRoutineToFolder,
  renameFolder,
} from "./actions";


export default async function RoutinesPage() {
  const s = await getRequestStrings();
  const commands = await requireCommands();
  const { folders, routines } = await commands.listRoutines({});
  const unfiled = routines.filter((r) => r.folderId === null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{s.routines.title}</h1>
        <Link href="/routines/new" className={linkButtonClass("primary", "px-3 text-sm")}>
          {s.routines.newRoutine}
        </Link>
      </div>

      {routines.length === 0 && folders.length === 0 && <EmptyState>{s.routines.empty}</EmptyState>}

      {folders.map((folder, index) => (
        <FolderSection
          key={folder.id}
          folder={folder}
          folders={folders}
          routines={routines.filter((r) => r.folderId === folder.id)}
          first={index === 0}
          last={index === folders.length - 1}
        />
      ))}

      {unfiled.length > 0 && (
        <section aria-labelledby="unfiled" className="flex flex-col gap-2">
          <h2 id="unfiled" className="font-semibold text-muted">
            {s.routines.unfiled}
          </h2>
          <RoutineList routines={unfiled} folders={folders} />
        </section>
      )}

      <form action={createFolder} className="flex gap-2">
        <TextInput name="name" aria-label={s.routines.folderName} placeholder={s.routines.newFolder} required />
        <SubmitButton variant="secondary" className="shrink-0">
          {s.routines.createFolder}
        </SubmitButton>
      </form>
    </div>
  );
}

async function FolderSection({
  folder,
  folders,
  routines,
  first,
  last,
}: {
  folder: RoutineFolder;
  folders: RoutineFolder[];
  routines: Routine[];
  first: boolean;
  last: boolean;
}) {
  const s = await getRequestStrings();
  const headingId = `folder-${folder.id}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 id={headingId} className="min-w-0 flex-1 truncate text-lg font-semibold">
          {folder.name}
        </h2>
        <MoveButtons
          name={folder.name}
          up={first ? null : moveFolder.bind(null, folder.id, -1)}
          down={last ? null : moveFolder.bind(null, folder.id, 1)}
        />
      </div>
      {routines.length === 0 ? (
        <p className="text-sm text-muted">{s.routines.emptyFolder}</p>
      ) : (
        <RoutineList routines={routines} folders={folders} />
      )}
      <details className="text-sm">
        <summary className="flex min-h-touch cursor-pointer items-center text-muted">{s.routines.renameFolder}</summary>
        <div className="flex flex-col gap-2 pt-1">
          <form action={renameFolder.bind(null, folder.id)} className="flex gap-2">
            <TextInput name="name" aria-label={s.routines.folderName} defaultValue={folder.name} required />
            <SubmitButton variant="secondary" className="shrink-0">
              {s.routines.renameFolder}
            </SubmitButton>
          </form>
          <form action={deleteFolder.bind(null, folder.id)} className="flex items-center gap-2">
            <SubmitButton confirm variant="ghost" className="text-danger">
              {s.routines.deleteFolder}
            </SubmitButton>
            <span className="text-muted">{s.routines.deleteFolderHint}</span>
          </form>
        </div>
      </details>
    </section>
  );
}

async function RoutineList({ routines, folders }: { routines: Routine[]; folders: RoutineFolder[] }) {
  const s = await getRequestStrings();
  return (
    <ul className="flex flex-col gap-2">
      {routines.map((routine, index) => (
        <li key={routine.id} className="flex flex-col gap-2 rounded-card border border-border bg-surface p-3">
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{routine.name}</p>
              <p className="line-clamp-2 text-sm text-muted">
                {routine.exercises.length === 0
                  ? s.routines.exerciseCount(0)
                  : s.routines.summary(routine.exercises.map((e) => e.name))}
              </p>
            </div>
            <MoveButtons
              name={routine.name}
              up={index === 0 ? null : moveRoutine.bind(null, routine.id, -1)}
              down={index === routines.length - 1 ? null : moveRoutine.bind(null, routine.id, 1)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/workout?routine=${routine.id}`}
              className={linkButtonClass("primary", "px-3 text-sm")}
              aria-label={`${s.routines.start} ${routine.name}`}
            >
              {s.routines.start}
            </Link>
            <Link
              href={`/routines/${routine.id}`}
              className={linkButtonClass("secondary", "px-3 text-sm")}
              aria-label={`${s.routines.edit} ${routine.name}`}
            >
              {s.routines.edit}
            </Link>
            {folders.length > 0 && (
              <form action={moveRoutineToFolder.bind(null, routine.id)} className="ml-auto flex items-center gap-1">
                <select
                  name="folderId"
                  aria-label={`${s.routines.moveTo}: ${routine.name}`}
                  defaultValue={routine.folderId ?? ""}
                  className="min-h-touch rounded-control border border-border-strong bg-surface px-2 text-sm"
                >
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                  <option value="">{s.routines.unfiled}</option>
                </select>
                <SubmitButton variant="ghost" className="px-2 text-sm">
                  {s.routines.move}
                </SubmitButton>
              </form>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

async function MoveButtons({
  name,
  up,
  down,
}: {
  name: string;
  up: (() => Promise<void>) | null;
  down: (() => Promise<void>) | null;
}) {
  const s = await getRequestStrings();
  const cls = "min-h-touch min-w-touch rounded-control text-muted disabled:opacity-30";
  return (
    <div className="flex shrink-0">
      <form action={up ?? undefined}>
        <button aria-label={s.routines.moveUp(name)} disabled={!up} className={cls}>
          ↑
        </button>
      </form>
      <form action={down ?? undefined}>
        <button aria-label={s.routines.moveDown(name)} disabled={!down} className={cls}>
          ↓
        </button>
      </form>
    </div>
  );
}
