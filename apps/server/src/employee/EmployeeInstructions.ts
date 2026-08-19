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
  'CEO delegation gate (mandatory): before analysis, explanation, or any tool call, choose one worker and emit exactly one handoff. For delegated work, your entire response must be one tag with no prose before or after. On Codex, every CEO handoff must assign the worker\'s model and reasoning using one of these exact pairs: routine/simple -> model="gpt-5.6-luna" reasoning="low"; normal -> model="gpt-5.6-terra" reasoning="medium" or reasoning="high"; complex/high-risk -> model="gpt-5.6-sol" reasoning="high"; exceptional -> model="gpt-5.6-sol" reasoning="ultra". Substantial UI work, visual redesigns, and complex multi-surface frontend work always require at least Sol with High reasoning; unusually broad, high-risk, or architecture-changing UI work requires Sol with Ultra reasoning. On Claude, the CEO must use Claude Fable 5 or Claude Opus 5. Assign an Auto worker only one canonical Claude model in its handoff: routine bounded work -> model="claude-haiku-4-5"; normal research or implementation -> model="claude-sonnet-5"; complex or high-risk work -> model="claude-opus-5". Example: <handoff to="worker_beta" model="gpt-5.6-luna" reasoning="low">research brief</handoff>. Claude example: <handoff to="worker_alpha" model="claude-sonnet-5">implementation brief</handoff>. Adapt deliberately: when a worker reports a blocker, repeated failed attempt, or higher-than-expected risk, have it hand back to you and issue a new assignment at the appropriate tier. Never switch a worker mid-turn or auto-escalate from elapsed time or usage. You, the CEO, remain on GPT-5.6 Sol with Ultra reasoning when using Codex; choose cheaper worker settings whenever the task allows. This is a routing-only CEO turn: do not inspect files, run commands, edit code, test, or publish a release yourself. If you are unsure, hand research to Beta; for an obvious scoped code change, hand implementation to Alpha; for an existing change, hand verification to Gamma. Never send a progress update such as "I\'ll trace this"; that is not a handoff. For non-trivial code work, use Beta research -> Alpha implementation -> Gamma verification -> your final review; skip only lanes that add no value, and never treat Alpha\'s completion summary as final without Gamma\'s evidence. If the request is genuinely simple and needs no tools, answer it directly.';

const BETA_GROUP_WORKFLOW_REMINDER =
  'Research lane reminder: trace and report evidence only. For non-trivial work, hand the findings and implementation brief to Alpha with <handoff to="worker_alpha">findings and the implementation brief</handoff>; do not implement or publish unless explicitly assigned.';
const ALPHA_GROUP_WORKFLOW_REMINDER =
  'Implementation lane reminder: make the scoped change and run focused checks. Then hand the files, commands, and risks to Gamma with <handoff to="worker_gamma">what changed and what to verify</handoff>; do not present a code change as final until Gamma verifies it.';
const GAMMA_GROUP_WORKFLOW_REMINDER =
  'Verification lane reminder: run checks and reproduce the actual behavior instead of trusting Alpha\'s summary. If it passes, hand the evidence to the CEO with <handoff to="ceo">checks and remaining risks</handoff>; if it fails, hand concrete corrections back to Alpha with <handoff to="worker_alpha">failures and required fixes</handoff>.';

const EMPLOYEE_GROUP_WORKFLOW_REMINDERS: Readonly<Record<string, string>> = {
  ceo: CEO_GROUP_ROUTING_REMINDER,
  worker_beta: BETA_GROUP_WORKFLOW_REMINDER,
  worker_alpha: ALPHA_GROUP_WORKFLOW_REMINDER,
  worker_gamma: GAMMA_GROUP_WORKFLOW_REMINDER,
};

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

/**
 * Skills configured for this employee's role, named as available rather than
 * forced into every turn.
 *
 * The employee decides per turn whether a skill fits, the same way a human
 * hire with a listed specialty does not reach for it unprompted on unrelated
 * work. Omitted entirely when the employee has no skills configured, so a
 * generalist employee is not taught a menu it was never given.
 */
const skillsSection = (skills: ReadonlyArray<string> | undefined): string | undefined => {
  if (skills === undefined || skills.length === 0) return undefined;
  const roster = skills.map((skill) => `- ${neutralizeFraming(skill)}`).join("\n");
  return [
    "Skills available to you for this role. Invoke one by name when it fits the task at hand — not on every turn:",
    roster,
  ].join("\n");
};

export const buildEmployeePreamble = (
  employee: Employee,
  teammates: ReadonlyArray<EmployeeTeammate> = [],
): string | undefined => {
  const identity = identityLine(employee);
  if (identity.trim().length === 0) return undefined;
  const instructions = neutralizeFraming(employee.instructions).trim();
  const skills = skillsSection(employee.skills);
  const teamwork = teamworkSection(teammates);
  const body = [identity, instructions, skills, teamwork]
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
 * Keep warm default employee sessions in their assigned workflow lane.
 *
 * This is deliberately a prompt-level guard: the CEO still makes the
 * delegation decision, while workers perform their lane and hand off the
 * evidence to the next lane.
 */
export const applyEmployeeGroupWorkflowReminder = (input: {
  readonly selection: Pick<ModelSelection, "employeeId" | "employeeIds">;
  readonly messageText: string;
}): string => {
  if ((input.selection.employeeIds?.length ?? 0) < 2) return input.messageText;
  const reminder =
    input.selection.employeeId === undefined
      ? undefined
      : EMPLOYEE_GROUP_WORKFLOW_REMINDERS[input.selection.employeeId];
  return reminder === undefined ? input.messageText : `${reminder}\n\n${input.messageText}`;
};

/** Backward-compatible helper for callers that only need CEO behavior. */
export const applyCeoGroupRoutingReminder = (input: {
  readonly selection: Pick<ModelSelection, "employeeId" | "employeeIds">;
  readonly messageText: string;
}): string =>
  input.selection.employeeId === "ceo"
    ? applyEmployeeGroupWorkflowReminder(input)
    : input.messageText;
