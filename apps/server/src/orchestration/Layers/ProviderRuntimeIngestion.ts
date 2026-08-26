import {
  ApprovalRequestId,
  type AssistantDeliveryMode,
  CommandId,
  type ContextManagementMode,
  DEFAULT_MODEL_BY_PROVIDER,
  type EmployeeId,
  type EmployeeMap,
  employeeUsesModelOverride,
  MessageId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationMessage,
  type OrchestrationProposedPlanId,
  CheckpointRef,
  classifyTaskAgentKind,
  EventId,
  isToolLifecycleItemType,
  ThreadId,
  type ThreadTokenUsageSnapshot,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationProposedPlan,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  resolveEmployee,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Cache from "effect/Cache";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import {
  buildContextContinuation,
  CONTEXT_AUTO_MANAGE_MIN_USED_PERCENTAGE,
  selectOldestMessageIdsForContextPruning,
} from "@t3tools/shared/contextManagement";

import { ProviderService } from "../../provider/Services/ProviderService.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { isGitRepository } from "../../git/Utils.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ThreadBackgroundLivenessService } from "../ThreadBackgroundLiveness.ts";
import { ThreadPlanProgressService } from "../ThreadPlanProgress.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import {
  ProviderRuntimeIngestionService,
  type ProviderRuntimeIngestionShape,
} from "../Services/ProviderRuntimeIngestion.ts";
import { projectActivityPayload } from "../ActivityPayloadProjection.ts";
import { canReplaceThreadTitle } from "../threadTitles.ts";
import { forkParked } from "../../serverActivation.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { recordUsageLimits } from "../../usage/usageLimits.ts";
import {
  getClaudeModelCapabilities,
  resolveClaudeEffort,
} from "../../provider/Layers/ClaudeProvider.ts";
import {
  canContinueHandoffChain,
  type ClaudeHandoffAssignment,
  type CodexHandoffAssignment,
  describeHandoffRejection,
  parseEmployeeHandoff,
  resolveAutomaticEmployeeHandoffTarget,
} from "../../employee/EmployeeHandoff.ts";

const DEFAULT_CODEX_HANDOFF_ASSIGNMENT: CodexHandoffAssignment = {
  model: "gpt-5.6-luna",
  reasoning: "low",
};

const applyCodexHandoffReasoning = (
  options: ModelSelection["options"],
  reasoning: CodexHandoffAssignment["reasoning"],
): NonNullable<ModelSelection["options"]> => [
  ...(options ?? []).filter((option) => option.id !== "reasoningEffort"),
  { id: "reasoningEffort", value: reasoning },
];

/**
 * A Claude handoff carries a model but never a `reasoning` attribute (Claude
 * capabilities differ by model — Haiku has no effort selector, so the CEO
 * cannot pick one). The model still runs at a real, defined default effort;
 * this surfaces that default onto the turn's `modelSelection.options` so the
 * timeline chip can show it, instead of silently having nothing to show.
 */
const claudeHandoffDefaultEffortOptions = (model: string): ModelSelection["options"] => {
  const effort = resolveClaudeEffort(getClaudeModelCapabilities(model), undefined);
  return effort === undefined ? undefined : [{ id: "effort", value: effort }];
};

const providerTurnKey = (threadId: ThreadId, turnId: TurnId) => `${threadId}:${turnId}`;
const providerTaskKey = (threadId: ThreadId, taskId: string) => `${threadId}:${taskId}`;

const isCeoGroupRoutingTurn = (thread: Pick<OrchestrationThread, "modelSelection">): boolean =>
  thread.modelSelection.employeeId === "ceo" &&
  (thread.modelSelection.employeeIds?.length ?? 0) >= 2;

const isToolLifecycleEvent = (event: ProviderRuntimeEvent): boolean =>
  (event.type === "item.started" ||
    event.type === "item.updated" ||
    event.type === "item.completed") &&
  isToolLifecycleItemType(event.payload.itemType);

// Fallback when the in-memory description cache no longer has the task name
// (server restart, session-exit sweep, TTL/capacity eviction): earlier
// task.started/task.progress activities for the task are persisted with it.
function findTaskTitleInActivities(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
  taskId: string,
): string | undefined {
  if (!activities) {
    return undefined;
  }
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (!activity || (activity.kind !== "task.started" && activity.kind !== "task.progress")) {
      continue;
    }
    const payload =
      activity.payload && typeof activity.payload === "object"
        ? (activity.payload as { taskId?: unknown; title?: unknown; detail?: unknown })
        : undefined;
    if (payload?.taskId !== taskId) {
      continue;
    }
    const title =
      typeof payload.title === "string"
        ? payload.title
        : activity.kind === "task.started" && typeof payload.detail === "string"
          ? payload.detail
          : undefined;
    if (title && title.trim().length > 0) {
      return title;
    }
  }
  return undefined;
}

interface AssistantSegmentState {
  baseKey: string;
  nextSegmentIndex: number;
  activeMessageId: MessageId | null;
}

const TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY = 10_000;
const TURN_MESSAGE_IDS_BY_TURN_TTL = Duration.minutes(120);
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY = 20_000;
const BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL = Duration.minutes(120);
const BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY = 10_000;
const BUFFERED_PROPOSED_PLAN_BY_ID_TTL = Duration.minutes(120);
const TASK_DESCRIPTION_BY_TASK_CACHE_CAPACITY = 10_000;
const TASK_DESCRIPTION_BY_TASK_TTL = Duration.minutes(120);
const MAX_BUFFERED_ASSISTANT_CHARS = 24_000;
/**
 * How often buffered assistant text reaches the UI while a reply is being
 * written.
 *
 * The two obvious settings are both wrong. Dispatching every token costs a
 * command, a SQL transaction, a projection, and a socket frame per token, which
 * is what `enableLegacyTokenStreaming` opts back into and why it is not the
 * default. Dispatching only at the end of the turn — what this used to do —
 * costs almost nothing and shows the user a dead pane until the whole answer
 * lands, which reads as the app being slow even when the model is fast.
 *
 * Coalescing on a short interval gets both: the reply appears to stream, at
 * roughly eight updates a second, for one or two orders of magnitude fewer
 * dispatches than a token stream on a fast model.
 */
const ASSISTANT_STREAM_FLUSH_INTERVAL_MS = 120;
const MAX_EMPLOYEE_HANDOFF_TEXT_CHARS = 32_000;
const STRICT_PROVIDER_LIFECYCLE_GUARD = process.env.T3CODE_STRICT_PROVIDER_LIFECYCLE_GUARD !== "0";

type TurnStartRequestedDomainEvent = Extract<
  OrchestrationEvent,
  { type: "thread.turn-start-requested" }
>;

type RuntimeIngestionInput =
  | {
      source: "runtime";
      event: ProviderRuntimeEvent;
    }
  | {
      source: "domain";
      event: TurnStartRequestedDomainEvent;
    };

function toTurnId(value: TurnId | string | undefined): TurnId | undefined {
  return value === undefined ? undefined : TurnId.make(String(value));
}

function toApprovalRequestId(value: string | undefined): ApprovalRequestId | undefined {
  return value === undefined ? undefined : ApprovalRequestId.make(value);
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return left === right;
}

function hasAssistantMessageForTurn(
  messages: ReadonlyArray<OrchestrationMessage>,
  turnId: TurnId,
  options?: { readonly streamingOnly?: boolean },
): boolean {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    if (message.role !== "assistant" || message.turnId !== turnId) {
      continue;
    }
    if (options?.streamingOnly === true && !message.streaming) {
      continue;
    }
    return true;
  }
  return false;
}

function findMessageById(
  messages: ReadonlyArray<OrchestrationMessage>,
  messageId: MessageId,
): OrchestrationMessage | undefined {
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.id === messageId) {
      return message;
    }
  }
  return undefined;
}

function findProposedPlanById(
  proposedPlans: ReadonlyArray<
    Pick<OrchestrationProposedPlan, "id" | "createdAt" | "implementedAt" | "implementationThreadId">
  >,
  planId: string,
):
  | Pick<OrchestrationProposedPlan, "id" | "createdAt" | "implementedAt" | "implementationThreadId">
  | undefined {
  for (let index = 0; index < proposedPlans.length; index += 1) {
    const proposedPlan = proposedPlans[index];
    if (proposedPlan?.id === planId) {
      return proposedPlan;
    }
  }
  return undefined;
}

function hasCheckpointForTurn(
  checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>,
  turnId: TurnId,
): boolean {
  for (let index = 0; index < checkpoints.length; index += 1) {
    if (checkpoints[index]?.turnId === turnId) {
      return true;
    }
  }
  return false;
}

function maxCheckpointTurnCount(
  checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>,
): number {
  let maxTurnCount = 0;
  for (let index = 0; index < checkpoints.length; index += 1) {
    const checkpoint = checkpoints[index];
    if (checkpoint && checkpoint.checkpointTurnCount > maxTurnCount) {
      maxTurnCount = checkpoint.checkpointTurnCount;
    }
  }
  return maxTurnCount;
}

function truncateDetail(value: string, limit = 180): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}

function normalizeProposedPlanMarkdown(planMarkdown: string | undefined): string | undefined {
  const trimmed = planMarkdown?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed;
}

function hasRenderableAssistantText(text: string | undefined): boolean {
  return (text?.trim().length ?? 0) > 0;
}

function proposedPlanIdForTurn(threadId: ThreadId, turnId: TurnId): string {
  return `plan:${threadId}:turn:${turnId}`;
}

function proposedPlanIdFromEvent(event: ProviderRuntimeEvent, threadId: ThreadId): string {
  const turnId = toTurnId(event.turnId);
  if (turnId) {
    return proposedPlanIdForTurn(threadId, turnId);
  }
  if (event.itemId) {
    return `plan:${threadId}:item:${event.itemId}`;
  }
  return `plan:${threadId}:event:${event.eventId}`;
}

function assistantSegmentBaseKeyFromEvent(event: ProviderRuntimeEvent): string {
  return String(event.itemId ?? event.turnId ?? event.eventId);
}

function assistantSegmentMessageId(baseKey: string, segmentIndex: number): MessageId {
  return MessageId.make(
    segmentIndex === 0 ? `assistant:${baseKey}` : `assistant:${baseKey}:segment:${segmentIndex}`,
  );
}
function buildContextWindowActivityPayload(
  event: ProviderRuntimeEvent,
  modelSelection: ModelSelection | undefined,
): (ThreadTokenUsageSnapshot & { readonly modelSelection?: ModelSelection }) | undefined {
  if (event.type !== "thread.token-usage.updated" || event.payload.usage.usedTokens <= 0) {
    return undefined;
  }
  return {
    ...event.payload.usage,
    ...(modelSelection !== undefined ? { modelSelection } : {}),
  };
}

function normalizeRuntimeTurnState(
  value: string | undefined,
): "completed" | "failed" | "interrupted" | "cancelled" {
  switch (value) {
    case "failed":
    case "interrupted":
    case "cancelled":
    case "completed":
      return value;
    default:
      return "completed";
  }
}

function orchestrationSessionStatusFromRuntimeState(
  state: "starting" | "running" | "waiting" | "ready" | "interrupted" | "stopped" | "error",
): "starting" | "running" | "ready" | "interrupted" | "stopped" | "error" {
  switch (state) {
    case "starting":
      return "starting";
    case "running":
    case "waiting":
      return "running";
    case "ready":
      return "ready";
    case "interrupted":
      return "interrupted";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
  }
}

function sessionStatusAllowsActiveTurn(
  status: ReturnType<typeof orchestrationSessionStatusFromRuntimeState>,
): boolean {
  return status === "starting" || status === "running";
}

function requestKindFromCanonicalRequestType(
  requestType: string | undefined,
): "command" | "file-read" | "file-change" | "mcp-elicitation" | undefined {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    case "mcp_elicitation_approval":
      return "mcp-elicitation";
    default:
      return undefined;
  }
}

/**
 * Copies the optional TaskAgentLinkage bundle from a task.* runtime payload
 * into the persisted activity payload. Identity fields ride on every row so
 * client folds survive activity retention; absent fields stay absent.
 */
function taskLinkageActivityFields(payload: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    // Server-stamped classification: persisted rows are self-describing, so
    // clients trust the stamp instead of re-deriving agent-vs-background
    // from taskType denylists and marker heuristics (legacy rows without a
    // stamp keep the client fallback).
    agentKind: classifyTaskAgentKind({
      taskType: typeof payload.taskType === "string" ? payload.taskType : undefined,
      agentId: typeof payload.agentId === "string" ? payload.agentId : undefined,
    }),
  };
  for (const key of [
    "taskType",
    "agentId",
    "title",
    "role",
    "model",
    "effort",
    "toolUseId",
    "parentAgentId",
    "workflowName",
    "agentIndex",
    "phaseIndex",
    "phaseTitle",
    "phases",
    "attempt",
    "runHandles",
    "outputFile",
    "agentPath",
    "timelineBypass",
    "typedUsage",
    "status",
    "error",
  ] as const) {
    if (payload[key] !== undefined) {
      fields[key] = payload[key];
    }
  }
  return fields;
}

export function runtimeEventToActivities(
  event: ProviderRuntimeEvent,
  taskTitle?: string,
  modelSelection?: ModelSelection,
): ReadonlyArray<OrchestrationThreadActivity> {
  const maybeSequence = (() => {
    const eventWithSequence = event as ProviderRuntimeEvent & { sessionSequence?: number };
    return eventWithSequence.sessionSequence !== undefined
      ? { sequence: eventWithSequence.sessionSequence }
      : {};
  })();
  switch (event.type) {
    case "request.opened": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "approval",
          kind: "approval.requested",
          summary:
            requestKind === "command"
              ? "Command approval requested"
              : requestKind === "file-read"
                ? "File-read approval requested"
                : requestKind === "file-change"
                  ? "File-change approval requested"
                  : requestKind === "mcp-elicitation"
                    ? "App access approval requested"
                    : "Approval requested",
          payload: {
            requestId: toApprovalRequestId(event.requestId),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.payload.detail ? { detail: event.payload.detail } : {}),
            ...(event.payload.appName ? { appName: event.payload.appName } : {}),
            ...(event.payload.options ? { options: event.payload.options } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "request.resolved": {
      if (event.payload.requestType === "tool_user_input") {
        return [];
      }
      const requestKind = requestKindFromCanonicalRequestType(event.payload.requestType);
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "approval",
          kind: "approval.resolved",
          summary: "Approval resolved",
          payload: {
            requestId: toApprovalRequestId(event.requestId),
            ...(requestKind ? { requestKind } : {}),
            requestType: event.payload.requestType,
            ...(event.payload.decision ? { decision: event.payload.decision } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.error": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "error",
          kind: "runtime.error",
          summary: "Runtime error",
          payload: {
            message: truncateDetail(event.payload.message),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "tool.denied": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "error",
          kind: "tool.denied",
          summary: `Tool denied: ${event.payload.toolName}`,
          payload: {
            toolName: event.payload.toolName,
            ...(event.payload.toolUseId ? { toolUseId: event.payload.toolUseId } : {}),
            ...(event.payload.reason ? { detail: truncateDetail(event.payload.reason) } : {}),
            ...(event.payload.agentId ? { agentId: event.payload.agentId } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "runtime.warning": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "runtime.warning",
          // Use the adapter-supplied message as the row label so the work log
          // shows what the warning was about, not a generic "Runtime warning".
          summary: truncateDetail(event.payload.message, 120),
          payload: {
            message: truncateDetail(event.payload.message),
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "turn.plan.updated": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "turn.plan.updated",
          summary: "Plan updated",
          payload: {
            plan: event.payload.plan,
            ...(event.payload.explanation !== undefined
              ? { explanation: event.payload.explanation }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.requested": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "user-input.requested",
          summary: "User input requested",
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            questions: event.payload.questions,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "user-input.resolved": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "user-input.resolved",
          summary: "User input submitted",
          payload: {
            ...(event.requestId ? { requestId: event.requestId } : {}),
            answers: event.payload.answers,
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.started": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "task.started",
          summary:
            event.payload.taskType === "plan"
              ? "Plan task started"
              : event.payload.taskType
                ? `${event.payload.taskType} task started`
                : "Task started",
          payload: {
            taskId: event.payload.taskId,
            ...(event.payload.taskType ? { taskType: event.payload.taskType } : {}),
            ...(event.payload.description
              ? { detail: truncateDetail(event.payload.description) }
              : {}),
            ...taskLinkageActivityFields(event.payload as Record<string, unknown>),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.progress": {
      const linkage = taskLinkageActivityFields(event.payload as Record<string, unknown>);
      // Usage and activity are independent latest-state streams. Keeping them
      // under separate stable ids prevents a command/reasoning update from
      // replacing the last known token count (and prevents a usage-only tick
      // from blanking the last meaningful activity).
      const identityLinkage = { ...linkage };
      delete identityLinkage.typedUsage;
      delete identityLinkage.status;
      delete identityLinkage.error;
      const title =
        event.payload.description.trim().length > 0
          ? { title: truncateDetail(event.payload.description, 120) }
          : {};
      const hasProgressState =
        event.payload.typedUsage === undefined ||
        event.payload.summary !== undefined ||
        event.payload.lastToolName !== undefined ||
        event.payload.status !== undefined ||
        event.payload.error !== undefined;
      return [
        ...(hasProgressState
          ? [
              {
                // Stable per-task id: activity is "latest state", not
                // history, so each meaningful tick replaces the last. This
                // bounds a large fleet to one activity row per task.
                id: EventId.make(`task-progress:${event.threadId}:${event.payload.taskId}`),
                createdAt: event.createdAt,
                tone: "info" as const,
                kind: "task.progress" as const,
                summary:
                  event.payload.description.trim().length > 0
                    ? truncateDetail(event.payload.description, 120)
                    : "Reasoning update",
                payload: {
                  taskId: event.payload.taskId,
                  ...title,
                  detail: truncateDetail(event.payload.summary ?? event.payload.description),
                  ...(event.payload.summary
                    ? { summary: truncateDetail(event.payload.summary) }
                    : {}),
                  ...(event.payload.lastToolName
                    ? { lastToolName: event.payload.lastToolName }
                    : {}),
                  ...(event.payload.status ? { status: event.payload.status } : {}),
                  ...(event.payload.error ? { error: event.payload.error } : {}),
                  ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
                  ...identityLinkage,
                },
                turnId: toTurnId(event.turnId) ?? null,
                ...maybeSequence,
              },
            ]
          : []),
        ...(event.payload.typedUsage !== undefined
          ? [
              {
                id: EventId.make(`task-usage:${event.threadId}:${event.payload.taskId}`),
                createdAt: event.createdAt,
                tone: "info" as const,
                kind: "task.progress" as const,
                summary: "Task usage updated",
                payload: {
                  taskId: event.payload.taskId,
                  ...title,
                  ...identityLinkage,
                  usageSnapshot: true,
                  typedUsage: event.payload.typedUsage,
                },
                turnId: toTurnId(event.turnId) ?? null,
                ...maybeSequence,
              },
            ]
          : []),
      ];
    }

    case "task.updated": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: event.payload.status === "failed" ? "error" : "info",
          kind: "task.updated",
          summary:
            event.payload.status === "failed"
              ? "Task failed"
              : event.payload.status
                ? `Task ${event.payload.status}`
                : "Task updated",
          payload: {
            taskId: event.payload.taskId,
            ...(event.payload.description
              ? { detail: truncateDetail(event.payload.description) }
              : {}),
            ...(event.payload.endedAt ? { endedAt: event.payload.endedAt } : {}),
            ...(event.payload.isBackgrounded !== undefined
              ? { isBackgrounded: event.payload.isBackgrounded }
              : {}),
            ...taskLinkageActivityFields(event.payload as Record<string, unknown>),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "tool.progress": {
      // Only agent-owned heartbeats are persisted: they feed the owning
      // agent's activity line. Parent-conversation tool progress stays
      // ephemeral (item lifecycle already covers it).
      if (event.payload.taskId === undefined) {
        return [];
      }
      return [
        {
          // Same stable-id treatment as task.progress: a heartbeat is
          // "what is this agent doing right now", so one row per task
          // (thread-scoped for the same global-PK collision reason).
          id: EventId.make(`tool-progress:${event.threadId}:${event.payload.taskId}`),
          createdAt: event.createdAt,
          tone: "info",
          kind: "tool.progress",
          summary: event.payload.toolName ?? "Tool progress",
          payload: {
            taskId: event.payload.taskId,
            ...(event.payload.toolName ? { toolName: event.payload.toolName } : {}),
            ...(event.payload.toolUseId ? { toolUseId: event.payload.toolUseId } : {}),
            ...(event.payload.elapsedSeconds !== undefined
              ? { elapsedSeconds: event.payload.elapsedSeconds }
              : {}),
            ...(event.payload.parentToolUseId
              ? { parentToolUseId: event.payload.parentToolUseId }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "task.completed": {
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: event.payload.status === "failed" ? "error" : "info",
          kind: "task.completed",
          summary:
            event.payload.status === "failed"
              ? "Task failed"
              : event.payload.status === "stopped"
                ? "Task stopped"
                : "Task completed",
          payload: {
            taskId: event.payload.taskId,
            status: event.payload.status,
            ...(taskTitle ? { title: truncateDetail(taskTitle, 120) } : {}),
            // summary + detail mirror task.progress: clients label the row from
            // summary and keep detail for the preview/expanded body.
            ...(event.payload.summary
              ? {
                  summary: truncateDetail(event.payload.summary),
                  detail: truncateDetail(event.payload.summary),
                }
              : {}),
            ...(event.payload.usage !== undefined ? { usage: event.payload.usage } : {}),
            ...taskLinkageActivityFields(event.payload as Record<string, unknown>),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.state.changed": {
      if (event.payload.state !== "compacted") {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-compaction",
          summary: "Context compacted",
          payload: {
            state: event.payload.state,
            ...(event.payload.detail !== undefined ? { detail: event.payload.detail } : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "thread.token-usage.updated": {
      const payload = buildContextWindowActivityPayload(event, modelSelection);
      if (!payload) {
        return [];
      }

      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "info",
          kind: "context-window.updated",
          summary: "Context window updated",
          payload,
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.updated": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      // A streaming update's `data` carries the full tool output accumulated
      // so far (adapters merge state forward), and a new activity is emitted
      // per chunk, so persisting `data` verbatim writes O(N²) bytes per tool
      // call into both the event store and the projection table. No reader
      // needs it: ws.ts and http.ts apply `projectActivityPayload` before any
      // payload reaches a client. Persist the projected form for non-terminal
      // updates; `item.completed` below still persists the full payload.
      return [
        projectActivityPayload({
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.updated",
          summary: event.payload.title ?? "Tool updated",
          payload: {
            itemType: event.payload.itemType,
            ...(event.itemId !== undefined ? { toolCallId: event.itemId } : {}),
            ...(event.payload.status ? { status: event.payload.status } : {}),
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
            ...(event.payload.agentId ? { agentId: event.payload.agentId } : {}),
            ...(event.payload.parentToolUseId
              ? { parentToolUseId: event.payload.parentToolUseId }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        }),
      ];
    }

    case "item.completed": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.completed",
          summary: event.payload.title ?? "Tool",
          payload: {
            itemType: event.payload.itemType,
            ...(event.itemId !== undefined ? { toolCallId: event.itemId } : {}),
            ...(event.payload.status ? { status: event.payload.status } : {}),
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
            ...(event.payload.agentId ? { agentId: event.payload.agentId } : {}),
            ...(event.payload.parentToolUseId
              ? { parentToolUseId: event.payload.parentToolUseId }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    case "item.started": {
      if (!isToolLifecycleItemType(event.payload.itemType)) {
        return [];
      }
      return [
        {
          id: event.eventId,
          createdAt: event.createdAt,
          tone: "tool",
          kind: "tool.started",
          summary: `${event.payload.title ?? "Tool"} started`,
          payload: {
            itemType: event.payload.itemType,
            ...(event.itemId !== undefined ? { toolCallId: event.itemId } : {}),
            ...(event.payload.status ? { status: event.payload.status } : {}),
            ...(event.payload.detail ? { detail: truncateDetail(event.payload.detail) } : {}),
            ...(event.payload.data !== undefined ? { data: event.payload.data } : {}),
            ...(event.payload.agentId ? { agentId: event.payload.agentId } : {}),
            ...(event.payload.parentToolUseId
              ? { parentToolUseId: event.payload.parentToolUseId }
              : {}),
          },
          turnId: toTurnId(event.turnId) ?? null,
          ...maybeSequence,
        },
      ];
    }

    default:
      break;
  }

  return [];
}

// A pending automatic context-management action is only valid for the
// provider/model/employee it was scheduled against. A CEO->worker handoff
// (or a plain model switch) between the qualifying usage sample and the safe
// idle boundary must invalidate it rather than let stale-model usage delete
// or roll over a now-different session.
interface ContextManagementIdentity {
  readonly instanceId: string;
  readonly model: string;
  readonly employeeId: string | undefined;
}

function contextManagementIdentityFromThread(thread: {
  readonly modelSelection: ModelSelection;
}): ContextManagementIdentity {
  return {
    instanceId: thread.modelSelection.instanceId,
    model: thread.modelSelection.model,
    employeeId: thread.modelSelection.employeeId,
  };
}

function contextManagementIdentityEquals(
  left: ContextManagementIdentity,
  right: ContextManagementIdentity,
): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.model === right.model &&
    left.employeeId === right.employeeId
  );
}

const make = Effect.gen(function* () {
  const threadBackgroundLiveness = yield* ThreadBackgroundLivenessService;
  const threadPlanProgress = yield* ThreadPlanProgressService;
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const providerService = yield* ProviderService;
  const projectionTurnRepository = yield* ProjectionTurnRepository;
  const serverSettingsService = yield* ServerSettingsService;
  const providerCommandId = (event: ProviderRuntimeEvent, tag: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`provider:${event.eventId}:${tag}:${uuid}`)),
    );

  const turnMessageIdsByTurnKey = yield* Cache.make<string, Set<MessageId>>({
    capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
    timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
    lookup: () => Effect.succeed(new Set<MessageId>()),
  });

  // `flushedAt` rides along with the text so pacing state expires on the same
  // TTL as the buffer it paces; a separate map would outlive abandoned messages.
  const bufferedAssistantTextByMessageId = yield* Cache.make<
    MessageId,
    { readonly text: string; readonly flushedAt: number }
  >({
    capacity: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_CACHE_CAPACITY,
    timeToLive: BUFFERED_MESSAGE_TEXT_BY_MESSAGE_ID_TTL,
    lookup: () => Effect.succeed({ text: "", flushedAt: 0 }),
  });

  // A second, turn-scoped buffer retains the complete employee reply until
  // turn.completed. The normal message buffer can flush early for streaming
  // or memory pressure, but handoff parsing must see the final trailing tag.
  const employeeHandoffTextByTurnKey = yield* Cache.make<string, string>({
    capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
    timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
    lookup: () => Effect.succeed(""),
  });

  // Number of automatic employee-to-employee turns since the user last
  // spoke, keyed by thread. The user turn domain event resets it.
  const consecutiveEmployeeHandoffs = new Map<string, number>();

  // Prompt reminders are not a hard boundary: a CEO can still ask a full-
  // access provider to run a tool before it emits its handoff. Remember the
  // blocked thread until the turn settles so later tool lifecycle events from
  // that same turn do not leak a misleading "ran" activity into the UI.
  const routingOnlyToolBlockedThreads = new Set<ThreadId>();
  const pendingCeoRoutingRecoveryTurnByThreadId = new Map<ThreadId, TurnId | null>();
  const pendingContextManagementByThreadId = new Map<
    ThreadId,
    {
      readonly mode: Exclude<ContextManagementMode, "manual">;
      readonly eventId: EventId;
      readonly identity: ContextManagementIdentity;
    }
  >();
  // Settings are read on-demand per event, so a mode round-trip (auto ->
  // manual -> the same auto mode) with no intervening thread event in
  // between would otherwise leave a stale pending action's mode check
  // passing. Tracking the last-observed mode via the live settings stream
  // catches every transition, not just ones a runtime event happens to see.
  let lastSeenContextManagementMode: ContextManagementMode | undefined;

  const assistantSegmentStateByTurnKey = yield* Cache.make<string, AssistantSegmentState>({
    capacity: TURN_MESSAGE_IDS_BY_TURN_CACHE_CAPACITY,
    timeToLive: TURN_MESSAGE_IDS_BY_TURN_TTL,
    lookup: () =>
      Effect.die(
        new Error("assistant segment state should be read through getOption before initialization"),
      ),
  });

  const bufferedProposedPlanById = yield* Cache.make<string, { text: string; createdAt: string }>({
    capacity: BUFFERED_PROPOSED_PLAN_BY_ID_CACHE_CAPACITY,
    timeToLive: BUFFERED_PROPOSED_PLAN_BY_ID_TTL,
    lookup: () => Effect.succeed({ text: "", createdAt: "" }),
  });

  // Task names arrive on task.started/task.progress but not on task.completed,
  // so remember them per task to title the completion activity.
  const taskDescriptionByTaskKey = yield* Cache.make<string, string>({
    capacity: TASK_DESCRIPTION_BY_TASK_CACHE_CAPACITY,
    timeToLive: TASK_DESCRIPTION_BY_TASK_TTL,
    lookup: () => Effect.succeed(""),
  });

  const rememberTaskDescription = (threadId: ThreadId, taskId: string, description: string) =>
    Cache.set(taskDescriptionByTaskKey, providerTaskKey(threadId, taskId), description);

  // Entries are left in place after completion so replayed or duplicate
  // terminal events stay titled; TTL, capacity, and the session-exit sweep
  // bound the cache.
  const lookupTaskDescription = (threadId: ThreadId, taskId: string) =>
    Cache.getOption(taskDescriptionByTaskKey, providerTaskKey(threadId, taskId)).pipe(
      Effect.map((description) =>
        Option.filter(description, (value) => value.length > 0).pipe(Option.getOrUndefined),
      ),
    );

  const appendEmployeeHandoffText = (threadId: ThreadId, turnId: TurnId, delta: string) => {
    const key = providerTurnKey(threadId, turnId);
    return Cache.getOption(employeeHandoffTextByTurnKey, key).pipe(
      Effect.flatMap((existingText) => {
        const next = `${Option.getOrElse(existingText, () => "")}${delta}`;
        return Cache.set(
          employeeHandoffTextByTurnKey,
          key,
          next.length <= MAX_EMPLOYEE_HANDOFF_TEXT_CHARS
            ? next
            : next.slice(-MAX_EMPLOYEE_HANDOFF_TEXT_CHARS),
        );
      }),
    );
  };

  const rememberEmployeeHandoffFallbackText = (
    threadId: ThreadId,
    turnId: TurnId,
    fallbackText: string | undefined,
  ) => {
    if (!fallbackText) return Effect.void;
    const key = providerTurnKey(threadId, turnId);
    return Cache.getOption(employeeHandoffTextByTurnKey, key).pipe(
      Effect.flatMap((existingText) =>
        Option.match(existingText, {
          onNone: () => Cache.set(employeeHandoffTextByTurnKey, key, fallbackText),
          onSome: (text) =>
            text.length === 0
              ? Cache.set(employeeHandoffTextByTurnKey, key, fallbackText)
              : Effect.void,
        }),
      ),
    );
  };

  const takeEmployeeHandoffText = (threadId: ThreadId, turnId: TurnId) => {
    const key = providerTurnKey(threadId, turnId);
    return Cache.getOption(employeeHandoffTextByTurnKey, key).pipe(
      Effect.flatMap((text) =>
        Cache.invalidate(employeeHandoffTextByTurnKey, key).pipe(
          Effect.as(Option.getOrElse(text, () => "")),
        ),
      ),
    );
  };

  const resolveThreadDetail = Effect.fn("resolveThreadDetail")(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadDetailById(threadId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const resolveThreadShell = Effect.fn("resolveThreadShell")(function* (threadId: ThreadId) {
    return yield* projectionSnapshotQuery
      .getThreadShellById(threadId)
      .pipe(Effect.map(Option.getOrUndefined));
  });

  const rememberAssistantMessageId = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap((existingIds) =>
        Cache.set(
          turnMessageIdsByTurnKey,
          providerTurnKey(threadId, turnId),
          Option.match(existingIds, {
            onNone: () => new Set([messageId]),
            onSome: (ids) => {
              const nextIds = new Set(ids);
              nextIds.add(messageId);
              return nextIds;
            },
          }),
        ),
      ),
    );

  const forgetAssistantMessageId = (threadId: ThreadId, turnId: TurnId, messageId: MessageId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.flatMap((existingIds) =>
        Option.match(existingIds, {
          onNone: () => Effect.void,
          onSome: (ids) => {
            const nextIds = new Set(ids);
            nextIds.delete(messageId);
            if (nextIds.size === 0) {
              return Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));
            }
            return Cache.set(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId), nextIds);
          },
        }),
      ),
    );

  const getAssistantMessageIdsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.getOption(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId)).pipe(
      Effect.map((existingIds) =>
        Option.getOrElse(existingIds, (): Set<MessageId> => new Set<MessageId>()),
      ),
    );

  const clearAssistantMessageIdsForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.invalidate(turnMessageIdsByTurnKey, providerTurnKey(threadId, turnId));

  const getAssistantSegmentStateForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.getOption(assistantSegmentStateByTurnKey, providerTurnKey(threadId, turnId));

  const setAssistantSegmentStateForTurn = (
    threadId: ThreadId,
    turnId: TurnId,
    state: AssistantSegmentState,
  ) => Cache.set(assistantSegmentStateByTurnKey, providerTurnKey(threadId, turnId), state);

  const clearAssistantSegmentStateForTurn = (threadId: ThreadId, turnId: TurnId) =>
    Cache.invalidate(assistantSegmentStateByTurnKey, providerTurnKey(threadId, turnId));

  const getActiveAssistantMessageIdForTurn = (threadId: ThreadId, turnId: TurnId) =>
    getAssistantSegmentStateForTurn(threadId, turnId).pipe(
      Effect.map((state) =>
        Option.flatMap(state, (entry) =>
          entry.activeMessageId ? Option.some(entry.activeMessageId) : Option.none(),
        ),
      ),
    );

  const startAssistantSegmentForTurn = (input: {
    threadId: ThreadId;
    turnId: TurnId;
    baseKey: string;
  }) =>
    getAssistantSegmentStateForTurn(input.threadId, input.turnId).pipe(
      Effect.flatMap((existingState) =>
        Effect.gen(function* () {
          const nextState = Option.match(existingState, {
            onNone: () => ({
              baseKey: input.baseKey,
              nextSegmentIndex: 1,
              activeMessageId: assistantSegmentMessageId(input.baseKey, 0),
            }),
            onSome: (state) => {
              const segmentIndex = state.baseKey === input.baseKey ? state.nextSegmentIndex : 0;
              const messageId = assistantSegmentMessageId(input.baseKey, segmentIndex);
              return {
                baseKey: input.baseKey,
                nextSegmentIndex: state.baseKey === input.baseKey ? state.nextSegmentIndex + 1 : 1,
                activeMessageId: messageId,
              } satisfies AssistantSegmentState;
            },
          });
          yield* setAssistantSegmentStateForTurn(input.threadId, input.turnId, nextState);
          return nextState.activeMessageId!;
        }),
      ),
    );

  const getOrCreateAssistantMessageId = (input: {
    threadId: ThreadId;
    event: ProviderRuntimeEvent;
    turnId?: TurnId;
  }) =>
    Effect.gen(function* () {
      if (!input.turnId) {
        return assistantSegmentMessageId(assistantSegmentBaseKeyFromEvent(input.event), 0);
      }

      const activeMessageId = yield* getActiveAssistantMessageIdForTurn(
        input.threadId,
        input.turnId,
      );
      if (Option.isSome(activeMessageId)) {
        return activeMessageId.value;
      }

      return yield* startAssistantSegmentForTurn({
        threadId: input.threadId,
        turnId: input.turnId,
        baseKey: assistantSegmentBaseKeyFromEvent(input.event),
      });
    });

  /**
   * Accumulates a delta and returns the text that is ready to be dispatched, or
   * an empty string while it is still worth waiting. The caller dispatches
   * whatever comes back, so partial and final flushes travel the same path the
   * memory safety valve already used.
   */
  const appendBufferedAssistantText = (messageId: MessageId, delta: string) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((existing) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const previous = Option.getOrUndefined(existing);
          const nextText = `${previous?.text ?? ""}${delta}`;
          // A message with no history flushes its first delta immediately: the
          // wait that matters most to the reader is the one before anything at
          // all appears.
          const flushedAt = previous?.flushedAt ?? 0;

          if (nextText.length > MAX_BUFFERED_ASSISTANT_CHARS) {
            // Safety valve: cap memory regardless of how recently we flushed.
            yield* Cache.invalidate(bufferedAssistantTextByMessageId, messageId);
            return nextText;
          }

          // Whitespace on its own must never reach the UI: dispatching it would
          // project an assistant message, and a turn that only ever emits
          // whitespace would leave an empty bubble behind.
          if (
            now - flushedAt >= ASSISTANT_STREAM_FLUSH_INTERVAL_MS &&
            hasRenderableAssistantText(nextText)
          ) {
            yield* Cache.set(bufferedAssistantTextByMessageId, messageId, {
              text: "",
              flushedAt: now,
            });
            return nextText;
          }

          yield* Cache.set(bufferedAssistantTextByMessageId, messageId, {
            text: nextText,
            flushedAt,
          });
          return "";
        }),
      ),
    );

  const takeBufferedAssistantText = (messageId: MessageId) =>
    Cache.getOption(bufferedAssistantTextByMessageId, messageId).pipe(
      Effect.flatMap((existing) =>
        Cache.invalidate(bufferedAssistantTextByMessageId, messageId).pipe(
          Effect.as(Option.match(existing, { onNone: () => "", onSome: (entry) => entry.text })),
        ),
      ),
    );

  const clearBufferedAssistantText = (messageId: MessageId) =>
    Cache.invalidate(bufferedAssistantTextByMessageId, messageId);

  const appendBufferedProposedPlan = (planId: string, delta: string, createdAt: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) => {
        const existing = Option.getOrUndefined(existingEntry);
        return Cache.set(bufferedProposedPlanById, planId, {
          text: `${existing?.text ?? ""}${delta}`,
          createdAt:
            existing?.createdAt && existing.createdAt.length > 0 ? existing.createdAt : createdAt,
        });
      }),
    );

  const takeBufferedProposedPlan = (planId: string) =>
    Cache.getOption(bufferedProposedPlanById, planId).pipe(
      Effect.flatMap((existingEntry) =>
        Cache.invalidate(bufferedProposedPlanById, planId).pipe(
          Effect.as(Option.getOrUndefined(existingEntry)),
        ),
      ),
    );

  const clearBufferedProposedPlan = (planId: string) =>
    Cache.invalidate(bufferedProposedPlanById, planId);

  const clearAssistantMessageState = (messageId: MessageId) =>
    clearBufferedAssistantText(messageId);

  const flushBufferedAssistantMessage = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    messageId: MessageId;
    employeeId?: EmployeeId;
    modelSelection: ModelSelection;
    turnId?: TurnId;
    createdAt: string;
    commandTag: string;
  }) =>
    Effect.gen(function* () {
      const bufferedText = yield* takeBufferedAssistantText(input.messageId);
      if (!hasRenderableAssistantText(bufferedText)) {
        return false;
      }

      yield* orchestrationEngine.dispatch({
        type: "thread.message.assistant.delta",
        commandId: yield* providerCommandId(input.event, input.commandTag),
        threadId: input.threadId,
        messageId: input.messageId,
        delta: bufferedText,
        ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
        modelSelection: input.modelSelection,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        createdAt: input.createdAt,
      });
      return true;
    });

  const flushBufferedAssistantMessagesForTurn = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    employeeId?: EmployeeId;
    modelSelection: ModelSelection;
    turnId: TurnId;
    createdAt: string;
    commandTag: string;
  }) =>
    Effect.gen(function* () {
      const assistantMessageIds = yield* getAssistantMessageIdsForTurn(
        input.threadId,
        input.turnId,
      );
      const flushedMessageIds = new Set<MessageId>();
      yield* Effect.forEach(
        assistantMessageIds,
        (messageId) =>
          flushBufferedAssistantMessage({
            event: input.event,
            threadId: input.threadId,
            messageId,
            ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
            modelSelection: input.modelSelection,
            turnId: input.turnId,
            createdAt: input.createdAt,
            commandTag: input.commandTag,
          }).pipe(
            Effect.tap((flushed) =>
              flushed ? Effect.sync(() => flushedMessageIds.add(messageId)) : Effect.void,
            ),
          ),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      return flushedMessageIds;
    });

  const finalizeAssistantMessage = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    messageId: MessageId;
    employeeId?: EmployeeId;
    modelSelection: ModelSelection;
    turnId?: TurnId;
    createdAt: string;
    commandTag: string;
    finalDeltaCommandTag: string;
    fallbackText?: string;
    hasProjectedMessage?: boolean;
  }) =>
    Effect.gen(function* () {
      const bufferedText = yield* takeBufferedAssistantText(input.messageId);
      const text =
        bufferedText.length > 0
          ? bufferedText
          : (input.fallbackText?.trim().length ?? 0) > 0
            ? input.fallbackText!
            : "";
      const hasRenderableText = hasRenderableAssistantText(text);

      if (hasRenderableText) {
        yield* orchestrationEngine.dispatch({
          type: "thread.message.assistant.delta",
          commandId: yield* providerCommandId(input.event, input.finalDeltaCommandTag),
          threadId: input.threadId,
          messageId: input.messageId,
          delta: text,
          ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
          modelSelection: input.modelSelection,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          createdAt: input.createdAt,
        });
      }

      if (input.hasProjectedMessage || hasRenderableText) {
        yield* orchestrationEngine.dispatch({
          type: "thread.message.assistant.complete",
          commandId: yield* providerCommandId(input.event, input.commandTag),
          threadId: input.threadId,
          messageId: input.messageId,
          ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
          modelSelection: input.modelSelection,
          ...(input.turnId ? { turnId: input.turnId } : {}),
          createdAt: input.createdAt,
        });
      }
      yield* clearAssistantMessageState(input.messageId);
    });

  const finalizeActiveAssistantSegmentForTurn = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    employeeId?: EmployeeId;
    modelSelection: ModelSelection;
    turnId: TurnId;
    createdAt: string;
    commandTag: string;
    finalDeltaCommandTag: string;
    hasProjectedMessage: boolean;
    flushedMessageIds?: ReadonlySet<MessageId>;
  }) =>
    Effect.gen(function* () {
      const activeMessageId = yield* getActiveAssistantMessageIdForTurn(
        input.threadId,
        input.turnId,
      );
      if (Option.isNone(activeMessageId)) {
        return;
      }

      yield* finalizeAssistantMessage({
        event: input.event,
        threadId: input.threadId,
        messageId: activeMessageId.value,
        ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
        modelSelection: input.modelSelection,
        turnId: input.turnId,
        createdAt: input.createdAt,
        commandTag: input.commandTag,
        finalDeltaCommandTag: input.finalDeltaCommandTag,
        hasProjectedMessage:
          input.hasProjectedMessage ||
          (input.flushedMessageIds?.has(activeMessageId.value) ?? false),
      });
      yield* forgetAssistantMessageId(input.threadId, input.turnId, activeMessageId.value);

      const state = yield* getAssistantSegmentStateForTurn(input.threadId, input.turnId);
      if (Option.isSome(state)) {
        yield* setAssistantSegmentStateForTurn(input.threadId, input.turnId, {
          ...state.value,
          activeMessageId: null,
        });
      }
    });

  const upsertProposedPlan = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    threadProposedPlans: ReadonlyArray<{
      id: string;
      createdAt: string;
      implementedAt: string | null;
      implementationThreadId: ThreadId | null;
    }>;
    planId: string;
    turnId?: TurnId;
    planMarkdown: string | undefined;
    createdAt: string;
    updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const planMarkdown = normalizeProposedPlanMarkdown(input.planMarkdown);
      if (!planMarkdown) {
        return;
      }

      const existingPlan = findProposedPlanById(input.threadProposedPlans, input.planId);
      yield* orchestrationEngine.dispatch({
        type: "thread.proposed-plan.upsert",
        commandId: yield* providerCommandId(input.event, "proposed-plan-upsert"),
        threadId: input.threadId,
        proposedPlan: {
          id: input.planId,
          turnId: input.turnId ?? null,
          planMarkdown,
          implementedAt: existingPlan?.implementedAt ?? null,
          implementationThreadId: existingPlan?.implementationThreadId ?? null,
          createdAt: existingPlan?.createdAt ?? input.createdAt,
          updatedAt: input.updatedAt,
        },
        createdAt: input.updatedAt,
      });
    });

  const finalizeBufferedProposedPlan = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    threadProposedPlans: ReadonlyArray<{
      id: string;
      createdAt: string;
      implementedAt: string | null;
      implementationThreadId: ThreadId | null;
    }>;
    planId: string;
    turnId?: TurnId;
    fallbackMarkdown?: string;
    updatedAt: string;
  }) =>
    Effect.gen(function* () {
      const bufferedPlan = yield* takeBufferedProposedPlan(input.planId);
      const bufferedMarkdown = normalizeProposedPlanMarkdown(bufferedPlan?.text);
      const fallbackMarkdown = normalizeProposedPlanMarkdown(input.fallbackMarkdown);
      const planMarkdown = bufferedMarkdown ?? fallbackMarkdown;
      if (!planMarkdown) {
        return;
      }

      yield* upsertProposedPlan({
        event: input.event,
        threadId: input.threadId,
        threadProposedPlans: input.threadProposedPlans,
        planId: input.planId,
        ...(input.turnId ? { turnId: input.turnId } : {}),
        planMarkdown,
        createdAt:
          bufferedPlan?.createdAt && bufferedPlan.createdAt.length > 0
            ? bufferedPlan.createdAt
            : input.updatedAt,
        updatedAt: input.updatedAt,
      });
      yield* clearBufferedProposedPlan(input.planId);
    });

  const clearTurnStateForSession = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const prefix = `${threadId}:`;
      const proposedPlanPrefix = `plan:${threadId}:`;
      const turnKeys = Array.from(yield* Cache.keys(turnMessageIdsByTurnKey));
      const employeeHandoffKeys = Array.from(yield* Cache.keys(employeeHandoffTextByTurnKey));
      const assistantSegmentKeys = Array.from(yield* Cache.keys(assistantSegmentStateByTurnKey));
      const proposedPlanKeys = Array.from(yield* Cache.keys(bufferedProposedPlanById));
      const taskDescriptionKeys = Array.from(yield* Cache.keys(taskDescriptionByTaskKey));
      yield* Effect.forEach(
        turnKeys,
        (key) =>
          Effect.gen(function* () {
            if (!key.startsWith(prefix)) {
              return;
            }

            const messageIds = yield* Cache.getOption(turnMessageIdsByTurnKey, key);
            if (Option.isSome(messageIds)) {
              yield* Effect.forEach(messageIds.value, clearAssistantMessageState, {
                concurrency: 1,
              }).pipe(Effect.asVoid);
            }

            yield* Cache.invalidate(turnMessageIdsByTurnKey, key);
          }),
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        employeeHandoffKeys,
        (key) =>
          key.startsWith(prefix)
            ? Cache.invalidate(employeeHandoffTextByTurnKey, key)
            : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      consecutiveEmployeeHandoffs.delete(threadId);
      yield* Effect.forEach(
        assistantSegmentKeys,
        (key) =>
          key.startsWith(prefix)
            ? Cache.invalidate(assistantSegmentStateByTurnKey, key)
            : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        proposedPlanKeys,
        (key) =>
          key.startsWith(proposedPlanPrefix)
            ? Cache.invalidate(bufferedProposedPlanById, key)
            : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
      yield* Effect.forEach(
        taskDescriptionKeys,
        (key) =>
          key.startsWith(prefix) ? Cache.invalidate(taskDescriptionByTaskKey, key) : Effect.void,
        { concurrency: 1 },
      ).pipe(Effect.asVoid);
    });

  const getSourceProposedPlanReferenceForPendingTurnStart = Effect.fn(
    "getSourceProposedPlanReferenceForPendingTurnStart",
  )(function* (threadId: ThreadId) {
    const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
      threadId,
    });
    if (Option.isNone(pendingTurnStart)) {
      return null;
    }

    const sourceThreadId = pendingTurnStart.value.sourceProposedPlanThreadId;
    const sourcePlanId = pendingTurnStart.value.sourceProposedPlanId;
    if (sourceThreadId === null || sourcePlanId === null) {
      return null;
    }

    return {
      sourceThreadId,
      sourcePlanId,
    } as const;
  });

  const getExpectedProviderTurnIdForThread = Effect.fn("getExpectedProviderTurnIdForThread")(
    function* (threadId: ThreadId) {
      const sessions = yield* providerService.listSessions();
      const session = sessions.find((entry) => entry.threadId === threadId);
      return session?.activeTurnId;
    },
  );

  const getSourceProposedPlanReferenceForAcceptedTurnStart = Effect.fn(
    "getSourceProposedPlanReferenceForAcceptedTurnStart",
  )(function* (threadId: ThreadId, eventTurnId: TurnId | undefined) {
    if (eventTurnId === undefined) {
      return null;
    }

    const expectedTurnId = yield* getExpectedProviderTurnIdForThread(threadId);
    if (!sameId(expectedTurnId, eventTurnId)) {
      return null;
    }

    return yield* getSourceProposedPlanReferenceForPendingTurnStart(threadId);
  });

  const markSourceProposedPlanImplemented = Effect.fn("markSourceProposedPlanImplemented")(
    function* (
      sourceThreadId: ThreadId,
      sourcePlanId: OrchestrationProposedPlanId,
      implementationThreadId: ThreadId,
      implementedAt: string,
    ) {
      const sourceThread = yield* resolveThreadDetail(sourceThreadId);
      const sourcePlan = sourceThread?.proposedPlans.find((entry) => entry.id === sourcePlanId);
      if (!sourceThread || !sourcePlan || sourcePlan.implementedAt !== null) {
        return;
      }

      const commandUuid = yield* crypto.randomUUIDv4;
      yield* orchestrationEngine.dispatch({
        type: "thread.proposed-plan.upsert",
        commandId: CommandId.make(
          `provider:source-proposed-plan-implemented:${implementationThreadId}:${commandUuid}`,
        ),
        threadId: sourceThread.id,
        proposedPlan: {
          ...sourcePlan,
          implementedAt,
          implementationThreadId,
          updatedAt: implementedAt,
        },
        createdAt: implementedAt,
      });
    },
  );

  const appendEmployeeHandoffActivity = Effect.fn("appendEmployeeHandoffActivity")(
    function* (input: {
      readonly event: ProviderRuntimeEvent;
      readonly threadId: ThreadId;
      readonly turnId: TurnId | undefined;
      readonly tone: "info" | "error";
      readonly summary: string;
      readonly detail: string;
    }) {
      const uuid = yield* crypto.randomUUIDv4;
      yield* orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: yield* providerCommandId(input.event, "employee-handoff-activity"),
        threadId: input.threadId,
        activity: {
          id: EventId.make(`employee-handoff:${uuid}`),
          tone: input.tone,
          kind: input.tone === "error" ? "employee.handoff.stopped" : "employee.handoff",
          summary: input.summary,
          payload: { detail: input.detail },
          turnId: input.turnId ?? null,
          createdAt: input.event.createdAt,
        },
        createdAt: input.event.createdAt,
      });
    },
  );

  type EmployeeHandoffThread = Pick<
    OrchestrationThread,
    "id" | "modelSelection" | "runtimeMode" | "interactionMode"
  >;

  const dispatchEmployeeHandoff = Effect.fn("dispatchEmployeeHandoff")(function* (input: {
    readonly event: ProviderRuntimeEvent;
    readonly thread: EmployeeHandoffThread;
    readonly turnId: TurnId | undefined;
    readonly employees: EmployeeMap;
    readonly toEmployeeId: EmployeeId;
    readonly message: string;
    readonly claudeAssignment?: ClaudeHandoffAssignment;
    readonly codexAssignment?: CodexHandoffAssignment;
    readonly completedHandoffs: number;
  }) {
    const selection = input.thread.modelSelection;
    const fromEmployeeId = selection.employeeId;
    const groupEmployeeIds = selection.employeeIds ?? [];
    if (
      fromEmployeeId === undefined ||
      groupEmployeeIds.length < 2 ||
      input.toEmployeeId === fromEmployeeId ||
      !groupEmployeeIds.includes(input.toEmployeeId)
    ) {
      consecutiveEmployeeHandoffs.delete(input.thread.id);
      return false;
    }

    if (!canContinueHandoffChain(input.completedHandoffs, input.toEmployeeId)) {
      consecutiveEmployeeHandoffs.delete(input.thread.id);
      yield* appendEmployeeHandoffActivity({
        event: input.event,
        threadId: input.thread.id,
        turnId: input.turnId,
        tone: "error",
        summary: "Employee handoff limit reached",
        detail:
          "The group paused after eight consecutive employee turns. Send a message to continue.",
      });
      return false;
    }

    const targetEmployee = resolveEmployee(input.employees, input.toEmployeeId);
    if (targetEmployee === undefined) {
      consecutiveEmployeeHandoffs.delete(input.thread.id);
      return false;
    }

    // Handoffs keep the provider selected for the group chat. The employee's
    // saved instance is only a fallback for older/malformed selections, so a
    // CEO running on Claude can hand work to an implementation employee whose
    // default is still Codex without silently jumping providers.
    const selectedProviderInfo = yield* providerService
      .getInstanceInfo(selection.instanceId)
      .pipe(Effect.option);
    const selectedProvider =
      Option.isSome(selectedProviderInfo) && selectedProviderInfo.value.enabled
        ? selectedProviderInfo.value
        : undefined;
    const usesSelectedProvider = selectedProvider !== undefined;
    const targetInstanceId = usesSelectedProvider
      ? selection.instanceId
      : targetEmployee.providerInstanceId;
    const targetInfo = usesSelectedProvider
      ? selectedProvider
      : yield* providerService
          .getInstanceInfo(targetInstanceId)
          .pipe(Effect.option, Effect.map(Option.getOrUndefined));
    if (targetInfo === undefined || !targetInfo.enabled) {
      consecutiveEmployeeHandoffs.delete(input.thread.id);
      yield* appendEmployeeHandoffActivity({
        event: input.event,
        threadId: input.thread.id,
        turnId: input.turnId,
        tone: "error",
        summary: "Employee provider unavailable",
        detail: `${targetEmployee.displayName}'s default provider instance '${targetEmployee.providerInstanceId}' is not available, and the chat provider could not be reused.`,
      });
      return false;
    }

    const usesEmployeeModelOverride = employeeUsesModelOverride(targetEmployee);
    const appliesEmployeeModelOverride =
      usesEmployeeModelOverride && targetInstanceId === targetEmployee.providerInstanceId;
    const ceoCodexAssignment =
      fromEmployeeId === "ceo" && !usesEmployeeModelOverride && targetInfo.driverKind === "codex"
        ? (input.codexAssignment ?? DEFAULT_CODEX_HANDOFF_ASSIGNMENT)
        : undefined;
    const ceoClaudeAssignment =
      fromEmployeeId === "ceo" &&
      !usesEmployeeModelOverride &&
      targetInfo.driverKind === "claudeAgent" &&
      (selection.model === "claude-fable-5" || selection.model === "claude-opus-5")
        ? input.claudeAssignment
        : undefined;
    const targetModel = appliesEmployeeModelOverride
      ? (targetEmployee.model ??
        (usesSelectedProvider ? selection.model : DEFAULT_MODEL_BY_PROVIDER[targetInfo.driverKind]))
      : ceoCodexAssignment !== undefined
        ? ceoCodexAssignment.model
        : ceoClaudeAssignment !== undefined
          ? ceoClaudeAssignment.model
          : usesSelectedProvider
            ? selection.model
            : DEFAULT_MODEL_BY_PROVIDER[targetInfo.driverKind];
    if (!targetModel) {
      consecutiveEmployeeHandoffs.delete(input.thread.id);
      yield* appendEmployeeHandoffActivity({
        event: input.event,
        threadId: input.thread.id,
        turnId: input.turnId,
        tone: "error",
        summary: "Employee model unavailable",
        detail: `No model is configured for ${targetEmployee.displayName}.`,
      });
      return false;
    }

    const inheritedOptions =
      selection.instanceId === targetInstanceId ? selection.options : undefined;
    const targetOptions = appliesEmployeeModelOverride
      ? targetEmployee.modelOptions
      : ceoCodexAssignment !== undefined
        ? applyCodexHandoffReasoning(inheritedOptions, ceoCodexAssignment.reasoning)
        : ceoClaudeAssignment !== undefined
          ? claudeHandoffDefaultEffortOptions(targetModel)
          : inheritedOptions;
    const nextModelSelection: ModelSelection = {
      instanceId: targetInstanceId,
      model: targetModel,
      employeeId: input.toEmployeeId,
      employeeIds: [...groupEmployeeIds],
      ...(targetOptions !== undefined && targetOptions.length > 0
        ? { options: targetOptions }
        : {}),
    };
    const sourceEmployee = resolveEmployee(input.employees, fromEmployeeId);
    const sourceName = sourceEmployee?.displayName ?? String(fromEmployeeId);
    const uuid = yield* crypto.randomUUIDv4;

    yield* orchestrationEngine.dispatch({
      type: "thread.meta.update",
      commandId: yield* providerCommandId(input.event, "employee-handoff-meta"),
      threadId: input.thread.id,
      modelSelection: nextModelSelection,
    });
    yield* orchestrationEngine.dispatch({
      type: "thread.turn.start",
      commandId: yield* providerCommandId(input.event, "employee-handoff-turn"),
      threadId: input.thread.id,
      message: {
        messageId: MessageId.make(`employee-handoff:${input.thread.id}:${uuid}`),
        role: "user",
        text: `To ${targetEmployee.displayName}, from ${sourceName}:\n\n${input.message}`,
        attachments: [],
        employeeId: fromEmployeeId,
      },
      modelSelection: nextModelSelection,
      runtimeMode: input.thread.runtimeMode,
      interactionMode: input.thread.interactionMode,
      createdAt: input.event.createdAt,
    });
    consecutiveEmployeeHandoffs.set(input.thread.id, input.completedHandoffs + 1);
    return true;
  });

  const processEmployeeHandoff = Effect.fn("processEmployeeHandoff")(function* (input: {
    readonly event: Extract<ProviderRuntimeEvent, { type: "turn.completed" }>;
    readonly thread: Pick<
      OrchestrationThread,
      "id" | "modelSelection" | "runtimeMode" | "interactionMode"
    >;
    readonly turnId: TurnId | undefined;
    readonly text: string;
  }) {
    const selection = input.thread.modelSelection;
    const fromEmployeeId = selection.employeeId;
    const groupEmployeeIds = selection.employeeIds ?? [];

    // A private employee thread has no colleagues. Only an explicitly selected
    // group may cause another provider turn without the user speaking.
    if (fromEmployeeId === undefined || groupEmployeeIds.length < 2) {
      consecutiveEmployeeHandoffs.delete(input.thread.id);
      return;
    }

    const settings = yield* serverSettingsService.getSettings;
    const result = parseEmployeeHandoff({
      text: input.text,
      employees: settings.employees,
      fromEmployeeId,
      allowedEmployeeIds: new Set(groupEmployeeIds),
    });

    if (result.kind === "none") {
      const completedHandoffs = consecutiveEmployeeHandoffs.get(input.thread.id) ?? 0;
      const automaticTargetEmployeeId =
        input.text.trim().length > 0 &&
        // A CEO returning after a completed worker chain is allowed to finish
        // the review. Only the initial CEO routing turn gets an automatic
        // recovery; otherwise a missing tag would loop back into the workers.
        !(fromEmployeeId === "ceo" && completedHandoffs > 0)
          ? resolveAutomaticEmployeeHandoffTarget({
              fromEmployeeId,
              allowedEmployeeIds: groupEmployeeIds,
            })
          : undefined;
      if (automaticTargetEmployeeId === undefined) {
        consecutiveEmployeeHandoffs.delete(input.thread.id);
        return;
      }

      const sourceEmployee = resolveEmployee(settings.employees, fromEmployeeId);
      const targetEmployee = resolveEmployee(settings.employees, automaticTargetEmployeeId);
      const dispatched = yield* dispatchEmployeeHandoff({
        event: input.event,
        thread: input.thread,
        turnId: input.turnId,
        employees: settings.employees,
        toEmployeeId: automaticTargetEmployeeId,
        message:
          "The previous employee completed without an explicit handoff. Continue the user's request in your assigned lane, review the response above, and hand off when your lane is complete.",
        completedHandoffs,
      });
      if (dispatched) {
        yield* appendEmployeeHandoffActivity({
          event: input.event,
          threadId: input.thread.id,
          turnId: input.turnId,
          tone: "info",
          summary: "Employee workflow continued",
          detail: `No handoff tag was emitted, so the request continued automatically with ${targetEmployee?.displayName ?? automaticTargetEmployeeId} after ${sourceEmployee?.displayName ?? fromEmployeeId}.`,
        });
      }
      return;
    }
    if (result.kind === "rejected") {
      consecutiveEmployeeHandoffs.delete(input.thread.id);
      yield* appendEmployeeHandoffActivity({
        event: input.event,
        threadId: input.thread.id,
        turnId: input.turnId,
        tone: "error",
        summary: "Employee handoff stopped",
        detail: describeHandoffRejection(result.rejection),
      });
      return;
    }

    yield* dispatchEmployeeHandoff({
      event: input.event,
      thread: input.thread,
      turnId: input.turnId,
      employees: settings.employees,
      toEmployeeId: result.handoff.toEmployeeId,
      message: result.handoff.message,
      ...(result.handoff.codexAssignment !== undefined
        ? { codexAssignment: result.handoff.codexAssignment }
        : {}),
      ...(result.handoff.claudeAssignment !== undefined
        ? { claudeAssignment: result.handoff.claudeAssignment }
        : {}),
      completedHandoffs: consecutiveEmployeeHandoffs.get(input.thread.id) ?? 0,
    });
  });

  const recoverBlockedCeoRouting = Effect.fn("recoverBlockedCeoRouting")(function* (input: {
    readonly event: ProviderRuntimeEvent;
    readonly thread: OrchestrationThread;
    readonly turnId: TurnId | undefined;
  }) {
    const selection = input.thread.modelSelection;
    const fromEmployeeId = selection.employeeId;
    const groupEmployeeIds = selection.employeeIds ?? [];
    if (fromEmployeeId === undefined || !isCeoGroupRoutingTurn(input.thread)) {
      consecutiveEmployeeHandoffs.delete(input.thread.id);
      return;
    }

    const settings = yield* serverSettingsService.getSettings;
    const eligibleWorkerIds = groupEmployeeIds.filter(
      (employeeId) =>
        employeeId !== fromEmployeeId &&
        resolveEmployee(settings.employees, employeeId) !== undefined,
    );
    const targetEmployeeId =
      eligibleWorkerIds.find((employeeId) => employeeId === "worker_beta") ?? eligibleWorkerIds[0];
    if (targetEmployeeId === undefined) {
      consecutiveEmployeeHandoffs.delete(input.thread.id);
      yield* appendEmployeeHandoffActivity({
        event: input.event,
        threadId: input.thread.id,
        turnId: input.turnId,
        tone: "error",
        summary: "CEO routing recovery failed",
        detail: "No enabled worker is available in this employee group.",
      });
      return;
    }

    const recentUserContext = input.thread.messages
      .filter((message) => message.role === "user" && message.employeeId === undefined)
      .slice(-3)
      .map((message, index) => {
        const text = message.text.trim();
        return `User message ${index + 1}:\n${text.length > 0 ? text : "(attachments only)"}`;
      })
      .join("\n\n");
    const boundedUserContext =
      recentUserContext.length > 12_000
        ? `...${recentUserContext.slice(recentUserContext.length - 12_000)}`
        : recentUserContext;
    const recoveryMessage = [
      "The CEO routing turn attempted a tool before delegating, so take over the underlying user request now.",
      targetEmployeeId === "worker_beta"
        ? "Research the request and continue the normal employee handoff chain with a concrete implementation brief."
        : "Handle the request in your assigned lane and continue the normal employee handoff chain.",
      boundedUserContext.length > 0 ? `Recent user context:\n\n${boundedUserContext}` : undefined,
    ]
      .filter((part): part is string => part !== undefined)
      .join("\n\n");

    const dispatched = yield* dispatchEmployeeHandoff({
      event: input.event,
      thread: input.thread,
      turnId: input.turnId,
      employees: settings.employees,
      toEmployeeId: targetEmployeeId,
      message: recoveryMessage,
      completedHandoffs: consecutiveEmployeeHandoffs.get(input.thread.id) ?? 0,
    });
    if (!dispatched) {
      return;
    }

    const targetEmployee = resolveEmployee(settings.employees, targetEmployeeId);
    yield* appendEmployeeHandoffActivity({
      event: input.event,
      threadId: input.thread.id,
      turnId: input.turnId,
      tone: "info",
      summary: "CEO routing recovered",
      detail: `The blocked routing turn continued automatically with ${targetEmployee?.displayName ?? targetEmployeeId}.`,
    });
  });

  const consumePendingCeoRoutingRecovery = (
    threadId: ThreadId,
    settledTurnId: TurnId | undefined,
  ): boolean => {
    if (!pendingCeoRoutingRecoveryTurnByThreadId.has(threadId)) {
      return false;
    }
    const blockedTurnId = pendingCeoRoutingRecoveryTurnByThreadId.get(threadId) ?? null;
    if (blockedTurnId !== null && !sameId(blockedTurnId, settledTurnId)) {
      return false;
    }
    pendingCeoRoutingRecoveryTurnByThreadId.delete(threadId);
    return true;
  };

  // Executes a queued auto-prune/auto-new-thread action once it is safe to
  // do so. Shared by the turn.completed settle path and by qualifying usage
  // reports that arrive with no active turn (e.g. session init), so an idle
  // report is not stuck waiting for a future turn that may not come soon.
  // Re-validates mode, identity (provider/model/employee), and idleness
  // immediately before acting, since all three can have drifted since the
  // sample that queued the action.
  const applyPendingContextManagement = (input: {
    event: ProviderRuntimeEvent;
    threadId: ThreadId;
    eventTurnId: TurnId | undefined;
  }) =>
    Effect.gen(function* () {
      const pending = pendingContextManagementByThreadId.get(input.threadId);
      if (pending === undefined) return;

      const currentContextManagementMode = (yield* serverSettingsService.getSettings)
        .contextManagementMode;
      if (currentContextManagementMode !== pending.mode) {
        pendingContextManagementByThreadId.delete(input.threadId);
        return;
      }

      const currentShell = yield* resolveThreadShell(input.threadId);
      if (!currentShell) return;
      const stillBusy =
        currentShell.session?.status === "starting" || currentShell.session?.status === "running";
      if (stillBusy) return;

      if (
        !contextManagementIdentityEquals(
          pending.identity,
          contextManagementIdentityFromThread(currentShell),
        )
      ) {
        // The provider/model/employee changed since this action was queued
        // (e.g. a CEO->worker handoff) — drop it rather than act against a
        // session it was never scheduled for.
        pendingContextManagementByThreadId.delete(input.threadId);
        return;
      }

      const currentDetail = yield* resolveThreadDetail(input.threadId);
      if (!currentDetail) return;

      const now = input.event.createdAt;
      const pruneMessageIds = selectOldestMessageIdsForContextPruning(currentDetail.messages);
      const continuationContext = buildContextContinuation({
        sourceThreadId: currentDetail.id,
        sourceThreadTitle: currentDetail.title,
        messages: currentDetail.messages.filter((message) => !pruneMessageIds.includes(message.id)),
      });
      if (pruneMessageIds.length === 0 || !continuationContext) {
        return;
      }

      if (pending.mode === "auto-prune") {
        yield* orchestrationEngine.dispatch({
          type: "thread.meta.update",
          commandId: yield* providerCommandId(input.event, "context-auto-prune-carryover"),
          threadId: input.threadId,
          continuation: {
            sourceThreadId: input.threadId,
            sourceThreadTitle: currentDetail.title,
            context: continuationContext,
            createdAt: now,
          },
        });
        yield* orchestrationEngine.dispatch({
          type: "thread.message.delete",
          commandId: yield* providerCommandId(input.event, "context-auto-prune"),
          threadId: input.threadId,
          messageId: pruneMessageIds[0]!,
          messageIds: [...pruneMessageIds],
          createdAt: now,
        });
        yield* orchestrationEngine.dispatch({
          type: "thread.session.stop",
          commandId: yield* providerCommandId(input.event, "context-auto-prune-reset"),
          threadId: input.threadId,
          createdAt: now,
        });
        yield* orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: yield* providerCommandId(input.event, "context-auto-prune-activity"),
          threadId: input.threadId,
          activity: {
            id: EventId.make(yield* crypto.randomUUIDv4),
            tone: "info",
            kind: "context-management.pruned",
            summary: `Automatically removed ${pruneMessageIds.length} old messages`,
            payload: {
              mode: pending.mode,
              triggerEventId: pending.eventId,
              removedMessageCount: pruneMessageIds.length,
            },
            turnId: input.eventTurnId ?? null,
            createdAt: now,
          },
          createdAt: now,
        });
      } else {
        const successorThreadId = ThreadId.make(
          `${input.threadId}-continuation-${pending.eventId}`,
        );
        const existingSuccessor = yield* resolveThreadShell(successorThreadId);
        if (existingSuccessor === undefined) {
          yield* orchestrationEngine.dispatch({
            type: "thread.create",
            commandId: yield* providerCommandId(input.event, "context-auto-rollover-create"),
            threadId: successorThreadId,
            projectId: currentDetail.projectId,
            title: `${currentDetail.title} (continued)`,
            modelSelection: currentDetail.modelSelection,
            runtimeMode: currentDetail.runtimeMode,
            interactionMode: currentDetail.interactionMode,
            branch: currentDetail.branch,
            worktreePath: currentDetail.worktreePath,
            goal: currentDetail.goal ?? null,
            continuation: {
              sourceThreadId: currentDetail.id,
              sourceThreadTitle: currentDetail.title,
              context: continuationContext,
              createdAt: now,
            },
            createdAt: now,
          });
        }
        yield* orchestrationEngine.dispatch({
          type: "thread.activity.append",
          commandId: yield* providerCommandId(input.event, "context-auto-rollover-activity"),
          threadId: input.threadId,
          activity: {
            id: EventId.make(yield* crypto.randomUUIDv4),
            tone: "info",
            kind: "context-management.rollover",
            summary: "Created a continuation thread",
            payload: {
              mode: pending.mode,
              triggerEventId: pending.eventId,
              successorThreadId,
            },
            turnId: input.eventTurnId ?? null,
            createdAt: now,
          },
          createdAt: now,
        });
      }
      pendingContextManagementByThreadId.delete(input.threadId);
    });

  const processRuntimeEvent = (event: ProviderRuntimeEvent) =>
    Effect.gen(function* () {
      if (event.type === "account.rate-limits.updated") {
        recordUsageLimits(event.provider, event.payload.rateLimits, event.createdAt);
      }
      const thread = yield* resolveThreadShell(event.threadId);
      if (!thread) return;

      let loadedThreadDetail: OrchestrationThread | null | undefined;
      const getLoadedThreadDetail = () =>
        Effect.gen(function* () {
          if (loadedThreadDetail !== undefined) {
            return loadedThreadDetail;
          }
          loadedThreadDetail = (yield* resolveThreadDetail(thread.id)) ?? null;
          return loadedThreadDetail;
        });

      if (event.type === "thread.token-usage.updated") {
        const settings = yield* serverSettingsService.getSettings;
        const mode = settings.contextManagementMode;
        const usage = event.payload.usage;
        const usedPercentage =
          usage.maxTokens === undefined || usage.maxTokens <= 0
            ? null
            : (usage.usedTokens / usage.maxTokens) * 100;
        const selectedProvider = yield* providerService.getInstanceInfo(
          thread.modelSelection.instanceId,
        );
        const matchesCurrentProvider =
          event.provider === selectedProvider.driverKind &&
          (event.providerInstanceId === undefined ||
            event.providerInstanceId === thread.modelSelection.instanceId);
        const currentIdentity = contextManagementIdentityFromThread(thread);
        const existingPending = pendingContextManagementByThreadId.get(thread.id);

        // Any of these invalidate a queued action outright: the mode was
        // switched away (including a manual round-trip — a fresh qualifying
        // sample is required after re-enabling, not the stale trigger), or
        // the provider/model/employee identity it was scheduled against no
        // longer matches (e.g. a CEO->worker handoff).
        if (
          existingPending !== undefined &&
          (mode === "manual" ||
            existingPending.mode !== mode ||
            !contextManagementIdentityEquals(existingPending.identity, currentIdentity))
        ) {
          pendingContextManagementByThreadId.delete(thread.id);
        }

        if (mode !== "manual" && matchesCurrentProvider && usedPercentage !== null) {
          if (usedPercentage < CONTEXT_AUTO_MANAGE_MIN_USED_PERCENTAGE) {
            // A fresher matching sample dropping back below threshold (e.g.
            // the provider auto-compacted) cancels any queued action rather
            // than letting a stale trigger still prune/roll over later.
            pendingContextManagementByThreadId.delete(thread.id);
          } else if (!pendingContextManagementByThreadId.has(thread.id)) {
            const detail = yield* getLoadedThreadDetail();
            const pruneIds = selectOldestMessageIdsForContextPruning(detail?.messages ?? []);
            const alreadyRolledOver =
              mode === "auto-new-thread" &&
              detail?.activities.some(
                (activity) => activity.kind === "context-management.rollover",
              );
            if (pruneIds.length > 0 && !alreadyRolledOver) {
              pendingContextManagementByThreadId.set(thread.id, {
                mode,
                eventId: event.eventId,
                identity: currentIdentity,
              });
            }
          }
        }

        // A qualifying sample can legitimately arrive with no active turn
        // (session init, a late result). Act at this safe idle boundary
        // instead of waiting for a future turn.completed that may not come
        // soon — applyPendingContextManagement re-checks idleness itself, so
        // this is a no-op while the session is actually busy.
        if (pendingContextManagementByThreadId.has(thread.id)) {
          yield* applyPendingContextManagement({
            event,
            threadId: thread.id,
            eventTurnId: undefined,
          });
        }
      }

      const now = event.createdAt;
      const eventTurnId = toTurnId(event.turnId);
      const employeeId = thread.modelSelection.employeeId;
      const activeTurnId = thread.session?.activeTurnId ?? null;

      if (
        event.type === "session.exited" ||
        (event.type === "turn.started" && !isCeoGroupRoutingTurn(thread))
      ) {
        routingOnlyToolBlockedThreads.delete(thread.id);
        pendingCeoRoutingRecoveryTurnByThreadId.delete(thread.id);
      }

      const isRoutingOnlyToolStart =
        isCeoGroupRoutingTurn(thread) &&
        event.type === "item.started" &&
        isToolLifecycleItemType(event.payload.itemType);
      if (isRoutingOnlyToolStart && !routingOnlyToolBlockedThreads.has(thread.id)) {
        routingOnlyToolBlockedThreads.add(thread.id);
        pendingCeoRoutingRecoveryTurnByThreadId.set(thread.id, eventTurnId ?? activeTurnId);
        yield* providerService
          .interruptTurn({
            threadId: thread.id,
            ...(eventTurnId !== undefined ? { turnId: eventTurnId } : {}),
          })
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("failed to stop CEO routing-only tool", {
                threadId: thread.id,
                turnId: eventTurnId,
                eventId: event.eventId,
                cause: Cause.pretty(cause),
              }),
            ),
          );
        yield* appendEmployeeHandoffActivity({
          event,
          threadId: thread.id,
          turnId: eventTurnId,
          tone: "info",
          summary: "CEO routing redirected",
          detail:
            "The CEO attempted a tool during a routing-only turn. The tool was blocked, and the request will continue automatically with a worker.",
        });
      }

      const pendingTurnStart = yield* projectionTurnRepository.getPendingTurnStartByThreadId({
        threadId: thread.id,
      });
      const hasPendingTurnStart =
        Option.isSome(pendingTurnStart) && thread.session?.status === "starting";

      const conflictsWithActiveTurn =
        activeTurnId !== null && eventTurnId !== undefined && !sameId(activeTurnId, eventTurnId);
      const missingTurnForActiveTurn = activeTurnId !== null && eventTurnId === undefined;

      // A turn.started that conflicts with the active turn is legitimate when
      // the server itself has a turn start pending for this thread AND the
      // provider session already tracks the event's turn as its active turn:
      // steering a running turn makes some providers (e.g. opencode) open a
      // new turn without ever completing the superseded one. A stale
      // turn.started for some other turn id still gets rejected.
      const conflictingTurnStartIsPendingTurnStart =
        event.type === "turn.started" && conflictsWithActiveTurn
          ? sameId(yield* getExpectedProviderTurnIdForThread(thread.id), eventTurnId) &&
            Option.isSome(pendingTurnStart)
          : false;

      const shouldApplyThreadLifecycle = (() => {
        if (!STRICT_PROVIDER_LIFECYCLE_GUARD) {
          return true;
        }
        switch (event.type) {
          case "session.exited":
            return true;
          case "session.started":
          case "thread.started":
            return true;
          case "turn.started":
            return !conflictsWithActiveTurn || conflictingTurnStartIsPendingTurnStart;
          case "turn.completed":
            if (conflictsWithActiveTurn || missingTurnForActiveTurn) {
              return false;
            }
            // Only the active turn may close the lifecycle state.
            if (activeTurnId !== null && eventTurnId !== undefined) {
              return sameId(activeTurnId, eventTurnId);
            }
            // No active turn tracked: accept only completions that name their
            // turn (covers a real completion whose turn.started was lost). An
            // untargeted completion cannot prove it belongs to any turn this
            // thread ran — the known emitter was the Claude resume handshake
            // (system/init + result(num_turns: 0)), which is not a turn at
            // all — and applying it here stomps the "starting" lifecycle
            // state while a turn start is pending.
            return eventTurnId !== undefined;
          default:
            return true;
        }
      })();
      const acceptedTurnStartedSourcePlan =
        event.type === "turn.started" && shouldApplyThreadLifecycle
          ? yield* getSourceProposedPlanReferenceForAcceptedTurnStart(thread.id, eventTurnId)
          : null;

      if (
        event.type === "session.started" ||
        event.type === "session.state.changed" ||
        event.type === "session.exited" ||
        event.type === "thread.started" ||
        event.type === "turn.started" ||
        event.type === "turn.completed"
      ) {
        const status = (() => {
          switch (event.type) {
            case "session.state.changed": {
              const runtimeStatus = orchestrationSessionStatusFromRuntimeState(event.payload.state);
              return hasPendingTurnStart && runtimeStatus === "ready" ? "starting" : runtimeStatus;
            }
            case "turn.started":
              return "running";
            case "session.exited":
              return "stopped";
            case "turn.completed":
              return normalizeRuntimeTurnState(event.payload.state) === "failed"
                ? "error"
                : "ready";
            case "session.started":
            case "thread.started":
              // Provider thread/session start notifications can arrive during an
              // active or pending turn; preserve that lifecycle state.
              return activeTurnId !== null ? "running" : hasPendingTurnStart ? "starting" : "ready";
          }
        })();
        const nextActiveTurnId =
          event.type === "turn.started"
            ? (eventTurnId ?? null)
            : event.type === "turn.completed" || event.type === "session.exited"
              ? null
              : event.type === "session.state.changed" &&
                  !sessionStatusAllowsActiveTurn(
                    orchestrationSessionStatusFromRuntimeState(event.payload.state),
                  )
                ? null
                : activeTurnId;
        const lastError =
          event.type === "session.state.changed" && event.payload.state === "error"
            ? (event.payload.reason ?? thread.session?.lastError ?? "Provider session error")
            : event.type === "turn.completed" &&
                normalizeRuntimeTurnState(event.payload.state) === "failed"
              ? (event.payload.errorMessage ?? thread.session?.lastError ?? "Turn failed")
              : status === "ready"
                ? null
                : (thread.session?.lastError ?? null);

        if (shouldApplyThreadLifecycle) {
          if (event.type === "turn.started" && acceptedTurnStartedSourcePlan !== null) {
            yield* markSourceProposedPlanImplemented(
              acceptedTurnStartedSourcePlan.sourceThreadId,
              acceptedTurnStartedSourcePlan.sourcePlanId,
              thread.id,
              now,
            ).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning(
                  "provider runtime ingestion failed to mark source proposed plan",
                  {
                    eventId: event.eventId,
                    eventType: event.type,
                    cause: Cause.pretty(cause),
                  },
                ),
              ),
            );
          }

          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: yield* providerCommandId(event, "thread-session-set"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status,
              providerName: event.provider,
              ...(event.providerInstanceId !== undefined
                ? { providerInstanceId: event.providerInstanceId }
                : {}),
              runtimeMode: thread.session?.runtimeMode ?? "full-access",
              activeTurnId: nextActiveTurnId,
              lastError,
              updatedAt: now,
            },
            createdAt: now,
          });
        }
      }

      const assistantDelta =
        event.type === "content.delta" && event.payload.streamKind === "assistant_text"
          ? event.payload.delta
          : undefined;
      const proposedPlanDelta =
        event.type === "turn.proposed.delta" ? event.payload.delta : undefined;

      if (assistantDelta && assistantDelta.length > 0) {
        const turnId = toTurnId(event.turnId);
        if (turnId && employeeId !== undefined) {
          yield* appendEmployeeHandoffText(thread.id, turnId, assistantDelta);
        }
        const assistantMessageId = yield* getOrCreateAssistantMessageId({
          threadId: thread.id,
          event,
          ...(turnId ? { turnId } : {}),
        });
        if (turnId) {
          yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId);
        }

        const assistantDeliveryMode: AssistantDeliveryMode = yield* Effect.map(
          serverSettingsService.getSettings,
          (settings) => (settings.enableLegacyTokenStreaming ? "streaming" : "buffered"),
        );
        if (assistantDeliveryMode === "buffered") {
          const readyChunk = yield* appendBufferedAssistantText(assistantMessageId, assistantDelta);
          if (readyChunk.length > 0) {
            yield* orchestrationEngine.dispatch({
              type: "thread.message.assistant.delta",
              commandId: yield* providerCommandId(event, "assistant-delta-buffer-spill"),
              threadId: thread.id,
              messageId: assistantMessageId,
              delta: readyChunk,
              ...(employeeId !== undefined ? { employeeId } : {}),
              modelSelection: thread.modelSelection,
              ...(turnId ? { turnId } : {}),
              createdAt: now,
            });
          }
        } else {
          yield* orchestrationEngine.dispatch({
            type: "thread.message.assistant.delta",
            commandId: yield* providerCommandId(event, "assistant-delta"),
            threadId: thread.id,
            messageId: assistantMessageId,
            delta: assistantDelta,
            ...(employeeId !== undefined ? { employeeId } : {}),
            modelSelection: thread.modelSelection,
            ...(turnId ? { turnId } : {}),
            createdAt: now,
          });
        }
      }

      const pauseForUserTurnId =
        event.type === "request.opened" || event.type === "user-input.requested"
          ? toTurnId(event.turnId)
          : undefined;
      if (pauseForUserTurnId) {
        const detailedThread = yield* getLoadedThreadDetail();
        const assistantDeliveryMode: AssistantDeliveryMode = yield* Effect.map(
          serverSettingsService.getSettings,
          (settings) => (settings.enableLegacyTokenStreaming ? "streaming" : "buffered"),
        );
        const flushedMessageIds =
          assistantDeliveryMode === "buffered"
            ? yield* flushBufferedAssistantMessagesForTurn({
                event,
                threadId: thread.id,
                ...(employeeId !== undefined ? { employeeId } : {}),
                modelSelection: thread.modelSelection,
                turnId: pauseForUserTurnId,
                createdAt: now,
                commandTag:
                  event.type === "request.opened"
                    ? "assistant-delta-flush-on-request-opened"
                    : "assistant-delta-flush-on-user-input-requested",
              })
            : new Set<MessageId>();
        yield* finalizeActiveAssistantSegmentForTurn({
          event,
          threadId: thread.id,
          ...(employeeId !== undefined ? { employeeId } : {}),
          modelSelection: thread.modelSelection,
          turnId: pauseForUserTurnId,
          createdAt: now,
          commandTag:
            event.type === "request.opened"
              ? "assistant-complete-on-request-opened"
              : "assistant-complete-on-user-input-requested",
          finalDeltaCommandTag:
            event.type === "request.opened"
              ? "assistant-delta-finalize-on-request-opened"
              : "assistant-delta-finalize-on-user-input-requested",
          hasProjectedMessage:
            detailedThread !== null &&
            hasAssistantMessageForTurn(detailedThread.messages, pauseForUserTurnId, {
              streamingOnly: true,
            }),
          flushedMessageIds,
        });
      }

      if (proposedPlanDelta && proposedPlanDelta.length > 0) {
        const planId = proposedPlanIdFromEvent(event, thread.id);
        yield* appendBufferedProposedPlan(planId, proposedPlanDelta, now);
      }

      const assistantCompletion =
        event.type === "item.completed" && event.payload.itemType === "assistant_message"
          ? {
              messageId: MessageId.make(
                `assistant:${event.itemId ?? event.turnId ?? event.eventId}`,
              ),
              fallbackText: event.payload.detail,
            }
          : undefined;
      const proposedPlanCompletion =
        event.type === "turn.proposed.completed"
          ? {
              planId: proposedPlanIdFromEvent(event, thread.id),
              turnId: toTurnId(event.turnId),
              planMarkdown: event.payload.planMarkdown,
            }
          : undefined;

      if (assistantCompletion) {
        const detailedThread = yield* getLoadedThreadDetail();
        const messages = detailedThread?.messages ?? [];
        const turnId = toTurnId(event.turnId);
        if (turnId && employeeId !== undefined) {
          yield* rememberEmployeeHandoffFallbackText(
            thread.id,
            turnId,
            assistantCompletion.fallbackText,
          );
        }
        const activeAssistantMessageId = turnId
          ? yield* getActiveAssistantMessageIdForTurn(thread.id, turnId)
          : Option.none<MessageId>();
        const hasAssistantMessagesForTurn =
          turnId !== undefined ? hasAssistantMessageForTurn(messages, turnId) : false;
        const assistantMessageId = Option.getOrElse(
          activeAssistantMessageId,
          () => assistantCompletion.messageId,
        );
        const existingAssistantMessage = findMessageById(messages, assistantMessageId);
        const shouldApplyFallbackCompletionText =
          !existingAssistantMessage || existingAssistantMessage.text.length === 0;

        const shouldSkipRedundantCompletion =
          Option.isNone(activeAssistantMessageId) &&
          turnId !== undefined &&
          hasAssistantMessagesForTurn &&
          (assistantCompletion.fallbackText?.trim().length ?? 0) === 0;

        if (!shouldSkipRedundantCompletion) {
          if (turnId && Option.isNone(activeAssistantMessageId)) {
            yield* rememberAssistantMessageId(thread.id, turnId, assistantMessageId);
          }

          yield* finalizeAssistantMessage({
            event,
            threadId: thread.id,
            messageId: assistantMessageId,
            ...(employeeId !== undefined ? { employeeId } : {}),
            modelSelection: thread.modelSelection,
            ...(turnId ? { turnId } : {}),
            createdAt: now,
            commandTag: "assistant-complete",
            finalDeltaCommandTag: "assistant-delta-finalize",
            hasProjectedMessage: existingAssistantMessage !== undefined,
            ...(assistantCompletion.fallbackText !== undefined && shouldApplyFallbackCompletionText
              ? { fallbackText: assistantCompletion.fallbackText }
              : {}),
          });

          if (turnId) {
            yield* forgetAssistantMessageId(thread.id, turnId, assistantMessageId);
          }
        }

        if (turnId) {
          yield* clearAssistantSegmentStateForTurn(thread.id, turnId);
        }
      }

      if (proposedPlanCompletion) {
        const detailedThread = yield* getLoadedThreadDetail();
        yield* finalizeBufferedProposedPlan({
          event,
          threadId: thread.id,
          threadProposedPlans: detailedThread?.proposedPlans ?? [],
          planId: proposedPlanCompletion.planId,
          ...(proposedPlanCompletion.turnId ? { turnId: proposedPlanCompletion.turnId } : {}),
          fallbackMarkdown: proposedPlanCompletion.planMarkdown,
          updatedAt: now,
        });
      }

      if (event.type === "turn.completed") {
        const detailedThread = yield* getLoadedThreadDetail();
        const messages = detailedThread?.messages ?? [];
        const proposedPlans = detailedThread?.proposedPlans ?? [];
        const turnId = toTurnId(event.turnId);
        if (turnId) {
          const assistantMessageIds = yield* getAssistantMessageIdsForTurn(thread.id, turnId);
          yield* Effect.forEach(
            assistantMessageIds,
            (assistantMessageId) =>
              finalizeAssistantMessage({
                event,
                threadId: thread.id,
                messageId: assistantMessageId,
                ...(employeeId !== undefined ? { employeeId } : {}),
                modelSelection: thread.modelSelection,
                turnId,
                createdAt: now,
                commandTag: "assistant-complete-finalize",
                finalDeltaCommandTag: "assistant-delta-finalize-fallback",
                hasProjectedMessage: findMessageById(messages, assistantMessageId) !== undefined,
              }),
            { concurrency: 1 },
          ).pipe(Effect.asVoid);
          yield* clearAssistantMessageIdsForTurn(thread.id, turnId);
          yield* clearAssistantSegmentStateForTurn(thread.id, turnId);

          yield* finalizeBufferedProposedPlan({
            event,
            threadId: thread.id,
            threadProposedPlans: proposedPlans,
            planId: proposedPlanIdForTurn(thread.id, turnId),
            turnId,
            updatedAt: now,
          });

          const employeeReplyText = yield* takeEmployeeHandoffText(thread.id, turnId);
          const shouldRecoverCeoRouting =
            shouldApplyThreadLifecycle && consumePendingCeoRoutingRecovery(thread.id, turnId);
          if (shouldRecoverCeoRouting) {
            if (detailedThread !== null) {
              yield* recoverBlockedCeoRouting({
                event,
                thread: detailedThread,
                turnId,
              });
            } else {
              consecutiveEmployeeHandoffs.delete(thread.id);
              yield* appendEmployeeHandoffActivity({
                event,
                threadId: thread.id,
                turnId,
                tone: "error",
                summary: "CEO routing recovery failed",
                detail: "The thread details were unavailable after the blocked routing turn.",
              });
            }
          } else if (
            shouldApplyThreadLifecycle &&
            employeeId !== undefined &&
            normalizeRuntimeTurnState(event.payload.state) === "completed"
          ) {
            yield* processEmployeeHandoff({
              event,
              thread: detailedThread ?? thread,
              turnId,
              text: employeeReplyText,
            });
          }
        }

        if (
          shouldApplyThreadLifecycle &&
          normalizeRuntimeTurnState(event.payload.state) === "completed"
        ) {
          yield* applyPendingContextManagement({
            event,
            threadId: thread.id,
            eventTurnId,
          });
        }
      }

      if (event.type === "session.exited") {
        yield* clearTurnStateForSession(thread.id);
      }
      if (event.type === "turn.aborted" && eventTurnId !== undefined) {
        yield* takeEmployeeHandoffText(thread.id, eventTurnId);
        const shouldRecoverCeoRouting =
          shouldApplyThreadLifecycle && consumePendingCeoRoutingRecovery(thread.id, eventTurnId);
        if (shouldRecoverCeoRouting) {
          const detailedThread = yield* getLoadedThreadDetail();
          if (detailedThread !== null) {
            yield* recoverBlockedCeoRouting({
              event,
              thread: detailedThread,
              turnId: eventTurnId,
            });
          } else {
            consecutiveEmployeeHandoffs.delete(thread.id);
            yield* appendEmployeeHandoffActivity({
              event,
              threadId: thread.id,
              turnId: eventTurnId,
              tone: "error",
              summary: "CEO routing recovery failed",
              detail: "The thread details were unavailable after the blocked routing turn.",
            });
          }
        } else {
          consecutiveEmployeeHandoffs.delete(thread.id);
        }
      }

      if (event.type === "runtime.error") {
        const runtimeErrorMessage = event.payload.message;

        const shouldApplyRuntimeError = !STRICT_PROVIDER_LIFECYCLE_GUARD
          ? true
          : activeTurnId === null || eventTurnId === undefined || sameId(activeTurnId, eventTurnId);

        if (shouldApplyRuntimeError) {
          yield* orchestrationEngine.dispatch({
            type: "thread.session.set",
            commandId: yield* providerCommandId(event, "runtime-error-session-set"),
            threadId: thread.id,
            session: {
              threadId: thread.id,
              status: "error",
              providerName: event.provider,
              ...(event.providerInstanceId !== undefined
                ? { providerInstanceId: event.providerInstanceId }
                : {}),
              runtimeMode: thread.session?.runtimeMode ?? "full-access",
              activeTurnId: eventTurnId ?? null,
              lastError: runtimeErrorMessage,
              updatedAt: now,
            },
            createdAt: now,
          });
        }
      }

      if (event.type === "thread.metadata.updated" && event.payload.name) {
        if (canReplaceThreadTitle(thread.title)) {
          yield* orchestrationEngine.dispatch({
            type: "thread.meta.update",
            commandId: yield* providerCommandId(event, "thread-meta-update"),
            threadId: thread.id,
            title: event.payload.name,
          });
        }
      }

      if (event.type === "turn.diff.updated") {
        const turnId = toTurnId(event.turnId);
        const checkpointContext = turnId
          ? yield* projectionSnapshotQuery
              .getThreadCheckpointContext(thread.id)
              .pipe(Effect.map(Option.getOrUndefined))
          : undefined;
        const workspaceCwd =
          checkpointContext?.worktreePath ?? checkpointContext?.workspaceRoot ?? undefined;
        if (turnId && checkpointContext && workspaceCwd && isGitRepository(workspaceCwd)) {
          // Skip if a checkpoint already exists for this turn. A real
          // (non-placeholder) capture from CheckpointReactor should not
          // be clobbered, and dispatching a duplicate placeholder for the
          // same turnId would produce an unstable checkpointTurnCount.
          if (hasCheckpointForTurn(checkpointContext.checkpoints, turnId)) {
            // Already tracked; no-op.
          } else {
            const assistantMessageId = MessageId.make(
              `assistant:${event.itemId ?? event.turnId ?? event.eventId}`,
            );
            yield* orchestrationEngine.dispatch({
              type: "thread.turn.diff.complete",
              commandId: yield* providerCommandId(event, "thread-turn-diff-complete"),
              threadId: thread.id,
              turnId,
              completedAt: now,
              checkpointRef: CheckpointRef.make(`provider-diff:${event.eventId}`),
              status: "missing",
              files: [],
              assistantMessageId,
              checkpointTurnCount: maxCheckpointTurnCount(checkpointContext.checkpoints) + 1,
              createdAt: now,
            });
          }
        }
      }

      if (event.type === "task.started" || event.type === "task.progress") {
        const description = event.payload.description?.trim();
        if (description) {
          yield* rememberTaskDescription(thread.id, event.payload.taskId, description);
        }
      }
      // Working-indicator plan progress: current step while the turn runs,
      // cleared on settle so a finished plan never lingers as stale UI.
      // Events carrying a turn id that conflicts with the active turn are
      // stale (superseded turn) and must neither overwrite nor clear the
      // active turn's progress; session.exited always clears.
      if (event.type === "session.exited") {
        threadPlanProgress.clearThreadPlanProgress(thread.id);
      } else if (!conflictsWithActiveTurn) {
        if (event.type === "turn.plan.updated") {
          threadPlanProgress.recordPlanProgress(thread.id, event.payload.plan);
        } else if (event.type === "turn.completed" || event.type === "turn.aborted") {
          threadPlanProgress.clearThreadPlanProgress(thread.id);
        }
      }

      // Sidebar background liveness: fed from the same lifecycle stream,
      // read by the shell query at mapping time (no persistence).
      switch (event.type) {
        case "task.started":
        case "task.progress":
        case "task.updated":
        case "task.completed": {
          const payload = event.payload as {
            taskId: string;
            taskType?: string;
            status?: string;
            agentId?: string;
          };
          threadBackgroundLiveness.recordTaskLiveness({
            threadId: thread.id,
            taskId: payload.taskId,
            taskType: payload.taskType,
            status: payload.status,
            agentId: payload.agentId,
            kind:
              event.type === "task.started"
                ? "started"
                : event.type === "task.progress"
                  ? "progress"
                  : event.type === "task.updated"
                    ? "updated"
                    : "completed",
          });
          break;
        }
        case "session.exited":
          threadBackgroundLiveness.clearThreadLiveness(thread.id);
          break;
        default:
          break;
      }

      let taskTitle: string | undefined;
      if (event.type === "task.completed") {
        taskTitle = yield* lookupTaskDescription(thread.id, event.payload.taskId);
        if (!taskTitle) {
          const threadDetail = yield* getLoadedThreadDetail();
          taskTitle = findTaskTitleInActivities(threadDetail?.activities, event.payload.taskId);
        }
      }

      const activities =
        routingOnlyToolBlockedThreads.has(thread.id) && isToolLifecycleEvent(event)
          ? []
          : runtimeEventToActivities(event, taskTitle, thread.modelSelection);
      yield* Effect.forEach(activities, (activity) =>
        providerCommandId(event, "thread-activity-append").pipe(
          Effect.flatMap((commandId) =>
            orchestrationEngine.dispatch({
              type: "thread.activity.append",
              commandId,
              threadId: thread.id,
              activity,
              createdAt: activity.createdAt,
            }),
          ),
        ),
      ).pipe(Effect.asVoid);
    });

  const processDomainEvent = (event: TurnStartRequestedDomainEvent) =>
    Effect.sync(() => {
      // A human-authored turn has no employee sender and starts a fresh
      // conversation burst. Employee handoff turns preserve the running count.
      if (event.payload.employeeId === undefined) {
        consecutiveEmployeeHandoffs.delete(event.payload.threadId);
        routingOnlyToolBlockedThreads.delete(event.payload.threadId);
        pendingCeoRoutingRecoveryTurnByThreadId.delete(event.payload.threadId);
      }
    });

  const processInput = (input: RuntimeIngestionInput) =>
    input.source === "runtime" ? processRuntimeEvent(input.event) : processDomainEvent(input.event);

  const processInputSafely = (input: RuntimeIngestionInput) =>
    processInput(input).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("provider runtime ingestion failed to process event", {
          source: input.source,
          eventId: input.event.eventId,
          eventType: input.event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processInputSafely);

  const start: ProviderRuntimeIngestionShape["start"] = () =>
    Effect.gen(function* () {
      yield* forkParked(
        Stream.runForEach(providerService.streamEvents, (event) =>
          worker.enqueue({ source: "runtime", event }),
        ),
      );
      yield* forkParked(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (event.type !== "thread.turn-start-requested") {
            return Effect.void;
          }
          return worker.enqueue({ source: "domain", event });
        }),
      );
      lastSeenContextManagementMode = yield* serverSettingsService.getSettings.pipe(
        Effect.map((settings) => settings.contextManagementMode),
        Effect.orElseSucceed(() => undefined),
      );
      yield* forkParked(
        Stream.runForEach(serverSettingsService.streamChanges, (settings) =>
          Effect.sync(() => {
            if (lastSeenContextManagementMode !== settings.contextManagementMode) {
              lastSeenContextManagementMode = settings.contextManagementMode;
              // Any transition — including a manual round-trip back to the
              // same automatic mode — drops queued actions. A fresh
              // qualifying usage sample is required to re-arm.
              pendingContextManagementByThreadId.clear();
            }
          }),
        ),
      );
    });

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderRuntimeIngestionShape;
});

export const ProviderRuntimeIngestionLive = Layer.effect(
  ProviderRuntimeIngestionService,
  make,
).pipe(Layer.provide(ProjectionTurnRepositoryLive));
