import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  DEFAULT_EMPLOYEES,
  EMPLOYEE_INSTRUCTIONS_MAX_CHARS,
  Employee,
  EmployeeId,
  EmployeeMap,
  employeeUsesModelOverride,
  isEmployeeId,
  resolveEmployee,
} from "./employee.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { DEFAULT_SERVER_SETTINGS, ServerSettings } from "./settings.ts";

const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeEmployeeId = Schema.decodeUnknownSync(EmployeeId);
const decodeEmployee = Schema.decodeUnknownSync(Employee);
const decodeEmployeeMap = Schema.decodeUnknownSync(EmployeeMap);

describe("EmployeeId", () => {
  it.each(["ada", "ada_frontend", "ada-frontend", "designerBot", "x", "abc123"])(
    "accepts %s",
    (id) => {
      expect(decodeEmployeeId(id)).toBe(id);
    },
  );

  it.each([
    ["empty string", ""],
    ["leading digit", "1ada"],
    ["leading dash", "-ada"],
    ["leading underscore", "_ada"],
    ["whitespace inside", "ada frontend"],
    ["dot inside", "ada.frontend"],
    ["slash inside", "ada/frontend"],
  ])("rejects %s", (_label, value) => {
    expect(() => decodeEmployeeId(value)).toThrow();
  });

  it("trims surrounding whitespace before validating", () => {
    expect(decodeEmployeeId("  ada  ")).toBe("ada");
  });

  it("rejects slugs beyond the length cap", () => {
    expect(() => decodeEmployeeId(`a${"b".repeat(64)}`)).toThrow();
  });

  it("narrows via isEmployeeId", () => {
    expect(isEmployeeId("ada")).toBe(true);
    expect(isEmployeeId("1ada")).toBe(false);
    expect(isEmployeeId(42)).toBe(false);
  });
});

describe("Employee", () => {
  it("defaults instructions to empty, fast mode to unset, and enabled to true", () => {
    const employee = decodeEmployee({
      displayName: "Ada",
      providerInstanceId: "claudeAgent",
    });
    expect(employee.instructions).toBe("");
    expect(employee.fastMode).toBeUndefined();
    expect(employee.enabled).toBe(true);
    expect(employee.role).toBeUndefined();
  });

  it("keeps the full persona when one is supplied", () => {
    const employee = decodeEmployee({
      displayName: "Ada",
      providerInstanceId: "claudeAgent",
      role: "Frontend engineer",
      instructions: "Prefer small diffs.",
      avatar: "🎨",
      accentColor: "#ff8800",
      model: "claude-opus-5",
      modelMode: "override",
      modelOptions: [{ id: "effort", value: "max" }],
      fastMode: true,
      enabled: false,
    });
    expect(employee.role).toBe("Frontend engineer");
    expect(employee.instructions).toBe("Prefer small diffs.");
    expect(employee.avatar).toBe("🎨");
    expect(employee.model).toBe("claude-opus-5");
    expect(employee.modelMode).toBe("override");
    expect(employee.modelOptions).toEqual([{ id: "effort", value: "max" }]);
    expect(employee.fastMode).toBe(true);
    expect(employee.enabled).toBe(false);
  });

  it("distinguishes explicit auto mode from legacy model overrides", () => {
    expect(
      employeeUsesModelOverride(
        decodeEmployee({
          displayName: "Auto Ada",
          providerInstanceId: "codex",
          modelMode: "auto",
          model: "gpt-5.6-luna",
          modelOptions: [{ id: "reasoningEffort", value: "high" }],
        }),
      ),
    ).toBe(false);
    expect(
      employeeUsesModelOverride(
        decodeEmployee({
          displayName: "Legacy Ada",
          providerInstanceId: "codex",
          model: "gpt-5.6-luna",
        }),
      ),
    ).toBe(true);
    expect(
      employeeUsesModelOverride(
        decodeEmployee({ displayName: "Follow Ada", providerInstanceId: "codex" }),
      ),
    ).toBe(false);
  });

  it("requires a display name", () => {
    expect(() => decodeEmployee({ providerInstanceId: "claudeAgent" })).toThrow();
    expect(() =>
      decodeEmployee({ displayName: "   ", providerInstanceId: "claudeAgent" }),
    ).toThrow();
  });

  it("caps instructions so a persona cannot crowd out the turn", () => {
    const atCap = "x".repeat(EMPLOYEE_INSTRUCTIONS_MAX_CHARS);
    expect(
      decodeEmployee({
        displayName: "Ada",
        providerInstanceId: "claudeAgent",
        instructions: atCap,
      }).instructions,
    ).toHaveLength(EMPLOYEE_INSTRUCTIONS_MAX_CHARS);
    expect(() =>
      decodeEmployee({
        displayName: "Ada",
        providerInstanceId: "claudeAgent",
        instructions: "x".repeat(EMPLOYEE_INSTRUCTIONS_MAX_CHARS + 1),
      }),
    ).toThrow();
  });

  // The forward/backward compatibility invariant: an employee may name a
  // provider instance this build has never heard of (fork, deleted instance,
  // rolled-back branch). Settings must still parse.
  it("accepts a provider instance this build does not configure", () => {
    const employee = decodeEmployee({
      displayName: "Ada",
      providerInstanceId: "someForkDriver_personal",
    });
    expect(employee.providerInstanceId).toBe("someForkDriver_personal");
  });

  it("still rejects a malformed provider instance slug", () => {
    expect(() => decodeEmployee({ displayName: "Ada", providerInstanceId: "1nope" })).toThrow();
  });
});

describe("EmployeeMap", () => {
  it("decodes a keyed map", () => {
    const map = decodeEmployeeMap({
      ada: { displayName: "Ada", providerInstanceId: "claudeAgent" },
      grace: { displayName: "Grace", providerInstanceId: "codex", role: "Reviewer" },
    });
    expect(Object.keys(map)).toEqual(["ada", "grace"]);
    expect(map[EmployeeId.make("grace")]?.role).toBe("Reviewer");
  });

  it("rejects a malformed key", () => {
    expect(() =>
      decodeEmployeeMap({ "1ada": { displayName: "Ada", providerInstanceId: "codex" } }),
    ).toThrow();
  });
});

describe("resolveEmployee", () => {
  const employees = decodeEmployeeMap({
    ada: { displayName: "Ada", providerInstanceId: "claudeAgent" },
    retired: { displayName: "Retired", providerInstanceId: "codex", enabled: false },
  });

  it("resolves a configured, enabled employee", () => {
    expect(resolveEmployee(employees, EmployeeId.make("ada"))?.displayName).toBe("Ada");
  });

  it("returns undefined when no employee is selected", () => {
    expect(resolveEmployee(employees, undefined)).toBeUndefined();
  });

  // A turn must never fail because a persona went missing.
  it("returns undefined for an employee this build cannot find", () => {
    expect(resolveEmployee(employees, EmployeeId.make("ghost"))).toBeUndefined();
  });

  it("treats a disabled employee the same as a missing one", () => {
    expect(resolveEmployee(employees, EmployeeId.make("retired"))).toBeUndefined();
  });

  it("does not resolve inherited object keys", () => {
    expect(resolveEmployee(employees, "constructor" as never)).toBeUndefined();
    expect(resolveEmployee(employees, "toString" as never)).toBeUndefined();
  });
});

describe("Employee bound to a provider instance", () => {
  it("lets several employees share one provider instance", () => {
    const map = decodeEmployeeMap({
      ada: { displayName: "Ada", providerInstanceId: "claudeAgent" },
      grace: { displayName: "Grace", providerInstanceId: "claudeAgent" },
    });
    const instance = ProviderInstanceId.make("claudeAgent");
    expect(map[EmployeeId.make("ada")]?.providerInstanceId).toBe(instance);
    expect(map[EmployeeId.make("grace")]?.providerInstanceId).toBe(instance);
  });
});

describe("DEFAULT_EMPLOYEES", () => {
  it("ships a lead plus workers, all enabled and on one instance", () => {
    const ids = Object.keys(DEFAULT_EMPLOYEES);
    expect(ids).toContain("ceo");
    expect(ids.filter((id) => id.startsWith("worker_")).length).toBeGreaterThanOrEqual(3);
    for (const employee of Object.values(DEFAULT_EMPLOYEES)) {
      expect(employee.enabled).toBe(true);
      expect(employee.providerInstanceId).toBe(ProviderInstanceId.make("codex"));
      expect(employee.instructions.length).toBeLessThanOrEqual(EMPLOYEE_INSTRUCTIONS_MAX_CHARS);
    }
  });

  it("defaults workers to CEO-controlled model routing", () => {
    expect(DEFAULT_EMPLOYEES[EmployeeId.make("ceo")]).toMatchObject({
      modelMode: "override",
      model: "gpt-5.6-sol",
      modelOptions: [{ id: "reasoningEffort", value: "ultra" }],
    });
    for (const id of ["worker_alpha", "worker_beta", "worker_gamma"]) {
      expect(DEFAULT_EMPLOYEES[EmployeeId.make(id)]?.modelMode).toBe("auto");
      expect(DEFAULT_EMPLOYEES[EmployeeId.make(id)]?.model).toBeUndefined();
    }
  });

  it("makes the CEO the explicit routing decision-maker", () => {
    const instructions = DEFAULT_EMPLOYEES[EmployeeId.make("ceo")]?.instructions ?? "";
    expect(instructions).toContain("choose the most efficient teammate");
    expect(instructions).toContain("Beta researches");
    expect(instructions).toContain("Beta researches, Alpha implements, Gamma verifies");
    expect(instructions).toContain("do not treat Alpha's completion summary as final");
    expect(instructions).toContain("routing-only");
    expect(instructions).toContain("do not inspect files");
    expect(instructions).toContain("your first response is a delegation gate");
    expect(instructions).toContain("output only one tag");
    expect(instructions).toContain('handoff to="worker_beta"');
    expect(instructions).toContain("that is not a handoff");
    expect(instructions).toContain("Never hand off to yourself");
  });

  it("gives each worker an explicit next-lane handoff", () => {
    expect(DEFAULT_EMPLOYEES[EmployeeId.make("worker_beta")]?.instructions).toContain(
      'handoff to="worker_alpha"',
    );
    expect(DEFAULT_EMPLOYEES[EmployeeId.make("worker_alpha")]?.instructions).toContain(
      'handoff to="worker_gamma"',
    );
    expect(DEFAULT_EMPLOYEES[EmployeeId.make("worker_gamma")]?.instructions).toContain(
      'handoff to="ceo"',
    );
  });

  it("seeds a settings file with no employees key, and leaves an explicit empty map alone", () => {
    expect(DEFAULT_SERVER_SETTINGS.employees).toEqual(DEFAULT_EMPLOYEES);
    expect(decodeServerSettings({ employees: {} }).employees).toEqual({});
  });
});
