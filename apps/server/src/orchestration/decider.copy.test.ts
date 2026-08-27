import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EmployeeId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const sourceThreadId = ThreadId.make("thread-copy-source");
const copyThreadId = ThreadId.make("thread-copy-target");
const projectId = ProjectId.make("project-copy");
const createdAt = "2026-08-27T10:00:00.000Z";

const sourceModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
  options: [{ id: "effort", value: "high" }],
  employeeId: EmployeeId.make("ceo"),
  employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("worker_alpha")],
};

const sourceGoal = {
  objective: "Ship the copy action",
  status: "active" as const,
  createdAt,
  updatedAt: createdAt,
};

const seedSourceThread = projectEvent(createEmptyReadModel(createdAt), {
  sequence: 1,
  eventId: EventId.make("event-copy-source-created"),
  aggregateKind: "thread",
  aggregateId: sourceThreadId,
  type: "thread.created",
  occurredAt: createdAt,
  commandId: CommandId.make("command-copy-source-created"),
  causationEventId: null,
  correlationId: CommandId.make("command-copy-source-created"),
  metadata: {},
  payload: {
    threadId: sourceThreadId,
    projectId,
    title: "Source thread",
    modelSelection: sourceModelSelection,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "approval-required",
    branch: "feat/copy",
    worktreePath: "/tmp/worktrees/feat-copy",
    goal: sourceGoal,
    createdAt,
    updatedAt: createdAt,
  },
});

function appendMessage(
  readModel: OrchestrationReadModel,
  input: {
    readonly sequence: number;
    readonly messageId: string;
    readonly role: "user" | "assistant";
    readonly text: string;
  },
) {
  return projectEvent(readModel, {
    sequence: input.sequence,
    eventId: EventId.make(`event-${input.messageId}`),
    aggregateKind: "thread",
    aggregateId: sourceThreadId,
    type: "thread.message-sent",
    occurredAt: createdAt,
    commandId: CommandId.make(`command-${input.messageId}`),
    causationEventId: null,
    correlationId: CommandId.make(`command-${input.messageId}`),
    metadata: {},
    payload: {
      threadId: sourceThreadId,
      messageId: MessageId.make(input.messageId),
      role: input.role,
      text: input.text,
      turnId: null,
      streaming: false,
      createdAt,
      updatedAt: createdAt,
    },
  } as OrchestrationEvent);
}

function singleEvent(
  result:
    | Omit<OrchestrationEvent, "sequence">
    | ReadonlyArray<Omit<OrchestrationEvent, "sequence">>,
): Omit<OrchestrationEvent, "sequence"> {
  if (Array.isArray(result)) {
    const event = result[0];
    if (!event) throw new Error("Expected one orchestration event.");
    return event;
  }
  return result as Omit<OrchestrationEvent, "sequence">;
}

const copyCommand = {
  type: "thread.copy" as const,
  commandId: CommandId.make("command-thread-copy"),
  sourceThreadId,
  threadId: copyThreadId,
  title: "Copy of Source thread",
  createdAt: "2026-08-27T10:05:00.000Z",
};

it.layer(NodeServices.layer)("decider thread copy", (it) => {
  it.effect("carries the source thread's working setup onto the copy", () =>
    Effect.gen(function* () {
      let readModel = yield* seedSourceThread;
      readModel = yield* appendMessage(readModel, {
        sequence: 2,
        messageId: "message-copy-user",
        role: "user",
        text: "Add a copy thread button",
      });
      readModel = yield* appendMessage(readModel, {
        sequence: 3,
        messageId: "message-copy-assistant",
        role: "assistant",
        text: "Wired it into the sidebar menu",
      });

      const event = singleEvent(
        yield* decideOrchestrationCommand({ readModel, command: copyCommand }),
      );

      expect(event).toMatchObject({
        type: "thread.created",
        aggregateId: copyThreadId,
        payload: {
          threadId: copyThreadId,
          projectId,
          title: "Copy of Source thread",
          // One field carries the model, the reasoning effort, and the
          // employees, so the copy opens configured exactly like its source.
          modelSelection: sourceModelSelection,
          runtimeMode: "approval-required",
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          // Same checkout as the source: a new worktree would strip the
          // user's uncommitted work from the copy.
          branch: "feat/copy",
          worktreePath: "/tmp/worktrees/feat-copy",
          goal: sourceGoal,
          createdAt: copyCommand.createdAt,
        },
      });
    }),
  );

  it.effect("seeds the copy with the source conversation as reference context", () =>
    Effect.gen(function* () {
      let readModel = yield* seedSourceThread;
      readModel = yield* appendMessage(readModel, {
        sequence: 2,
        messageId: "message-copy-user",
        role: "user",
        text: "Add a copy thread button",
      });
      readModel = yield* appendMessage(readModel, {
        sequence: 3,
        messageId: "message-copy-assistant",
        role: "assistant",
        text: "Wired it into the sidebar menu",
      });

      const event = singleEvent(
        yield* decideOrchestrationCommand({ readModel, command: copyCommand }),
      );
      const payload = event.payload as { readonly continuation: { readonly context: string } };

      expect(event).toMatchObject({
        payload: {
          continuation: {
            sourceThreadId,
            sourceThreadTitle: "Source thread",
            createdAt: copyCommand.createdAt,
          },
        },
      });
      expect(payload.continuation.context).toContain("Add a copy thread button");
      expect(payload.continuation.context).toContain("Wired it into the sidebar menu");
    }),
  );

  it.effect("copies no messages and no checkpoints onto the new thread", () =>
    Effect.gen(function* () {
      let readModel = yield* seedSourceThread;
      readModel = yield* appendMessage(readModel, {
        sequence: 2,
        messageId: "message-copy-user",
        role: "user",
        text: "Add a copy thread button",
      });

      const event = singleEvent(
        yield* decideOrchestrationCommand({ readModel, command: copyCommand }),
      );
      const projected = yield* projectEvent(readModel, {
        ...event,
        sequence: 3,
      } as OrchestrationEvent);
      const copy = projected.threads.find((thread) => thread.id === copyThreadId);
      const source = projected.threads.find((thread) => thread.id === sourceThreadId);

      expect(copy?.messages).toEqual([]);
      expect(copy?.checkpoints).toEqual([]);
      expect(copy?.session).toBeNull();
      // The source is untouched — copying is not a move.
      expect(source?.messages).toHaveLength(1);
      expect(source?.title).toBe("Source thread");
    }),
  );

  it.effect("still creates the copy when the source has no eligible messages", () =>
    Effect.gen(function* () {
      const readModel = yield* seedSourceThread;

      const event = singleEvent(
        yield* decideOrchestrationCommand({ readModel, command: copyCommand }),
      );

      expect(event).toMatchObject({
        type: "thread.created",
        payload: { threadId: copyThreadId, continuation: null },
      });
    }),
  );

  it.effect("rejects a copy of a thread that does not exist", () =>
    Effect.gen(function* () {
      const readModel = yield* seedSourceThread;
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel,
          command: { ...copyCommand, sourceThreadId: ThreadId.make("thread-missing") },
        }),
      );

      expect(error.message).toContain("does not exist");
    }),
  );

  it.effect("rejects a copy onto a thread id that is already taken", () =>
    Effect.gen(function* () {
      const readModel = yield* seedSourceThread;
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel,
          command: { ...copyCommand, threadId: sourceThreadId },
        }),
      );

      expect(error.message).toContain("cannot be created twice");
    }),
  );
});
