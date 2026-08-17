import type { ProviderDriverKind, ThreadId } from "@t3tools/contracts";

export function isCodexRealtimeVoiceAvailable(
  provider: ProviderDriverKind | null,
  threadId: ThreadId | null,
): boolean {
  return provider === "codex" && threadId !== null;
}

export function codexRealtimeVoiceUnavailableReason(
  provider: ProviderDriverKind | null,
  threadId: ThreadId | null,
): string | null {
  if (threadId === null) return "Start a thread before using voice.";
  if (provider !== "codex") return "Experimental voice is available for Codex only.";
  return null;
}
