/**
 * Guest links — this client's own socket into a friend's environment.
 *
 * A friend's environment is not an entry in the connection registry and must not
 * become one. The registry's supervisor bootstraps every connection by reading
 * server config, which needs `orchestration:read`; a friend session carries only
 * `friend:participate`, so that handshake would be refused and the connection
 * would sit permanently blocked. Worse, registering it would make somebody
 * else's machine look like an environment of ours in every environment picker.
 *
 * So guest links get their own tiny pool. One socket per friend, reference
 * counted, kept alive briefly after the last reader lets go so that flipping
 * between shared chats does not reconnect each time.
 */
import { WS_METHODS, type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";

import { resolveRemoteWebSocketConnectionUrl } from "../authorization/remote.ts";
import { BearerConnectionTarget, ConnectionTransientError } from "../connection/model.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import { RpcSessionFactory, layer as rpcSessionLayer } from "../rpc/session.ts";

/** How long a link stays warm after its last reader releases it. */
const IDLE_LINGER = Duration.seconds(20);

export interface FriendLinkCredential {
  readonly friendId: string;
  readonly environmentId: EnvironmentId;
  readonly httpBaseUrl: string;
  readonly accessToken: string;
}

/**
 * Guest environments are reached over the same scheme they were paired on. A
 * friend code carrying `http://` is a LAN or tunnel address, and silently
 * upgrading it would break the connection rather than secure it.
 */
export function friendWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

const transient = (detail: string) =>
  new ConnectionTransientError({ reason: "remote-unavailable", detail });

interface PooledLink {
  readonly client: WsRpcProtocolClient;
  readonly scope: Scope.Closeable;
  readonly credentialFingerprint: string;
  readers: number;
  reaper: Fiber.Fiber<void> | null;
}

export class FriendLinkPool extends Context.Service<
  FriendLinkPool,
  {
    /**
     * Runs `use` against a live guest client, holding the link open for the
     * duration. The link is shared with any other reader of the same friend.
     */
    readonly use: <A, E>(
      credential: FriendLinkCredential,
      use: (client: WsRpcProtocolClient) => Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | ConnectionTransientError>;
    /** Same sharing rules, for a subscription that stays open. */
    readonly stream: <A, E>(
      credential: FriendLinkCredential,
      use: (client: WsRpcProtocolClient) => Stream.Stream<A, E>,
    ) => Stream.Stream<A, E | ConnectionTransientError>;
  }
>()("@t3tools/client-runtime/friends/link/FriendLinkPool") {}

export const make = Effect.gen(function* () {
  const sessions = yield* RpcSessionFactory;
  // Captured once so the pool's own API stays free of an HTTP requirement that
  // every caller would otherwise have to thread through.
  const httpClient = yield* HttpClient.HttpClient;
  const links = yield* Ref.make(new Map<string, PooledLink>());

  const open = (credential: FriendLinkCredential) =>
    Effect.gen(function* () {
      const socketUrl = yield* resolveRemoteWebSocketConnectionUrl({
        wsBaseUrl: friendWebSocketBaseUrl(credential.httpBaseUrl),
        httpBaseUrl: credential.httpBaseUrl,
        bearerToken: credential.accessToken,
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(() =>
          transient(
            `Could not reach ${credential.httpBaseUrl}. They may be offline or on another network.`,
          ),
        ),
      );
      const scope = yield* Scope.make();
      const session = yield* sessions
        .connect({
          environmentId: credential.environmentId,
          label: credential.httpBaseUrl,
          httpBaseUrl: credential.httpBaseUrl,
          socketUrl,
          httpAuthorization: { _tag: "Bearer", token: credential.accessToken },
          // Shaped as a bearer target because that is what it is. It is never
          // persisted or registered, so it cannot show up as an environment.
          target: new BearerConnectionTarget({
            environmentId: credential.environmentId,
            label: credential.httpBaseUrl,
            connectionId: `friend:${credential.friendId}`,
          }),
        })
        .pipe(
          Scope.provide(scope),
          Effect.tapCause(() => Scope.close(scope, Exit.void)),
          Effect.mapError((error) => transient(error.detail)),
        );
      return {
        client: session.client,
        scope,
        credentialFingerprint: credential.accessToken,
        readers: 0,
        reaper: null,
      } satisfies PooledLink;
    });

  const closeLink = (friendId: string, link: PooledLink) =>
    Ref.update(links, (current) => {
      const next = new Map(current);
      if (next.get(friendId) === link) {
        next.delete(friendId);
      }
      return next;
    }).pipe(Effect.andThen(Scope.close(link.scope, Exit.void)), Effect.ignore);

  const acquire = (credential: FriendLinkCredential) =>
    Effect.gen(function* () {
      const current = (yield* Ref.get(links)).get(credential.friendId);
      // A rotated credential means the pooled socket is authenticated as
      // somebody we no longer are; drop it rather than reuse it.
      if (current !== undefined && current.credentialFingerprint === credential.accessToken) {
        if (current.reaper !== null) {
          yield* Fiber.interrupt(current.reaper);
          current.reaper = null;
        }
        current.readers += 1;
        return current;
      }
      if (current !== undefined) {
        yield* closeLink(credential.friendId, current);
      }
      const link = yield* open(credential);
      link.readers = 1;
      yield* Ref.update(links, (existing) => {
        const next = new Map(existing);
        next.set(credential.friendId, link);
        return next;
      });
      return link;
    });

  const release = (credential: FriendLinkCredential, link: PooledLink) =>
    Effect.gen(function* () {
      link.readers -= 1;
      if (link.readers > 0) {
        return;
      }
      // Linger, so switching between two shared chats on the same friend does
      // not tear down and rebuild the socket in between.
      link.reaper = yield* Effect.forkDetach(
        Effect.sleep(IDLE_LINGER).pipe(
          Effect.andThen(link.readers === 0 ? closeLink(credential.friendId, link) : Effect.void),
        ),
      );
    });

  const use: FriendLinkPool["Service"]["use"] = <A, E>(
    credential: FriendLinkCredential,
    body: (client: WsRpcProtocolClient) => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | ConnectionTransientError> =>
    Effect.acquireUseRelease(
      acquire(credential),
      (link) => body(link.client),
      (link) => release(credential, link),
    );

  const stream: FriendLinkPool["Service"]["stream"] = <A, E>(
    credential: FriendLinkCredential,
    body: (client: WsRpcProtocolClient) => Stream.Stream<A, E>,
  ): Stream.Stream<A, E | ConnectionTransientError> =>
    // `unwrap` drops Scope from the result, which ties the acquired link to the
    // lifetime of the stream itself.
    Stream.unwrap(
      Effect.acquireRelease(acquire(credential), (link) => release(credential, link)).pipe(
        Effect.map((link) => body(link.client)),
      ),
    );

  return { use, stream } satisfies FriendLinkPool["Service"];
});

export const layer = Layer.effect(FriendLinkPool, make);

/**
 * The pool plus the RPC session factory it needs. Clients compose this beside
 * `Connection.layer` rather than inside it: guest links are deliberately not
 * part of the connection registry.
 */
export const layerWithSession = layer.pipe(Layer.provide(rpcSessionLayer));

// ---------------------------------------------------------------------------
// Guest calls
// ---------------------------------------------------------------------------

export const announceToFriend = (
  pool: FriendLinkPool["Service"],
  credential: FriendLinkCredential,
  input: Parameters<WsRpcProtocolClient[typeof WS_METHODS.friendsGuestAnnounce]>[0],
) => pool.use(credential, (client) => client[WS_METHODS.friendsGuestAnnounce](input));

export const sharedThreadsOfFriend = (
  pool: FriendLinkPool["Service"],
  credential: FriendLinkCredential,
) => pool.stream(credential, (client) => client[WS_METHODS.friendsGuestSubscribeThreads]({}));

export const sharedThreadOfFriend = (
  pool: FriendLinkPool["Service"],
  credential: FriendLinkCredential,
  threadId: ThreadId,
) =>
  pool.stream(credential, (client) => client[WS_METHODS.friendsGuestSubscribeThread]({ threadId }));

export const postToSharedThread = (
  pool: FriendLinkPool["Service"],
  credential: FriendLinkCredential,
  input: { readonly threadId: ThreadId; readonly text: string },
) => pool.use(credential, (client) => client[WS_METHODS.friendsGuestPostMessage](input));

export const partyBeaconToFriend = (
  pool: FriendLinkPool["Service"],
  credential: FriendLinkCredential,
  input: Parameters<WsRpcProtocolClient[typeof WS_METHODS.friendsGuestPartyBeacon]>[0],
) => pool.use(credential, (client) => client[WS_METHODS.friendsGuestPartyBeacon](input));
