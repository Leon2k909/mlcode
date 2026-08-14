import type { ProviderDriverKind, UsageLimitSnapshot, UsageProviderKind } from "@t3tools/contracts";

const snapshots = new Map<UsageProviderKind, UsageLimitSnapshot>();

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestamp(value: unknown): number | null {
  const numeric = finite(value);
  if (numeric !== null) return numeric;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function utilizationPercent(value: unknown): number | null {
  const raw = finite(value);
  if (raw === null) return null;
  return Math.max(0, Math.min(100, raw * (raw <= 1 ? 100 : 1)));
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function displayPlan(value: unknown): string | undefined {
  const plan = nonEmptyString(value);
  if (!plan || plan === "unknown") return undefined;
  const labels: Record<string, string> = {
    free: "Free",
    go: "Go",
    max: "Max",
    plus: "Plus",
    pro: "Pro",
    prolite: "Pro Lite",
    team: "Team",
    business: "Business",
    enterprise: "Enterprise",
    edu: "Education",
    self_serve_business_usage_based: "Business",
    enterprise_cbp_usage_based: "Enterprise",
  };
  return (
    labels[plan] ?? plan.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
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

function codexSpendWindow(value: unknown) {
  const limit = record(value);
  const remainingPercent = finite(limit?.remainingPercent);
  if (remainingPercent === null) return null;
  return {
    label: "Spend limit",
    usedPercent: Math.max(0, Math.min(100, 100 - remainingPercent)),
    resetsAt: finite(limit?.resetsAt),
  };
}

function claudeUsageWindow(label: string, value: unknown) {
  const window = record(value);
  if (!window) return null;
  const usedPercent = utilizationPercent(window.utilization);
  const resetsAt = timestamp(window.resets_at ?? window.resetsAt);
  if (usedPercent === null && resetsAt === null) return null;
  return {
    label,
    ...(usedPercent === null ? {} : { usedPercent }),
    resetsAt,
  };
}

function normalizeClaudeUsageResponse(
  event: Record<string, unknown>,
  rateLimits: Record<string, unknown> | null,
  readAt: string,
): UsageLimitSnapshot | null {
  const windows = [
    claudeUsageWindow("5-hour", rateLimits?.five_hour),
    claudeUsageWindow("Weekly", rateLimits?.seven_day),
    claudeUsageWindow("Weekly (OAuth apps)", rateLimits?.seven_day_oauth_apps),
    claudeUsageWindow("Weekly (Fable)", rateLimits?.seven_day_opus),
    claudeUsageWindow("Weekly (Sonnet)", rateLimits?.seven_day_sonnet),
    claudeUsageWindow("Extra usage", rateLimits?.extra_usage),
  ].filter((window): window is NonNullable<typeof window> => window !== null);
  const plan = displayPlan(
    event.subscription_type ?? event.subscriptionType ?? event.plan ?? event.planType,
  );
  if (windows.length === 0 && plan === undefined) return null;
  return {
    provider: "claude",
    readAt,
    status: nonEmptyString(event.status),
    ...(plan === undefined ? {} : { plan }),
    windows,
  };
}

function normalizeCodex(value: unknown, readAt: string): UsageLimitSnapshot | null {
  const event = record(value);
  if (!event) return null;
  const rootLimits = record(event.rateLimits) ?? event;
  const limitsById = record(event.rateLimitsByLimitId);
  const codexLimitOverrides = record(limitsById?.codex);
  const codexLimits = codexLimitOverrides ? { ...rootLimits, ...codexLimitOverrides } : rootLimits;
  const plan = displayPlan(codexLimits?.planType ?? rootLimits?.planType ?? event.planType);
  const windows = [
    codexWindow("Session", codexLimits.primary),
    codexWindow("Weekly", codexLimits.secondary),
    codexSpendWindow(codexLimits.individualLimit),
  ].filter((window): window is NonNullable<typeof window> => window !== null);
  if (windows.length === 0 && plan === undefined) return null;
  return {
    provider: "codex",
    readAt,
    status: codexLimits.spendControlReached === true ? "Spend limit reached" : null,
    ...(plan === undefined ? {} : { plan }),
    windows,
  };
}

function normalizeClaude(value: unknown, readAt: string): UsageLimitSnapshot | null {
  const event = record(value);
  if (!event) return null;
  const structuredRateLimits =
    Object.hasOwn(event, "rate_limits") || Object.hasOwn(event, "rateLimits")
      ? record(event.rate_limits ?? event.rateLimits)
      : undefined;
  if (structuredRateLimits !== undefined) {
    return normalizeClaudeUsageResponse(event, structuredRateLimits, readAt);
  }
  const info = record(event?.rate_limit_info) ?? record(event?.rateLimitInfo);
  if (!info) return null;
  const type = typeof info.rateLimitType === "string" ? info.rateLimitType : "usage";
  const labels: Record<string, string> = {
    five_hour: "5-hour",
    seven_day: "Weekly",
    seven_day_opus: "Weekly (Fable)",
    seven_day_sonnet: "Weekly (Sonnet)",
    overage: "Overage",
    max_plan: "Max plan",
  };
  const status = nonEmptyString(info.status) ?? nonEmptyString(info.overageStatus);
  const plan = displayPlan(
    info.plan ??
      info.planType ??
      event?.plan ??
      event?.planType ??
      (type === "max_plan" ? "max" : undefined),
  );
  const usedPercent = utilizationPercent(info.utilization);
  const window = {
    label: labels[type] ?? "Usage",
    ...(usedPercent === null
      ? {}
      : {
          usedPercent,
        }),
    resetsAt: timestamp(
      type === "overage" ? (info.overageResetsAt ?? info.resetsAt) : info.resetsAt,
    ),
  };
  if (usedPercent === null && window.resetsAt === null && status === null && plan === undefined) {
    return null;
  }
  return {
    provider: "claude",
    readAt,
    status,
    ...(plan === undefined ? {} : { plan }),
    windows: [window],
  };
}

function mergeSnapshots(
  previous: UsageLimitSnapshot,
  next: UsageLimitSnapshot,
): UsageLimitSnapshot {
  const windows = new Map(previous.windows.map((window) => [window.label, window]));
  for (const window of next.windows) {
    const previousWindow = windows.get(window.label);
    windows.set(window.label, previousWindow ? { ...previousWindow, ...window } : window);
  }
  return {
    ...previous,
    ...next,
    ...(next.plan === undefined && previous.plan !== undefined ? { plan: previous.plan } : {}),
    ...(next.status === null && previous.status !== null ? { status: previous.status } : {}),
    windows: [...windows.values()],
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
  if (!snapshot) return;
  const previous = snapshots.get(snapshot.provider);
  if (previous && snapshot.readAt < previous.readAt) return;
  snapshots.set(snapshot.provider, previous ? mergeSnapshots(previous, snapshot) : snapshot);
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
