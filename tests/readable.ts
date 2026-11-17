import type { Text } from "@/domain/message";
import { getStrings } from "@/strings";
import { renderMessages, renderText } from "@/strings/render";

/**
 * Generated text as the owner reads it (standard words), for assertions: the engine and the command layer emit
 * messages (src/domain/message.ts) that src/strings renders.
 */
export const text = (t: Text): string => renderText(getStrings(), t);

/** `value` with every message in it (summaries, reasons, progression reasons, inbox titles…) rendered as text. */
export const readable = <T>(value: T): T => renderMessages(getStrings(), value) as T;
