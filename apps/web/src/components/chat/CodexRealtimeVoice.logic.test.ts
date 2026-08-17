import { ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  codexRealtimeVoiceUnavailableReason,
  isCodexRealtimeVoiceAvailable,
} from "./CodexRealtimeVoice.logic";

describe("Codex realtime voice availability", () => {
  const threadId = ThreadId.make("thread-1");

  it("requires Codex and an active thread", () => {
    expect(isCodexRealtimeVoiceAvailable(ProviderDriverKind.make("codex"), threadId)).toBe(true);
    expect(isCodexRealtimeVoiceAvailable(ProviderDriverKind.make("claude"), threadId)).toBe(false);
    expect(isCodexRealtimeVoiceAvailable(ProviderDriverKind.make("codex"), null)).toBe(false);
  });

  it("explains unsupported provider and missing-thread states", () => {
    expect(
      codexRealtimeVoiceUnavailableReason(ProviderDriverKind.make("claude"), threadId),
    ).toContain("Codex only");
    expect(codexRealtimeVoiceUnavailableReason(ProviderDriverKind.make("codex"), null)).toContain(
      "Start a thread",
    );
    expect(
      codexRealtimeVoiceUnavailableReason(ProviderDriverKind.make("codex"), threadId),
    ).toBeNull();
  });
});
