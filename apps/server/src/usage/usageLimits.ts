import type { ProviderDriverKind, UsageLimitSnapshot, UsageProviderKind } from "@t3tools/contracts";

const snapshots = new Map<UsageProviderKind, UsageLimitSnapshot>();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function codexWindow(label: string, value: unknown) {
  const window = record(value);
  const usedPercent = finite(window?.usedPercent);
  if (usedPercent === null) return null;
  return {
    label,
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetsAt: finite(window?.resetsAt),
  };
}

function normalizeCodex(value: unknown, readAt: string): UsageLimitSnapshot | null {
  const event = record(value);
  const limits = record(event?.rateLimits) ?? event;
  if (!limits) return null;
  const windows = [
    codexWindow("Session", limits.primary),
    codexWindow("Weekly", limits.secondary),
  ].filter((window): window is NonNullable<typeof window> => window !== null);
  if (windows.length === 0) return null;
  return { provider: "codex", readAt, status: null, windows };
}

function normalizeClaude(value: unknown, readAt: string): UsageLimitSnapshot | null {
  const event = record(value);
  const info = record(event?.rate_limit_info);
  const utilization = finite(info?.utilization);
  if (!info || utilization === null) return null;
  const type = typeof info.rateLimitType === "string" ? info.rateLimitType : "usage";
  const labels: Record<string, string> = {
    five_hour: "5-hour",
    seven_day: "7-day",
    seven_day_opus: "7-day Opus",
    seven_day_sonnet: "7-day Sonnet",
    overage: "Overage",
  };
  return {
    provider: "claude",
    readAt,
    status: typeof info.status === "string" ? info.status : null,
    windows: [
      {
        label: labels[type] ?? "Usage",
        usedPercent: Math.max(0, Math.min(100, utilization * (utilization <= 1 ? 100 : 1))),
        resetsAt: finite(info.resetsAt),
      },
    ],
  };
}

export function normalizeUsageLimits(
  provider: ProviderDriverKind,
  value: unknown,
  readAt: string,
): UsageLimitSnapshot | null {
  return provider === "codex"
    ? normalizeCodex(value, readAt)
    : provider === "claudeAgent"
      ? normalizeClaude(value, readAt)
      : null;
}

export function recordUsageLimits(
  provider: ProviderDriverKind,
  value: unknown,
  readAt: string,
): void {
  const snapshot = normalizeUsageLimits(provider, value, readAt);
  if (snapshot) snapshots.set(snapshot.provider, snapshot);
}

export function readUsageLimits(): UsageLimitSnapshot[] {
  return [...snapshots.values()];
}

export function hydrateUsageLimits(values: readonly UsageLimitSnapshot[]): void {
  for (const snapshot of values) {
    const previous = snapshots.get(snapshot.provider);
    if (!previous || snapshot.readAt > previous.readAt) snapshots.set(snapshot.provider, snapshot);
  }
}
