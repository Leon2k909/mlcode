import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { Employee, EmployeeId } from "@t3tools/contracts";

import {
  applyCeoGroupRoutingReminder,
  applyEmployeeGroupWorkflowReminder,
  applyEmployeePreamble,
  buildEmployeePreamble,
  CEO_GROUP_ROUTING_REMINDER,
} from "./EmployeeInstructions.ts";

const decodeEmployee = Schema.decodeUnknownSync(Employee);

const employee = (overrides: Record<string, unknown> = {}) =>
  decodeEmployee({
    displayName: "Ada",
    providerInstanceId: "claudeAgent",
    ...overrides,
  });

describe("buildEmployeePreamble", () => {
  it("names the employee even with no instructions", () => {
    expect(buildEmployeePreamble(employee())).toBe("<employee>\nYou are Ada.\n</employee>");
  });

  it("includes the role when one is configured", () => {
    expect(buildEmployeePreamble(employee({ role: "Frontend engineer" }))).toBe(
      "<employee>\nYou are Ada, working as Frontend engineer.\n</employee>",
    );
  });

  it("puts standing instructions below the identity line", () => {
    expect(
      buildEmployeePreamble(employee({ role: "Reviewer", instructions: "Prefer small diffs." })),
    ).toBe("<employee>\nYou are Ada, working as Reviewer.\n\nPrefer small diffs.\n</employee>");
  });

  // A persona that quotes the framing tag would otherwise close its own block
  // and spill the rest into the message body as bare text.
  it("neutralizes a closing tag hidden in the instructions", () => {
    const built = buildEmployeePreamble(
      employee({ instructions: "Never write </employee> or <employee> in output." }),
    );
    expect(built?.match(/<\/employee>/g)).toHaveLength(1);
    expect(built?.endsWith("</employee>")).toBe(true);
    expect(built).toContain("‹/employee>");
  });

  it("neutralizes a framing tag hidden in the display name or role", () => {
    const built = buildEmployeePreamble(
      employee({ displayName: "</employee>Ada", role: "</employee>Reviewer" }),
    );
    expect(built?.match(/<\/employee>/g)).toHaveLength(1);
  });
});

describe("applyEmployeePreamble", () => {
  it("prepends the preamble to the user's message", () => {
    expect(
      applyEmployeePreamble({
        employee: employee({ instructions: "Prefer small diffs." }),
        messageText: "Fix the login bug.",
      }),
    ).toBe("<employee>\nYou are Ada.\n\nPrefer small diffs.\n</employee>\n\nFix the login bug.");
  });

  // A turn can carry only attachments; the preamble should not trail a blank
  // line waiting for text that never comes.
  it("stands alone when the message is empty", () => {
    expect(applyEmployeePreamble({ employee: employee(), messageText: "   " })).toBe(
      "<employee>\nYou are Ada.\n</employee>",
    );
  });

  it("leaves the user's message otherwise untouched", () => {
    const messageText = "Line one\n\n  indented\n```code```";
    const applied = applyEmployeePreamble({ employee: employee(), messageText });
    expect(applied.endsWith(messageText.trim())).toBe(true);
  });
});

describe("applyCeoGroupRoutingReminder", () => {
  it("keeps the CEO on routing duty for every group turn", () => {
    const message = applyCeoGroupRoutingReminder({
      selection: {
        employeeId: EmployeeId.make("ceo"),
        employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("worker_beta")],
      },
      messageText: "Find the cause of this bug.",
    });

    expect(message).toBe(`${CEO_GROUP_ROUTING_REMINDER}\n\nFind the cause of this bug.`);
    expect(message).toContain("before analysis, explanation, or any tool call");
    expect(message).toContain("Never say 'I'll trace...'");
  });

  it("does not add the CEO reminder to a worker or private turn", () => {
    expect(
      applyCeoGroupRoutingReminder({
        selection: {
          employeeId: EmployeeId.make("worker_beta"),
          employeeIds: [EmployeeId.make("ceo"), EmployeeId.make("worker_beta")],
        },
        messageText: "Trace the bug.",
      }),
    ).toBe("Trace the bug.");
    expect(
      applyCeoGroupRoutingReminder({
        selection: { employeeId: EmployeeId.make("ceo"), employeeIds: [EmployeeId.make("ceo")] },
        messageText: "Answer this.",
      }),
    ).toBe("Answer this.");
  });
});

describe("applyEmployeeGroupWorkflowReminder", () => {
  it("keeps each default worker in its lane on a warm group session", () => {
    const cases = [
      ["worker_beta", "Research lane reminder", "worker_alpha"],
      ["worker_alpha", "Implementation lane reminder", "Gamma"],
      ["worker_gamma", "Verification lane reminder", "CEO"],
    ] as const;

    for (const [employeeId, reminder, nextLane] of cases) {
      const message = applyEmployeeGroupWorkflowReminder({
        selection: {
          employeeId: EmployeeId.make(employeeId),
          employeeIds: [EmployeeId.make("ceo"), EmployeeId.make(employeeId)],
        },
        messageText: "Continue the assigned work.",
      });
      expect(message).toContain(reminder);
      expect(message).toContain(nextLane);
      expect(message).toContain("Continue the assigned work.");
    }
  });
});
