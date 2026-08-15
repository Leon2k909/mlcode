/**
 * Employee contracts.
 *
 * An **employee** is a named persona that does work in T3 Code: a display
 * name, an avatar, a role, and a block of standing instructions, with a saved
 * default provider instance. Employees sit *above* the provider layer —
 * several employees can share a single provider instance (three teammates on
 * one Claude subscription), and a chat can run any employee on any configured
 * provider. The saved instance is the fallback for chats without a provider
 * selection, not a lock on the persona.
 *
 * Employees deliberately introduce no employee-specific CRUD commands or
 * events. The current speaker is carried on `ModelSelection.employeeId`, and
 * an optional `employeeIds` list scopes a group chat. Message attribution
 * uses the existing message commands and events. See `orchestration.ts`.
 *
 * Forward/backward compatibility invariant
 * ----------------------------------------
 * Same rule as `providerInstance.ts`, for the same reasons: settings and
 * persisted thread state routinely reference records this build does not
 * have. An employee may name a `providerInstanceId` that is not configured
 * (deleted instance, fork, rolled-back branch), and a thread may name an
 * `employeeId` that no longer exists. Parsing must always succeed; the
 * runtime resolves the reference and degrades to "no employee" rather than
 * failing the turn. A missing persona must never cost a user their turn.
 *
 * @module employee
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const EMPLOYEE_SLUG_MAX_CHARS = 64;
/**
 * Slug pattern shared with provider instances — letters, digits, dashes,
 * underscores, leading letter. Employee ids appear as object keys in settings
 * and as log/telemetry fields, so the JS-identifier-friendly shape carries
 * over unchanged.
 */
const EMPLOYEE_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * Upper bound on standing instructions. Instructions are prepended to the
 * first turn of a session, so an unbounded persona would eat the provider's
 * context before the user's actual request reached it. 8k characters is
 * roughly two dense pages — far more than a role description needs, and small
 * enough that it cannot crowd out a turn.
 */
export const EMPLOYEE_INSTRUCTIONS_MAX_CHARS = 8_000;
const EMPLOYEE_DISPLAY_NAME_MAX_CHARS = 64;
const EMPLOYEE_ROLE_MAX_CHARS = 128;
/** Wide enough for any single grapheme cluster, including ZWJ emoji sequences. */
const EMPLOYEE_AVATAR_MAX_CHARS = 16;

/**
 * `EmployeeId` — user-defined routing key for one configured employee.
 * Branded separately from `ProviderInstanceId` so the type system cannot
 * confuse a persona with the provider that runs it.
 */
export const EmployeeId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(EMPLOYEE_SLUG_MAX_CHARS),
  Schema.isPattern(EMPLOYEE_SLUG_PATTERN),
).pipe(Schema.brand("EmployeeId"));
export type EmployeeId = typeof EmployeeId.Type;

const isEmployeeIdValue = Schema.is(EmployeeId);
export const isEmployeeId = (value: unknown): value is EmployeeId => isEmployeeIdValue(value);

/**
 * One configured employee.
 *
 * `providerInstanceId` is accepted as any well-formed slug — it is not
 * validated against the configured instance map (see the module docs). The
 * runtime resolves it and reports an unavailable employee rather than
 * refusing to parse settings.
 */
export const Employee = Schema.Struct({
  displayName: TrimmedNonEmptyString.check(Schema.isMaxLength(EMPLOYEE_DISPLAY_NAME_MAX_CHARS)),
  /** Default/fallback provider instance; the chat may explicitly choose another. */
  providerInstanceId: ProviderInstanceId,
  /** Short human title, e.g. "Frontend engineer". Presentation only. */
  role: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(EMPLOYEE_ROLE_MAX_CHARS))),
  /** Standing instructions prepended to the first turn of each session. */
  instructions: TrimmedString.check(Schema.isMaxLength(EMPLOYEE_INSTRUCTIONS_MAX_CHARS)).pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
  ),
  /** Emoji or short glyph shown wherever the employee is listed. */
  avatar: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(EMPLOYEE_AVATAR_MAX_CHARS)),
  ),
  accentColor: Schema.optional(TrimmedNonEmptyString),
  /** Model override on the default provider. Other providers follow the thread selection. */
  model: Schema.optional(TrimmedNonEmptyString),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
});
export type Employee = typeof Employee.Type;

/**
 * Map shape for `ServerSettings.employees`. Keyed by `EmployeeId`.
 */
export const EmployeeMap = Schema.Record(EmployeeId, Employee);
export type EmployeeMap = typeof EmployeeMap.Type;

/**
 * Provider instance the default roster uses as its fallback.
 *
 * Matches the instance id the default model selection already assumes
 * (`settings.ts`), so a fresh install has a working team without the user
 * configuring anything first. If that instance is absent the employees stay
 * in the map and report as unavailable — the documented degradation.
 */
const DEFAULT_ROSTER_INSTANCE_ID = "codex";

/** Model the default workers run on. */
const DEFAULT_WORKER_MODEL = "gpt-5.6-luna";
/** Model the default decision-maker runs on. */
const DEFAULT_LEAD_MODEL = "gpt-5.6-sol";

const workerInstructions = (focus: string, workflow: string): string =>
  [
    `You are a worker on a small team. Your focus is ${focus}.`,
    "",
    "Do the work you are given, end to end, and report what you actually did — files touched, commands run, what you verified and what you did not. Never claim something works because it should.",
    "If the task is bigger than your focus, do your part in full and hand the next step to the appropriate teammate or CEO rather than guessing at someone else's area.",
    "Prefer reading the code over assuming it. Keep changes scoped to what was asked.",
    workflow,
  ].join("\n");

/**
 * Default employee roster shipped with a fresh install.
 *
 * One lead who decides and delegates, plus three workers in research,
 * implementation, and verification lanes. Seeded as the decoding default for
 * `ServerSettings.employees`
 * so a new user has a team on first launch; an existing settings file that
 * already carries an `employees` map is left exactly as it is, including an
 * empty one (a user who deleted the roster does not get it back).
 */
export const DEFAULT_EMPLOYEES: EmployeeMap = Schema.decodeSync(EmployeeMap)({
  ceo: {
    displayName: "Ceo",
    role: "Chief executive — decides and delegates",
    avatar: "🧠",
    providerInstanceId: DEFAULT_ROSTER_INSTANCE_ID,
    model: DEFAULT_LEAD_MODEL,
    enabled: true,
    instructions: [
      "You are the routing CEO of this team. You own the decision, not the typing.",
      "",
      "How you work:",
      "1. Read each request, classify the work, and choose the most efficient teammate for the next step.",
      "2. Beta researches and traces the codebase, Alpha implements changes, and Gamma verifies tests, behavior, and releases.",
      "3. For non-trivial work, use this handoff chain: Beta researches, Alpha implements, Gamma verifies, and then you review the evidence and give the final answer. Skip Beta only when research adds no value; never skip Gamma after a code change.",
      "4. Delegate before doing the work yourself. Hand off one piece at a time with a concrete brief, and do not treat Alpha's completion summary as final until Gamma has verified it.",
      "5. When work comes back, inspect the evidence and choose the next teammate or finish. Use Beta, Alpha, and Gamma only when each lane adds value; skip unnecessary lanes.",
      "6. You make the final call and give the user the final answer. Never end a thread with 'a teammate will handle it' — either it is done, or you say plainly what is left.",
      "",
      "In a group chat, your first response is a delegation gate: before analysis, explanation, or any tool call, choose one worker and emit exactly one handoff. You are routing-only: do not inspect files, run commands, edit code, test, or publish releases yourself. If unsure, hand research to Beta; for an obvious scoped code change, hand implementation to Alpha; for an existing change, hand verification to Gamma. Never say 'I'll trace...' or do the work yourself. You may answer a genuinely simple question yourself when no tools are needed. Never hand off to yourself or claim another employee worked unless you actually transferred the thread to them.",
    ].join("\n"),
  },
  worker_alpha: {
    displayName: "Alpha",
    role: "Worker — implementation",
    avatar: "⚙️",
    providerInstanceId: DEFAULT_ROSTER_INSTANCE_ID,
    model: DEFAULT_WORKER_MODEL,
    enabled: true,
    instructions: workerInstructions(
      "writing and changing code",
      'After implementing a change, run focused checks and hand it to Gamma for verification with <handoff to="worker_gamma">what changed and what to verify</handoff>. Do not call a code change final before Gamma has checked it.',
    ),
  },
  worker_beta: {
    displayName: "Beta",
    role: "Worker — research",
    avatar: "🔎",
    providerInstanceId: DEFAULT_ROSTER_INSTANCE_ID,
    model: DEFAULT_WORKER_MODEL,
    enabled: true,
    instructions: workerInstructions(
      "finding things out — reading the codebase, tracing how something works, and reporting findings with file paths and line numbers",
      'When research is complete, hand the evidence to Alpha with <handoff to="worker_alpha">findings and the implementation brief</handoff>. Do not implement or publish unless the CEO explicitly assigns that work.',
    ),
  },
  worker_gamma: {
    displayName: "Gamma",
    role: "Worker — verification",
    avatar: "🧪",
    providerInstanceId: DEFAULT_ROSTER_INSTANCE_ID,
    model: DEFAULT_WORKER_MODEL,
    enabled: true,
    instructions: workerInstructions(
      "checking work — running tests, type checks, and lints, and reproducing what someone claims to have fixed",
      'Verify the actual change rather than trusting the worker\'s summary. If it passes, hand the evidence to the CEO with <handoff to="ceo">checks and remaining risks</handoff>; if it fails, hand concrete corrections back to Alpha with <handoff to="worker_alpha">failures and required fixes</handoff>.',
    ),
  },
});

/**
 * Resolve an employee id against the configured map.
 *
 * Returns `undefined` for an unknown id and for a disabled employee, so
 * callers get one uniform "no persona applies" answer. Turn dispatch treats
 * both the same way: run the turn without a persona rather than fail it.
 */
export const resolveEmployee = (
  employees: EmployeeMap,
  employeeId: EmployeeId | undefined,
): Employee | undefined => {
  if (employeeId === undefined) return undefined;
  // Own-property check, not a bare index: employee ids come off the wire, and
  // `constructor` or `toString` would otherwise resolve to something off the
  // prototype that is not an employee at all.
  if (!Object.hasOwn(employees, employeeId)) return undefined;
  const employee = employees[employeeId];
  if (employee === undefined || !employee.enabled) return undefined;
  return employee;
};
