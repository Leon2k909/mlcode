/**
 * Employee list derivation and settings patches for the web client.
 *
 * Kept free of React so the rules that matter — id validity, uniqueness,
 * whole-map replacement — are testable on their own. The panel renders from
 * these; it does not re-derive them.
 *
 * @module employees
 */
import { DEFAULT_EMPLOYEES } from "@t3tools/contracts";
import type {
  Employee,
  EmployeeId,
  EmployeeMap,
  ModelSelection,
  ProviderInstanceId,
} from "@t3tools/contracts";

/** Mirrors the slug cap enforced by `EmployeeId` in `@t3tools/contracts`. */
const EMPLOYEE_ID_MAX_CHARS = 64;
/** Mirrors `EMPLOYEE_SLUG_PATTERN` in `packages/contracts/src/employee.ts`. */
const EMPLOYEE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const EMPLOYEE_HANDOFF_PATTERN =
  /<handoff\s+to\s*=\s*["']?([a-zA-Z][a-zA-Z0-9_-]*)["']?\s*>([\s\S]*?)<\/handoff>/i;

export interface EmployeeEntry {
  readonly employeeId: EmployeeId;
  readonly employee: Employee;
}

export interface ThreadEmployeeParticipant {
  readonly employeeId: EmployeeId;
  readonly displayName: string;
  readonly employee: Employee | undefined;
}

export interface EmployeeHandoffDisplayState {
  readonly visibleText: string;
  readonly toEmployeeId: EmployeeId | undefined;
  readonly message: string | undefined;
}

/**
 * Rebuild a model selection without losing the employee or group that owns it.
 * Model-option normalizers intentionally know nothing about employees, so every
 * normalization boundary must explicitly carry this routing metadata forward.
 */
export function withEmployeeRouting(
  base: ModelSelection,
  routing: Pick<ModelSelection, "employeeId" | "employeeIds">,
): ModelSelection {
  return {
    instanceId: base.instanceId,
    model: base.model,
    ...(base.options !== undefined ? { options: base.options } : {}),
    ...(routing.employeeId !== undefined ? { employeeId: routing.employeeId } : {}),
    ...(routing.employeeIds !== undefined ? { employeeIds: routing.employeeIds } : {}),
  };
}

/**
 * Remove the model-facing handoff protocol from chat copy while retaining
 * enough information for the timeline to show who received the work.
 */
export function deriveEmployeeHandoffDisplay(text: string): EmployeeHandoffDisplayState {
  const match = EMPLOYEE_HANDOFF_PATTERN.exec(text);
  if (match === null) {
    return { visibleText: text, toEmployeeId: undefined, message: undefined };
  }

  const requestedId = match[1];
  const message = (match[2] ?? "").trim();
  return {
    visibleText: text
      .replace(EMPLOYEE_HANDOFF_PATTERN, "")
      .replaceAll(/\n{3,}/g, "\n\n")
      .trim(),
    toEmployeeId: requestedId as EmployeeId,
    message: message.length > 0 ? message : undefined,
  };
}

/**
 * Turn a display name into a candidate id — "Ada Lovelace" becomes `ada_lovelace`.
 *
 * A leading digit is prefixed rather than dropped, because dropping it would
 * silently turn "42 Support" into `support` and collide with a real employee.
 */
export function slugifyEmployeeName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, EMPLOYEE_ID_MAX_CHARS);
  if (slug.length === 0) return "";
  return EMPLOYEE_ID_PATTERN.test(slug) ? slug : `e_${slug}`.slice(0, EMPLOYEE_ID_MAX_CHARS);
}

/**
 * Validate an employee id against the same rules the server applies.
 * Returns a user-facing message, or `null` when valid.
 */
export function validateEmployeeId(id: string, existing: ReadonlySet<string>): string | null {
  if (id.length === 0) return "Employee ID is required.";
  if (id.length > EMPLOYEE_ID_MAX_CHARS) {
    return `Employee ID must be ${EMPLOYEE_ID_MAX_CHARS} characters or fewer.`;
  }
  if (!EMPLOYEE_ID_PATTERN.test(id)) {
    return "Employee ID must start with a letter and use only letters, digits, '-', or '_'.";
  }
  if (existing.has(id)) return `An employee named '${id}' already exists.`;
  return null;
}

/** Employees in display order: by name, then id so the order is total. */
export function sortEmployeeEntries(entries: readonly EmployeeEntry[]): EmployeeEntry[] {
  return [...entries].sort((a, b) => {
    const byName = a.employee.displayName.localeCompare(b.employee.displayName);
    return byName === 0 ? a.employeeId.localeCompare(b.employeeId) : byName;
  });
}

export function deriveEmployeeEntries(employees: EmployeeMap): EmployeeEntry[] {
  return sortEmployeeEntries(
    Object.entries(employees).map(([employeeId, employee]) => ({
      employeeId: employeeId as EmployeeId,
      employee: employee as Employee,
    })),
  );
}

/**
 * Default group routing for a new or unassigned chat.
 *
 * The built-in roster is intentionally used instead of every configured
 * employee: optional hires should not silently join every conversation. A
 * missing or disabled built-in employee is simply omitted, so removing one
 * from Settings remains authoritative.
 */
export function deriveDefaultEmployeeRouting(
  employees: EmployeeMap,
): Pick<ModelSelection, "employeeId" | "employeeIds"> {
  const enabledDefaults = Object.keys(DEFAULT_EMPLOYEES)
    .map((employeeId) => {
      const employee = employees[employeeId as EmployeeId];
      return employee?.enabled === true ? (employeeId as EmployeeId) : undefined;
    })
    .filter((employeeId): employeeId is EmployeeId => employeeId !== undefined);

  const employeeId = enabledDefaults[0];
  if (employeeId === undefined) return {};
  return {
    employeeId,
    ...(enabledDefaults.length >= 2 ? { employeeIds: enabledDefaults } : {}),
  };
}

/**
 * Resolve the employees a thread currently contains, preserving the group's
 * order and retaining removed employee ids as readable placeholders.
 */
export function deriveThreadEmployeeParticipants(
  selection: Pick<ModelSelection, "employeeId" | "employeeIds">,
  employees: EmployeeMap,
): ThreadEmployeeParticipant[] {
  const employeeIds = [...(selection.employeeIds ?? [])];
  if (selection.employeeId !== undefined && !employeeIds.includes(selection.employeeId)) {
    employeeIds.unshift(selection.employeeId);
  }
  if (employeeIds.length === 0 && selection.employeeId !== undefined) {
    employeeIds.push(selection.employeeId);
  }

  return [...new Set(employeeIds)].map((employeeId) => {
    const employee = Object.hasOwn(employees, employeeId) ? employees[employeeId] : undefined;
    return {
      employeeId,
      displayName: employee?.displayName ?? employeeId,
      employee,
    };
  });
}

/** Exact display-name mentions in model-authored plan text. */
export function findMentionedEmployees(text: string, employees: EmployeeMap): EmployeeEntry[] {
  return deriveEmployeeEntries(employees).filter(({ employee }) => {
    const escapedName = employee.displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}_])${escapedName}(?=$|[^\\p{L}\\p{N}_])`, "iu").test(text);
  });
}

export function employeeRoutingEqual(
  left: Pick<ModelSelection, "employeeId" | "employeeIds"> | null | undefined,
  right: Pick<ModelSelection, "employeeId" | "employeeIds"> | null | undefined,
): boolean {
  if (left?.employeeId !== right?.employeeId) return false;
  const leftIds = left?.employeeIds ?? [];
  const rightIds = right?.employeeIds ?? [];
  return leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index]);
}

/**
 * Employees whose saved default provider instance is not configured here.
 *
 * These are kept, not dropped — the instance may come back with the next
 * branch or fork — but the panel marks them so a user is not left wondering
 * why their default provider is unavailable. They can still run on another
 * provider selected in the composer.
 */
export function findOrphanedEmployees(
  employees: EmployeeMap,
  configuredInstanceIds: ReadonlySet<string>,
): EmployeeEntry[] {
  return deriveEmployeeEntries(employees).filter(
    (entry) => !configuredInstanceIds.has(entry.employee.providerInstanceId),
  );
}

/**
 * Patch that adds or replaces one employee.
 *
 * `employees` is a whole-map replacement on the wire (see `settings.ts`), so
 * the caller always sends the full map with this one entry swapped in.
 */
export function buildEmployeeUpsertPatch(input: {
  readonly employees: EmployeeMap;
  readonly employeeId: EmployeeId;
  readonly employee: Employee;
}): { employees: EmployeeMap } {
  return {
    employees: {
      ...input.employees,
      [input.employeeId]: input.employee,
    },
  };
}

/** Patch that removes one employee. */
export function buildEmployeeRemovalPatch(input: {
  readonly employees: EmployeeMap;
  readonly employeeId: EmployeeId;
}): { employees: EmployeeMap } {
  const next = { ...input.employees } as Record<string, Employee>;
  delete next[input.employeeId];
  return { employees: next as EmployeeMap };
}

/**
 * Patch that renames an employee's id, preserving map order where possible.
 *
 * A rename is a delete plus an insert because the id is the key. Threads that
 * already reference the old id resolve to "no employee" and keep working —
 * that is the documented degradation, not a bug to guard against here.
 */
export function buildEmployeeRenamePatch(input: {
  readonly employees: EmployeeMap;
  readonly fromId: EmployeeId;
  readonly toId: EmployeeId;
  readonly employee: Employee;
}): { employees: EmployeeMap } {
  if (input.fromId === input.toId) {
    return buildEmployeeUpsertPatch({
      employees: input.employees,
      employeeId: input.toId,
      employee: input.employee,
    });
  }
  const removed = buildEmployeeRemovalPatch({
    employees: input.employees,
    employeeId: input.fromId,
  }).employees;
  return buildEmployeeUpsertPatch({
    employees: removed,
    employeeId: input.toId,
    employee: input.employee,
  });
}

/**
 * An employee the panel offers but does not create.
 *
 * Suggestions are inert until the user adds one: nothing here reaches settings
 * on its own. The provider instance is deliberately absent — it is bound at add
 * time to whatever the user actually has configured, so a suggestion can never
 * arrive already orphaned.
 */
export interface SuggestedEmployee {
  readonly employeeId: EmployeeId;
  readonly displayName: string;
  readonly role: string;
  readonly avatar: string;
  readonly instructions: string;
  /** One line explaining when this person is worth hiring. */
  readonly summary: string;
  /** Model override, or `undefined` to follow the thread's own selection. */
  readonly model?: string;
}

/**
 * Optional teammates offered under the roster, none of them on by default.
 *
 * These are the roles that come up often enough to be worth one click but not
 * often enough to be worth shipping to everyone — a user who never reviews
 * code should not have a reviewer sitting in their sidebar.
 */
export const SUGGESTED_EMPLOYEES: readonly SuggestedEmployee[] = [
  {
    employeeId: "reviewer" as EmployeeId,
    displayName: "Rey",
    role: "Code reviewer",
    avatar: "🔬",
    summary: "Reads a diff before it lands and names concrete defects, not style opinions.",
    instructions: [
      "You review code. You do not write it unless asked.",
      "",
      "Read the actual diff and the code around it. Report defects that would bite someone: wrong behaviour, unhandled cases, races, silent failures, security holes. For each one, say the file, the line, and the concrete input or state that makes it go wrong.",
      "Skip taste. If you cannot state how something breaks, it is not a finding.",
      "End with a plain verdict: safe to land, or the specific things that must change first.",
    ].join("\n"),
  },
  {
    employeeId: "architect" as EmployeeId,
    displayName: "Arch",
    role: "Architect",
    avatar: "📐",
    summary: "Plans a change across files before anyone starts typing.",
    instructions: [
      "You design changes; you rarely implement them.",
      "",
      "Given a goal, read enough of the codebase to know how it works today, then lay out the change: which files, in what order, and what each step must not break. Name the trade-off you chose and the one you rejected.",
      "Prefer the approach that fits the code that already exists over the one that would be nicer on a blank page.",
      "Hand the plan back with enough detail that someone else can execute it without re-deriving your reasoning.",
    ].join("\n"),
  },
  {
    employeeId: "designer" as EmployeeId,
    displayName: "Dee",
    role: "Frontend & design",
    avatar: "🎨",
    summary:
      "Owns UI work — layout, states, spacing, and how a screen behaves when things go wrong.",
    instructions: [
      "You own the interface.",
      "",
      "Match the components, tokens, and spacing the codebase already uses instead of inventing a parallel style. Cover the states that get forgotten: empty, loading, error, long text, narrow viewport, dark mode.",
      "When you change something visual, say what it looks like now versus before, and how you checked.",
    ].join("\n"),
  },
  {
    employeeId: "writer" as EmployeeId,
    displayName: "Wren",
    role: "Docs & release notes",
    avatar: "✍️",
    summary: "Writes the docs, changelogs, and commit messages nobody else wants to write.",
    instructions: [
      "You write the prose around the code: docs, release notes, commit and PR text.",
      "",
      "Read the change before describing it — never write from the title alone. Say what changed and why it matters to the reader, in their words, not the repo's internal vocabulary.",
      "Match the voice of the surrounding docs. Short sentences. No marketing.",
    ].join("\n"),
  },
  {
    employeeId: "ops" as EmployeeId,
    displayName: "Ops",
    role: "Build & release",
    avatar: "🚢",
    summary: "Handles CI, builds, and releases — the parts that fail at 2am.",
    instructions: [
      "You own build, CI, and release plumbing.",
      "",
      "Before changing a workflow or build script, read what it currently does and what depends on it. Say explicitly what a failure of your change would look like and how it would be rolled back.",
      "Never disable a check to make a build green. Fix the cause or report it.",
    ].join("\n"),
  },
];

/**
 * Suggestions the user has not hired yet.
 *
 * Filtered by id: once an id is taken, the suggestion disappears rather than
 * offering to overwrite a person the user has since customized.
 */
export function deriveAvailableSuggestions(
  employees: EmployeeMap,
  suggestions: readonly SuggestedEmployee[] = SUGGESTED_EMPLOYEES,
): SuggestedEmployee[] {
  return suggestions.filter((suggestion) => !Object.hasOwn(employees, suggestion.employeeId));
}

/**
 * Patch that hires one suggested employee with a configured fallback provider.
 */
export function buildSuggestedEmployeePatch(input: {
  readonly employees: EmployeeMap;
  readonly suggestion: SuggestedEmployee;
  readonly providerInstanceId: ProviderInstanceId;
}): { employees: EmployeeMap } {
  const { suggestion } = input;
  return buildEmployeeUpsertPatch({
    employees: input.employees,
    employeeId: suggestion.employeeId,
    employee: {
      displayName: suggestion.displayName,
      role: suggestion.role,
      avatar: suggestion.avatar,
      instructions: suggestion.instructions,
      providerInstanceId: input.providerInstanceId,
      enabled: true,
      ...(suggestion.model !== undefined ? { model: suggestion.model } : {}),
    } as Employee,
  });
}

/** Two-character fallback shown when an employee has no avatar glyph. */
export function employeeInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return [...words[0]!].slice(0, 2).join("").toUpperCase();
  return `${[...words[0]!][0] ?? ""}${[...words[words.length - 1]!][0] ?? ""}`.toUpperCase();
}

/** Employees with the same saved fallback provider, for grouped presentation. */
export function employeesForInstance(
  employees: EmployeeMap,
  instanceId: ProviderInstanceId,
): EmployeeEntry[] {
  return deriveEmployeeEntries(employees).filter(
    (entry) => entry.employee.providerInstanceId === instanceId,
  );
}
