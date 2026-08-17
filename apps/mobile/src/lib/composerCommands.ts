export const MOBILE_BUILT_IN_SLASH_COMMANDS = [
  {
    id: "cmd:model",
    type: "slash-command" as const,
    command: "model",
    label: "/model",
    description: "Switch model",
  },
  {
    id: "cmd:plan",
    type: "slash-command" as const,
    command: "plan",
    label: "/plan",
    description: "Switch to plan mode",
  },
  {
    id: "cmd:default",
    type: "slash-command" as const,
    command: "default",
    label: "/default",
    description: "Switch to default mode",
  },
  {
    id: "cmd:goal",
    type: "slash-command" as const,
    command: "goal",
    label: "/goal",
    description: "Set or manage the thread goal",
  },
] as const;

export function filterMobileBuiltInSlashCommands(query: string) {
  const normalizedQuery = query.toLowerCase();
  return MOBILE_BUILT_IN_SLASH_COMMANDS.filter((item) => item.command.includes(normalizedQuery));
}
