import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { EmployeeId, EmployeeMap } from "@t3tools/contracts";

import {
  canContinueHandoffChain,
  describeHandoffRejection,
  MAX_CONSECUTIVE_HANDOFFS,
  parseEmployeeHandoff,
  resolveAutomaticEmployeeHandoffTarget,
} from "./EmployeeHandoff.ts";

const employees = Schema.decodeUnknownSync(EmployeeMap)({
  ceo: { displayName: "Ada", providerInstanceId: "claudeAgent", role: "CEO" },
  reviewer: { displayName: "Grace", providerInstanceId: "claudeAgent", role: "Reviewer" },
  retired: { displayName: "Alan", providerInstanceId: "codex", enabled: false },
});

const parse = (text: string, fromEmployeeId?: string) =>
  parseEmployeeHandoff({
    text,
    employees,
    fromEmployeeId: fromEmployeeId as EmployeeId | undefined,
  });

const parseForGroup = (text: string, employeeIds: ReadonlyArray<string>) =>
  parseEmployeeHandoff({
    text,
    employees,
    fromEmployeeId: EmployeeId.make("ceo"),
    allowedEmployeeIds: new Set(employeeIds),
  });

describe("parseEmployeeHandoff", () => {
  it("returns none when no handoff was attempted", () => {
    expect(parse("Done, the tests pass.").kind).toBe("none");
  });

  it("parses a handoff and its message", () => {
    const result = parse('Shipped it.\n\n<handoff to="reviewer">Check the auth path.</handoff>');
    expect(result.kind).toBe("handoff");
    if (result.kind !== "handoff") return;
    expect(result.handoff.toEmployeeId).toBe("reviewer");
    expect(result.handoff.message).toBe("Check the auth path.");
    expect(result.handoff.codexAssignment).toBeUndefined();
  });

  it.each([
    ["gpt-5.6-luna", "low"],
    ["gpt-5.6-terra", "medium"],
    ["gpt-5.6-terra", "high"],
    ["gpt-5.6-sol", "high"],
    ["gpt-5.6-sol", "ultra"],
  ] as const)("parses the CEO Codex assignment %s/%s", (model, reasoning) => {
    const result = parse(
      `<handoff reasoning="${reasoning}" to="reviewer" model="${model}">Do it.</handoff>`,
    );
    if (result.kind !== "handoff") throw new Error("expected handoff");
    expect(result.handoff.codexAssignment).toEqual({ model, reasoning });
  });

  it.each([
    '<handoff to="reviewer" model="gpt-5.6-sol">Do it.</handoff>',
    '<handoff to="reviewer" model="gpt-5.6-luna" reasoning="ultra">Do it.</handoff>',
    '<handoff to="reviewer" model="made-up" reasoning="low">Do it.</handoff>',
  ])("keeps a handoff but discards an invalid assignment", (text) => {
    const result = parse(text);
    if (result.kind !== "handoff") throw new Error("expected handoff");
    expect(result.handoff.codexAssignment).toBeUndefined();
  });

  it("strips the block from the text shown in the timeline", () => {
    const result = parse('Shipped it.\n\n<handoff to="reviewer">Check it.</handoff>');
    if (result.kind !== "handoff") throw new Error("expected handoff");
    expect(result.handoff.remainingText).toBe("Shipped it.");
    expect(result.handoff.remainingText).not.toContain("handoff");
  });

  it.each([
    ["<handoff to=reviewer>Go.</handoff>", "unquoted"],
    ["<handoff to='reviewer'>Go.</handoff>", "single quoted"],
    ['<handoff   to = "reviewer" >Go.</handoff>', "loose whitespace"],
    ['<HANDOFF TO="reviewer">Go.</HANDOFF>', "uppercase"],
  ])("tolerates %s attribute style", (text) => {
    expect(parse(text).kind).toBe("handoff");
  });

  it("keeps a multi-line message intact", () => {
    const result = parse('<handoff to="reviewer">Line one.\n\nLine two.</handoff>');
    if (result.kind !== "handoff") throw new Error("expected handoff");
    expect(result.handoff.message).toBe("Line one.\n\nLine two.");
  });

  // A thread has one owner. Fanning out is not supported, so the outcome has
  // to be predictable rather than arbitrary.
  it("honors only the first of several handoffs", () => {
    const result = parse(
      '<handoff to="reviewer">First.</handoff><handoff to="ceo">Second.</handoff>',
    );
    if (result.kind !== "handoff") throw new Error("expected handoff");
    expect(result.handoff.toEmployeeId).toBe("reviewer");
  });

  it("rejects an unknown employee", () => {
    const result = parse('<handoff to="nobody">Hello.</handoff>');
    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.rejection.reason).toBe("unknown-employee");
  });

  it("rejects a disabled employee", () => {
    const result = parse('<handoff to="retired">Hello.</handoff>');
    if (result.kind !== "rejected") throw new Error("expected rejection");
    expect(result.rejection.reason).toBe("disabled-employee");
  });

  it("rejects a configured employee outside the current group", () => {
    const result = parseForGroup('<handoff to="reviewer">Hello.</handoff>', ["ceo"]);
    if (result.kind !== "rejected") throw new Error("expected rejection");
    expect(result.rejection.reason).toBe("not-in-group");
  });

  it("allows a handoff to another member of the current group", () => {
    expect(parseForGroup('<handoff to="reviewer">Hello.</handoff>', ["ceo", "reviewer"]).kind).toBe(
      "handoff",
    );
  });

  // Would loop the same employee forever without the user ever speaking.
  it("rejects a handoff to self", () => {
    const result = parse('<handoff to="reviewer">Again.</handoff>', "reviewer");
    if (result.kind !== "rejected") throw new Error("expected rejection");
    expect(result.rejection.reason).toBe("self-handoff");
  });

  it("rejects a handoff that says nothing", () => {
    const result = parse('<handoff to="reviewer">   </handoff>');
    if (result.kind !== "rejected") throw new Error("expected rejection");
    expect(result.rejection.reason).toBe("empty-message");
  });

  it("does not resolve prototype keys as employees", () => {
    expect(parse('<handoff to="constructor">Hi.</handoff>').kind).toBe("rejected");
  });
});

describe("describeHandoffRejection", () => {
  it("names the requested employee in every case", () => {
    const reasons = [
      "unknown-employee",
      "disabled-employee",
      "not-in-group",
      "self-handoff",
      "empty-message",
    ] as const;
    for (const reason of reasons) {
      expect(describeHandoffRejection({ reason, requestedId: "reviewer" })).toContain("reviewer");
    }
  });
});

describe("canContinueHandoffChain", () => {
  it("allows a chain below the cap", () => {
    expect(canContinueHandoffChain(0)).toBe(true);
    expect(canContinueHandoffChain(MAX_CONSECUTIVE_HANDOFFS - 1)).toBe(true);
  });

  // Two agents will otherwise talk forever on the user's subscription.
  it("stops the chain at the cap", () => {
    expect(canContinueHandoffChain(MAX_CONSECUTIVE_HANDOFFS)).toBe(false);
    expect(canContinueHandoffChain(MAX_CONSECUTIVE_HANDOFFS + 1)).toBe(false);
  });
});

describe("resolveAutomaticEmployeeHandoffTarget", () => {
  it("keeps the built-in workflow moving when a tag is missing", () => {
    expect(
      resolveAutomaticEmployeeHandoffTarget({
        fromEmployeeId: "worker_beta",
        allowedEmployeeIds: ["ceo", "worker_beta", "worker_alpha", "worker_gamma"],
      }),
    ).toBe("worker_alpha");
  });

  it("skips disabled or removed built-in lanes", () => {
    expect(
      resolveAutomaticEmployeeHandoffTarget({
        fromEmployeeId: "ceo",
        allowedEmployeeIds: ["ceo", "worker_alpha", "worker_gamma"],
      }),
    ).toBe("worker_alpha");
  });

  it("uses the next configured custom employee as a fallback", () => {
    expect(
      resolveAutomaticEmployeeHandoffTarget({
        fromEmployeeId: "reviewer",
        allowedEmployeeIds: ["ceo", "reviewer", "architect"],
      }),
    ).toBe("architect");
  });

  it("does not invent a target for a solo group", () => {
    expect(
      resolveAutomaticEmployeeHandoffTarget({
        fromEmployeeId: "ceo",
        allowedEmployeeIds: ["ceo"],
      }),
    ).toBeUndefined();
  });
});
