import type {
  ContextManagementMode,
  MessageId,
  UsageLimitSnapshot,
  UsageProviderKind,
} from "@t3tools/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { makeWindow } from "@t3tools/shared/usageFormat";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { cn } from "~/lib/utils";
import { type ContextWindowSnapshot, formatContextWindowTokens } from "~/lib/contextWindow";
import { useUsage } from "~/state/usage";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import {
  formatContextWindowCompactionMessage,
  selectOldestMessageIdsForPruning,
  shouldOfferContextPrune,
  type ContextPrunableMessage,
} from "./ContextWindowMeter.logic";
import { Minimize2Icon } from "lucide-react";

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

function formatUsageStatus(value: string | null): string | null {
  if (value === null) return null;
  const labels: Record<string, string> = {
    allowed: "Available",
    allowed_warning: "Near limit",
    rejected: "Limit reached",
  };
  return (
    labels[value] ?? value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot | null;
  providerDisplayName?: string | null;
  modelDisplayName?: string | null;
  fastMode?: boolean | null;
  messages?: ReadonlyArray<ContextPrunableMessage<MessageId>>;
  onPruneOlderMessages?: (messageIds: ReadonlyArray<MessageId>) => void;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
  contextManagementMode?: ContextManagementMode;
  onContextManagementModeChange?: (mode: ContextManagementMode) => Promise<boolean>;
}) {
  const { usage, providerDisplayName, modelDisplayName, messages = [] } = props;
  const usageProvider: UsageProviderKind | null = providerDisplayName
    ?.toLowerCase()
    .includes("codex")
    ? "codex"
    : providerDisplayName?.toLowerCase().includes("claude")
      ? "claude"
      : null;
  const [open, setOpen] = useState(false);
  const [savingMode, setSavingMode] = useState<ContextManagementMode | null>(null);
  const [modeSaveFailed, setModeSaveFailed] = useState(false);
  const [prunePromptDismissed, setPrunePromptDismissed] = useState(false);
  const pruneMessageIds = useMemo(() => selectOldestMessageIdsForPruning(messages), [messages]);
  const showPrunePrompt =
    usage !== null &&
    // Pruning acts on the number; a pre-session estimate is not a number to
    // act on. The next provider report un-flags it.
    !usage.stale &&
    props.onPruneOlderMessages !== undefined &&
    shouldOfferContextPrune({
      usedPercentage: usage.usedPercentage,
      messageCount: messages.length,
    }) &&
    pruneMessageIds.length > 0 &&
    (props.contextManagementMode ?? "manual") === "manual" &&
    !prunePromptDismissed;

  useEffect(() => {
    if (usage === null) {
      setOpen(false);
    }
  }, [usage]);

  if (usage === null) {
    return (
      <Popover>
        <PopoverTrigger
          render={
            <button
              type="button"
              className={cn(
                "inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-transparent text-muted-foreground outline-none transition-colors",
                "hover:bg-accent data-[pressed]:bg-accent",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              )}
              aria-label="Context window usage unavailable"
            >
              <span className="size-5 rounded-full border-2 border-muted-foreground/25" />
            </button>
          }
        />
        <PopoverPopup tooltipStyle side="top" align="end" className="w-64 max-w-none">
          <div className="p-[var(--floating-content-inset)] text-secondary-label text-xs">
            Context usage appears after the first message in this thread.
          </div>
        </PopoverPopup>
      </Popover>
    );
  }

  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ContextWindowMeterContent
        usage={usage}
        modelDisplayName={modelDisplayName}
        usageProvider={usageProvider}
        usedPercentage={usedPercentage}
        normalizedPercentage={normalizedPercentage}
        fastMode={props.fastMode}
        onCompact={props.onCompact}
        compactDisabled={props.compactDisabled}
        compactDisabledReason={props.compactDisabledReason}
        loadLimits={open}
        pruneMessageCount={pruneMessageIds.length}
        showPrunePrompt={showPrunePrompt}
        onDismissPrunePrompt={() => {
          setPrunePromptDismissed(true);
          setOpen(false);
        }}
        onPruneOlderMessages={
          props.onPruneOlderMessages === undefined
            ? undefined
            : () => {
                setPrunePromptDismissed(true);
                setOpen(false);
                props.onPruneOlderMessages?.(pruneMessageIds);
              }
        }
        contextManagementMode={props.contextManagementMode ?? "manual"}
        savingMode={savingMode}
        modeSaveFailed={modeSaveFailed}
        onContextManagementModeChange={
          props.onContextManagementModeChange === undefined
            ? undefined
            : async (mode) => {
                setSavingMode(mode);
                setModeSaveFailed(false);
                const saved = await props.onContextManagementModeChange?.(mode);
                setSavingMode(null);
                setModeSaveFailed(saved !== true);
              }
        }
      />
    </Popover>
  );
}

function ContextUsageLimits({ provider }: { provider: UsageProviderKind }) {
  const usageWindow = useMemo(() => ({ ...makeWindow(1), limitsOnly: true }), []);
  const { environments, isPending, isPartial, refresh } = useUsage(usageWindow);
  const refreshedOnOpen = useRef(false);
  useLiveRefresh(refresh);

  useEffect(() => {
    if (refreshedOnOpen.current || environments.length === 0) return;
    refreshedOnOpen.current = true;
    refresh();
  }, [environments.length, refresh]);

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
            const used =
              limit.usedPercent === undefined
                ? null
                : Math.max(0, Math.min(100, limit.usedPercent));
            const remaining = used === null ? null : 100 - used;
            const reset = formatUsageReset(limit.resetsAt);
            return (
              <div className="flex flex-col gap-0.5 text-[11px] leading-4" key={limit.label}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-secondary-label">{limit.label}</span>
                  <span className="font-medium tabular-nums text-secondary-label">
                    {remaining === null
                      ? (formatUsageStatus(snapshot.status) ?? "Status reported")
                      : `${remaining.toFixed(0)}% remaining`}
                  </span>
                </div>
                {used === null ? (
                  <span className="text-right text-secondary-label/75">
                    {formatUsageStatus(snapshot.status) ?? "Utilization not reported"}
                    {reset ? ` · resets ${reset}` : ""}
                  </span>
                ) : reset ? (
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

export function ContextManagementControls(props: {
  contextManagementMode: ContextManagementMode;
  savingMode: ContextManagementMode | null;
  modeSaveFailed: boolean;
  onContextManagementModeChange: (mode: ContextManagementMode) => void;
}) {
  return (
    <div className="mt-1 border-t border-border/60 pt-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-muted-foreground text-[11px]">Long threads</span>
        <span className="text-secondary-label text-[10px]">Runs after work finishes</span>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1">
        {(
          [
            ["manual", "Ask me"],
            ["auto-prune", "Auto-delete"],
            ["auto-new-thread", "New chat"],
          ] as const
        ).map(([mode, label]) => (
          <Button
            key={mode}
            size="xs"
            variant={props.contextManagementMode === mode ? "secondary" : "ghost"}
            disabled={props.savingMode !== null}
            onClick={() => props.onContextManagementModeChange(mode)}
            aria-pressed={props.contextManagementMode === mode}
          >
            {props.savingMode === mode ? "Saving..." : label}
          </Button>
        ))}
      </div>
      <p className="mt-1.5 text-secondary-label text-[10px] leading-3.5">
        Automatic modes act at 75% using fresh provider usage. New chats are created without sending
        or switching away from this thread.
      </p>
      {props.modeSaveFailed ? (
        <p className="mt-1 text-destructive text-[10px] leading-3.5">
          Could not save this setting. Check the connection and try again.
        </p>
      ) : null}
    </div>
  );
}

function ContextWindowMeterContent(props: {
  usage: ContextWindowSnapshot;
  modelDisplayName: string | null | undefined;
  usageProvider: UsageProviderKind | null;
  usedPercentage: string | null;
  normalizedPercentage: number;
  fastMode: boolean | null | undefined;
  onCompact: (() => void) | undefined;
  compactDisabled: boolean | undefined;
  compactDisabledReason: string | null | undefined;
  loadLimits: boolean;
  pruneMessageCount: number;
  showPrunePrompt: boolean;
  onDismissPrunePrompt: () => void;
  onPruneOlderMessages: (() => void) | undefined;
  contextManagementMode: ContextManagementMode;
  savingMode: ContextManagementMode | null;
  modeSaveFailed: boolean;
  onContextManagementModeChange: ((mode: ContextManagementMode) => void) | undefined;
}) {
  const {
    usage,
    modelDisplayName,
    usageProvider,
    usedPercentage,
    normalizedPercentage,
    onCompact,
    compactDisabled,
    compactDisabledReason,
  } = props;
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
        closeDelay={onCompact ? 150 : 0}
        render={
          <Button
            size="icon-sm"
            variant="ghost-muted"
            className="size-7 rounded-full hover:text-muted-foreground data-pressed:text-muted-foreground"
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu mx-0!"
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
          </Button>
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
          {usage.stale ? (
            <p className="text-[11px] leading-4 text-secondary-label">
              From your last session — refreshes with the next message.
            </p>
          ) : null}
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
          {props.fastMode !== null && props.fastMode !== undefined ? (
            <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
              <span className="text-secondary-label">Fast mode</span>
              <span className="font-medium tabular-nums text-secondary-label">
                {props.fastMode ? "On" : "Off"}
              </span>
            </div>
          ) : null}
          {props.showPrunePrompt ? (
            <div className="mt-1 rounded-md border border-border/70 bg-muted/30 p-2">
              <div className="font-medium text-muted-foreground text-[11px]">
                This thread is getting long
              </div>
              <p className="mt-1 text-secondary-label text-[11px] leading-4">
                Delete the {props.pruneMessageCount} oldest messages to make more room for the next
                turn?
              </p>
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <Button size="xs" variant="ghost" onClick={props.onDismissPrunePrompt}>
                  Not now
                </Button>
                <Button size="xs" variant="destructive" onClick={props.onPruneOlderMessages}>
                  Delete oldest
                </Button>
              </div>
            </div>
          ) : null}
          {props.onContextManagementModeChange ? (
            <ContextManagementControls
              contextManagementMode={props.contextManagementMode}
              savingMode={props.savingMode}
              modeSaveFailed={props.modeSaveFailed}
              onContextManagementModeChange={props.onContextManagementModeChange}
            />
          ) : null}
          {props.loadLimits && usageProvider ? (
            <ContextUsageLimits provider={usageProvider} />
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="mt-1 text-pretty text-secondary-label text-[11px] font-medium">
              {formatContextWindowCompactionMessage(modelDisplayName, usage.autoCompactThreshold)}
            </div>
          ) : null}
          {onCompact ? (
            <>
              <Button
                size="xs"
                variant="outline"
                className="mt-1 w-full justify-center"
                disabled={compactDisabled}
                onClick={onCompact}
              >
                <Minimize2Icon aria-hidden="true" />
                Compact context
              </Button>
              {compactDisabled && compactDisabledReason ? (
                <div className="text-pretty text-secondary-label text-[11px]">
                  {compactDisabledReason}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </PopoverPopup>
    </>
  );
}
