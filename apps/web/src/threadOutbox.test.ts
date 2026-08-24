import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useThreadOutboxStore, type QueuedThreadOutboxMessage } from "./threadOutbox";

function queued(
  environmentId: string,
  threadId: string,
  messageId: string,
): QueuedThreadOutboxMessage {
  return {
    id: MessageId.make(messageId),
    environmentId: EnvironmentId.make(environmentId),
    threadId: ThreadId.make(threadId),
    text: "Follow up",
    createdAt: "2026-08-24T00:00:00.000Z",
    status: "queued",
    payload: {
      messageId: MessageId.make(messageId),
      threadId: ThreadId.make(threadId),
      text: "Follow up",
      createdAt: "2026-08-24T00:00:00.000Z",
      titleSeed: "Follow up",
      attachmentsPromise: Promise.resolve([]),
      optimisticAttachments: [],
      modelSelection: {
        instanceId: "codex" as never,
        model: "gpt-5.6-sol",
      },
      runtimeMode: "full-access",
      interactionMode: "default",
    },
  };
}

beforeEach(() => {
  useThreadOutboxStore.setState({ messages: [] });
});

describe("thread outbox", () => {
  it("retains queued messages after the active chat is replaced", () => {
    const message = queued("environment-a", "thread-a", "message-a");
    useThreadOutboxStore.getState().setMessages((existing) => [...existing, message]);

    // Normal navigation replaces ChatView; the app-level outbox must not.
    expect(useThreadOutboxStore.getState().messages).toEqual([message]);
  });

  it("keeps identical thread ids isolated by environment", () => {
    const first = queued("environment-a", "thread-a", "message-a");
    const second = queued("environment-b", "thread-a", "message-b");
    useThreadOutboxStore.getState().setMessages(() => [first, second]);
    useThreadOutboxStore
      .getState()
      .setMessages((existing) =>
        existing.filter(
          (message) =>
            message.environmentId !== first.environmentId || message.threadId !== first.threadId,
        ),
      );

    expect(useThreadOutboxStore.getState().messages).toEqual([second]);
  });
});
