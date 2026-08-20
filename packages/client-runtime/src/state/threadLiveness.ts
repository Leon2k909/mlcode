import type { OrchestrationThreadShell } from "@t3tools/contracts";

export const THREAD_NO_PROGRESS_WARNING_MS = 10 * 60 * 1_000;

export interface ThreadNoProgressState {
  readonly active: boolean;
  readonly possiblyStuck: boolean;
  readonly lastProgressAt: string | null;
  readonly idleMs: number;
}

function latestValidTimestamp(...values: ReadonlyArray<string | null | undefined>): {
  readonly iso: string | null;
  readonly timestamp: number | null;
} {
  let iso: string | null = null;
  let timestamp: number | null = null;
  for (const value of values) {
    if (value == null) continue;
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed) || (timestamp !== null && parsed <= timestamp)) continue;
    iso = value;
    timestamp = parsed;
  }
  return { iso, timestamp };
}

/**
 * Classifies an active turn from its last projected progress, not its total
 * duration. Thread `updatedAt` advances for messages, tool activities, and
 * session transitions, so a long build that keeps reporting output remains
 * healthy while a silent provider eventually becomes advisory-stuck.
 */
export function resolveThreadNoProgress(
  thread: Pick<
    OrchestrationThreadShell,
    "hasPendingApprovals" | "hasPendingUserInput" | "latestTurn" | "session" | "updatedAt"
  >,
  options: {
    readonly nowMs: number;
    readonly warningAfterMs?: number;
  },
): ThreadNoProgressState {
  const active =
    !thread.hasPendingApprovals &&
    !thread.hasPendingUserInput &&
    (thread.session?.status === "running" || thread.session?.status === "starting");
  const latest = latestValidTimestamp(
    thread.latestTurn?.requestedAt,
    thread.latestTurn?.startedAt,
    thread.session?.updatedAt,
    thread.updatedAt,
  );
  if (!active || latest.timestamp === null || !Number.isFinite(options.nowMs)) {
    return {
      active,
      possiblyStuck: false,
      lastProgressAt: latest.iso,
      idleMs: 0,
    };
  }

  const idleMs = Math.max(0, options.nowMs - latest.timestamp);
  return {
    active: true,
    possiblyStuck: idleMs >= Math.max(1, options.warningAfterMs ?? THREAD_NO_PROGRESS_WARNING_MS),
    lastProgressAt: latest.iso,
    idleMs,
  };
}
