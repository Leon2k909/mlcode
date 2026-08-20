import { describe, expect, it } from "vite-plus/test";

import { resolveThreadNoProgress, THREAD_NO_PROGRESS_WARNING_MS } from "./threadLiveness.ts";

const nowMs = Date.parse("2026-08-20T12:20:00.000Z");
const base = {
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  latestTurn: {
    turnId: "turn-1" as never,
    state: "running" as const,
    requestedAt: "2026-08-20T12:00:00.000Z",
    startedAt: "2026-08-20T12:00:01.000Z",
    completedAt: null,
    assistantMessageId: null,
    checkpointTurnCount: null,
    checkpointRef: null,
    checkpointStatus: null,
  },
  session: {
    threadId: "thread-1" as never,
    status: "running" as const,
    providerName: "Codex",
    runtimeMode: "full-access" as const,
    activeTurnId: "turn-1" as never,
    lastError: null,
    updatedAt: "2026-08-20T12:00:01.000Z",
  },
  updatedAt: "2026-08-20T12:00:01.000Z",
};

describe("resolveThreadNoProgress", () => {
  it("flags an active turn only after the no-progress threshold", () => {
    const state = resolveThreadNoProgress(base, { nowMs });
    expect(state.possiblyStuck).toBe(true);
    expect(state.idleMs).toBe(19 * 60_000 + 59_000);
  });

  it("treats fresh projected activity as progress regardless of turn age", () => {
    const state = resolveThreadNoProgress(
      { ...base, updatedAt: "2026-08-20T12:19:30.000Z" },
      { nowMs },
    );
    expect(state.possiblyStuck).toBe(false);
    expect(state.idleMs).toBe(30_000);
  });

  it("keeps approval and user-input waits out of stuck detection", () => {
    expect(
      resolveThreadNoProgress({ ...base, hasPendingApprovals: true }, { nowMs }).possiblyStuck,
    ).toBe(false);
    expect(
      resolveThreadNoProgress({ ...base, hasPendingUserInput: true }, { nowMs }).possiblyStuck,
    ).toBe(false);
  });

  it("does not flag settled sessions or malformed clocks", () => {
    expect(
      resolveThreadNoProgress(
        { ...base, session: { ...base.session, status: "ready" as const } },
        { nowMs },
      ).possiblyStuck,
    ).toBe(false);
    expect(
      resolveThreadNoProgress(
        {
          ...base,
          latestTurn: { ...base.latestTurn, requestedAt: "bad", startedAt: null },
          session: { ...base.session, updatedAt: "bad" },
          updatedAt: "bad",
        },
        { nowMs },
      ).possiblyStuck,
    ).toBe(false);
  });

  it("supports a focused threshold override", () => {
    expect(
      resolveThreadNoProgress(
        { ...base, updatedAt: "2026-08-20T12:19:59.001Z" },
        { nowMs, warningAfterMs: 1_000 },
      ).possiblyStuck,
    ).toBe(false);
    expect(
      resolveThreadNoProgress(
        { ...base, updatedAt: "2026-08-20T12:19:59.000Z" },
        { nowMs, warningAfterMs: 1_000 },
      ).possiblyStuck,
    ).toBe(true);
    expect(THREAD_NO_PROGRESS_WARNING_MS).toBe(10 * 60_000);
  });
});
