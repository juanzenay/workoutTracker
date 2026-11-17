import type { GitHubBackupClient, StorageBackupClient } from "@/server/backup/targets";

/** A GitHub backup client that records commits instead of calling GitHub; `fail` makes every commit throw it. */
export function fakeGitHub({ repo = "owner/workout-tracker-backup", fail }: { repo?: string; fail?: Error } = {}) {
  const commits: { path: string; message: string; data: unknown }[] = [];
  const client: GitHubBackupClient = {
    async commitFile({ path, content, message }) {
      if (fail) throw fail;
      commits.push({ path, message, data: JSON.parse(content) });
      return { location: `https://github.com/${repo}/blob/main/${path}` };
    },
  };
  return { client, commits };
}

/** A Supabase Storage backup client that records uploads instead of calling Supabase; `fail` makes every upload throw it. */
export function fakeStorage({ fail }: { fail?: Error } = {}) {
  const uploads: { path: string; data: unknown }[] = [];
  const client: StorageBackupClient = {
    async upload({ path, content }) {
      if (fail) throw fail;
      uploads.push({ path, data: JSON.parse(content) });
      return { location: `storage://backups/${path}` };
    },
  };
  return { client, uploads };
}
