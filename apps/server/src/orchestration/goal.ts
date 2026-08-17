import type { ThreadGoal } from "@t3tools/contracts";

const ACTIVE_GOAL_HEADER = "[Persistent thread goal]";

/** Add the active thread objective to each provider turn without changing the user's message. */
export function applyPersistentThreadGoal(
  messageText: string,
  goal: ThreadGoal | null | undefined,
): string {
  if (goal?.status !== "active") {
    return messageText;
  }

  return `${ACTIVE_GOAL_HEADER}\nObjective: ${goal.objective}\nContinue working toward this objective unless the user explicitly changes or clears it.\n\n${messageText}`;
}
