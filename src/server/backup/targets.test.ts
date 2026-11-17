import { describe, expect, it } from "vitest";
import { backupTargetsFromEnv, createGitHubBackupClient } from "./targets";

/** A fetch that answers from `routes` ("METHOD url" → [status, body]) and records every request. */
function stubFetch(routes: Record<string, [number, unknown]>) {
  const requests: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    requests.push({
      method,
      url,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const route = routes[`${method} ${url}`];
    if (!route) throw new Error(`unexpected ${method} ${url}`);
    return new Response(JSON.stringify(route[1]), { status: route[0] });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

const FILE = "https://api.github.com/repos/owner/workout-tracker-backup/contents/workout-tracker-backup.json";

describe("GitHub backup client", () => {
  it("creates the backup file on the first night", async () => {
    const { fetchImpl, requests } = stubFetch({
      [`GET ${FILE}`]: [404, { message: "Not Found" }],
      [`PUT ${FILE}`]: [201, { content: { html_url: "https://github.com/owner/workout-tracker-backup/blob/main/workout-tracker-backup.json" } }],
    });
    const client = createGitHubBackupClient({ repo: "owner/workout-tracker-backup", token: "ghp_secret", fetch: fetchImpl });

    const { location } = await client.commitFile({ path: "workout-tracker-backup.json", content: '{"a":1}', message: "Nightly backup 2026-10-12" });

    expect(location).toBe("https://github.com/owner/workout-tracker-backup/blob/main/workout-tracker-backup.json");
    const put = requests[1]!;
    expect(put.headers.authorization).toBe("Bearer ghp_secret");
    expect(put.body).toEqual({ message: "Nightly backup 2026-10-12", content: Buffer.from('{"a":1}').toString("base64") });
  });

  it("replaces the existing file on later nights (by its sha, on the configured branch)", async () => {
    const { fetchImpl, requests } = stubFetch({
      [`GET ${FILE}?ref=backups`]: [200, { sha: "abc123" }],
      [`PUT ${FILE}`]: [200, { content: { html_url: "https://github.com/owner/workout-tracker-backup/blob/backups/workout-tracker-backup.json" } }],
    });
    const client = createGitHubBackupClient({ repo: "owner/workout-tracker-backup", token: "t", branch: "backups", fetch: fetchImpl });

    await client.commitFile({ path: "workout-tracker-backup.json", content: "{}", message: "Nightly backup 2026-10-13" });

    expect(requests[1]!.body).toMatchObject({ sha: "abc123", branch: "backups" });
  });

  it("reports GitHub's reason without leaking the token", async () => {
    const { fetchImpl } = stubFetch({ [`GET ${FILE}`]: [401, { message: "Bad credentials" }] });
    const client = createGitHubBackupClient({ repo: "owner/workout-tracker-backup", token: "ghp_secret", fetch: fetchImpl });

    const failure = client.commitFile({ path: "workout-tracker-backup.json", content: "{}", message: "m" });

    await expect(failure).rejects.toThrow(/401.*Bad credentials/);
    await expect(failure).rejects.not.toThrow(/ghp_secret/);
  });

  it("reports an unreachable GitHub as a backup failure", async () => {
    const client = createGitHubBackupClient({
      repo: "owner/workout-tracker-backup",
      token: "t",
      fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch,
    });

    await expect(client.commitFile({ path: "workout-tracker-backup.json", content: "{}", message: "m" })).rejects.toThrow(
      /Could not reach GitHub/,
    );
  });
});

describe("backup targets from the environment", () => {
  it("uses GitHub when a repo and token are set, and Storage only as the fallback", () => {
    const storageOnly = backupTargetsFromEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://p.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" });
    expect(storageOnly.github).toBeNull();
    expect(storageOnly.storage).not.toBeNull();

    const both = backupTargetsFromEnv({
      BACKUP_GITHUB_REPO: "owner/workout-tracker-backup",
      BACKUP_GITHUB_TOKEN: "t",
      NEXT_PUBLIC_SUPABASE_URL: "https://p.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "k",
    });
    expect(both.github).not.toBeNull();

    expect(backupTargetsFromEnv({})).toEqual({ github: null, storage: null });
  });

  it("uses the secret key Vercel's Supabase integration provides for the Storage fallback", () => {
    const fromIntegration = backupTargetsFromEnv({ SUPABASE_URL: "https://p.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_k" });
    expect(fromIntegration.storage).not.toBeNull();
  });
});
