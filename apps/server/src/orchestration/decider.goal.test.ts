import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const threadId = ThreadId.make("thread-goal");

const seedThread = projectEvent(createEmptyReadModel("2026-08-17T10:00:00.000Z"), {
  sequence: 1,
  eventId: EventId.make("event-thread-goal-created"),
  aggregateKind: "thread",
  aggregateId: threadId,
  type: "thread.created",
  occurredAt: "2026-08-17T10:00:00.000Z",
  commandId: CommandId.make("command-thread-goal-created"),
  causationEventId: null,
  correlationId: CommandId.make("command-thread-goal-created"),
  metadata: {},
  payload: {
    threadId,
    projectId: ProjectId.make("project-goal"),
    title: "Goal thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-luna",
    },
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "full-access",
    branch: null,
    worktreePath: null,
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
  },
});

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

it.layer(NodeServices.layer)("decider thread goals", (it) => {
  it.effect("sets, updates, and clears a thread goal through metadata commands", () =>
    Effect.gen(function* () {
      const initial = yield* seedThread;
      const createdAt = "2026-08-17T10:01:00.000Z";
      const setGoal = {
        objective: "Ship onboarding",
        status: "active" as const,
        createdAt,
        updatedAt: createdAt,
      };
      const setEvent = singleEvent(
        yield* decideOrchestrationCommand({
          readModel: initial,
          command: {
            type: "thread.meta.update",
            commandId: CommandId.make("command-goal-set"),
            threadId,
            goal: setGoal,
          },
        }),
      );
      expect(setEvent).toMatchObject({
        type: "thread.meta-updated",
        payload: { threadId, goal: setGoal },
      });
      const afterSet = yield* projectEvent(initial, {
        ...setEvent,
        sequence: 2,
      } as OrchestrationEvent);

      const pausedGoal = {
        ...setGoal,
        status: "paused" as const,
        updatedAt: "2026-08-17T10:02:00.000Z",
      };
      const updateEvent = singleEvent(
        yield* decideOrchestrationCommand({
          readModel: afterSet,
          command: {
            type: "thread.meta.update",
            commandId: CommandId.make("command-goal-update"),
            threadId,
            goal: pausedGoal,
          },
        }),
      );
      expect(updateEvent).toMatchObject({
        type: "thread.meta-updated",
        payload: { threadId, goal: pausedGoal },
      });
      const afterUpdate = yield* projectEvent(afterSet, {
        ...updateEvent,
        sequence: 3,
      } as OrchestrationEvent);
      expect(afterUpdate.threads[0]?.goal).toEqual(pausedGoal);

      const clearEvent = singleEvent(
        yield* decideOrchestrationCommand({
          readModel: afterUpdate,
          command: {
            type: "thread.meta.update",
            commandId: CommandId.make("command-goal-clear"),
            threadId,
            goal: null,
          },
        }),
      );
      expect(clearEvent).toMatchObject({
        type: "thread.meta-updated",
        payload: { threadId, goal: null },
      });
      const afterClear = yield* projectEvent(afterUpdate, {
        ...clearEvent,
        sequence: 4,
      } as OrchestrationEvent);
      expect(afterClear.threads[0]?.goal).toBeNull();
    }),
  );
});
