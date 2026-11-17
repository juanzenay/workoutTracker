import { createClient } from "@supabase/supabase-js";

/**
 * Where the nightly backup goes. GitHub (a private repo the owner owns) is the
 * primary target; Supabase Storage is the fallback when no repo is configured.
 * The command layer only talks to these ports; tests inject fakes (no network).
 */

export interface GitHubBackupClient {
  /** Creates or replaces `path` on the repo's branch in one commit. `location` is the file's web URL. */
  commitFile(input: { path: string; content: string; message: string }): Promise<{ location: string }>;
}

export interface StorageBackupClient {
  /** Uploads (or overwrites) `path` in the private backups bucket. */
  upload(input: { path: string; content: string }): Promise<{ location: string }>;
}

/** `null`: not configured on this deployment. */
export interface BackupTargets {
  github: GitHubBackupClient | null;
  storage: StorageBackupClient | null;
}

export type BackupTargetName = "github" | "storage";

export class BackupTargetError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BackupTargetError";
  }
}

export interface GitHubBackupConfig {
  /** `owner/name` of the private backup repo. */
  repo: string;
  /** Fine-grained token with Contents: read and write on that repo only. */
  token: string;
  /** Defaults to the repo's default branch. */
  branch?: string;
  apiUrl?: string;
  fetch?: typeof fetch;
}

/** Live GitHub client (REST contents API): reads the file's current sha, then PUTs the new content. */
export function createGitHubBackupClient({
  repo,
  token,
  branch,
  apiUrl = "https://api.github.com",
  fetch: fetchImpl = fetch,
}: GitHubBackupConfig): GitHubBackupClient {
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
    "user-agent": "workout-tracker-backup",
  };
  const fileUrl = (path: string) => `${apiUrl}/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;

  async function failure(response: Response, doing: string): Promise<never> {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body.message === "string") detail = `: ${body.message}`;
    } catch {
      // no JSON body
    }
    throw new BackupTargetError(`GitHub answered ${response.status} while ${doing} ${repo}${detail}`);
  }

  return {
    async commitFile({ path, content, message }) {
      let response: Response;
      try {
        const query = branch ? `?ref=${encodeURIComponent(branch)}` : "";
        response = await fetchImpl(fileUrl(path) + query, { headers });
        let sha: string | undefined;
        if (response.ok) sha = ((await response.json()) as { sha?: string }).sha;
        else if (response.status !== 404) return await failure(response, "reading");

        response = await fetchImpl(fileUrl(path), {
          method: "PUT",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            message,
            content: Buffer.from(content, "utf8").toString("base64"),
            ...(sha ? { sha } : {}),
            ...(branch ? { branch } : {}),
          }),
        });
      } catch (error) {
        if (error instanceof BackupTargetError) throw error;
        throw new BackupTargetError(`Could not reach GitHub (${(error as Error).message})`, { cause: error });
      }
      if (!response.ok) return failure(response, "committing to");
      const body = (await response.json()) as { content?: { html_url?: string } };
      return { location: body.content?.html_url ?? `https://github.com/${repo}/blob/${branch ?? "HEAD"}/${path}` };
    },
  };
}

export interface StorageBackupConfig {
  supabaseUrl: string;
  /** Service-role key (server only): the bucket is private. */
  serviceRoleKey: string;
  bucket?: string;
}

/** Live Supabase Storage client; creates the private bucket on first use. */
export function createStorageBackupClient({ supabaseUrl, serviceRoleKey, bucket = "backups" }: StorageBackupConfig): StorageBackupClient {
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async upload({ path, content }) {
      const put = () =>
        supabase.storage.from(bucket).upload(path, new Blob([content], { type: "application/json" }), { upsert: true });
      let { error } = await put();
      if (error && /not found/i.test(error.message)) {
        const created = await supabase.storage.createBucket(bucket, { public: false });
        if (created.error && !/already exists/i.test(created.error.message)) {
          throw new BackupTargetError(`Supabase Storage could not create bucket ${bucket}: ${created.error.message}`);
        }
        ({ error } = await put());
      }
      if (error) throw new BackupTargetError(`Supabase Storage rejected the upload: ${error.message}`);
      return { location: `storage://${bucket}/${path}` };
    },
  };
}

/**
 * Targets from the environment: GitHub when `BACKUP_GITHUB_REPO` and `BACKUP_GITHUB_TOKEN` are set
 * (`BACKUP_GITHUB_BRANCH` optional); Supabase Storage when `SUPABASE_SERVICE_ROLE_KEY` (or the integration's `SUPABASE_SECRET_KEY`) and the project URL are.
 */
export function backupTargetsFromEnv(env: Record<string, string | undefined> = process.env): BackupTargets {
  const repo = env.BACKUP_GITHUB_REPO?.trim();
  const token = env.BACKUP_GITHUB_TOKEN?.trim();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  return {
    github: repo && token ? createGitHubBackupClient({ repo, token, branch: env.BACKUP_GITHUB_BRANCH?.trim() || undefined }) : null,
    storage: supabaseUrl && serviceRoleKey ? createStorageBackupClient({ supabaseUrl, serviceRoleKey }) : null,
  };
}
