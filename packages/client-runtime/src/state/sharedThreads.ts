/**
 * Guest-side state: chats a friend has shared with you.
 *
 * These atoms straddle two machines. The credential comes from *your* server
 * (`friends.getLinkCredential`, an ordinary environment RPC), and the data comes
 * from *theirs* over a guest link. That is why nothing here goes through the
 * environment registry: the friend's server is not an environment of yours, and
 * the only thing you may ask it for is a chat it has explicitly shared.
 */
import {
  WS_METHODS,
  type EnvironmentId,
  type FriendId,
  type FriendProfile,
  type SharedThreadStreamEvent,
  type SharedThreadSummary,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Atom } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { FriendLinkPool, type FriendLinkCredential } from "../friends/link.ts";
import { request } from "../rpc/client.ts";
import { createRuntimeCommand, runInEnvironment } from "./runtime.ts";

/**
 * A friend closing their laptop is the normal case, not an error worth showing
 * as a dead pane, so guest streams reconnect on their own. Fixed rather than
 * backing off: a link that is down is almost always down because the other
 * machine is asleep, and we want the room to come back promptly when it wakes,
 * not after whatever delay an exponential had wandered up to.
 */
const RECONNECT = Schedule.spaced("5 seconds");

/**
 * Anything that stops us reaching a friend's shared chat, flattened into one
 * type. The causes are genuinely varied — our own server refusing the
 * credential, their machine being asleep, the socket dropping mid-stream — but
 * every one of them means the same thing to a reader, and the stream retries
 * regardless of which it was.
 */
export class SharedThreadUnavailableError extends Schema.TaggedErrorClass<SharedThreadUnavailableError>()(
  "SharedThreadUnavailableError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

const unavailable = (cause: unknown) =>
  new SharedThreadUnavailableError({
    detail: cause instanceof Error ? cause.message : "That chat is not reachable right now.",
  });

// Atom families are keyed by string and ids are opaque, so join on a control
// character that cannot occur inside one.
const KEY_SEPARATOR = "\u0001";

export interface SharedThreadTarget {
  /** Our own environment — the one holding the friend link. */
  readonly environmentId: EnvironmentId;
  readonly friendId: FriendId;
  readonly friendEnvironmentId: EnvironmentId;
}

const targetKey = (target: SharedThreadTarget) =>
  [target.environmentId, target.friendId, target.friendEnvironmentId].join(KEY_SEPARATOR);

const parseTargetKey = (parts: ReadonlyArray<string>): SharedThreadTarget => ({
  environmentId: (parts[0] ?? "") as EnvironmentId,
  friendId: (parts[1] ?? "") as FriendId,
  friendEnvironmentId: (parts[2] ?? "") as EnvironmentId,
});

const credentialFor = (
  target: SharedThreadTarget,
): Effect.Effect<FriendLinkCredential, SharedThreadUnavailableError, EnvironmentRegistry> =>
  runInEnvironment(
    target.environmentId,
    request(WS_METHODS.friendsGetLinkCredential, { friendId: target.friendId }),
  ).pipe(
    Effect.map((credential) => ({
      friendId: target.friendId,
      environmentId: target.friendEnvironmentId,
      httpBaseUrl: credential.httpBaseUrl,
      accessToken: credential.accessToken,
    })),
    Effect.mapError(unavailable),
  );

export function createSharedThreadAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | FriendLinkPool | R, E>,
) {
  const sharedThreadsStream = (
    target: SharedThreadTarget,
  ): Stream.Stream<
    ReadonlyArray<SharedThreadSummary>,
    SharedThreadUnavailableError,
    EnvironmentRegistry | FriendLinkPool
  > =>
    Stream.unwrap(
      Effect.gen(function* () {
        const pool = yield* FriendLinkPool;
        const credential = yield* credentialFor(target);
        return pool
          .stream(credential, (client) => client[WS_METHODS.friendsGuestSubscribeThreads]({}))
          .pipe(Stream.map((event) => event.payload.threads));
      }),
    ).pipe(Stream.mapError(unavailable), Stream.retry(RECONNECT));

  const roomStream = (
    target: SharedThreadTarget,
    threadId: ThreadId,
  ): Stream.Stream<
    SharedThreadStreamEvent,
    SharedThreadUnavailableError,
    EnvironmentRegistry | FriendLinkPool
  > =>
    Stream.unwrap(
      Effect.gen(function* () {
        const pool = yield* FriendLinkPool;
        const credential = yield* credentialFor(target);
        return pool.stream(credential, (client) =>
          client[WS_METHODS.friendsGuestSubscribeThread]({ threadId }),
        );
      }),
    ).pipe(Stream.mapError(unavailable), Stream.retry(RECONNECT));

  const listFamily = Atom.family((key: string) =>
    runtime
      .atom(sharedThreadsStream(parseTargetKey(key.split(KEY_SEPARATOR))))
      .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`friends:shared-threads:${key}`)),
  );

  const roomFamily = Atom.family((key: string) => {
    const parts = key.split(KEY_SEPARATOR);
    return runtime
      .atom(roomStream(parseTargetKey(parts), (parts[3] ?? "") as ThreadId))
      .pipe(Atom.setIdleTTL(30_000), Atom.withLabel(`friends:shared-thread:${key}`));
  });

  return {
    /** Every chat this friend currently shares with us. */
    list: (target: SharedThreadTarget) => listFamily(targetKey(target)),
    /** Live view of one shared chat. */
    room: (target: SharedThreadTarget & { readonly threadId: ThreadId }) =>
      roomFamily(`${targetKey(target)}${KEY_SEPARATOR}${target.threadId}`),
    /**
     * Delivers the reciprocal friend code our server minted, which is what turns
     * a one-way link into a mutual one. Runs from the client because the client
     * is the only side with a socket to them.
     */
    announce: createRuntimeCommand(runtime, {
      label: "friends:announce",
      execute: (
        input: SharedThreadTarget & {
          readonly profile: FriendProfile;
          readonly reciprocalCode: string;
        },
      ) =>
        Effect.gen(function* () {
          const pool = yield* FriendLinkPool;
          const credential = yield* credentialFor(input);
          return yield* pool.use(credential, (client) =>
            client[WS_METHODS.friendsGuestAnnounce]({
              profile: input.profile,
              reciprocalCode: input.reciprocalCode,
            }),
          );
        }),
    }),
    post: createRuntimeCommand(runtime, {
      label: "friends:shared-thread:post",
      execute: (
        input: SharedThreadTarget & { readonly threadId: ThreadId; readonly text: string },
      ) =>
        Effect.gen(function* () {
          const pool = yield* FriendLinkPool;
          const credential = yield* credentialFor(input);
          return yield* pool.use(credential, (client) =>
            client[WS_METHODS.friendsGuestPostMessage]({
              threadId: input.threadId,
              text: input.text,
            }),
          );
        }),
    }),
  };
}
