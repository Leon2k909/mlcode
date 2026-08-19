import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { Employee, EmployeeId, EmployeeMap, ProviderInstanceId } from "@t3tools/contracts";

import {
  buildEmployeeRemovalPatch,
  buildEmployeeRenamePatch,
  buildEmployeeUpsertPatch,
  buildSuggestedEmployeePatch,
  deriveAvailableSuggestions,
  deriveDefaultEmployeeRouting,
  deriveEmployeeHandoffDisplay,
  deriveEmployeeEntries,
  deriveThreadEmployeeParticipants,
  employeeRoutingEqual,
  employeeInitials,
  employeesForInstance,
  findMentionedEmployees,
  findOrphanedEmployees,
  slugifyEmployeeName,
  SUGGESTED_EMPLOYEES,
  validateEmployeeId,
  withEmployeeRouting,
} from "./employees";

const decodeEmployee = Schema.decodeUnknownSync(Employee);
const decodeEmployeeMap = Schema.decodeUnknownSync(EmployeeMap);

const employee = (displayName: string, providerInstanceId = "claudeAgent") =>
  decodeEmployee({ displayName, providerInstanceId });

describe("withEmployeeRouting", () => {
  it("preserves a private employee and group membership across model normalization", () => {
    const employeeId = EmployeeId.make("ceo");
    const employeeIds = [employeeId, EmployeeId.make("reviewer")];

    expect(
      withEmployeeRouting(
        {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6",
          options: [{ id: "reasoningEffort", value: "low" }],
        },
        { employeeId, employeeIds },
      ),
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.6",
      options: [{ id: "reasoningEffort", value: "low" }],
      employeeId: "ceo",
      employeeIds: ["ceo", "reviewer"],
    });
  });

  it("clears stale routing when the source is no employee", () => {
    expect(
      withEmployeeRouting(
        {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.6",
          employeeId: EmployeeId.make("ceo"),
        },
        {},
      ),
    ).toEqual({ instanceId: "codex", model: "gpt-5.6" });
  });
});

describe("slugifyEmployeeName", () => {
  it.each([
    ["Ada", "ada"],
    ["Ada Lovelace", "ada_lovelace"],
    ["  Grace   Hopper  ", "grace_hopper"],
    ["Ada-Lovelace", "ada_lovelace"],
    ["Ada!!!", "ada"],
  ])("turns %s into %s", (input, expected) => {
    expect(slugifyEmployeeName(input)).toBe(expected);
  });

  it("returns empty for a name with nothing sluggable", () => {
    expect(slugifyEmployeeName("   ")).toBe("");
    expect(slugifyEmployeeName("!!!")).toBe("");
  });

  // Dropping the digit would silently collide "42 Support" with "Support".
  it("prefixes rather than drops a leading digit", () => {
    expect(slugifyEmployeeName("42 Support")).toBe("e_42_support");
    expect(slugifyEmployeeName("42 Support")).not.toBe("support");
  });

  it("keeps the result inside the slug cap", () => {
    expect(slugifyEmployeeName("a".repeat(200)).length).toBeLessThanOrEqual(64);
    expect(slugifyEmployeeName(`9${"a".repeat(200)}`).length).toBeLessThanOrEqual(64);
  });
});

describe("validateEmployeeId", () => {
  const existing = new Set(["ada"]);

  it("accepts a well-formed unused id", () => {
    expect(validateEmployeeId("grace", existing)).toBeNull();
  });

  it.each([
    ["", "required"],
    ["1ada", "start with a letter"],
    ["ada lovelace", "start with a letter"],
    ["ada.lovelace", "start with a letter"],
  ])("rejects %s", (id, fragment) => {
    expect(validateEmployeeId(id, existing)).toContain(fragment);
  });

  it("rejects a duplicate id", () => {
    expect(validateEmployeeId("ada", existing)).toContain("already exists");
  });

  it("rejects an over-long id", () => {
    expect(validateEmployeeId(`a${"b".repeat(64)}`, existing)).toContain("64 characters");
  });
});

describe("deriveEmployeeEntries", () => {
  it("sorts by display name, then id", () => {
    const map = decodeEmployeeMap({
      zed: { displayName: "Ada", providerInstanceId: "codex" },
      ada: { displayName: "Ada", providerInstanceId: "codex" },
      grace: { displayName: "Grace", providerInstanceId: "codex" },
    });
    expect(deriveEmployeeEntries(map).map((entry) => entry.employeeId)).toEqual([
      "ada",
      "zed",
      "grace",
    ]);
  });

  it("returns an empty list for no employees", () => {
    expect(deriveEmployeeEntries(decodeEmployeeMap({}))).toEqual([]);
  });
});

describe("deriveDefaultEmployeeRouting", () => {
  it("routes a new chat through the enabled built-in roster in lead-first order", () => {
    const map = decodeEmployeeMap({
      ceo: { displayName: "Ceo", providerInstanceId: "codex" },
      worker_alpha: { displayName: "Alpha", providerInstanceId: "codex" },
      worker_beta: { displayName: "Beta", providerInstanceId: "codex" },
      worker_gamma: { displayName: "Gamma", providerInstanceId: "codex" },
      reviewer: { displayName: "Reviewer", providerInstanceId: "codex" },
    });

    expect(deriveDefaultEmployeeRouting(map)).toEqual({
      employeeId: "ceo",
      employeeIds: ["ceo", "worker_alpha", "worker_beta", "worker_gamma"],
    });
  });

  it("omits disabled or removed defaults and does not add optional hires", () => {
    const map = decodeEmployeeMap({
      ceo: { displayName: "Ceo", providerInstanceId: "codex", enabled: false },
      worker_alpha: { displayName: "Alpha", providerInstanceId: "codex" },
      reviewer: { displayName: "Reviewer", providerInstanceId: "codex" },
    });

    expect(deriveDefaultEmployeeRouting(map)).toEqual({ employeeId: "worker_alpha" });
  });

  it("returns no routing when the built-in roster is removed", () => {
    expect(deriveDefaultEmployeeRouting(decodeEmployeeMap({}))).toEqual({});
  });
});

describe("thread employee presentation", () => {
  const map = decodeEmployeeMap({
    ceo: { displayName: "Alex", providerInstanceId: "codex" },
    reviewer: { displayName: "Riley", providerInstanceId: "claudeAgent" },
  });

  it("lists every group member by display name", () => {
    expect(
      deriveThreadEmployeeParticipants(
        {
          employeeId: EmployeeId.make("ceo"),
          employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("reviewer")],
        },
        map,
      ).map((participant) => participant.displayName),
    ).toEqual(["Alex", "Riley"]);
  });

  it("keeps a removed employee id visible instead of hiding the membership", () => {
    expect(
      deriveThreadEmployeeParticipants({ employeeId: EmployeeId.make("missing") }, map)[0],
    ).toMatchObject({ employeeId: "missing", displayName: "missing", employee: undefined });
  });

  it("recognizes display-name references in plans without treating roles as employees", () => {
    expect(
      findMentionedEmployees("Hand Riley a brief, then let the CEO decide.", map).map(
        (entry) => entry.employeeId,
      ),
    ).toEqual(["reviewer"]);
  });

  it("compares current and next-turn group routing in order", () => {
    const privateChat = { employeeId: EmployeeId.make("ceo") };
    const groupChat = {
      employeeId: EmployeeId.make("ceo"),
      employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("reviewer")],
    };
    expect(employeeRoutingEqual(privateChat, privateChat)).toBe(true);
    expect(employeeRoutingEqual(privateChat, groupChat)).toBe(false);
    expect(employeeRoutingEqual(groupChat, { ...groupChat })).toBe(true);
  });
});

describe("findOrphanedEmployees", () => {
  const map = decodeEmployeeMap({
    ada: { displayName: "Ada", providerInstanceId: "claudeAgent" },
    ghost: { displayName: "Ghost", providerInstanceId: "someForkDriver" },
  });

  it("flags employees whose provider instance is not configured", () => {
    const orphans = findOrphanedEmployees(map, new Set(["claudeAgent"]));
    expect(orphans.map((entry) => entry.employeeId)).toEqual(["ghost"]);
  });

  it("flags nothing when every instance is configured", () => {
    expect(findOrphanedEmployees(map, new Set(["claudeAgent", "someForkDriver"]))).toEqual([]);
  });
});

describe("settings patches", () => {
  const map = decodeEmployeeMap({
    ada: { displayName: "Ada", providerInstanceId: "claudeAgent" },
    grace: { displayName: "Grace", providerInstanceId: "codex" },
  });

  it("upsert adds without disturbing the others", () => {
    const patch = buildEmployeeUpsertPatch({
      employees: map,
      employeeId: EmployeeId.make("alan"),
      employee: employee("Alan"),
    });
    expect(Object.keys(patch.employees).sort()).toEqual(["ada", "alan", "grace"]);
    expect(patch.employees[EmployeeId.make("ada")]?.displayName).toBe("Ada");
  });

  it("upsert replaces an existing entry in place", () => {
    const patch = buildEmployeeUpsertPatch({
      employees: map,
      employeeId: EmployeeId.make("ada"),
      employee: employee("Ada Lovelace"),
    });
    expect(Object.keys(patch.employees).sort()).toEqual(["ada", "grace"]);
    expect(patch.employees[EmployeeId.make("ada")]?.displayName).toBe("Ada Lovelace");
  });

  it("removal drops exactly one entry", () => {
    const patch = buildEmployeeRemovalPatch({ employees: map, employeeId: EmployeeId.make("ada") });
    expect(Object.keys(patch.employees)).toEqual(["grace"]);
  });

  it("removal leaves the source map untouched", () => {
    buildEmployeeRemovalPatch({ employees: map, employeeId: EmployeeId.make("ada") });
    expect(Object.keys(map).sort()).toEqual(["ada", "grace"]);
  });

  it("rename moves the entry to the new key", () => {
    const patch = buildEmployeeRenamePatch({
      employees: map,
      fromId: EmployeeId.make("ada"),
      toId: EmployeeId.make("ada_lovelace"),
      employee: employee("Ada Lovelace"),
    });
    expect(Object.keys(patch.employees).sort()).toEqual(["ada_lovelace", "grace"]);
    expect(patch.employees[EmployeeId.make("ada_lovelace")]?.displayName).toBe("Ada Lovelace");
  });

  it("rename to the same id is a plain update, not a delete", () => {
    const patch = buildEmployeeRenamePatch({
      employees: map,
      fromId: EmployeeId.make("ada"),
      toId: EmployeeId.make("ada"),
      employee: employee("Ada Lovelace"),
    });
    expect(Object.keys(patch.employees).sort()).toEqual(["ada", "grace"]);
    expect(patch.employees[EmployeeId.make("ada")]?.displayName).toBe("Ada Lovelace");
  });

  it("preserves Auto routing and Fast mode in the complete employee settings payload", () => {
    const employeeId = EmployeeId.make("ada");
    const autoFastEmployee = decodeEmployee({
      displayName: "Ada",
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelMode: "auto",
      modelOptions: [],
      fastMode: true,
    });

    const patch = buildEmployeeRenamePatch({
      employees: map,
      fromId: employeeId,
      toId: employeeId,
      employee: autoFastEmployee,
    });

    expect(patch.employees[employeeId]).toMatchObject({
      modelMode: "auto",
      modelOptions: [],
      fastMode: true,
    });
  });
});

describe("employeeInitials", () => {
  it.each([
    ["Ada", "AD"],
    ["Ada Lovelace", "AL"],
    ["Ada Byron Lovelace", "AL"],
    ["x", "X"],
  ])("renders %s as %s", (name, expected) => {
    expect(employeeInitials(name)).toBe(expected);
  });

  it("falls back for a blank name", () => {
    expect(employeeInitials("   ")).toBe("?");
  });

  it("does not split an emoji into broken halves", () => {
    expect(employeeInitials("🎨")).toBe("🎨");
  });
});

describe("deriveEmployeeHandoffDisplay", () => {
  it("removes the model protocol and exposes the target", () => {
    expect(
      deriveEmployeeHandoffDisplay(
        'The implementation is ready.\n\n<handoff to="reviewer">Please review it.</handoff>',
      ),
    ).toEqual({
      visibleText: "The implementation is ready.",
      toEmployeeId: "reviewer",
      message: "Please review it.",
    });
  });

  it("leaves ordinary assistant text alone", () => {
    expect(deriveEmployeeHandoffDisplay("No handoff needed.")).toEqual({
      visibleText: "No handoff needed.",
      toEmployeeId: undefined,
      message: undefined,
    });
  });

  it("accepts unquoted ids because model output is not a wire format", () => {
    expect(deriveEmployeeHandoffDisplay("<handoff to=ceo>Decision needed.</handoff>")).toEqual({
      visibleText: "",
      toEmployeeId: "ceo",
      message: "Decision needed.",
    });
  });

  it("hides task-sensitive model assignment attributes", () => {
    expect(
      deriveEmployeeHandoffDisplay(
        '<handoff to="reviewer" model="gpt-5.6-luna" reasoning="low">Check this.</handoff>',
      ),
    ).toEqual({
      visibleText: "",
      toEmployeeId: "reviewer",
      message: "Check this.",
    });
  });

  it("hides a self-handoff when the source employee is known", () => {
    expect(
      deriveEmployeeHandoffDisplay("Done.\n<handoff to=ceo>Continue.</handoff>", {
        fromEmployeeId: EmployeeId.make("ceo"),
      }),
    ).toEqual({
      visibleText: "Done.",
      toEmployeeId: undefined,
      message: undefined,
    });
  });
});

describe("employeesForInstance", () => {
  it("returns every employee sharing one instance", () => {
    const map = decodeEmployeeMap({
      ada: { displayName: "Ada", providerInstanceId: "claudeAgent" },
      grace: { displayName: "Grace", providerInstanceId: "claudeAgent" },
      alan: { displayName: "Alan", providerInstanceId: "codex" },
    });
    expect(
      employeesForInstance(map, ProviderInstanceId.make("claudeAgent")).map((e) => e.employeeId),
    ).toEqual(["ada", "grace"]);
  });
});

describe("suggested employees", () => {
  it("hides a suggestion whose id is already taken", () => {
    const map = decodeEmployeeMap({
      reviewer: { displayName: "Someone else", providerInstanceId: "codex" },
    });
    expect(deriveAvailableSuggestions(map).map((s) => s.employeeId)).not.toContain("reviewer");
    expect(deriveAvailableSuggestions({} as EmployeeMap)).toEqual(SUGGESTED_EMPLOYEES);
  });

  it("every suggestion decodes as a valid employee once an instance is bound", () => {
    for (const suggestion of SUGGESTED_EMPLOYEES) {
      const patch = buildSuggestedEmployeePatch({
        employees: {} as EmployeeMap,
        suggestion,
        providerInstanceId: ProviderInstanceId.make("codex"),
      });
      const hired = patch.employees[suggestion.employeeId];
      expect(decodeEmployee(hired)).toEqual(hired);
      expect(validateEmployeeId(suggestion.employeeId, new Set())).toBeNull();
    }
  });

  it("keeps existing employees when hiring", () => {
    const map = decodeEmployeeMap({ ada: { displayName: "Ada", providerInstanceId: "codex" } });
    const suggestion = SUGGESTED_EMPLOYEES[0]!;
    const next = buildSuggestedEmployeePatch({
      employees: map,
      suggestion,
      providerInstanceId: ProviderInstanceId.make("codex"),
    }).employees;
    expect(Object.keys(next).sort()).toEqual(["ada", suggestion.employeeId].sort());
  });
});
