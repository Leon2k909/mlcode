import type { ThreadGoal } from "@t3tools/contracts";

export type ThreadGoalCommand =
  | { readonly kind: "show" }
  | { readonly kind: "set"; readonly objective: string }
  | { readonly kind: "clear" }
  | { readonly kind: "pause" }
  | { readonly kind: "resume" };

export interface ThreadGoalFeedback {
  readonly tone: "info" | "warning" | "error";
  readonly title: string;
  readonly description: string;
}

export function parseStandaloneThreadGoalCommand(text: string): ThreadGoalCommand | null {
  const match = /^\/goal(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;

  const argument = match[1]?.trim() ?? "";
  if (argument.length === 0) return { kind: "show" };
  if (argument.toLowerCase() === "clear") return { kind: "clear" };
  if (argument.toLowerCase() === "pause") return { kind: "pause" };
  if (argument.toLowerCase() === "resume") return { kind: "resume" };
  return { kind: "set", objective: argument };
}

export async function executeThreadGoalCommand(input: {
  readonly command: ThreadGoalCommand;
  readonly currentGoal: ThreadGoal | null;
  readonly hasThread: boolean;
  readonly canPersist: boolean;
  readonly now: string;
  readonly persist: (goal: ThreadGoal | null) => Promise<string | null>;
}): Promise<ThreadGoalFeedback> {
  if (!input.hasThread) {
    return {
      tone: "warning",
      title: "No active thread",
      description: "Send a message before setting a thread goal.",
    };
  }

  if (input.command.kind === "show") {
    return {
      tone: "info",
      title: input.currentGoal ? `Goal ${input.currentGoal.status}` : "No active goal",
      description: input.currentGoal?.objective ?? "Use /goal <objective> to set one.",
    };
  }

  if (!input.canPersist) {
    return {
      tone: "warning",
      title: "Save the thread first",
      description: "Thread goals are available after the first message is saved.",
    };
  }

  if (
    (input.command.kind === "pause" || input.command.kind === "resume") &&
    input.currentGoal === null
  ) {
    return {
      tone: "warning",
      title: "No goal to update",
      description: "Set a goal with /goal <objective> first.",
    };
  }

  if (input.command.kind === "clear" && input.currentGoal === null) {
    return {
      tone: "info",
      title: "No goal to clear",
      description: "Use /goal <objective> to set one.",
    };
  }

  const nextGoal: ThreadGoal | null =
    input.command.kind === "clear"
      ? null
      : input.command.kind === "set"
        ? {
            objective: input.command.objective,
            status: "active",
            createdAt: input.currentGoal?.createdAt ?? input.now,
            updatedAt: input.now,
          }
        : input.command.kind === "pause"
          ? { ...input.currentGoal!, status: "paused", updatedAt: input.now }
          : { ...input.currentGoal!, status: "active", updatedAt: input.now };

  const failure = await input.persist(nextGoal);
  if (failure !== null) {
    return {
      tone: "error",
      title: "Goal was not updated",
      description: failure,
    };
  }

  const descriptions: Record<Exclude<ThreadGoalCommand["kind"], "show">, string> = {
    set: "The objective will be included in future turns.",
    pause: "Future turns will stop receiving the goal until you resume it.",
    resume: "Future turns will continue receiving the goal.",
    clear: "Future turns will no longer receive the goal.",
  };
  const titles: Record<Exclude<ThreadGoalCommand["kind"], "show">, string> = {
    set: "Goal set",
    pause: "Goal paused",
    resume: "Goal resumed",
    clear: "Goal cleared",
  };

  return {
    tone: "info",
    title: titles[input.command.kind],
    description: descriptions[input.command.kind],
  };
}
