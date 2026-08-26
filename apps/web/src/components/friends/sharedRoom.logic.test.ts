import { EnvironmentId, FriendId, MessageId, ThreadId } from "@t3tools/contracts";
import type {
  SharedThreadMessage,
  SharedThreadStreamEvent,
  SharedThreadSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { agentStateLabel, EMPTY_SHARED_ROOM, reduceSharedRoom } from "./sharedRoom.logic";

const thread: SharedThreadSummary = {
  threadId: ThreadId.make("thread-1"),
  title: "Fix the login bug",
  projectTitle: "acme-web",
  host: {
    environmentId: EnvironmentId.make("env-alice"),
    displayName: "Alice",
    avatarColor: "blue",
  },
  canPrompt: true,
  agentBusy: false,
  lastActivityAt: "2026-08-25T10:00:00.000Z",
};

const message = (overrides: Partial<SharedThreadMessage>): SharedThreadMessage => ({
  messageId: MessageId.make("m1"),
  role: "assistant",
  text: "Hello",
  author: null,
  speaker: null,
  turnId: null,
  streaming: false,
  createdAt: "2026-08-25T10:00:00.000Z",
  updatedAt: "2026-08-25T10:00:00.000Z",
  ...overrides,
});

const snapshot: SharedThreadStreamEvent = {
  version: 1,
  type: "snapshot",
  payload: { thread, messages: [], agentState: "idle", participants: [] },
};

describe("shared room reducer", () => {
  it("replaces everything on a snapshot", () => {
    const state = reduceSharedRoom(EMPTY_SHARED_ROOM, snapshot);
    expect(state.thread).toEqual(thread);
    expect(state.closed).toBeNull();
  });

  it("appends streaming assistant deltas instead of replacing them", () => {
    let state = reduceSharedRoom(EMPTY_SHARED_ROOM, snapshot);
    state = reduceSharedRoom(state, {
      version: 1,
      type: "message",
      payload: message({ text: "Look", streaming: true }),
    });
    state = reduceSharedRoom(state, {
      version: 1,
      type: "message",
      payload: message({ text: "ing at it", streaming: true }),
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.text).toBe("Looking at it");
  });

  it("replaces the text when the settled row arrives", () => {
    let state = reduceSharedRoom(EMPTY_SHARED_ROOM, snapshot);
    state = reduceSharedRoom(state, {
      version: 1,
      type: "message",
      payload: message({ text: "partial", streaming: true }),
    });
    state = reduceSharedRoom(state, {
      version: 1,
      type: "message",
      payload: message({ text: "the whole answer", streaming: false }),
    });
    expect(state.messages[0]?.text).toBe("the whole answer");
    expect(state.messages[0]?.streaming).toBe(false);
  });

  it("keeps the existing text when a settled row carries none", () => {
    // Completion events can arrive with an empty body once the deltas already
    // carried the content; treating that as a replacement would blank the row.
    let state = reduceSharedRoom(EMPTY_SHARED_ROOM, snapshot);
    state = reduceSharedRoom(state, {
      version: 1,
      type: "message",
      payload: message({ text: "already streamed", streaming: true }),
    });
    state = reduceSharedRoom(state, {
      version: 1,
      type: "message",
      payload: message({ text: "", streaming: false }),
    });
    expect(state.messages[0]?.text).toBe("already streamed");
  });

  it("attributes friend messages and leaves host messages unattributed", () => {
    let state = reduceSharedRoom(EMPTY_SHARED_ROOM, snapshot);
    state = reduceSharedRoom(state, {
      version: 1,
      type: "message",
      payload: message({
        messageId: MessageId.make("m2"),
        role: "user",
        text: "try the other branch",
        author: { friendId: FriendId.make("f1"), displayName: "Bob", avatarColor: "green" },
      }),
    });
    state = reduceSharedRoom(state, {
      version: 1,
      type: "message",
      payload: message({ messageId: MessageId.make("m3"), role: "user", text: "on it" }),
    });
    expect(state.messages[0]?.author?.displayName).toBe("Bob");
    expect(state.messages[1]?.author).toBeNull();
  });

  it("drops removed messages", () => {
    let state = reduceSharedRoom(EMPTY_SHARED_ROOM, snapshot);
    state = reduceSharedRoom(state, { version: 1, type: "message", payload: message({}) });
    state = reduceSharedRoom(state, {
      version: 1,
      type: "messagesRemoved",
      payload: { messageIds: [MessageId.make("m1")] },
    });
    expect(state.messages).toHaveLength(0);
  });

  it("tracks the agent indicator on both the state and the summary", () => {
    let state = reduceSharedRoom(EMPTY_SHARED_ROOM, snapshot);
    state = reduceSharedRoom(state, {
      version: 1,
      type: "agentState",
      payload: { agentState: "running", agentBusy: true },
    });
    expect(state.agentState).toBe("running");
    expect(state.thread?.agentBusy).toBe(true);
  });

  it("records why the room ended", () => {
    let state = reduceSharedRoom(EMPTY_SHARED_ROOM, snapshot);
    state = reduceSharedRoom(state, {
      version: 1,
      type: "closed",
      payload: { reason: "unshared" },
    });
    expect(state.closed).toBe("unshared");
  });
});

describe("agent state label", () => {
  it("says nothing while idle", () => {
    expect(agentStateLabel("idle", "Alice")).toBeNull();
  });

  it("names the host as the one being asked to approve", () => {
    expect(agentStateLabel("awaiting-host-approval", "Alice")).toBe(
      "Waiting for Alice to approve something",
    );
  });
});
