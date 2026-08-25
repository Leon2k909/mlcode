import type {
  SharedThreadAgentState,
  SharedThreadMessage,
  SharedThreadParticipant,
  SharedThreadStreamEvent,
  SharedThreadSummary,
} from "@t3tools/contracts";

/**
 * A shared chat as the guest sees it, folded from the event stream.
 *
 * Kept as a pure reducer so the interesting cases — a streaming message being
 * appended to, the host revoking the share mid-read — are testable without a
 * socket or a render.
 */
export interface SharedRoomState {
  readonly thread: SharedThreadSummary | null;
  readonly messages: ReadonlyArray<SharedThreadMessage>;
  readonly agentState: SharedThreadAgentState;
  readonly participants: ReadonlyArray<SharedThreadParticipant>;
  /** Set once the host ends the room; the view stops accepting input. */
  readonly closed: "unshared" | "deleted" | null;
}

export const EMPTY_SHARED_ROOM: SharedRoomState = {
  thread: null,
  messages: [],
  agentState: "idle",
  participants: [],
  closed: null,
};

/**
 * Streaming assistant rows arrive as deltas that append, while a settled row
 * replaces. This mirrors the host's own projection so the two views of the same
 * conversation cannot drift apart mid-turn.
 */
function upsertMessage(
  messages: ReadonlyArray<SharedThreadMessage>,
  next: SharedThreadMessage,
): ReadonlyArray<SharedThreadMessage> {
  const index = messages.findIndex((message) => message.messageId === next.messageId);
  if (index === -1) {
    return [...messages, next];
  }
  const previous = messages[index];
  if (previous === undefined) {
    return [...messages, next];
  }
  const text = next.streaming
    ? `${previous.text}${next.text}`
    : next.text.length > 0
      ? next.text
      : previous.text;
  const merged: SharedThreadMessage = { ...previous, ...next, text };
  return [...messages.slice(0, index), merged, ...messages.slice(index + 1)];
}

export function reduceSharedRoom(
  state: SharedRoomState,
  event: SharedThreadStreamEvent,
): SharedRoomState {
  switch (event.type) {
    case "snapshot":
      return {
        thread: event.payload.thread,
        messages: event.payload.messages,
        agentState: event.payload.agentState,
        participants: event.payload.participants,
        closed: null,
      };
    case "message":
      return { ...state, messages: upsertMessage(state.messages, event.payload) };
    case "messagesRemoved": {
      const removed = new Set(event.payload.messageIds);
      return {
        ...state,
        messages: state.messages.filter((message) => !removed.has(message.messageId)),
      };
    }
    case "agentState":
      return {
        ...state,
        agentState: event.payload.agentState,
        thread:
          state.thread === null ? null : { ...state.thread, agentBusy: event.payload.agentBusy },
      };
    case "participants":
      return { ...state, participants: event.payload.participants };
    case "closed":
      return { ...state, closed: event.payload.reason };
  }
}

/** One line describing what the agent is doing, for the room's status strip. */
export function agentStateLabel(state: SharedThreadAgentState, hostName: string): string | null {
  switch (state) {
    case "running":
      return "Agent is working…";
    case "awaiting-host-approval":
      return `Waiting for ${hostName} to approve something`;
    case "error":
      return "The agent hit an error";
    case "idle":
      return null;
  }
}
