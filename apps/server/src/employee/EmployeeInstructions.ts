/**
 * Employee instruction composition.
 *
 * Turns a configured employee into the preamble that opens their session.
 * Pure string work with no Effect context — orchestration stays pure and this
 * stays trivially testable.
 *
 * The preamble is prepended when an employee first enters a provider context,
 * not to every turn. Provider CLIs keep session context, so repeating the
 * persona each turn would burn tokens and drift the model's attention toward
 * boilerplate. A group handoff introduces the new employee even if a
 * compatible provider session remains warm. The caller owns that state; this
 * module holds none of its own.
 *
 * @module employee/EmployeeInstructions
 */
import type { Employee, ModelSelection } from "@t3tools/contracts";

/**
 * A short, per-turn reminder for the lead in a group chat.
 *
 * Employee standing instructions are intentionally injected only when a
 * provider context is opened (or a handoff changes the active employee). A
 * warm CEO session therefore needs this smaller reminder on later turns, or
 * it can drift back into doing the work itself.
 */
export const CEO_GROUP_ROUTING_REMINDER =
  "Routing-only CEO turn: do not inspect files, run commands, edit code, test, or publish a release. Choose the most efficient teammate for the next step and hand off one concrete task. Beta researches, Alpha implements, and Gamma verifies. If the request is genuinely simple and needs no tools, answer it directly.";

/**
 * Framing tag for the persona block. Chosen to match the existing provider
 * instruction convention (`<collaboration_mode>`, `<runtime_info>`).
 */
const EMPLOYEE_TAG = "employee";

/**
 * Neutralize any sequence that would close the framing tag early.
 *
 * Instructions are authored by the user in settings, so this is not a trust
 * boundary — it is a correctness one. A persona that happens to contain
 * `</employee>` (quoting these very docs, say) would otherwise truncate its
 * own block and spill the remainder into the message body as bare text.
 */
const neutralizeFraming = (value: string): string =>
  value.replaceAll(new RegExp(`</?${EMPLOYEE_TAG}>`, "gi"), (match) => match.replaceAll("<", "‹"));

/**
 * Identity sentence for an employee. Always present — an employee with no
 * instructions is still someone, and naming them is the whole point.
 */
const identityLine = (employee: Employee): string => {
  const role =
    employee.role === undefined ? "" : `, working as ${neutralizeFraming(employee.role)}`;
  return `You are ${neutralizeFraming(employee.displayName)}${role}.`;
};

/**
 * Build the persona preamble for an employee, or `undefined` when the
 * employee contributes nothing worth sending.
 *
 * Returns `undefined` only in the degenerate case of an employee whose
 * display name is blank after trimming — the schema forbids it, so this is
 * defense against hand-edited settings files rather than an expected path.
 */
/**
 * One colleague an employee can hand work to.
 */
export interface EmployeeTeammate {
  readonly employeeId: string;
  readonly displayName: string;
  readonly role: string | undefined;
}

/**
 * Roster plus the handoff protocol.
 *
 * Without this an employee has no way to know a colleague exists, so the
 * handoff tag is unreachable in practice — a model does not invent a protocol
 * it was never told about. Omitted entirely when an employee has no
 * colleagues, so a solo employee is not taught a gesture it cannot use.
 */
const teamworkSection = (teammates: ReadonlyArray<EmployeeTeammate>): string | undefined => {
  if (teammates.length === 0) return undefined;
  const roster = teammates
    .map((mate) => {
      const role = mate.role === undefined ? "" : ` — ${neutralizeFraming(mate.role)}`;
      return `- ${neutralizeFraming(mate.displayName)} (id: ${mate.employeeId})${role}`;
    })
    .join("\n");
  return [
    "You work with colleagues. You can hand the thread to one of them:",
    roster,
    "",
    "To hand off, end your turn with:",
    `<handoff to="<id>">what you want them to do</handoff>`,
    "",
    "They take over the same workspace and continue the thread, so say what you did and what you need — they cannot see your reasoning, only what you write. Hand off when a colleague is genuinely better suited. Otherwise finish the work yourself and reply to the user normally.",
  ].join("\n");
};

export const buildEmployeePreamble = (
  employee: Employee,
  teammates: ReadonlyArray<EmployeeTeammate> = [],
): string | undefined => {
  const identity = identityLine(employee);
  if (identity.trim().length === 0) return undefined;
  const instructions = neutralizeFraming(employee.instructions).trim();
  const teamwork = teamworkSection(teammates);
  const body = [identity, instructions, teamwork]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");
  return `<${EMPLOYEE_TAG}>\n${body}\n</${EMPLOYEE_TAG}>`;
};

/**
 * Prepend an employee's preamble to a turn's input text.
 *
 * `messageText` may be empty — a turn can carry only attachments — in which
 * case the preamble stands alone rather than trailing a blank line.
 */
export const applyEmployeePreamble = (input: {
  readonly employee: Employee;
  readonly messageText: string;
  readonly teammates?: ReadonlyArray<EmployeeTeammate>;
}): string => {
  const preamble = buildEmployeePreamble(input.employee, input.teammates ?? []);
  if (preamble === undefined) return input.messageText;
  const message = input.messageText.trim();
  return message.length === 0 ? preamble : `${preamble}\n\n${message}`;
};

/**
 * Keep a warm CEO group session in the routing lane.
 *
 * This is deliberately a prompt-level guard: the CEO still makes the
 * delegation decision, while the worker that receives the handoff performs
 * the file inspection, implementation, tests, and release work.
 */
export const applyCeoGroupRoutingReminder = (input: {
  readonly selection: Pick<ModelSelection, "employeeId" | "employeeIds">;
  readonly messageText: string;
}): string => {
  const isCeoGroupTurn =
    input.selection.employeeId === "ceo" && (input.selection.employeeIds?.length ?? 0) >= 2;
  return isCeoGroupTurn
    ? `${CEO_GROUP_ROUTING_REMINDER}\n\n${input.messageText}`
    : input.messageText;
};
