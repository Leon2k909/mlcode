/**
 * Keeps agent compute out of the foreground's way.
 *
 * @module process/agentPriority
 */
import * as Effect from "effect/Effect";
import * as NodeOS from "node:os";

/**
 * Runs a provider agent's process below normal priority.
 *
 * The agent and every tool it spawns (children inherit the priority class on
 * Windows, and the niceness on POSIX) are throughput work: a build that takes
 * a few percent longer is imperceptible behind a stream of model tokens,
 * while a game or a call dropping frames because a test suite pegged every
 * core is very perceptible. Foreground apps win the contention; on an
 * otherwise idle machine the agent still gets everything.
 *
 * Best effort by design: a PID that already exited, or a platform that
 * refuses (EPERM under some sandboxes), leaves the process at its default
 * priority rather than failing the session.
 */
export const deprioritizeAgentProcess = (
  pid: number,
  setPriority: (pid: number, priority: number) => void = NodeOS.setPriority,
): Effect.Effect<void> =>
  Effect.sync(() => {
    try {
      setPriority(pid, NodeOS.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {
      // Priority stays default; the agent still runs.
    }
  });
