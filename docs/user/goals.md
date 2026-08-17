# Thread goals

Use `/goal` to keep one objective attached to a thread. While the goal is active, ML Code includes it with each new provider turn so the agent can keep working toward it across follow-up messages.

## Commands

- `/goal <objective>` sets a goal or replaces the current objective.
- `/goal` shows the current goal and whether it is active or paused.
- `/goal pause` keeps the goal saved but stops including it in provider turns.
- `/goal resume` starts including a paused goal again.
- `/goal clear` removes the goal.

The commands are available in the web, desktop, and mobile composers. A thread must be saved before its goal can be changed.

## Provider behavior

Thread goals are provider-neutral. ML Code adds an active objective to the prompt sent to the selected provider; paused and cleared goals are not sent. Switching providers does not remove the saved goal.

This is intentionally a smaller feature than Codex's native goal protocol. ML Code does not call Codex `thread/goal/set`, `thread/goal/get`, or `thread/goal/clear`, and it does not track a goal token budget, tokens used, or elapsed time. `/goal` persists an objective and its active or paused state only.
