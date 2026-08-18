import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";
import { getTriggerDisplayModelName, type ModelEsque } from "./providerIconUtils";

export type ContextPrunableMessage<MessageId extends string = string> = {
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
};

const CONTEXT_PRUNE_MIN_USER_TURNS = 5;
const CONTEXT_PRUNE_RETAIN_USER_TURNS = 4;
const CONTEXT_PRUNE_MIN_USED_PERCENTAGE = 50;

export function shouldOfferContextPrune(input: {
  usedPercentage: number | null;
  messageCount: number;
}): boolean {
  return (
    input.messageCount >= CONTEXT_PRUNE_MIN_USER_TURNS * 2 &&
    input.usedPercentage !== null &&
    Number.isFinite(input.usedPercentage) &&
    input.usedPercentage >= CONTEXT_PRUNE_MIN_USED_PERCENTAGE
  );
}

/**
 * A prune prompt is intentionally offered only once per thread. The meter can
 * temporarily lose its fresh usage sample while a provider/model boundary is
 * being resolved, so its visibility must not reset this decision.
 */
export function shouldAutoOpenContextPrunePrompt(input: {
  readonly promptKey: string | null | undefined;
  readonly showPrunePrompt: boolean;
  readonly promptedPruneKey: string | null;
}): boolean {
  return (
    input.showPrunePrompt &&
    input.promptKey !== null &&
    input.promptKey !== undefined &&
    input.promptedPruneKey !== input.promptKey
  );
}

/**
 * Returns the oldest complete portion of a thread while retaining the latest
 * four user turns. System messages are never selected. The caller still owns
 * the confirmation and server-side validation before anything is removed.
 */
export function selectOldestMessageIdsForPruning<MessageId extends string>(
  messages: ReadonlyArray<ContextPrunableMessage<MessageId>>,
): ReadonlyArray<MessageId> {
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

export function resolveContextWindowModelDisplayName(
  selection: ModelSelection | null | undefined,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
): string | null {
  if (!selection) {
    return null;
  }

  const selectedModel = modelOptionsByInstance
    .get(selection.instanceId)
    ?.find((model) => model.slug === selection.model);

  return selectedModel ? getTriggerDisplayModelName(selectedModel) : selection.model;
}

export function formatContextWindowCompactionMessage(
  modelDisplayName: string | null | undefined,
): string {
  return modelDisplayName
    ? `Context for ${modelDisplayName} compacts automatically when needed.`
    : "Context compacts automatically when needed.";
}

export function resolveContextWindowFastMode(
  selection: ModelSelection | null | undefined,
  providerDisplayName?: string | null,
): boolean | null {
  const fastMode = getModelSelectionBooleanOptionValue(selection, "fastMode");
  if (fastMode !== undefined) return fastMode;

  const serviceTier = getModelSelectionStringOptionValue(selection, "serviceTier");
  if (serviceTier === "fast") return true;
  if (serviceTier === "default" && providerDisplayName?.toLowerCase().includes("codex")) {
    return false;
  }
  return null;
}
