import type { MessageId, OrchestrationMessage, ThreadId } from "@t3tools/contracts";

export const CONTEXT_PRUNE_MIN_USED_PERCENTAGE = 50;
export const CONTEXT_AUTO_MANAGE_MIN_USED_PERCENTAGE = 75;
export const CONTEXT_PRUNE_RETAIN_USER_TURNS = 4;
export const MAX_CONTEXT_CONTINUATION_CHARS = 32_000;

type ContextMessage = Pick<OrchestrationMessage, "id" | "role" | "text">;

export function selectOldestMessageIdsForContextPruning<Id extends MessageId | string>(
  messages: ReadonlyArray<{ readonly id: Id; readonly role: "user" | "assistant" | "system" }>,
): ReadonlyArray<Id> {
  const userMessageIndexes = messages.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );
  const pruneUserTurnCount = userMessageIndexes.length - CONTEXT_PRUNE_RETAIN_USER_TURNS;
  if (pruneUserTurnCount <= 0) return [];
  const cutoffIndex = userMessageIndexes[pruneUserTurnCount];
  if (cutoffIndex === undefined) return [];
  return messages
    .slice(0, cutoffIndex)
    .filter((message) => message.role !== "system")
    .map((message) => message.id);
}

export function buildContextContinuation(input: {
  readonly sourceThreadId: ThreadId;
  readonly sourceThreadTitle: string;
  readonly messages: ReadonlyArray<ContextMessage>;
  readonly maxChars?: number;
}): string | null {
  const maxChars = input.maxChars ?? MAX_CONTEXT_CONTINUATION_CHARS;
  let context = "";
  for (const message of input.messages.toReversed()) {
    if (message.role === "system" || message.text.trim().length === 0) continue;
    const section = `${message.role.toUpperCase()}:\n${message.text.trim()}`;
    const separator = context.length > 0 ? "\n\n" : "";
    const available = maxChars - context.length - separator.length;
    if (available <= 0) break;
    context = `${section.slice(-available)}${separator}${context}`;
    if (section.length > available) break;
  }
  if (context.length === 0) return null;
  return [
    `[Automatic continuation from thread "${input.sourceThreadTitle}" (${input.sourceThreadId}).]`,
    "Use this bounded history as reference context. Re-check the repository before relying on stale implementation details.",
    "",
    context,
  ].join("\n");
}
