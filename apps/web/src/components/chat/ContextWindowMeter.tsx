import type { UsageLimitSnapshot, UsageProviderKind } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { makeWindow } from "@t3tools/shared/usageFormat";
import { cn } from "~/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { useUsage } from "~/state/usage";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

function formatUsageReset(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  providerDisplayName?: string | null;
}) {
  const { usage, providerDisplayName } = props;
  const usageProvider: UsageProviderKind | null = providerDisplayName
    ?.toLowerCase()
    .includes("codex")
    ? "codex"
    : providerDisplayName?.toLowerCase().includes("claude")
      ? "claude"
      : null;
  const [open, setOpen] = useState(false);
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ContextWindowMeterContent
        usage={usage}
        providerDisplayName={providerDisplayName}
        usageProvider={usageProvider}
        usedPercentage={usedPercentage}
        normalizedPercentage={normalizedPercentage}
        loadLimits={open}
      />
    </Popover>
  );
}

function ContextUsageLimits({ provider }: { provider: UsageProviderKind }) {
  const usageWindow = useMemo(() => makeWindow(1), []);
  const { environments, isPending, isPartial } = useUsage(usageWindow);
  const snapshot = useMemo(() => {
    const newest = new Map<UsageProviderKind, UsageLimitSnapshot>();
    for (const environment of environments) {
      for (const snapshot of environment.summary?.limits ?? []) {
        const previous = newest.get(snapshot.provider);
        if (!previous || snapshot.readAt > previous.readAt) newest.set(snapshot.provider, snapshot);
      }
    }
    return newest.get(provider) ?? null;
  }, [environments, provider]);

  return (
    <div className="mt-1 border-t border-border/60 pt-2">
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-muted-foreground">Usage limits</span>
        {snapshot?.plan ? (
          <span className="text-secondary-label">Plan: {snapshot.plan}</span>
        ) : null}
      </div>
      {snapshot === null ? (
        <p className="text-secondary-label text-[11px] leading-4">
          {isPending || isPartial
            ? "Loading usage limits…"
            : "Provider account limits are not available yet."}
        </p>
      ) : snapshot.windows.length === 0 ? (
        <p className="text-secondary-label text-[11px] leading-4">
          The provider reported a plan but no quota windows.
        </p>
      ) : (
        <div className="space-y-1.5">
          {snapshot.windows.map((limit) => {
            const used = Math.max(0, Math.min(100, limit.usedPercent));
            const remaining = 100 - used;
            const reset = formatUsageReset(limit.resetsAt);
            return (
              <div className="flex flex-col gap-0.5 text-[11px] leading-4" key={limit.label}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-secondary-label">{limit.label}</span>
                  <span className="font-medium tabular-nums text-secondary-label">
                    {remaining.toFixed(0)}% remaining
                  </span>
                </div>
                {reset ? (
                  <span className="text-right text-secondary-label/75 tabular-nums">
                    resets {reset}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ContextWindowMeterContent(props: {
  usage: ContextWindowSnapshot;
  providerDisplayName: string | null | undefined;
  usageProvider: UsageProviderKind | null;
  usedPercentage: string | null;
  normalizedPercentage: number;
  loadLimits: boolean;
}) {
  const { usage, providerDisplayName, usageProvider, usedPercentage, normalizedPercentage } = props;
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedPercentage / 100);
  const totalProcessedTokens = usage.totalProcessedTokens ?? null;
  const showTotalProcessed = totalProcessedTokens !== null && totalProcessedTokens > 0;
  const isOverloaded = normalizedPercentage > 90;
  const usageColor = isOverloaded
    ? "var(--color-error)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";

  return (
    <>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={0}
        render={
          <button
            type="button"
            className={cn(
              "inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-transparent text-muted-foreground outline-none transition-colors",
              "hover:bg-accent data-[pressed]:bg-accent",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            )}
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke={usageColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
            </span>
          </button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        viewportClassName="p-0"
        className="w-64 max-w-none text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2 p-[var(--floating-content-inset)]">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">Context Window</div>
            {usage.maxTokens !== null && usedPercentage ? (
              <div className="text-secondary-label text-[11px] tabular-nums">
                <span>{usedPercentage}</span>
                <span className="mx-1">·</span>
                <span>
                  {formatContextWindowTokens(usage.usedTokens)}/
                  {formatContextWindowTokens(usage.maxTokens ?? null)}
                </span>
              </div>
            ) : (
              <div className="text-secondary-label text-[11px] tabular-nums">
                {formatContextWindowTokens(usage.usedTokens)}
              </div>
            )}
          </div>
          {usage.maxTokens !== null ? (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(normalizedPercentage)}
              aria-label="Context window usage"
            >
              <div
                className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${normalizedPercentage}%`, backgroundColor: usageColor }}
              />
            </div>
          ) : null}
          {showTotalProcessed ? (
            <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
              <span className="text-secondary-label">Total processed</span>
              <span className="font-medium tabular-nums text-secondary-label">
                {formatContextWindowTokens(totalProcessedTokens)}
              </span>
            </div>
          ) : null}
          {props.loadLimits && usageProvider ? (
            <ContextUsageLimits provider={usageProvider} />
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="mt-1 text-pretty text-secondary-label text-[11px] font-medium">
              {providerDisplayName ?? "It"} automatically compacts its context when needed.
            </div>
          ) : null}
        </div>
      </PopoverPopup>
    </>
  );
}
