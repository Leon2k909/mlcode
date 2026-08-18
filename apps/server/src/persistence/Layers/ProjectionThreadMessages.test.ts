import { EmployeeId, MessageId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionThreadMessageRepository } from "../Services/ProjectionThreadMessages.ts";
import { ProjectionThreadMessageRepositoryLive } from "./ProjectionThreadMessages.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  ProjectionThreadMessageRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("ProjectionThreadMessageRepository", (it) => {
  it.effect("preserves existing attachments when upsert omits attachments", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-preserve-attachments");
      const messageId = MessageId.make("message-preserve-attachments");
      const createdAt = "2026-02-28T19:00:00.000Z";
      const updatedAt = "2026-02-28T19:00:01.000Z";
      const persistedAttachments = [
        {
          type: "image" as const,
          id: "thread-preserve-attachments-att-1",
          name: "example.png",
          mimeType: "image/png",
          sizeBytes: 5,
        },
      ];

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "initial",
        attachments: persistedAttachments,
        isStreaming: false,
        createdAt,
        updatedAt,
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "user",
        text: "updated",
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:00:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "updated");
      assert.deepEqual(rows[0]?.attachments, persistedAttachments);

      const rowById = yield* repository.getByMessageId({ messageId });
      assert.equal(rowById._tag, "Some");
      if (rowById._tag === "Some") {
        assert.equal(rowById.value.text, "updated");
        assert.deepEqual(rowById.value.attachments, persistedAttachments);
      }
    }),
  );

  it.effect("allows explicit attachment clearing with an empty array", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-clear-attachments");
      const messageId = MessageId.make("message-clear-attachments");
      const createdAt = "2026-02-28T19:10:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "with attachment",
        attachments: [
          {
            type: "image",
            id: "thread-clear-attachments-att-1",
            name: "example.png",
            mimeType: "image/png",
            sizeBytes: 5,
          },
        ],
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:10:01.000Z",
      });

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "cleared",
        attachments: [],
        isStreaming: false,
        createdAt,
        updatedAt: "2026-02-28T19:10:02.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.text, "cleared");
      assert.deepEqual(rows[0]?.attachments, []);
    }),
  );

  it.effect("persists employee routing metadata across streaming upserts", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-employee-message");
      const messageId = MessageId.make("assistant-employee-message");
      const employeeId = EmployeeId.make("reviewer");
      const modelSelection = {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.6-luna",
        options: [{ id: "reasoningEffort", value: "low" }],
        employeeId,
      };
      const createdAt = "2026-08-13T10:00:00.000Z";

      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        employeeId,
        modelSelection,
        text: "Reviewing",
        isStreaming: true,
        createdAt,
        updatedAt: createdAt,
      });
      yield* repository.upsert({
        messageId,
        threadId,
        turnId: null,
        role: "assistant",
        text: "Review complete",
        isStreaming: false,
        createdAt,
        updatedAt: "2026-08-13T10:00:01.000Z",
      });

      const rows = yield* repository.listByThreadId({ threadId });
      assert.equal(rows[0]?.employeeId, employeeId);
      assert.deepEqual(rows[0]?.modelSelection, modelSelection);
      const rowById = yield* repository.getByMessageId({ messageId });
      assert.equal(rowById._tag, "Some");
      if (rowById._tag === "Some") {
        assert.equal(rowById.value.employeeId, employeeId);
        assert.deepEqual(rowById.value.modelSelection, modelSelection);
      }
    }),
  );

  it.effect("lists ordered message headers without hydrating message bodies", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadMessageRepository;
      const threadId = ThreadId.make("thread-message-headers");

      yield* repository.upsert({
        messageId: MessageId.make("message-header-2"),
        threadId,
        turnId: null,
        role: "assistant",
        text: "This body is intentionally excluded from the header query.",
        isStreaming: false,
        createdAt: "2026-08-17T21:00:02.000Z",
        updatedAt: "2026-08-17T21:00:02.000Z",
      });
      yield* repository.upsert({
        messageId: MessageId.make("message-header-1"),
        threadId,
        turnId: null,
        role: "user",
        text: "This body is also intentionally excluded.",
        isStreaming: false,
        createdAt: "2026-08-17T21:00:01.000Z",
        updatedAt: "2026-08-17T21:00:01.000Z",
      });

      const headers = yield* repository.listHeadersByThreadId({ threadId });
      assert.deepEqual(headers, [
        {
          messageId: MessageId.make("message-header-1"),
          threadId,
          role: "user",
          createdAt: "2026-08-17T21:00:01.000Z",
        },
        {
          messageId: MessageId.make("message-header-2"),
          threadId,
          role: "assistant",
          createdAt: "2026-08-17T21:00:02.000Z",
        },
      ]);
    }),
  );
});
