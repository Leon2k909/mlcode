import { describe, expect, it } from "vite-plus/test";
import {
  EmployeeId,
  ProviderInstanceId,
  type EmployeeMap,
  type ServerConfig,
} from "@t3tools/contracts";

import {
  deriveEmployeeHandoffDisplay,
  employeeSelectionLabel,
  resolveEmployeeModelSelection,
} from "./employees";

const ceoId = EmployeeId.make("ceo");
const reviewerId = EmployeeId.make("reviewer");
const autoId = EmployeeId.make("auto_worker");
const employees = {
  [ceoId]: {
    displayName: "Casey",
    providerInstanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5-codex",
    instructions: "Own the implementation.",
    enabled: true,
  },
  [reviewerId]: {
    displayName: "Riley",
    providerInstanceId: ProviderInstanceId.make("claudeAgent"),
    model: "claude-opus-4-6",
    instructions: "Review carefully.",
    enabled: true,
  },
  [autoId]: {
    displayName: "Auto Worker",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelMode: "auto",
    model: "gpt-5.6-luna",
    modelOptions: [{ id: "reasoningEffort", value: "high" }],
    instructions: "Follow the active CEO selection.",
    enabled: true,
  },
} as EmployeeMap;
const config = {
  settings: { employees },
  providers: [
    {
      instanceId: "codex",
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: [{ slug: "gpt-5-codex", isDefault: true }],
    },
    {
      instanceId: "claudeAgent",
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: [{ slug: "claude-opus-4-6", isDefault: true }],
    },
  ],
} as unknown as ServerConfig;

describe("mobile employees", () => {
  it("routes a selected employee to their assigned provider and group", () => {
    expect(
      resolveEmployeeModelSelection({
        config,
        currentSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        employeeId: reviewerId,
        employeeIds: [ceoId, reviewerId],
      }),
    ).toEqual({
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-opus-4-6",
      employeeId: reviewerId,
      employeeIds: [ceoId, reviewerId],
    });
  });

  it("removes employee routing without changing the model", () => {
    expect(
      resolveEmployeeModelSelection({
        config,
        currentSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
          employeeId: ceoId,
          employeeIds: [ceoId, reviewerId],
        },
        employeeId: undefined,
        employeeIds: undefined,
      }),
    ).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    });
  });

  it("lets an auto employee inherit the active model and options", () => {
    expect(
      resolveEmployeeModelSelection({
        config,
        currentSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6-sol",
          options: [{ id: "reasoningEffort", value: "low" }],
        },
        employeeId: autoId,
        employeeIds: [ceoId, autoId],
      }),
    ).toEqual({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
      options: [{ id: "reasoningEffort", value: "low" }],
      employeeId: autoId,
      employeeIds: [ceoId, autoId],
    });
  });

  it("hides the model protocol but retains its handoff target", () => {
    expect(
      deriveEmployeeHandoffDisplay('Done.\n\n<handoff to="reviewer">Please check this.</handoff>'),
    ).toEqual({ visibleText: "Done.", toEmployeeId: reviewerId });
  });

  it("summarizes the active employee and their group", () => {
    expect(
      employeeSelectionLabel(employees, {
        employeeId: ceoId,
        employeeIds: [ceoId, reviewerId],
      }),
    ).toBe("Casey +1");
  });
});
