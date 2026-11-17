/**
 * Copies text to the clipboard. Resolves false when there is no clipboard (an insecure page, an old
 * browser) or the write is refused, so the caller can say so instead of failing silently.
 */
export async function copyText(text: string, clipboard: Pick<Clipboard, "writeText"> | undefined): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
