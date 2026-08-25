import { createFriendsEnvironmentAtoms } from "@t3tools/client-runtime/state/friends";
import { createSharedThreadAtoms } from "@t3tools/client-runtime/state/sharedThreads";

import { connectionAtomRuntime } from "../connection/runtime";

/** Your own friends list, shares, and the mutations that change them. */
export const friendsEnvironment = createFriendsEnvironmentAtoms(connectionAtomRuntime);

/** Chats your friends have shared with you, read over a guest link. */
export const sharedThreads = createSharedThreadAtoms(connectionAtomRuntime);
