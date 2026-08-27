import * as NodeOS from "node:os";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { deprioritizeAgentProcess } from "./agentPriority.ts";

describe("deprioritizeAgentProcess", () => {
  it.effect("moves the process to below-normal priority", () =>
    Effect.gen(function* () {
      const calls: Array<{ pid: number; priority: number }> = [];
      yield* deprioritizeAgentProcess(4242, (pid, priority) => {
        calls.push({ pid, priority });
      });
      expect(calls).toEqual([
        { pid: 4242, priority: NodeOS.constants.priority.PRIORITY_BELOW_NORMAL },
      ]);
    }),
  );

  it.effect("treats a refused or vanished process as fine", () =>
    Effect.gen(function* () {
      // A PID that exited between spawn and this call throws ESRCH; a locked-
      // down platform throws EPERM. Neither may fail the agent session.
      yield* deprioritizeAgentProcess(4242, () => {
        throw new Error("EPERM");
      });
      expect(true).toBe(true);
    }),
  );
});
