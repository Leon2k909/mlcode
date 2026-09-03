import { memo, type PointerEventHandler } from "react";
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import type { ThreadTurnDispatchMode } from "@t3tools/contracts";
import { useEnvironmentIdentificationMode } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { StageBackdropButtonArt, useSidebarStageBackdropVariant } from "../SidebarStageBackdrop";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { Spinner } from "../ui/spinner";
import { composerFloatingLayerProps } from "./composerEventScope";

interface PendingActionState {
  questionIndex: number;
  isLastQuestion: boolean;
  canAdvance: boolean;
  isResponding: boolean;
  isComplete: boolean;
}

interface ComposerPrimaryActionsProps {
  compact: boolean;
  pendingAction: PendingActionState | null;
  isRunning: boolean;
  showPlanFollowUpPrompt: boolean;
  promptHasText: boolean;
  isSendBusy: boolean;
  sendDisabledReason: string | null;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isPreparingWorktree: boolean;
  hasSendableContent: boolean;
  queuesRunningTurns: boolean;
  onSubmitMode: (mode: ThreadTurnDispatchMode) => void;
  preserveComposerFocusOnPointerDown?: boolean;
  /** Enter-to-send is disabled on mobile viewports, where stop would otherwise
   * be the only primary action and a running turn could not be steered. */
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  onImplementPlanInNewThread: () => void;
}

export const formatPendingPrimaryActionLabel = (input: {
  compact: boolean;
  isLastQuestion: boolean;
  isResponding: boolean;
  questionIndex: number;
}) => {
  if (input.isResponding) {
    return "Submitting...";
  }
  if (input.compact) {
    return input.isLastQuestion ? "Submit" : "Next";
  }
  if (!input.isLastQuestion) {
    return "Next question";
  }
  return input.questionIndex > 0 ? "Submit answers" : "Submit answer";
};

const preventPointerFocus: PointerEventHandler<HTMLElement> = (event) => {
  event.preventDefault();
};

export const ComposerPrimaryActions = memo(function ComposerPrimaryActions({
  compact,
  pendingAction,
  isRunning,
  showPlanFollowUpPrompt,
  promptHasText,
  isSendBusy,
  sendDisabledReason,
  isConnecting,
  isEnvironmentUnavailable,
  isPreparingWorktree,
  hasSendableContent,
  queuesRunningTurns,
  onSubmitMode,
  preserveComposerFocusOnPointerDown = false,
  onPreviousPendingQuestion,
  onInterrupt,
  onImplementPlanInNewThread,
}: ComposerPrimaryActionsProps) {
  const pointerFocusProps = preserveComposerFocusOnPointerDown
    ? { onPointerDown: preventPointerFocus }
    : undefined;
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const isSendDisabled = sendDisabledReason !== null;
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );

  const renderStopGenerationButton = (insidePendingAction: boolean) => (
    <button
      type="button"
      className={cn(
        "flex cursor-pointer items-center justify-center rounded-full bg-destructive/90 text-white shadow-xs shadow-destructive/24 inset-shadow-[0_1px_--theme(--color-white/16%)] transition-all duration-150 hover:bg-destructive hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none",
        insidePendingAction ? "size-8 sm:size-7" : "size-8 sm:h-8 sm:w-8",
      )}
      {...pointerFocusProps}
      onClick={onInterrupt}
      aria-label="Stop generation"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
        <rect x="2" y="2" width="8" height="8" rx="1.5" />
      </svg>
    </button>
  );

  if (pendingAction) {
    return (
      <div className={cn("flex items-center justify-end", compact ? "gap-1.5" : "gap-2")}>
        {isRunning ? renderStopGenerationButton(true) : null}
        {pendingAction.questionIndex > 0 ? (
          compact ? (
            <Button
              size="icon-sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
              aria-label="Previous question"
            >
              <ChevronLeftIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              {...pointerFocusProps}
              onClick={onPreviousPendingQuestion}
              disabled={pendingAction.isResponding}
            >
              Previous
            </Button>
          )
        ) : null}
        <Button
          type="submit"
          size="sm"
          className={cn(
            "rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover",
            compact ? "px-3" : "px-4",
          )}
          {...pointerFocusProps}
          disabled={
            isEnvironmentUnavailable ||
            pendingAction.isResponding ||
            (pendingAction.isLastQuestion ? !pendingAction.isComplete : !pendingAction.canAdvance)
          }
        >
          {formatPendingPrimaryActionLabel({
            compact,
            isLastQuestion: pendingAction.isLastQuestion,
            isResponding: pendingAction.isResponding,
            questionIndex: pendingAction.questionIndex,
          })}
        </Button>
      </div>
    );
  }

  if (isRunning) {
    return (
      <div className="group/turn-actions flex items-center justify-end gap-1.5">
        {renderStopGenerationButton(false)}
        {hasSendableContent ? (
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="flex h-8 items-center gap-1.5 rounded-full bg-message-action px-3 text-message-action-foreground text-xs font-medium shadow-xs transition-all duration-150 enabled:cursor-pointer hover:bg-message-action-hover hover:scale-105 disabled:pointer-events-none disabled:opacity-30"
                    {...pointerFocusProps}
                    onClick={() => onSubmitMode("queue")}
                    disabled={
                      isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable
                    }
                    aria-label={
                      queuesRunningTurns
                        ? "Queue this message for the next turn"
                        : "Hold this message for the next turn"
                    }
                  />
                }
              >
                Queue
              </TooltipTrigger>
              <TooltipPopup>
                {queuesRunningTurns
                  ? "Queue this message for the next turn"
                  : "Hold this message for the next turn"}
              </TooltipPopup>
            </Tooltip>
            <button
              type="button"
              className="pointer-events-none flex h-8 max-w-0 translate-x-1 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border border-border bg-muted/40 px-0 text-xs font-medium text-foreground/80 opacity-0 shadow-xs transition-[max-width,opacity,transform,padding,background-color] duration-200 group-hover/turn-actions:pointer-events-auto group-hover/turn-actions:max-w-28 group-hover/turn-actions:translate-x-0 group-hover/turn-actions:px-3 group-hover/turn-actions:opacity-100 group-focus-within/turn-actions:pointer-events-auto group-focus-within/turn-actions:max-w-28 group-focus-within/turn-actions:translate-x-0 group-focus-within/turn-actions:px-3 group-focus-within/turn-actions:opacity-100 hover:border-foreground/20 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30 motion-reduce:transition-none"
              {...pointerFocusProps}
              onClick={() => onSubmitMode("steer")}
              disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
              aria-label="Steer now (Ctrl+Enter)"
              aria-keyshortcuts="Control+Enter"
            >
              Steer
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path
                  d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (showPlanFollowUpPrompt) {
    if (promptHasText) {
      return (
        <Button
          type="submit"
          size="sm"
          className={cn(
            "rounded-full bg-message-action text-message-action-foreground hover:bg-message-action-hover",
            compact ? "h-9 px-3 sm:h-8" : "h-9 px-4 sm:h-8",
          )}
          {...pointerFocusProps}
          disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Refine"}
        </Button>
      );
    }

    return (
      <div data-chat-composer-implement-actions="true" className="flex items-center justify-end">
        <Button
          type="submit"
          size="sm"
          className="h-9 rounded-l-full rounded-r-none bg-message-action px-4 text-message-action-foreground hover:bg-message-action-hover sm:h-8"
          {...pointerFocusProps}
          disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
        >
          {isConnecting || isSendBusy ? "Sending..." : "Implement"}
        </Button>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="sm"
                variant="default"
                className="h-9 rounded-l-none rounded-r-full border-l-message-action-foreground/20 bg-message-action px-2 text-message-action-foreground hover:bg-message-action-hover sm:h-8"
                aria-label="Implementation actions"
                {...pointerFocusProps}
                disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
              />
            }
          >
            <ChevronDownIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end" side="top" {...composerFloatingLayerProps}>
            <MenuItem
              disabled={isSendBusy || isSendDisabled || isConnecting || isEnvironmentUnavailable}
              onClick={() => void onImplementPlanInNewThread()}
            >
              Implement in a new thread
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    );
  }

  const sendButton = (
    <button
      type="submit"
      className={cn(
        "relative isolate flex h-9 w-9 items-center justify-center overflow-hidden rounded-full shadow-xs transition-all duration-150 enabled:cursor-pointer enabled:inset-shadow-[0_1px_--theme(--color-white/16%)] hover:scale-105 active:inset-shadow-[0_1px_--theme(--color-black/8%)] active:shadow-none disabled:pointer-events-none disabled:opacity-30 disabled:shadow-none disabled:hover:scale-100 sm:h-8 sm:w-8",
        stageBackdropVariant
          ? "bg-transparent text-white enabled:shadow-black/24 enabled:hover:brightness-110"
          : "bg-message-action text-message-action-foreground enabled:shadow-message-action/24 hover:bg-message-action-hover",
      )}
      {...pointerFocusProps}
      disabled={
        isSendBusy ||
        isSendDisabled ||
        isConnecting ||
        isEnvironmentUnavailable ||
        !hasSendableContent
      }
      aria-label={
        isEnvironmentUnavailable
          ? "Environment disconnected"
          : sendDisabledReason
            ? sendDisabledReason
            : isConnecting
              ? "Connecting"
              : isPreparingWorktree
                ? "Preparing worktree"
                : isSendBusy
                  ? "Sending"
                  : "Send message"
      }
    >
      {stageBackdropVariant ? (
        <span className="absolute inset-0 -z-10" aria-hidden="true">
          <StageBackdropButtonArt variant={stageBackdropVariant} />
        </span>
      ) : null}
      {isConnecting || isSendBusy ? (
        <Spinner className="size-3.5" aria-hidden="true" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M7 11.5V2.5M7 2.5L3 6.5M7 2.5L11 6.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );

  return sendButton;
});
