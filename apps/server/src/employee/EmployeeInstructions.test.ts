import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { Employee } from "@t3tools/contracts";

import { applyEmployeePreamble, buildEmployeePreamble } from "./EmployeeInstructions.ts";

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
