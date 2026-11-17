import { describe, expect, it } from "vitest";
import { setupTestDb } from "../../../tests/db/test-db";

const db = setupTestDb();

async function signedInOwner() {
  const owner = await db().signUp("owner@example.com");
  return db().commandsAs({ kind: "user", userId: owner.id });
}

describe("feedback", () => {
  it("lists open items oldest first, then done ones, and reopens and deletes", async () => {
    const commands = await signedInOwner();
    const first = await commands.addFeedback({ body: "  Rest timer should vibrate  " });
    const second = await commands.addFeedback({ body: "Add a plate calculator" });
    const third = await commands.addFeedback({ body: "Dark mode contrast" });
    expect(first.body).toBe("Rest timer should vibrate");

    await commands.setFeedbackDone({ id: first.id, done: true });
    const bodies = async () => (await commands.listFeedback({})).items.map((i) => i.body);
    expect(await bodies()).toEqual(["Add a plate calculator", "Dark mode contrast", "Rest timer should vibrate"]);
    expect((await commands.listFeedback({})).items.at(-1)!.doneAt).not.toBeNull();

    await commands.setFeedbackDone({ id: first.id, done: false });
    expect(await bodies()).toEqual(["Rest timer should vibrate", "Add a plate calculator", "Dark mode contrast"]);

    await commands.deleteFeedback({ id: second.id });
    expect(await bodies()).toEqual(["Rest timer should vibrate", "Dark mode contrast"]);
    await expect(commands.deleteFeedback({ id: third.id.replace(/.$/, "0") })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects blank feedback and keeps it owner-only", async () => {
    const commands = await signedInOwner();
    await expect(commands.addFeedback({ body: "   " })).rejects.toThrow();

    await commands.addFeedback({ body: "Mine" });
    const signedOut = db().commandsAs({ kind: "anon" });
    await expect(signedOut.listFeedback({})).resolves.toEqual({ items: [] });
    await expect(signedOut.addFeedback({ body: "Not mine" })).rejects.toThrow();
  });
});
