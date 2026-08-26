import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";
import {
  CONTEXT_PRUNE_MIN_USED_PERCENTAGE,
  selectOldestMessageIdsForContextPruning,
} from "@t3tools/shared/contextManagement";
import {
  CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
  isClaudeResumeCompactionQuestion,
} from "@t3tools/shared/claudeCompaction";
import {
  resolveSelectableProviderInstanceEntry,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { getTriggerDisplayModelName, type ModelEsque } from "./providerIconUtils";

export type ContextPrunableMessage<MessageId extends string = string> = {
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
};

const CONTEXT_PRUNE_MIN_USER_TURNS = 5;

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
 * Returns the oldest complete portion of a thread while retaining the latest
 * four user turns. System messages are never selected. The caller still owns
 * the confirmation and server-side validation before anything is removed.
 */
export function selectOldestMessageIdsForPruning<MessageId extends string>(
  messages: ReadonlyArray<ContextPrunableMessage<MessageId>>,
): ReadonlyArray<MessageId> {
  return selectOldestMessageIdsForContextPruning(messages);
}

export const CLAUDE_RESUME_COMPACTION_MINUTES = 70;
export const CLAUDE_RESUME_COMPACTION_TOKENS = 100_000;

export function hasAvailableClaudeCompactionProvider(input: {
  readonly providers: ReadonlyArray<ProviderInstanceEntry>;
  readonly instanceId: ProviderInstanceId | null;
  readonly lockedInstanceId: ProviderInstanceId | null;
}): boolean {
  const claudeProviders = input.providers.filter(
    (provider) => provider.driverKind === "claudeAgent",
  );
  const lockedContinuationGroupKey = input.lockedInstanceId
    ? claudeProviders.find((provider) => provider.instanceId === input.lockedInstanceId)
        ?.continuationGroupKey
    : undefined;
  const compatibleProviders = lockedContinuationGroupKey
    ? claudeProviders.filter(
        (provider) => provider.continuationGroupKey === lockedContinuationGroupKey,
      )
    : claudeProviders;

  return (
    resolveSelectableProviderInstanceEntry(compatibleProviders, input.instanceId ?? undefined) !==
    undefined
  );
}

export function hasDismissedResumeCompaction(
  activities: ReadonlyArray<{ readonly kind: string; readonly payload: unknown }>,
): boolean {
  return activities.some((activity) => {
    if (activity.kind !== "user-input.resolved") return false;
    const payload = activity.payload;
    if (!payload || typeof payload !== "object") return false;
    const answers = (payload as { readonly answers?: unknown }).answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) return false;

    return Object.entries(answers).some(
      ([question, answer]) =>
        isClaudeResumeCompactionQuestion(question) &&
        answer === CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
    );
  });
}

export function shouldOfferResumeCompaction(input: {
  readonly provider: string | null | undefined;
  readonly usedTokens: number | null | undefined;
  readonly updatedAt: string | null | undefined;
  readonly now: string;
}): boolean {
  if (
    input.provider !== "claudeAgent" ||
    (input.usedTokens ?? 0) < CLAUDE_RESUME_COMPACTION_TOKENS
  ) {
    return false;
  }

  const updatedAt = Date.parse(input.updatedAt ?? "");
  const now = Date.parse(input.now);
  return (
    Number.isFinite(updatedAt) &&
    Number.isFinite(now) &&
    now - updatedAt >= CLAUDE_RESUME_COMPACTION_MINUTES * 60_000
  );
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
  autoCompactThreshold?: number | null,
): string {
  if (typeof autoCompactThreshold === "number" && autoCompactThreshold > 0) {
    return `Compacts automatically at ${autoCompactThreshold.toLocaleString("en-US")} tokens.`;
  }
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
