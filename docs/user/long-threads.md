# Long threads

ML Code can manage a conversation before it fills the provider's context window. Open the context indicator beside the composer and choose a **Long threads** mode:

- **Ask me** keeps the existing warning. At 50% context usage, ML Code can offer to delete eligible older messages.
- **Auto-delete** waits for the current turn and employee handoffs to finish, then removes eligible older messages once fresh provider usage reaches 75%. The next turn starts a fresh provider session with a bounded summary of retained conversation context.
- **New chat** waits for the same safe boundary, creates a linked continuation thread, and carries over the project, workspace, branch, selected provider/model/employee, permission mode, interaction mode, and active goal. It does not send a message or switch chats automatically.

Automatic modes never delete system messages or the latest four user turns. They use fresh usage reported for the current provider, so stale percentages after a restart cannot trigger an action. If a turn is running, the action is deferred instead of interrupting work.

The setting belongs to the connected environment. On mobile, expand an environment under **Settings → Environments** to change it.

If an automatic action fails, ML Code leaves the current thread intact and can try again after another fresh usage report and completed turn. You can switch back to **Ask me** at any time.
