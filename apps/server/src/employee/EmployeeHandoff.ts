/**
 * Employee-to-employee handoff protocol.
 *
 * Lets one employee address another inside a thread, the way a person would
 * @-mention a colleague in Slack. An employee ends a turn with:
 *
 *   <handoff to="reviewer">Draft is ready, please check the auth path.</handoff>
 *
 * The reactor parses that, transfers ownership of the thread to `reviewer`,
 * and starts their turn with the message as input. Ownership passing is the
 * whole coordination model — there is no scheduler and no coordinator role,
 * because a thread already runs one session at a time against one shared
 * workspace. Whoever owns the thread speaks; a handoff moves ownership.
 *
 * Pure parsing with no Effect context, so the protocol is testable on its own.
 *
 * @module employee/EmployeeHandoff
 */
import type { EmployeeId, EmployeeMap } from "@t3tools/contracts";

const HANDOFF_TAG = "handoff";

/**
 * Matches a handoff block and captures the target id and message body.
 * Deliberately tolerant of attribute quoting style and surrounding
 * whitespace — this is model-generated text, not a wire format.
 */
const HANDOFF_PATTERN = new RegExp(
  `<${HANDOFF_TAG}\\s+to\\s*=\\s*["']?([a-zA-Z][a-zA-Z0-9_-]*)["']?\\s*>([\\s\\S]*?)</${HANDOFF_TAG}>`,
  "i",
);

export interface EmployeeHandoff {
  /** The teammate taking over the thread. */
  readonly toEmployeeId: EmployeeId;
  /** What the outgoing employee said to them. Never empty. */
  readonly message: string;
  /** Assistant text with the handoff block removed, for the timeline. */
  readonly remainingText: string;
}

/**
 * Reasons a handoff block does not produce a transfer. Surfaced so the caller
 * can tell "no handoff was attempted" apart from "a handoff was attempted and
 * could not be honored" — the second is worth reporting to the user, because
 * silently dropping it looks like the teammate ignored the request.
 */
export type EmployeeHandoffRejection =
  | { readonly reason: "unknown-employee"; readonly requestedId: string }
  | { readonly reason: "disabled-employee"; readonly requestedId: string }
  | { readonly reason: "not-in-group"; readonly requestedId: string }
  | { readonly reason: "self-handoff"; readonly requestedId: string }
  | { readonly reason: "empty-message"; readonly requestedId: string };

export type EmployeeHandoffResult =
  | { readonly kind: "handoff"; readonly handoff: EmployeeHandoff }
  | { readonly kind: "rejected"; readonly rejection: EmployeeHandoffRejection }
  | { readonly kind: "none" };

/**
 * The built-in employee workflow used when a model completes a group turn
 * without emitting the handoff tag it was asked for. Explicit handoffs remain
 * authoritative; this is only a safety net so a malformed or incomplete
 * response does not strand the user's work in the current employee.
 */
const DEFAULT_EMPLOYEE_WORKFLOW = ["ceo", "worker_beta", "worker_alpha", "worker_gamma"] as const;

/**
 * Pick the next built-in workflow member that is still in the current group.
 * Missing built-ins are skipped, and a custom group falls back to its next
 * configured member so optional employees do not make the chain dead-end.
 */
export const resolveAutomaticEmployeeHandoffTarget = (input: {
  readonly fromEmployeeId: string;
  readonly allowedEmployeeIds: ReadonlyArray<string>;
}): EmployeeId | undefined => {
  const allowed = new Set(input.allowedEmployeeIds);
  const workflowIndex = DEFAULT_EMPLOYEE_WORKFLOW.indexOf(
    input.fromEmployeeId as (typeof DEFAULT_EMPLOYEE_WORKFLOW)[number],
  );
  const workflowCandidates =
    workflowIndex >= 0
      ? workflowIndex === DEFAULT_EMPLOYEE_WORKFLOW.length - 1
        ? [DEFAULT_EMPLOYEE_WORKFLOW[0]]
        : DEFAULT_EMPLOYEE_WORKFLOW.slice(workflowIndex + 1)
      : [];
  const configuredIndex = input.allowedEmployeeIds.indexOf(input.fromEmployeeId);
  const configuredCandidates =
    configuredIndex >= 0
      ? input.allowedEmployeeIds.slice(configuredIndex + 1)
      : input.allowedEmployeeIds;
  const target =
    workflowCandidates.find((employeeId) => allowed.has(employeeId)) ??
    configuredCandidates.find((employeeId) => employeeId !== input.fromEmployeeId);
  return target === undefined ? undefined : (target as EmployeeId);
};

const stripHandoffBlock = (text: string): string =>
  text
    .replace(HANDOFF_PATTERN, "")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Parse a handoff out of one assistant turn.
 *
 * Only the first block is honored. A model that emits several is trying to
 * fan out, which this model does not support — a thread has one owner, and
 * picking the first keeps the outcome predictable instead of arbitrary.
 */
export const parseEmployeeHandoff = (input: {
  readonly text: string;
  readonly employees: EmployeeMap;
  readonly fromEmployeeId: EmployeeId | undefined;
  readonly allowedEmployeeIds?: ReadonlySet<string>;
}): EmployeeHandoffResult => {
  const match = HANDOFF_PATTERN.exec(input.text);
  if (match === null) return { kind: "none" };

  const requestedId = match[1] ?? "";
  const message = (match[2] ?? "").trim();

  if (input.fromEmployeeId !== undefined && requestedId === input.fromEmployeeId) {
    return { kind: "rejected", rejection: { reason: "self-handoff", requestedId } };
  }
  if (!Object.hasOwn(input.employees, requestedId)) {
    return { kind: "rejected", rejection: { reason: "unknown-employee", requestedId } };
  }
  const target = input.employees[requestedId as EmployeeId];
  if (target === undefined || !target.enabled) {
    return { kind: "rejected", rejection: { reason: "disabled-employee", requestedId } };
  }
  if (input.allowedEmployeeIds !== undefined && !input.allowedEmployeeIds.has(requestedId)) {
    return { kind: "rejected", rejection: { reason: "not-in-group", requestedId } };
  }
  // A handoff with nothing said is a dead end: the incoming employee would
  // start a turn with no instruction and no context for why they were called.
  if (message.length === 0) {
    return { kind: "rejected", rejection: { reason: "empty-message", requestedId } };
  }

  return {
    kind: "handoff",
    handoff: {
      toEmployeeId: requestedId as EmployeeId,
      message,
      remainingText: stripHandoffBlock(input.text),
    },
  };
};

/** User-facing explanation for a handoff that could not be honored. */
export const describeHandoffRejection = (rejection: EmployeeHandoffRejection): string => {
  switch (rejection.reason) {
    case "unknown-employee":
      return `Tried to hand off to '${rejection.requestedId}', who is not a configured employee.`;
    case "disabled-employee":
      return `Tried to hand off to '${rejection.requestedId}', who is turned off.`;
    case "not-in-group":
      return `Tried to hand off to '${rejection.requestedId}', who is not in this group chat.`;
    case "self-handoff":
      return `Tried to hand off to themselves ('${rejection.requestedId}').`;
    case "empty-message":
      return `Tried to hand off to '${rejection.requestedId}' without saying anything.`;
  }
};

/**
 * Bound on how many consecutive employee-to-employee turns may run without the
 * user speaking.
 *
 * Two agents will otherwise talk forever, burning the user's subscription on a
 * conversation nobody asked to continue. When the budget runs out the thread
 * returns to the user, which is where a Grok-Bot-style exchange ends anyway.
 */
export const MAX_CONSECUTIVE_HANDOFFS = 8;

/** Whether another handoff may run, given how many have already chained. */
export const canContinueHandoffChain = (consecutiveHandoffs: number): boolean =>
  consecutiveHandoffs < MAX_CONSECUTIVE_HANDOFFS;
