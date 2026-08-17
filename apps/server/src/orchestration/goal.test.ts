import { describe, expect, it } from "vite-plus/test";

import { applyPersistentThreadGoal } from "./goal.ts";

const activeGoal = {
  objective: "Ship the onboarding flow",
  status: "active" as const,
  createdAt: "2026-08-17T12:00:00.000Z",
  updatedAt: "2026-08-17T12:00:00.000Z",
};

describe("applyPersistentThreadGoal", () => {
  it("prepends an active goal to provider input", () => {
    expect(applyPersistentThreadGoal("Implement the first step", activeGoal)).toContain(
      "Objective: Ship the onboarding flow",
    );
    expect(applyPersistentThreadGoal("Implement the first step", activeGoal)).toContain(
      "Implement the first step",
    );
  });

  it("does not inject paused or missing goals", () => {
    expect(
      applyPersistentThreadGoal("Keep the current prompt", { ...activeGoal, status: "paused" }),
    ).toBe("Keep the current prompt");
    expect(applyPersistentThreadGoal("Keep the current prompt", null)).toBe(
      "Keep the current prompt",
    );
  });
});
