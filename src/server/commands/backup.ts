import { z } from "zod";
import type { BackupTargetName } from "../backup/targets";
import { CommandError, defineCommand } from "./define";
import { buildExport } from "./export";
import { raiseInbox } from "./inbox";

/**
 * Nightly backup (Vercel Cron → /api/cron/backup → runBackup). Dumps all data
 * with the export and commits it to the owner's private GitHub repo, or uploads
 * it to Supabase Storage when no repo is configured. A failure never throws: it
 * is recorded and raised as an important inbox item (pushed) so the owner knows
 * they are unprotected. A success is recorded and raised as a minor item.
 */

/** One file, overwritten nightly: the repo's history keeps every version and diffs stay readable. */
const GITHUB_PATH = "workout-tracker-backup.json";

export interface BackupRun {
  id: string;
  status: "succeeded" | "failed";
  target: BackupTargetName | null;
  location: string | null;
  error: string | null;
  at: string;
}

interface BackupRunRow {
  id: string;
  status: BackupRun["status"];
  target: BackupTargetName | null;
  location: string | null;
  error: string | null;
  created_at: Date;
}

const toRun = (row: BackupRunRow): BackupRun => ({
  id: row.id,
  status: row.status,
  target: row.target,
  location: row.location,
  error: row.error,
  at: row.created_at.toISOString(),
});


/** Runs one backup now. Called by the nightly cron (as the service actor); the owner may also run it. */
export const runBackup = defineCommand({
  input: z.object({}),
  async run(ctx): Promise<BackupRun> {
    const { tx, actor, backup } = ctx;
    if (actor.kind === "anon") throw new CommandError("unauthorized", "Only the owner or the backup job can back up");

    const data = await buildExport(tx);
    const day = data.exportedAt.slice(0, 10);
    const content = `${JSON.stringify(data, null, 2)}\n`;

    let target: BackupTargetName | null = null;
    let location: string | null = null;
    let error: string | null = null;
    try {
      if (backup.github) {
        target = "github";
        ({ location } = await backup.github.commitFile({ path: GITHUB_PATH, content, message: `Nightly backup ${day}` }));
      } else if (backup.storage) {
        target = "storage";
        ({ location } = await backup.storage.upload({ path: `workout-tracker-backup-${day}.json`, content }));
      } else {
        error = "No backup target is configured (set BACKUP_GITHUB_REPO and BACKUP_GITHUB_TOKEN, or SUPABASE_SERVICE_ROLE_KEY).";
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const status = error === null ? "succeeded" : "failed";

    const [row] = await tx<BackupRunRow[]>`
      insert into public.backup_runs (status, target, location, error)
      values (${status}, ${target}, ${location}, ${error?.slice(0, 1000) ?? null})
      returning id, status, target, location, error, created_at`;

    if (status === "failed") {
      await raiseInbox(ctx, {
        kind: "backup_failed",
        level: "important",
        title: { code: "backupFailed" },
        body: [{ code: "backupFailedBody", target, error: (error ?? "").slice(0, 1000) }],
        url: "/export",
      });
    } else {
      await raiseInbox(ctx, {
        kind: "backup_succeeded",
        level: "minor",
        title: { code: "backupSucceeded", target: target! },
        url: "/export",
      });
    }
    return toRun(row!);
  },
});

/** The latest backup run and the latest successful one (shown on the export page). */
export const getBackupStatus = defineCommand({
  input: z.object({}),
  async run({ tx }) {
    const [latest] = await tx<BackupRunRow[]>`
      select id, status, target, location, error, created_at from public.backup_runs
      order by created_at desc, id desc limit 1`;
    const [lastSuccess] = await tx<BackupRunRow[]>`
      select id, status, target, location, error, created_at from public.backup_runs
      where status = 'succeeded' order by created_at desc, id desc limit 1`;
    return { latest: latest ? toRun(latest) : null, lastSuccess: lastSuccess ? toRun(lastSuccess) : null };
  },
});
