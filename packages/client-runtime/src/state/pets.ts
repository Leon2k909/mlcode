import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export function createPetEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Installing and removing both write to the same pets folder, so they run one
  // at a time per environment rather than racing over the same directory.
  const commandScheduler = createAtomCommandScheduler();
  const serialPerEnvironment = {
    mode: "serial",
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  } as const;

  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pets:list",
      tag: WS_METHODS.petsList,
      staleTimeMs: 10_000,
      idleTtlMs: 5 * 60_000,
    }),
    gallery: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pets:gallery",
      tag: WS_METHODS.petsBrowseGallery,
      // The gallery is somebody else's server and its own listing is cached for
      // a minute, so re-asking more often than this buys nothing.
      staleTimeMs: 60_000,
      idleTtlMs: 5 * 60_000,
    }),
    install: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pets:install",
      tag: WS_METHODS.petsInstall,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
    uninstall: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:pets:uninstall",
      tag: WS_METHODS.petsUninstall,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
  };
}
