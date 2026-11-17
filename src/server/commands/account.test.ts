import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

describe("account", () => {
  it("tells the deployment owner apart from anyone else", async () => {
    const owner = await db().signUp("owner@example.com");
    await expect(db().commandsAs({ kind: "user", userId: owner.id }).getAccount({})).resolves.toEqual({ isOwner: true });
    await expect(db().commandsAs({ kind: "user", userId: crypto.randomUUID() }).getAccount({})).resolves.toEqual({
      isOwner: false,
    });
    await expect(db().commandsAs({ kind: "anon" }).getAccount({})).resolves.toEqual({ isOwner: false });
  });
});

describe("deployment status", () => {
  it("tells anyone whether the deployment has been claimed yet", async () => {
    await expect(db().commandsAs({ kind: "anon" }).getDeploymentStatus({})).resolves.toEqual({ claimed: false });

    await db().signUp("owner@example.com");

    await expect(db().commandsAs({ kind: "anon" }).getDeploymentStatus({})).resolves.toEqual({ claimed: true });
    await expect(
      db().commandsAs({ kind: "user", userId: crypto.randomUUID() }).getDeploymentStatus({}),
    ).resolves.toEqual({ claimed: true });
  });

  it("opens the claim again when the owner account is deleted in Supabase", async () => {
    const owner = await db().signUp("owner@example.com");
    await db().sql`delete from auth.users where id = ${owner.id}`;

    await expect(db().commandsAs({ kind: "anon" }).getDeploymentStatus({})).resolves.toEqual({ claimed: false });
    await db().signUp("owner2@example.com");
  });
});
