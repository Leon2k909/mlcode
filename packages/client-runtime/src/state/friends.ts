/**
 * Owner-side friends state.
 *
 * Everything here talks to *your own* environment: the friends list, the shares
 * you have granted, and the mutations that change them. Reading a friend's
 * shared chat is a different conversation entirely — that goes over a guest link
 * (`friends/link.ts`) to their machine, not through these atoms.
 */
import { WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createFriendsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Friend mutations are serialized per environment: linking mints credentials
  // and writes rows, and two of them racing would be a confusing way to end up
  // with a half-formed link.
  const commandScheduler = createAtomCommandScheduler();
  const serialPerEnvironment = {
    mode: "serial",
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  } as const;

  return {
    snapshot: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:friends:snapshot",
      tag: WS_METHODS.friendsSubscribe,
      transform: (stream) => stream.pipe(Stream.map((event) => event.payload)),
    }),
    createInvite: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:friends:create-invite",
      tag: WS_METHODS.friendsCreateInvite,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
    redeemInvite: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:friends:redeem-invite",
      tag: WS_METHODS.friendsRedeemInvite,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
    removeFriend: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:friends:remove",
      tag: WS_METHODS.friendsRemove,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
    markAnnounced: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:friends:mark-announced",
      tag: WS_METHODS.friendsMarkAnnounced,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
    getLinkCredential: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:friends:link-credential",
      tag: WS_METHODS.friendsGetLinkCredential,
    }),
    updateProfile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:friends:update-profile",
      tag: WS_METHODS.friendsUpdateProfile,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
    shareThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:friends:share-thread",
      tag: WS_METHODS.friendsShareThread,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
    unshareThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:friends:unshare-thread",
      tag: WS_METHODS.friendsUnshareThread,
      scheduler: commandScheduler,
      concurrency: serialPerEnvironment,
    }),
  };
}
