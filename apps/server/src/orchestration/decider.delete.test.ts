import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asCommandId = (value: string): CommandId => CommandId.make(value);
const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asThreadId = (value: string): ThreadId => ThreadId.make(value);

const seedReadModel = Effect.gen(function* () {
  const now = "2026-01-01T00:00:00.000Z";
  const initial = createEmptyReadModel(now);
  const withProject = yield* projectEvent(initial, {
    sequence: 1,
    eventId: asEventId("evt-project-create"),
    aggregateKind: "project",
    aggregateId: asProjectId("project-delete"),
    type: "project.created",
    occurredAt: now,
    commandId: asCommandId("cmd-project-create"),
    causationEventId: null,
    correlationId: asCommandId("cmd-project-create"),
    metadata: {},
    payload: {
      projectId: asProjectId("project-delete"),
      title: "Project Delete",
      workspaceRoot: "/tmp/project-delete",
      defaultModelSelection: null,
      scripts: [],
      createdAt: now,
      updatedAt: now,
    },
  });

  const withFirstThread = yield* projectEvent(withProject, {
    sequence: 2,
    eventId: asEventId("evt-thread-create-1"),
    aggregateKind: "thread",
    aggregateId: asThreadId("thread-delete-1"),
    type: "thread.created",
    occurredAt: now,
    commandId: asCommandId("cmd-thread-create-1"),
    causationEventId: null,
    correlationId: asCommandId("cmd-thread-create-1"),
    metadata: {},
    payload: {
      threadId: asThreadId("thread-delete-1"),
      projectId: asProjectId("project-delete"),
      title: "Thread Delete 1",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });

  return yield* projectEvent(withFirstThread, {
    sequence: 3,
    eventId: asEventId("evt-thread-create-2"),
    aggregateKind: "thread",
    aggregateId: asThreadId("thread-delete-2"),
    type: "thread.created",
    occurredAt: now,
    commandId: asCommandId("cmd-thread-create-2"),
    causationEventId: null,
    correlationId: asCommandId("cmd-thread-create-2"),
    metadata: {},
    payload: {
      threadId: asThreadId("thread-delete-2"),
      projectId: asProjectId("project-delete"),
      title: "Thread Delete 2",
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5-codex",
      },
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
      runtimeMode: "approval-required",
      branch: null,
      worktreePath: null,
      createdAt: now,
      updatedAt: now,
    },
  });
});

type PlannedEvent = Omit<OrchestrationEvent, "sequence">;

function normalizeDeleteEvent(event: PlannedEvent | ReadonlyArray<PlannedEvent>) {
  const events = Array.isArray(event) ? event : [event];
  return events.map((entry) => {
    switch (entry.type) {
      case "thread.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            threadId: entry.payload.threadId,
          },
        };
      case "project.deleted":
        return {
          type: entry.type,
          aggregateKind: entry.aggregateKind,
          aggregateId: entry.aggregateId,
          commandId: entry.commandId,
          correlationId: entry.correlationId,
          payload: {
            projectId: entry.payload.projectId,
          },
        };
      default:
        return entry;
    }
  });
}

it.layer(NodeServices.layer)("decider deletion flows", (it) => {
  it.effect("rejects deleting a non-empty project without force", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const error = yield* Effect.flip(
        decideOrchestrationCommand({
          command: {
            type: "project.delete",
            commandId: asCommandId("cmd-project-delete-no-force"),
            projectId: asProjectId("project-delete"),
          },
          readModel,
        }),
      );
      expect(error.message).toContain("cannot be deleted without force=true");
    }),
  );

  it.effect("reuses thread.delete semantics when force-deleting a non-empty project", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const projectDeleteCommand: Extract<OrchestrationCommand, { type: "project.delete" }> = {
        type: "project.delete",
        commandId: asCommandId("cmd-project-delete-force"),
        projectId: asProjectId("project-delete"),
        force: true,
      };

      const forcedResult = yield* decideOrchestrationCommand({
        command: projectDeleteCommand,
        readModel,
      });
      const forcedEvents = Array.isArray(forcedResult) ? forcedResult : [forcedResult];

      expect(forcedEvents.map((event) => event.type)).toEqual([
        "thread.deleted",
        "thread.deleted",
        "project.deleted",
      ]);

      let sequentialReadModel = readModel;
      let nextSequence = readModel.snapshotSequence;
      const sequentialEvents: PlannedEvent[] = [];
      for (const nextCommand of [
        {
          type: "thread.delete",
          commandId: projectDeleteCommand.commandId,
          threadId: asThreadId("thread-delete-1"),
        },
        {
          type: "thread.delete",
          commandId: projectDeleteCommand.commandId,
          threadId: asThreadId("thread-delete-2"),
        },
        {
          type: "project.delete",
          commandId: projectDeleteCommand.commandId,
          projectId: asProjectId("project-delete"),
        },
      ] satisfies ReadonlyArray<OrchestrationCommand>) {
        const decided = yield* decideOrchestrationCommand({
          command: nextCommand,
          readModel: sequentialReadModel,
        });
        const nextEvents = Array.isArray(decided) ? decided : [decided];
        sequentialEvents.push(...nextEvents);
        for (const nextEvent of nextEvents) {
          nextSequence += 1;
          sequentialReadModel = yield* projectEvent(sequentialReadModel, {
            ...nextEvent,
            sequence: nextSequence,
          });
        }
      }

      expect(normalizeDeleteEvent(forcedResult)).toEqual(normalizeDeleteEvent(sequentialEvents));
    }),
  );

  it.effect("deletes the latest user message without requiring a checkpoint", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const messageId = MessageId.make("message-delete-latest");
      const withMessage = yield* projectEvent(readModel, {
        sequence: 4,
        eventId: asEventId("evt-message-delete-latest"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-delete-1"),
        occurredAt: "2026-01-01T00:00:01.000Z",
        commandId: asCommandId("cmd-message-delete-latest"),
        causationEventId: null,
        correlationId: asCommandId("cmd-message-delete-latest"),
        metadata: {},
        type: "thread.message-sent",
        payload: {
          threadId: asThreadId("thread-delete-1"),
          messageId,
          role: "user",
          text: "Sent to the wrong chat",
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: "2026-01-01T00:00:01.000Z",
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      });

      const result = yield* decideOrchestrationCommand({
        readModel: withMessage,
        command: {
          type: "thread.message.delete",
          commandId: asCommandId("cmd-delete-message"),
          threadId: asThreadId("thread-delete-1"),
          messageId,
          createdAt: "2026-01-01T00:00:02.000Z",
        },
      });

      expect(result).toMatchObject({
        type: "thread.message-deleted",
        payload: {
          threadId: asThreadId("thread-delete-1"),
          messageId,
          deletedAt: "2026-01-01T00:00:02.000Z",
        },
      });
      const projected = yield* projectEvent(withMessage, {
        sequence: 5,
        eventId: asEventId("evt-message-deleted"),
        aggregateKind: "thread",
        aggregateId: asThreadId("thread-delete-1"),
        occurredAt: "2026-01-01T00:00:02.000Z",
        commandId: asCommandId("cmd-delete-message"),
        causationEventId: null,
        correlationId: asCommandId("cmd-delete-message"),
        metadata: {},
        type: "thread.message-deleted",
        payload: {
          threadId: asThreadId("thread-delete-1"),
          messageId,
          deletedAt: "2026-01-01T00:00:02.000Z",
        },
      });
      expect(projected.threads.find((thread) => thread.id === "thread-delete-1")?.messages).toEqual(
        [],
      );
    }),
  );

  it.effect("prunes a validated batch of older messages while retaining the latest user turn", () =>
    Effect.gen(function* () {
      const readModel = yield* seedReadModel;
      const threadId = asThreadId("thread-delete-1");
      const messageEvents = [
        ["old-user", "user", "Old question", null],
        ["old-assistant", "assistant", "Old answer", null],
        ["latest-user", "user", "Keep this question", null],
      ] as const;
      let withMessages = readModel;
      let sequence = 4;
      for (const [id, role, text, turnId] of messageEvents) {
        const occurredAt = `2026-01-01T00:00:0${sequence - 3}.000Z`;
        withMessages = yield* projectEvent(withMessages, {
          sequence,
          eventId: asEventId(`evt-${id}`),
          aggregateKind: "thread",
          aggregateId: threadId,
          occurredAt,
          commandId: asCommandId(`cmd-${id}`),
          causationEventId: null,
          correlationId: asCommandId(`cmd-${id}`),
          metadata: {},
          type: "thread.message-sent",
          payload: {
            threadId,
            messageId: MessageId.make(id),
            role,
            text,
            attachments: [],
            turnId: turnId === null ? null : turnId,
            streaming: false,
            createdAt: occurredAt,
            updatedAt: occurredAt,
          },
        });
        sequence += 1;
      }

      const result = yield* decideOrchestrationCommand({
        readModel: withMessages,
        command: {
          type: "thread.message.delete",
          commandId: asCommandId("cmd-prune-old-messages"),
          threadId,
          messageId: MessageId.make("old-user"),
          messageIds: [MessageId.make("old-user"), MessageId.make("old-assistant")],
          createdAt: "2026-01-01T00:00:10.000Z",
        },
      });
      const events = Array.isArray(result) ? result : [result];
      expect(events).toHaveLength(2);
      expect(events.map((event) => event.payload.messageId)).toEqual([
        MessageId.make("old-user"),
        MessageId.make("old-assistant"),
      ]);

      let projected = withMessages;
      for (const event of events) {
        sequence += 1;
        projected = yield* projectEvent(projected, { ...event, sequence });
      }
      expect(
        projected.threads
          .find((thread) => thread.id === threadId)
          ?.messages.map((message) => message.id),
      ).toEqual([MessageId.make("latest-user")]);
    }),
  );
});
