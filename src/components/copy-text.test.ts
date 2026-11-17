import { describe, expect, it, vi } from "vitest";
import { copyText } from "./copy-text";

describe("copyText", () => {
  it("writes the text to the clipboard and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(copyText("Push day\nOctober 16, 2026 · 55 min", { writeText })).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("Push day\nOctober 16, 2026 · 55 min");
  });

  it("reports failure when there is no clipboard", async () => {
    await expect(copyText("Push day", undefined)).resolves.toBe(false);
  });

  it("reports failure instead of throwing when the clipboard refuses the write", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError"));

    await expect(copyText("Push day", { writeText })).resolves.toBe(false);
  });
});
