import { describe, expect, it } from "@effect/vitest";
import {
  filterMobileBuiltInSlashCommands,
  MOBILE_BUILT_IN_SLASH_COMMANDS,
} from "./composerCommands.ts";

describe("mobile composer commands", () => {
  it("offers the provider-neutral goal command", () => {
    expect(MOBILE_BUILT_IN_SLASH_COMMANDS).toContainEqual({
      id: "cmd:goal",
      type: "slash-command",
      command: "goal",
      label: "/goal",
      description: "Set or manage the thread goal",
    });
    expect(filterMobileBuiltInSlashCommands("go")).toEqual([
      expect.objectContaining({ command: "goal" }),
    ]);
  });
});
