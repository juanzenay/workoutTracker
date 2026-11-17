import { describe, expect, it } from "vitest";
import type { BackupTargets } from "@/server/backup/targets";
import { setupTestDb } from "../../../tests/db/test-db";
import { fakeGitHub, fakeStorage } from "../../../tests/fixtures/fake-backup";
import { fakePushSender, testSubscription } from "../../../tests/fixtures/fake-push";
import { readable } from "../../../tests/readable";

const db = setupTestDb();

/** The owner (one logged body measurement, a push-enabled phone) and the nightly job wired to `targets`. */
async function ownerAndJob(targets: BackupTargets) {
  const owner = await db().signUp("owner@example.com");
  const commands = db().commandsAs({ kind: "user", userId: owner.id });
  await commands.savePushSubscription(testSubscription());
  await commands.logBodyMeasurement({ date: "2026-10-01", weightUnit: "lb", values: { weight: 185.5 } });
  const push = fakePushSender();
  const job = db().commandsAs({ kind: "service" }, { push: push.sender, backup: targets });
  return { commands, job, sent: push.sent };
}

describe("nightly backup", () => {
  it("commits the full JSON export to the configured GitHub repo", async () => {
    const github = fakeGitHub();
    const storage = fakeStorage();
    const { job, sent } = await ownerAndJob({ github: github.client, storage: storage.client });

    const result = await job.runBackup({});

    expect(result).toMatchObject({ status: "succeeded", target: "github" });
    expect(github.commits).toHaveLength(1);
    const [commit] = github.commits;
    expect(commit!.path).toBe("workout-tracker-backup.json");
    expect(commit!.message).toMatch(/^Nightly backup \d{4}-\d{2}-\d{2}$/);
    expect(commit!.data).toMatchObject({
      format: "workout-tracker-export",
      tables: { body_measurements: [expect.objectContaining({ date: "2026-10-01" })] },
    });
    expect(storage.uploads).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("falls back to Supabase Storage when no GitHub repo is configured", async () => {
    const storage = fakeStorage();
    const { job } = await ownerAndJob({ github: null, storage: storage.client });

    const result = await job.runBackup({});

    expect(result).toMatchObject({ status: "succeeded", target: "storage" });
    expect(storage.uploads).toEqual([
      {
        path: expect.stringMatching(/^workout-tracker-backup-\d{4}-\d{2}-\d{2}\.json$/),
        data: expect.objectContaining({ format: "workout-tracker-export" }),
      },
    ]);
  });

  it("records a success as a minor inbox item and as the last backup, without a push", async () => {
    const github = fakeGitHub();
    const { commands, job, sent } = await ownerAndJob({ github: github.client, storage: null });

    await job.runBackup({});

    expect(readable(await commands.listInbox({})).entries).toEqual([
      { type: "item", item: expect.objectContaining({ kind: "backup_succeeded", level: "minor", url: "/export" }) },
    ]);
    const { lastSuccess, latest } = await commands.getBackupStatus({});
    expect(lastSuccess).toMatchObject({
      status: "succeeded",
      target: "github",
      location: "https://github.com/owner/workout-tracker-backup/blob/main/workout-tracker-backup.json",
    });
    expect(latest).toEqual(lastSuccess);
    expect(sent).toEqual([]);
  });

  it("raises an important inbox item and pushes it when GitHub rejects the commit", async () => {
    const working = fakeGitHub();
    const { commands, job: firstNight } = await ownerAndJob({ github: working.client, storage: null });
    await firstNight.runBackup({});
    const push = fakePushSender();
    const failing = fakeGitHub({ fail: new Error("GitHub answered 401 while committing to owner/workout-tracker-backup: Bad credentials") });
    const job = db().commandsAs({ kind: "service" }, { push: push.sender, backup: { github: failing.client, storage: null } });

    const result = await job.runBackup({});

    expect(result).toMatchObject({ status: "failed", target: "github", error: expect.stringContaining("401") });
    const [newest] = readable(await commands.listInbox({})).entries;
    expect(newest).toEqual({
      type: "item",
      item: expect.objectContaining({ kind: "backup_failed", level: "important", url: "/export", body: [expect.stringContaining("Bad credentials")] }),
    });
    expect(push.sent).toEqual([
      {
        subscription: expect.objectContaining({ endpoint: testSubscription().endpoint }),
        message: expect.objectContaining({ title: expect.stringMatching(/backup failed/i), url: "/export" }),
      },
    ]);
    const status = await commands.getBackupStatus({});
    expect(status.latest).toMatchObject({ status: "failed" });
    expect(status.lastSuccess).toMatchObject({ status: "succeeded", target: "github" });
  });

  it("treats having no backup target at all as a failure", async () => {
    const { commands, job, sent } = await ownerAndJob({ github: null, storage: null });

    const result = await job.runBackup({});

    expect(result).toMatchObject({ status: "failed", target: null });
    expect(readable(await commands.listInbox({})).entries).toEqual([
      { type: "item", item: expect.objectContaining({ kind: "backup_failed", level: "important" }) },
    ]);
    expect(sent).toHaveLength(1);
    expect((await commands.getBackupStatus({})).lastSuccess).toBeNull();
  });

  it("does not let anonymous callers run a backup or read its status", async () => {
    const github = fakeGitHub();
    await ownerAndJob({ github: github.client, storage: null });
    const anon = db().commandsAs({ kind: "anon" }, { backup: { github: github.client, storage: null } });

    await expect(anon.runBackup({})).rejects.toMatchObject({ code: "unauthorized" });
    expect(await anon.getBackupStatus({})).toEqual({ latest: null, lastSuccess: null });
    expect(github.commits).toEqual([]);
  });
});
