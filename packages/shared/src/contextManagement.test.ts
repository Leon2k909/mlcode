import { MessageId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildContextContinuation,
  CONTEXT_AUTO_MANAGE_MIN_USED_PERCENTAGE,
  CONTEXT_PRUNE_MIN_USED_PERCENTAGE,
  selectOldestMessageIdsForContextPruning,
} from "./contextManagement.ts";

describe("context management", () => {
  it("keeps system messages and the latest four user turns", () => {
    const messages = [
      { id: MessageId.make("system"), role: "system" as const },
      { id: MessageId.make("user-1"), role: "user" as const },
      { id: MessageId.make("assistant-1"), role: "assistant" as const },
      { id: MessageId.make("user-2"), role: "user" as const },
      { id: MessageId.make("assistant-2"), role: "assistant" as const },
      { id: MessageId.make("user-3"), role: "user" as const },
      { id: MessageId.make("user-4"), role: "user" as const },
      { id: MessageId.make("user-5"), role: "user" as const },
    ];

    expect(selectOldestMessageIdsForContextPruning(messages)).toEqual([
      MessageId.make("user-1"),
      MessageId.make("assistant-1"),
    ]);
    expect(CONTEXT_PRUNE_MIN_USED_PERCENTAGE).toBe(50);
    expect(CONTEXT_AUTO_MANAGE_MIN_USED_PERCENTAGE).toBe(75);
  });

  it("builds a bounded continuation from recent non-system messages", () => {
    const context = buildContextContinuation({
      sourceThreadId: ThreadId.make("source-thread"),
      sourceThreadTitle: "Long task",
      maxChars: 45,
      messages: [
        {
          id: MessageId.make("system"),
          role: "system",
          text: "secret system prompt",
        },
        { id: MessageId.make("user"), role: "user", text: "old user context" },
        { id: MessageId.make("assistant"), role: "assistant", text: "recent answer" },
      ],
    });

    expect(context).toContain('Automatic continuation from thread "Long task"');
    expect(context).toContain("ASSISTANT:\nrecent answer");
    expect(context).not.toContain("secret system prompt");
  });
});
