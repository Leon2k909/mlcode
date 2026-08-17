import type { ThreadGoal } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { executeThreadGoalCommand, parseStandaloneThreadGoalCommand } from "./threadGoal.ts";

const activeGoal: ThreadGoal = {
  objective: "Ship onboarding",
  status: "active",
  createdAt: "2026-08-17T10:00:00.000Z",
  updatedAt: "2026-08-17T10:00:00.000Z",
};

describe("thread goal commands", () => {
  it("parses show, lifecycle, and objective commands", () => {
    expect(parseStandaloneThreadGoalCommand(" /goal ")).toEqual({ kind: "show" });
    expect(parseStandaloneThreadGoalCommand("/goal Ship onboarding")).toEqual({
      kind: "set",
      objective: "Ship onboarding",
    });
    expect(parseStandaloneThreadGoalCommand("/goal pause")).toEqual({ kind: "pause" });
    expect(parseStandaloneThreadGoalCommand("/goal resume")).toEqual({ kind: "resume" });
    expect(parseStandaloneThreadGoalCommand("/goal clear")).toEqual({ kind: "clear" });
    expect(parseStandaloneThreadGoalCommand("/goalist")).toBeNull();
  });

  it("reports missing and unsaved thread states without persisting", async () => {
    const persist = vi.fn(async () => null);

    await expect(
      executeThreadGoalCommand({
        command: { kind: "set", objective: "Ship" },
        currentGoal: null,
        hasThread: false,
        canPersist: false,
        now: "2026-08-17T11:00:00.000Z",
        persist,
      }),
    ).resolves.toMatchObject({ title: "No active thread", tone: "warning" });
    await expect(
      executeThreadGoalCommand({
        command: { kind: "set", objective: "Ship" },
        currentGoal: null,
        hasThread: true,
        canPersist: false,
        now: "2026-08-17T11:00:00.000Z",
        persist,
      }),
    ).resolves.toMatchObject({ title: "Save the thread first", tone: "warning" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("shows the current goal and handles missing lifecycle targets", async () => {
    const persist = vi.fn(async () => null);
    const base = {
      hasThread: true,
      canPersist: true,
      now: "2026-08-17T11:00:00.000Z",
      persist,
    } as const;

    await expect(
      executeThreadGoalCommand({ ...base, command: { kind: "show" }, currentGoal: activeGoal }),
    ).resolves.toEqual({
      tone: "info",
      title: "Goal active",
      description: "Ship onboarding",
    });
    await expect(
      executeThreadGoalCommand({ ...base, command: { kind: "show" }, currentGoal: null }),
    ).resolves.toMatchObject({ title: "No active goal" });
    await expect(
      executeThreadGoalCommand({ ...base, command: { kind: "pause" }, currentGoal: null }),
    ).resolves.toMatchObject({ title: "No goal to update", tone: "warning" });
    await expect(
      executeThreadGoalCommand({ ...base, command: { kind: "clear" }, currentGoal: null }),
    ).resolves.toMatchObject({ title: "No goal to clear" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("sets, replaces, pauses, resumes, and clears a goal", async () => {
    const persisted: Array<ThreadGoal | null> = [];
    const persist = vi.fn(async (goal: ThreadGoal | null) => {
      persisted.push(goal);
      return null;
    });
    const base = {
      hasThread: true,
      canPersist: true,
      now: "2026-08-17T11:00:00.000Z",
      persist,
    } as const;

    await expect(
      executeThreadGoalCommand({
        ...base,
        command: { kind: "set", objective: "Create release" },
        currentGoal: null,
      }),
    ).resolves.toMatchObject({ title: "Goal set" });
    await executeThreadGoalCommand({
      ...base,
      command: { kind: "set", objective: "Replace release" },
      currentGoal: activeGoal,
    });
    await executeThreadGoalCommand({
      ...base,
      command: { kind: "pause" },
      currentGoal: activeGoal,
    });
    await executeThreadGoalCommand({
      ...base,
      command: { kind: "resume" },
      currentGoal: { ...activeGoal, status: "paused" },
    });
    await executeThreadGoalCommand({
      ...base,
      command: { kind: "clear" },
      currentGoal: activeGoal,
    });

    expect(persisted).toEqual([
      {
        objective: "Create release",
        status: "active",
        createdAt: base.now,
        updatedAt: base.now,
      },
      {
        objective: "Replace release",
        status: "active",
        createdAt: activeGoal.createdAt,
        updatedAt: base.now,
      },
      { ...activeGoal, status: "paused", updatedAt: base.now },
      { ...activeGoal, status: "active", updatedAt: base.now },
      null,
    ]);
  });

  it("surfaces persistence failures", async () => {
    await expect(
      executeThreadGoalCommand({
        command: { kind: "set", objective: "Ship" },
        currentGoal: null,
        hasThread: true,
        canPersist: true,
        now: "2026-08-17T11:00:00.000Z",
        persist: async () => "Connection lost.",
      }),
    ).resolves.toEqual({
      tone: "error",
      title: "Goal was not updated",
      description: "Connection lost.",
    });
  });
});
