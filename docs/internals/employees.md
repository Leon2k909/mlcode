# Employees

> For maintainers. Using T3 Code? See [docs/user](../user/).

An **employee** is a named persona that does work: a display name, an avatar, a role, and a block
of standing instructions, bound to one provider instance.

Employees sit _above_ the provider layer. A provider instance answers "which CLI, whose
credentials"; an employee answers "who is doing this". Several employees can share one instance —
three teammates on a single Claude subscription — and one employee never spans two.

## Data model

The orchestration engine is event-sourced, so a new first-class entity would normally mean a full
set of employee CRUD commands, events, and projections. Employees deliberately avoid that.

An employee is carried on [`ModelSelection.employeeId`][contracts-orchestration]. `ModelSelection`
is already the per-thread "who does the work" selector: it is persisted on the thread, it is sent
on `thread.create` and on every `thread.turn.start`, and it already rides both
`ProviderSessionStartInput` and `ProviderSendTurnInput`. Adding an optional field there routes the
persona everywhere it needs to go.

`ModelSelection.employeeIds` is present only for a group chat and contains its allowed
participants. `employeeId` remains the current speaker. A one-employee private chat therefore has
only `employeeId`; a group carries both fields.

Messages also carry an optional `employeeId`. It is copied through the existing
`thread.message-sent` event and persisted on `projection_thread_messages`, rather than introducing
an employee-message event. This attribution lets every client render who said what and survives a
server restart.

The field is optional forever. Threads predating employees, and threads run by nobody in
particular, carry no id.

## Configuration

Employees live in `ServerSettings.employees`, keyed by `EmployeeId` — the same slug rules as
`ProviderInstanceId`, branded separately so the two cannot be confused. Like `providerInstances`,
the patch shape is a whole-map replacement: the map is small, and a half-merged persona is worse
than a replaced one.

Standing instructions are capped at `EMPLOYEE_INSTRUCTIONS_MAX_CHARS` (8,000). An unbounded persona
would eat the provider's context before the user's actual request reached it.

## Forward/backward compatibility

Same invariant as [providerInstance.ts][contracts-instance], for the same reasons. An employee may
name a `providerInstanceId` this build does not configure, and a thread may name an `employeeId`
that no longer exists — forks, deleted records, rolled-back branches. Parsing always succeeds.

`resolveEmployee` collapses "unknown id" and "disabled employee" into one `undefined`, and turn
dispatch runs the turn without a persona rather than failing it. **A missing persona must never
cost a user their turn.**

## When instructions are injected

Instructions open an employee's provider conversation, not every message in it. Provider CLIs keep
session context, so repeating the persona each turn would spend context on boilerplate the model
already has. A different employee taking ownership is introduced even when a compatible provider
session stays warm.

The trigger is a provider context reset, which
[`ensureSessionForThread`][reactor] reports back to the turn builder as `contextReset`:

| Session outcome                  | `contextReset` | Persona injected                                           |
| -------------------------------- | -------------- | ---------------------------------------------------------- |
| Reused, same employee            | `false`        | no                                                         |
| Reused, different employee       | `false`        | yes                                                        |
| Restarted **with** resume cursor | `false`        | no — prior conversation rehydrates, persona is still in it |
| Restarted **without** cursor     | `true`         | yes                                                        |
| Started fresh                    | `true`         | yes                                                        |

Composition itself is pure string work in [`EmployeeInstructions.ts`][instructions], with no Effect
context — orchestration stays pure and the persona block stays trivially testable. The preamble is
wrapped in an `<employee>` block, matching the existing provider instruction convention
(`<collaboration_mode>`, `<runtime_info>`). Framing tags occurring inside a persona's own text are
neutralized so a persona cannot close its own block and spill into the message body.

Because injection happens at `buildSendTurnRequestForThread` — the single place a turn's text is
composed — employees work across all five drivers with no adapter changes.

## Group handoffs

The teamwork preamble lists only the selected `employeeIds` and teaches the model one narrow
protocol:

```text
<handoff to="reviewer">Please check the auth change.</handoff>
```

[`ProviderRuntimeIngestion.ts`][ingestion] buffers the assistant text for the turn, validates the
first handoff against the configured and enabled group members, updates the thread's current
`ModelSelection`, and dispatches a normal `thread.turn.start` for the recipient. The synthetic user
message is attributed to the outgoing employee, so it appears as employee-to-employee speech in the
timeline.

The command reactor treats only this explicit group transition as permission to cross provider
drivers. A cross-driver handoff starts a fresh provider session without the previous driver's resume
cursor; ordinary provider changes in an established thread remain forbidden. Both employees still
share the thread and workspace history persisted by T3 Code.

Only one recipient can take ownership at a time, and a chain stops after eight handoffs without a
human message. Invalid, disabled, self, out-of-group, and empty handoffs become visible activities
instead of disappearing silently.

[contracts-orchestration]: ../../packages/contracts/src/orchestration.ts
[contracts-instance]: ../../packages/contracts/src/providerInstance.ts
[instructions]: ../../apps/server/src/employee/EmployeeInstructions.ts
[reactor]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[ingestion]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
