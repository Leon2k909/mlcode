import type {
  ModelSelection,
  OrchestrationThreadActivity,
  ThreadTokenUsageSnapshot,
} from "@t3tools/contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

type NullableContextWindowUsage = {
  readonly [Key in keyof ThreadTokenUsageSnapshot]: undefined extends ThreadTokenUsageSnapshot[Key]
    ? Exclude<ThreadTokenUsageSnapshot[Key], undefined> | null
    : ThreadTokenUsageSnapshot[Key];
};

export type ContextWindowSnapshot = NullableContextWindowUsage & {
  readonly remainingTokens: number | null;
  readonly usedPercentage: number | null;
  readonly remainingPercentage: number | null;
  readonly updatedAt: string;
  /**
   * The sample predates this composer session. Close enough to show - the
   * conversation it measured has not changed - but the provider's next report
   * replaces it and interactions that act on the number should wait for one.
   */
  readonly stale: boolean;
};

export type ContextWindowSnapshotOptions = {
  /**
   * Usage activities that were already present when this composer session
   * hydrated. They still describe this conversation, so they render right
   * away - but flagged `stale`, and the provider's next report wins. Hiding
   * them entirely left the meter dead on every thread open until the user
   * sent a message.
   */
  readonly hydratedActivityIds?: ReadonlySet<string>;
};

export function deriveLatestContextWindowSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  activeModelSelection?: Pick<ModelSelection, "instanceId" | "model" | "employeeId"> | null,
  options?: ContextWindowSnapshotOptions,
): ContextWindowSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind === "context-compaction") {
      // A pre-compaction sample no longer describes the live prompt. Wait for
      // the provider's next token update instead of reviving the old count on
      // reload.
      return null;
    }
    if (!activity || activity.kind !== "context-window.updated") {
      continue;
    }
    const stale = options?.hydratedActivityIds?.has(activity.id) ?? false;

    const payload = asRecord(activity.payload);
    const usedTokens = asFiniteNumber(payload?.usedTokens);
    if (usedTokens === null || usedTokens < 0) {
      continue;
    }

    if (activeModelSelection !== undefined && activeModelSelection !== null) {
      const reportedSelection = asRecord(payload?.modelSelection);
      if (
        reportedSelection?.instanceId !== activeModelSelection.instanceId ||
        reportedSelection.model !== activeModelSelection.model ||
        reportedSelection.employeeId !== activeModelSelection.employeeId
      ) {
        // Legacy samples carry no selection identity, and a sample from a
        // different provider/model is equally stale. Do not guess which
        // historical count belongs to the current composer.
        return null;
      }
    }

    const maxTokens = asFiniteNumber(payload?.maxTokens);
    const usedPercentage =
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null;
    const remainingTokens =
      maxTokens !== null ? Math.max(0, Math.round(maxTokens - usedTokens)) : null;
    const remainingPercentage = usedPercentage !== null ? Math.max(0, 100 - usedPercentage) : null;

    return {
      usedTokens,
      totalProcessedTokens: asFiniteNumber(payload?.totalProcessedTokens),
      maxTokens,
      remainingTokens,
      usedPercentage,
      remainingPercentage,
      inputTokens: asFiniteNumber(payload?.inputTokens),
      cachedInputTokens: asFiniteNumber(payload?.cachedInputTokens),
      outputTokens: asFiniteNumber(payload?.outputTokens),
      reasoningOutputTokens: asFiniteNumber(payload?.reasoningOutputTokens),
      lastUsedTokens: asFiniteNumber(payload?.lastUsedTokens),
      lastInputTokens: asFiniteNumber(payload?.lastInputTokens),
      lastCachedInputTokens: asFiniteNumber(payload?.lastCachedInputTokens),
      lastOutputTokens: asFiniteNumber(payload?.lastOutputTokens),
      lastReasoningOutputTokens: asFiniteNumber(payload?.lastReasoningOutputTokens),
      toolUses: asFiniteNumber(payload?.toolUses),
      durationMs: asFiniteNumber(payload?.durationMs),
      compactsAutomatically: asBoolean(payload?.compactsAutomatically) ?? false,
      autoCompactThreshold: asFiniteNumber(payload?.autoCompactThreshold),
      updatedAt: activity.createdAt,
      stale,
    };
  }

  return null;
}

export function formatContextWindowTokens(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "0";
  }
  if (value < 1_000) {
    return `${Math.round(value)}`;
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`;
  }
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

/** Map a provider driver kind to a user-facing display name. */
export function formatProviderDisplayName(provider: string | null | undefined): string {
  if (!provider) return "This agent";
  switch (provider) {
    case "claudeAgent":
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "cursor":
      return "Cursor";
    case "opencode":
      return "OpenCode";
    default: {
      // Title-case unknown driver kinds so they read reasonably.
      const trimmed = provider.replace(/Agent$/i, "").trim();
      if (trimmed.length === 0) return provider;
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
  }
}
