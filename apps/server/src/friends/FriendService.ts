/**
 * FriendService — linking two environments and running the shared room.
 *
 * ## How a link forms
 *
 * Alice mints a friend code: a one-time bootstrap credential scoped to
 * `friend:participate`, plus her endpoint and profile, base64url-packed. Bob
 * pastes it, and Bob's server exchanges the credential at Alice's `/oauth/token`
 * for a long-lived friend session. That is the outbound half of Bob's link.
 *
 * The inbound half is the mirror image, and Bob's server mints it during the
 * same redemption: a reciprocal code stored as `announceCode`. Bob's *client*
 * carries it to Alice on its next guest session (`guestAnnounce`), because the
 * client already holds a socket to Alice and the server would otherwise need to
 * become a WebSocket client purely to say hello. Alice redeems that code over
 * plain HTTP and the link is mutual.
 *
 * ## What a friend can reach
 *
 * A friend session carries one scope and nothing else, so every ordinary RPC
 * refuses it at the door. The guest methods here are the entire surface, and
 * each resolves the caller's session subject back to a friend row and then to a
 * share row for the specific thread named. No share, no access — there is no
 * path that reads a thread without passing `requireShare`.
 *
 * Approvals are deliberately absent from that surface. A guest sees that the
 * host is being asked to approve something; deciding stays with the person whose
 * machine would run the command.
 */
import {
  AuthFriendScopes,
  type AuthEnvironmentScope,
  DEFAULT_FRIEND_AVATAR_COLOR,
  type CommandId,
  type EmployeeId,
  type EnvironmentId,
  type Friend,
  type FriendAvatarColor,
  type FriendId,
  type FriendInvite,
  type FriendProfile,
  type FriendThreadShare,
  type FriendsSnapshot,
  type FriendPartyActivity,
  type FriendsGuestAnnounceInput,
  type FriendsGuestPartyBeaconInput,
  type FriendsLinkCredential,
  type FriendsShareThreadInput,
  type FriendsUnshareThreadInput,
  type FriendsUpdateProfileInput,
  FriendOperationError,
  type MessageAuthor,
  type MessageId,
  type OrchestrationEvent,
  type OrchestrationThread,
  type OrchestrationThreadShell,
  type SharedThreadAgentState,
  type SharedThreadMessage,
  type SharedThreadParticipant,
  type SharedThreadStreamEvent,
  type SharedThreadSummary,
  SharedThreadStreamError,
  type ThreadId,
  ThreadTurnStartCommand,
  AuthAccessTokenResult,
  AuthAccessTokenType,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
} from "@t3tools/contracts";
import { encodeFriendCode, parseFriendCode } from "@t3tools/shared/friendCode";
import { encodeOAuthScope } from "@t3tools/shared/oauthScope";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as PairingGrantStore from "../auth/PairingGrantStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import { ServerConfig } from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { resolveHeadlessConnectionString } from "../startupAccess.ts";
import * as FriendPresence from "./FriendPresence.ts";
import { FriendStore, type FriendRecord } from "./FriendStore.ts";

/** Invites are handed over by hand, often across a weekend. */
const FRIEND_INVITE_TTL = Duration.days(7);
const FRIEND_SUBJECT_PREFIX = "friend-invite:";
const REDEEM_TIMEOUT = Duration.seconds(20);

const failure = (reason: FriendOperationError["reason"], message: string) =>
  new FriendOperationError({ reason, message });

const streamFailure = (reason: FriendOperationError["reason"], message: string) =>
  new SharedThreadStreamError({ reason, message });

export interface FriendServiceShape {
  readonly getSnapshot: Effect.Effect<FriendsSnapshot, FriendOperationError>;
  readonly snapshots: Stream.Stream<FriendsSnapshot, FriendOperationError>;
  readonly createInvite: Effect.Effect<FriendInvite, FriendOperationError>;
  readonly redeemInvite: (code: string) => Effect.Effect<void, FriendOperationError>;
  readonly removeFriend: (friendId: FriendId) => Effect.Effect<void, FriendOperationError>;
  readonly markAnnounced: (friendId: FriendId) => Effect.Effect<void, FriendOperationError>;
  readonly getLinkCredential: (
    friendId: FriendId,
  ) => Effect.Effect<FriendsLinkCredential, FriendOperationError>;
  readonly updateProfile: (
    input: FriendsUpdateProfileInput,
  ) => Effect.Effect<FriendProfile, FriendOperationError>;
  readonly shareThread: (
    input: FriendsShareThreadInput,
  ) => Effect.Effect<void, FriendOperationError>;
  readonly unshareThread: (
    input: FriendsUnshareThreadInput,
  ) => Effect.Effect<void, FriendOperationError>;

  readonly guestAnnounce: (
    subject: string,
    input: FriendsGuestAnnounceInput,
  ) => Effect.Effect<void, FriendOperationError>;
  readonly guestSharedThreads: (
    subject: string,
  ) => Stream.Stream<
    { readonly host: FriendProfile; readonly threads: ReadonlyArray<SharedThreadSummary> },
    SharedThreadStreamError
  >;
  readonly guestSharedThread: (
    subject: string,
    threadId: ThreadId,
  ) => Stream.Stream<SharedThreadStreamEvent, SharedThreadStreamError>;
  readonly guestPostMessage: (
    subject: string,
    input: { readonly threadId: ThreadId; readonly text: string },
  ) => Effect.Effect<{ readonly messageId: MessageId }, FriendOperationError>;
  readonly guestPartyBeacon: (
    subject: string,
    input: FriendsGuestPartyBeaconInput,
  ) => Effect.Effect<void, FriendOperationError>;
}

export class FriendService extends Context.Service<FriendService, FriendServiceShape>()(
  "t3/friends/FriendService",
) {}

/** Thread events a guest room cares about. Everything else is host-only detail. */
const isGuestRelevantEvent = (event: OrchestrationEvent, threadId: ThreadId): boolean =>
  event.aggregateKind === "thread" &&
  event.aggregateId === threadId &&
  (event.type === "thread.message-sent" ||
    event.type === "thread.message-deleted" ||
    event.type === "thread.session-set" ||
    event.type === "thread.turn-start-requested" ||
    event.type === "thread.meta-updated" ||
    event.type === "thread.reverted" ||
    event.type === "thread.deleted" ||
    event.type === "thread.approval-response-requested" ||
    event.type === "thread.user-input-response-requested");

export const make = Effect.gen(function* () {
  const store = yield* FriendStore;
  const grants = yield* PairingGrantStore.PairingGrantStore;
  const sessions = yield* SessionStore.SessionStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const projections = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const serverConfig = yield* ServerConfig;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const crypto = yield* Crypto.Crypto;
  const httpClient = yield* HttpClient.HttpClient;
  const presence = yield* FriendPresence.make;

  /** Nudges the owner-facing snapshot stream. */
  const dirty = yield* PubSub.unbounded<void>();
  /**
   * Latest party beacon per friend. In-memory like presence: activity from a
   * process that died was not live activity, and the reader already treats
   * anything old as stale by its own clock.
   */
  const partyBeacons = yield* Ref.make(new Map<FriendId, FriendPartyActivity>());
  const markDirty = PubSub.publish(dirty, undefined).pipe(Effect.asVoid);

  const internal = (operation: string) => (cause: unknown) =>
    failure("internal", `Friend operation ${operation} failed: ${String(cause)}`);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  // -------------------------------------------------------------------------
  // Identity
  // -------------------------------------------------------------------------

  const readProfile = Effect.gen(function* () {
    const environmentId = yield* environment.getEnvironmentId;
    const stored = yield* store.readIdentity().pipe(Effect.mapError(internal("readIdentity")));
    if (Option.isSome(stored)) {
      return {
        environmentId,
        displayName: stored.value.displayName,
        avatarColor: stored.value.avatarColor,
      } satisfies FriendProfile;
    }
    // Nobody has chosen a name yet, so borrow the environment label. It is the
    // machine name most of the time, which is a better first impression than a
    // blank row and is trivially editable.
    const descriptor = yield* environment.getDescriptor;
    return {
      environmentId,
      displayName: descriptor.label,
      avatarColor: DEFAULT_FRIEND_AVATAR_COLOR,
    } satisfies FriendProfile;
  });

  const updateProfile: FriendServiceShape["updateProfile"] = (input) =>
    Effect.gen(function* () {
      const current = yield* readProfile;
      const displayName = input.displayName ?? current.displayName;
      const avatarColor: FriendAvatarColor = input.avatarColor ?? current.avatarColor;
      yield* store
        .writeIdentity({ displayName, avatarColor, updatedAt: yield* nowIso })
        .pipe(Effect.mapError(internal("writeIdentity")));
      yield* markDirty;
      return { environmentId: current.environmentId, displayName, avatarColor };
    });

  /**
   * The address we put in friend codes. Prefers the port we actually bound over
   * the configured one, since a taken port shifts at startup and a code with the
   * wrong port is worse than no code at all.
   */
  const localHttpBaseUrl = Effect.sync(() =>
    resolveHeadlessConnectionString(serverConfig.host, serverConfig.port),
  );

  // -------------------------------------------------------------------------
  // Snapshot
  // -------------------------------------------------------------------------

  const toFriend = (
    record: FriendRecord,
    online: boolean,
    viewingThreadId: ThreadId | null,
    partyActivity: FriendPartyActivity | undefined,
  ) =>
    ({
      friendId: record.friendId,
      profile: {
        // The column is a plain string; it only ever holds an id another
        // environment reported for itself.
        environmentId: record.environmentId as EnvironmentId,
        displayName: record.displayName,
        avatarColor: record.avatarColor,
      },
      httpBaseUrl: record.httpBaseUrl,
      linkStatus: record.linkStatus,
      announceCode: record.announceCode,
      presence: online ? "online" : "offline",
      viewingThreadId,
      ...(partyActivity === undefined ? {} : { partyActivity }),
      lastSeenAt: record.lastSeenAt,
      createdAt: record.createdAt,
    }) satisfies Friend;

  const connectedFriendSubjects = sessions.listActive().pipe(
    Effect.map(
      (active) =>
        new Set(
          active
            .filter(
              (session) => session.connected && session.subject.startsWith(FRIEND_SUBJECT_PREFIX),
            )
            .map((session) => session.subject),
        ),
    ),
    Effect.catchCause(() => Effect.succeed(new Set<string>())),
  );

  const getSnapshot: FriendServiceShape["getSnapshot"] = Effect.gen(function* () {
    const [profile, records, shares, connected] = yield* Effect.all([
      readProfile,
      store.list().pipe(Effect.mapError(internal("list"))),
      store.listShares().pipe(Effect.mapError(internal("listShares"))),
      connectedFriendSubjects,
    ]);
    const beacons = yield* Ref.get(partyBeacons);
    const friends = yield* Effect.forEach(records, (record) =>
      presence
        .threadOf(record.friendId)
        .pipe(
          Effect.map((viewing) =>
            toFriend(
              record,
              connected.has(record.inviteSubject),
              viewing,
              beacons.get(record.friendId),
            ),
          ),
        ),
    );
    const snapshot: FriendsSnapshot = { profile, friends, shares };
    return snapshot;
  });

  /**
   * Presence flickers, session churn, and our own writes all change the same
   * picture, so they feed one debounced recompute rather than three partial
   * update paths that could disagree.
   */
  const snapshotTriggers = Stream.merge(
    Stream.fromPubSub(dirty),
    Stream.merge(presence.changes, sessions.streamChanges.pipe(Stream.map(() => undefined))),
  );

  const snapshots: FriendServiceShape["snapshots"] = Stream.concat(
    // Emit once immediately so a subscriber renders without waiting for a change.
    Stream.fromEffect(getSnapshot),
    snapshotTriggers.pipe(
      Stream.debounce(Duration.millis(120)),
      Stream.mapEffect(() => getSnapshot),
    ),
  );

  // -------------------------------------------------------------------------
  // Invites and linking
  // -------------------------------------------------------------------------

  const mintInvite = Effect.gen(function* () {
    const inviteId = yield* crypto.randomUUIDv4.pipe(Effect.mapError(internal("randomUUID")));
    const subject = `${FRIEND_SUBJECT_PREFIX}${inviteId}`;
    const profile = yield* readProfile;
    const issued = yield* grants
      .issueOneTimeToken({
        ttl: FRIEND_INVITE_TTL,
        scopes: AuthFriendScopes as ReadonlyArray<AuthEnvironmentScope>,
        subject,
        label: `Friend invite from ${profile.displayName}`,
      })
      .pipe(Effect.mapError(internal("issueOneTimeToken")));
    const httpBaseUrl = yield* localHttpBaseUrl;
    const code = encodeFriendCode({
      environmentId: profile.environmentId,
      displayName: profile.displayName,
      avatarColor: profile.avatarColor,
      httpBaseUrl,
      token: issued.credential,
    });
    return { inviteId, subject, code, issued };
  });

  const createInvite: FriendServiceShape["createInvite"] = Effect.gen(function* () {
    const minted = yield* mintInvite;
    return {
      inviteId: minted.inviteId,
      code: minted.code,
      expiresAt: DateTime.formatIso(minted.issued.expiresAt),
      createdAt: yield* nowIso,
    } as FriendInvite;
  });

  /**
   * Exchange somebody else's friend code for a session on their environment.
   * The only outbound call the server makes on its own behalf.
   */
  const exchangeFriendCredential = (input: {
    readonly httpBaseUrl: string;
    readonly token: string;
    readonly label: string;
  }) =>
    HttpClientRequest.post(new URL("/oauth/token", input.httpBaseUrl).toString()).pipe(
      HttpClientRequest.bodyUrlParams({
        grant_type: AuthTokenExchangeGrantType,
        subject_token: input.token,
        subject_token_type: AuthEnvironmentBootstrapTokenType,
        requested_token_type: AuthAccessTokenType,
        scope: encodeOAuthScope(AuthFriendScopes as ReadonlyArray<AuthEnvironmentScope>),
        client_label: input.label,
      }),
      httpClient.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(AuthAccessTokenResult)),
      Effect.timeout(REDEEM_TIMEOUT),
      Effect.mapError(() =>
        failure(
          "unreachable",
          `Could not reach ${input.httpBaseUrl}. Check that they are online and that the address is reachable from this machine.`,
        ),
      ),
    );

  const redeemInvite: FriendServiceShape["redeemInvite"] = (code) =>
    Effect.gen(function* () {
      const parsed = parseFriendCode(code);
      if (!parsed.ok) {
        return yield* failure(
          parsed.reason === "bad-endpoint" ? "invalid-code" : "invalid-code",
          parsed.reason === "bad-endpoint"
            ? "That friend code points at an address this app will not connect to."
            : "That does not look like a friend code.",
        );
      }
      const contents = parsed.contents;
      const selfEnvironmentId = yield* environment.getEnvironmentId;
      if (contents.environmentId === selfEnvironmentId) {
        return yield* failure("self-link", "That is your own friend code.");
      }
      const existing = yield* store
        .findByEnvironmentId(contents.environmentId)
        .pipe(Effect.mapError(internal("findByEnvironmentId")));
      if (Option.isSome(existing) && existing.value.linkStatus === "linked") {
        return yield* failure(
          "already-linked",
          `You are already linked with ${contents.displayName}.`,
        );
      }

      const profile = yield* readProfile;
      const exchanged = yield* exchangeFriendCredential({
        httpBaseUrl: contents.httpBaseUrl,
        token: contents.token,
        label: profile.displayName,
      });

      // Mint our half now so the client has something to deliver on its first
      // guest session. Doing it here keeps the whole handshake inside one
      // user-visible action.
      const reciprocal = yield* mintInvite;
      const createdAt = yield* nowIso;

      yield* store
        .upsert({
          friendId: (Option.isSome(existing)
            ? existing.value.friendId
            : yield* crypto.randomUUIDv4.pipe(Effect.mapError(internal("randomUUID")))) as FriendId,
          environmentId: contents.environmentId,
          displayName: contents.displayName,
          avatarColor: contents.avatarColor,
          httpBaseUrl: contents.httpBaseUrl,
          accessToken: exchanged.access_token,
          linkStatus: "linked",
          inviteSubject: reciprocal.subject,
          announceCode: reciprocal.code,
          createdAt: Option.isSome(existing) ? existing.value.createdAt : createdAt,
        })
        .pipe(Effect.mapError(internal("upsert")));
      yield* markDirty;
    });

  const markAnnounced: FriendServiceShape["markAnnounced"] = (friendId) =>
    store
      .clearAnnounceCode(friendId)
      .pipe(Effect.mapError(internal("clearAnnounceCode")), Effect.andThen(markDirty));

  const getLinkCredential: FriendServiceShape["getLinkCredential"] = (friendId) =>
    Effect.gen(function* () {
      const record = yield* store.findById(friendId).pipe(Effect.mapError(internal("findById")));
      if (Option.isNone(record)) {
        return yield* failure("unknown-friend", "That friend is not linked.");
      }
      const { httpBaseUrl, accessToken } = record.value;
      if (httpBaseUrl === null || accessToken === null) {
        return yield* failure(
          "unreachable",
          "This link is still one-way. Ask them to open ML Code so the connection can finish.",
        );
      }
      return { httpBaseUrl, accessToken };
    });

  const removeFriend: FriendServiceShape["removeFriend"] = (friendId) =>
    Effect.gen(function* () {
      const record = yield* store.findById(friendId).pipe(Effect.mapError(internal("findById")));
      if (Option.isNone(record)) {
        return yield* failure("unknown-friend", "That friend is not linked.");
      }
      // Cutting the credential matters more than cutting the row: an open socket
      // would otherwise keep working until its token expired.
      const active = yield* sessions
        .listActive()
        .pipe(
          Effect.catchCause(() =>
            Effect.succeed([] as ReadonlyArray<{ sessionId: never; subject: string }>),
          ),
        );
      yield* Effect.forEach(
        active.filter((session) => session.subject === record.value.inviteSubject),
        (session) => sessions.revoke(session.sessionId).pipe(Effect.ignore),
        { discard: true },
      );
      yield* store.remove(friendId).pipe(Effect.mapError(internal("remove")));
      yield* markDirty;
    });

  // -------------------------------------------------------------------------
  // Sharing
  // -------------------------------------------------------------------------

  const shareThread: FriendServiceShape["shareThread"] = (input) =>
    Effect.gen(function* () {
      const record = yield* store
        .findById(input.friendId)
        .pipe(Effect.mapError(internal("findById")));
      if (Option.isNone(record)) {
        return yield* failure("unknown-friend", "That friend is not linked.");
      }
      const thread = yield* projections
        .getThreadShellById(input.threadId)
        .pipe(Effect.mapError(internal("getThreadShellById")));
      if (Option.isNone(thread)) {
        return yield* failure("thread-missing", "That chat no longer exists.");
      }
      yield* store
        .putShare({
          threadId: input.threadId,
          friendId: input.friendId,
          canPrompt: input.canPrompt,
          createdAt: yield* nowIso,
        })
        .pipe(Effect.mapError(internal("putShare")));
      yield* markDirty;
    });

  const unshareThread: FriendServiceShape["unshareThread"] = (input) =>
    store
      .removeShare(input)
      .pipe(Effect.mapError(internal("removeShare")), Effect.andThen(markDirty));

  // -------------------------------------------------------------------------
  // Guest surface
  // -------------------------------------------------------------------------

  /** Every guest path starts here: session subject to friend row, or refusal. */
  const requireFriend = (subject: string) =>
    store.findByInviteSubject(subject).pipe(
      Effect.mapError(internal("findByInviteSubject")),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            failure(
              "unknown-friend",
              "This link is no longer recognized. Ask for a new friend code.",
            ),
          onSome: (record: FriendRecord) => Effect.succeed(record),
        }),
      ),
    );

  const requireShare = (friendId: FriendId, threadId: ThreadId) =>
    store.findShare({ threadId, friendId }).pipe(
      Effect.mapError(internal("findShare")),
      Effect.flatMap(
        Option.match({
          onNone: () => failure("not-shared", "That chat is not shared with you."),
          onSome: (share: FriendThreadShare) => Effect.succeed(share),
        }),
      ),
    );

  const guestAnnounce: FriendServiceShape["guestAnnounce"] = (subject, input) =>
    Effect.gen(function* () {
      const selfEnvironmentId = yield* environment.getEnvironmentId;
      if (input.profile.environmentId === selfEnvironmentId) {
        return yield* failure("self-link", "An environment cannot befriend itself.");
      }
      const existing = yield* store
        .findByInviteSubject(subject)
        .pipe(Effect.mapError(internal("findByInviteSubject")));
      const byEnvironment = yield* store
        .findByEnvironmentId(input.profile.environmentId)
        .pipe(Effect.mapError(internal("findByEnvironmentId")));
      const prior = Option.isSome(existing) ? existing : byEnvironment;

      // Already reachable: the announcement is a repeat from a reconnecting
      // client, so refresh the profile and stop before spending their one-time
      // code.
      if (Option.isSome(prior) && prior.value.linkStatus === "linked") {
        yield* store
          .upsert({
            friendId: prior.value.friendId,
            environmentId: input.profile.environmentId,
            displayName: input.profile.displayName,
            avatarColor: input.profile.avatarColor,
            httpBaseUrl: prior.value.httpBaseUrl,
            accessToken: prior.value.accessToken,
            linkStatus: "linked",
            inviteSubject: subject,
            announceCode: prior.value.announceCode,
            createdAt: prior.value.createdAt,
          })
          .pipe(Effect.mapError(internal("upsert")));
        yield* markDirty;
        return;
      }

      const parsed = parseFriendCode(input.reciprocalCode);
      const createdAt = yield* nowIso;
      const friendId = (
        Option.isSome(prior)
          ? prior.value.friendId
          : yield* crypto.randomUUIDv4.pipe(Effect.mapError(internal("randomUUID")))
      ) as FriendId;

      // Record them first. Even if the reciprocal exchange fails they can still
      // reach us, and a half link the owner can see beats a silent nothing.
      yield* store
        .upsert({
          friendId,
          environmentId: input.profile.environmentId,
          displayName: input.profile.displayName,
          avatarColor: input.profile.avatarColor,
          httpBaseUrl: null,
          accessToken: null,
          linkStatus: "pending",
          inviteSubject: subject,
          announceCode: null,
          createdAt: Option.isSome(prior) ? prior.value.createdAt : createdAt,
        })
        .pipe(Effect.mapError(internal("upsert")));
      yield* markDirty;

      if (!parsed.ok) {
        yield* store
          .setOutboundLink({
            friendId,
            httpBaseUrl: null,
            accessToken: null,
            linkStatus: "unreachable",
          })
          .pipe(Effect.mapError(internal("setOutboundLink")));
        yield* markDirty;
        return;
      }

      const profile = yield* readProfile;
      const exchanged = yield* exchangeFriendCredential({
        httpBaseUrl: parsed.contents.httpBaseUrl,
        token: parsed.contents.token,
        label: profile.displayName,
      }).pipe(Effect.option);

      yield* store
        .setOutboundLink(
          Option.isSome(exchanged)
            ? {
                friendId,
                httpBaseUrl: parsed.contents.httpBaseUrl,
                accessToken: exchanged.value.access_token,
                linkStatus: "linked",
              }
            : { friendId, httpBaseUrl: null, accessToken: null, linkStatus: "unreachable" },
        )
        .pipe(Effect.mapError(internal("setOutboundLink")));
      yield* markDirty;
    });

  // -------------------------------------------------------------------------
  // Guest projections
  // -------------------------------------------------------------------------

  const authorOf = (record: FriendRecord): MessageAuthor => ({
    friendId: record.friendId,
    displayName: record.displayName,
    avatarColor: record.avatarColor,
  });

  /**
   * Derived from the thread shell rather than the hydrated thread: this runs on
   * every committed event for an open room, and loading a whole conversation to
   * learn whether a spinner should turn would be a real cost on long threads.
   */
  const agentStateOf = (thread: OrchestrationThreadShell): SharedThreadAgentState => {
    if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
      return "awaiting-host-approval";
    }
    switch (thread.session?.status) {
      case "running":
      case "starting":
        return "running";
      case "error":
        return "error";
      default:
        return "idle";
    }
  };

  /**
   * Employee display names, so a guest sees "Sol" rather than a generic "Agent"
   * when the host works through a persona. Read once per room rather than per
   * message: renaming an employee mid-conversation is rare, and the alternative
   * is a settings read on every streamed delta.
   */
  const employeeNameResolver = serverSettings.getSettings.pipe(
    Effect.map((settings) => {
      const employees = settings.employees;
      return (id: EmployeeId | undefined): string | null => {
        if (id === undefined) {
          return null;
        }
        return Object.hasOwn(employees, id) ? (employees[id]?.displayName ?? null) : null;
      };
    }),
    Effect.catchCause(() => Effect.succeed((_id: EmployeeId | undefined) => null)),
  );

  const toGuestMessage = (
    message: OrchestrationThread["messages"][number],
    employeeNameOf: (id: EmployeeId | undefined) => string | null,
  ): SharedThreadMessage => ({
    messageId: message.id,
    role: message.role,
    text: message.text,
    author: message.author ?? null,
    speaker: employeeNameOf(message.employeeId),
    turnId: message.turnId,
    streaming: message.streaming,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  });

  const summaryOf = (input: {
    readonly thread: OrchestrationThreadShell;
    readonly projectTitle: string;
    readonly host: FriendProfile;
    readonly canPrompt: boolean;
  }): SharedThreadSummary => ({
    threadId: input.thread.id,
    title: input.thread.title,
    projectTitle: input.projectTitle,
    host: input.host,
    canPrompt: input.canPrompt,
    agentBusy: input.thread.session?.status === "running",
    lastActivityAt: input.thread.updatedAt,
  });

  /** Thread shell, with read failures flattened to a missing thread. */
  const readThreadShell = (threadId: ThreadId) =>
    projections
      .getThreadShellById(threadId)
      .pipe(Effect.catchCause(() => Effect.succeed(Option.none<OrchestrationThreadShell>())));

  /**
   * The shell carries the title, the session status, and the pending-approval
   * flags, which is everything a summary needs and not one message.
   */
  const loadSharedThread = (share: FriendThreadShare) =>
    Effect.gen(function* () {
      const thread = yield* projections.getThreadShellById(share.threadId);
      if (Option.isNone(thread)) {
        return Option.none<{
          readonly thread: OrchestrationThreadShell;
          readonly projectTitle: string;
        }>();
      }
      const project = yield* projections.getProjectShellById(thread.value.projectId);
      return Option.some({
        thread: thread.value,
        projectTitle: Option.isSome(project) ? project.value.title : "Workspace",
      });
    });

  const guestSharedThreads: FriendServiceShape["guestSharedThreads"] = (subject) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const record = yield* requireFriend(subject).pipe(
          Effect.mapError((error) => streamFailure(error.reason, error.message)),
        );
        yield* store
          .markSeen({ friendId: record.friendId, seenAt: yield* nowIso })
          .pipe(Effect.ignore);

        const read = Effect.gen(function* () {
          const host = yield* readProfile;
          const shares = yield* store.listSharesForFriend(record.friendId);
          const loaded = yield* Effect.forEach(shares, (share) =>
            loadSharedThread(share).pipe(
              Effect.map((entry) =>
                Option.map(entry, (value) =>
                  summaryOf({ ...value, host, canPrompt: share.canPrompt }),
                ),
              ),
            ),
          );
          const result: {
            readonly host: FriendProfile;
            readonly threads: ReadonlyArray<SharedThreadSummary>;
          } = {
            host,
            threads: loaded.filter(Option.isSome).map((entry) => entry.value),
          };
          return result;
        }).pipe(Effect.mapError((cause) => streamFailure("internal", String(cause))));

        // Any committed event can change a title or a busy flag, and the list is
        // small, so recomputing on a debounce is cheaper than tracking which
        // event touched which row.
        return Stream.concat(
          Stream.fromEffect(read),
          engine.streamDomainEvents.pipe(
            Stream.filter((event) => event.aggregateKind === "thread"),
            Stream.merge(Stream.fromPubSub(dirty)),
            Stream.debounce(Duration.millis(250)),
            Stream.mapEffect(() => read),
          ),
        );
      }),
    );

  const guestSharedThread: FriendServiceShape["guestSharedThread"] = (subject, threadId) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const record = yield* requireFriend(subject).pipe(
          Effect.mapError((error) => streamFailure(error.reason, error.message)),
        );
        const share = yield* requireShare(record.friendId, threadId).pipe(
          Effect.mapError((error) => streamFailure(error.reason, error.message)),
        );

        const employeeNameOf = yield* employeeNameResolver;

        // Presence is scoped to this subscription, so a dropped socket removes
        // the viewer without any explicit leave message.
        yield* Effect.acquireRelease(presence.track({ friendId: record.friendId, threadId }), () =>
          presence.untrack({ friendId: record.friendId, threadId }),
        );
        yield* markDirty;

        const participantsOf = Effect.gen(function* () {
          const viewers = yield* presence.viewersOf(threadId);
          const records = yield* store.list();
          return records
            .filter(
              (entry) => entry.friendId !== record.friendId && viewers.includes(entry.friendId),
            )
            .map(
              (entry) =>
                ({
                  friendId: entry.friendId,
                  displayName: entry.displayName,
                  avatarColor: entry.avatarColor,
                }) satisfies SharedThreadParticipant,
            );
        }).pipe(
          Effect.catchCause(() => Effect.succeed([] as ReadonlyArray<SharedThreadParticipant>)),
        );

        // The one place a full thread read is justified: opening a room needs
        // the backlog. Everything after this rides on incremental events.
        const snapshot = Effect.gen(function* () {
          const host = yield* readProfile;
          const loaded = yield* loadSharedThread(share);
          const detail = yield* projections.getThreadDetailById(threadId);
          if (Option.isNone(loaded) || Option.isNone(detail) || detail.value.deletedAt !== null) {
            return {
              version: 1,
              type: "closed",
              payload: { reason: "deleted" },
            } satisfies SharedThreadStreamEvent;
          }
          return {
            version: 1,
            type: "snapshot",
            payload: {
              thread: summaryOf({ ...loaded.value, host, canPrompt: share.canPrompt }),
              messages: detail.value.messages.map((message) =>
                toGuestMessage(message, employeeNameOf),
              ),
              agentState: agentStateOf(loaded.value.thread),
              participants: yield* participantsOf,
            },
          } satisfies SharedThreadStreamEvent;
        }).pipe(Effect.mapError((cause) => streamFailure("internal", String(cause))));

        // Attach live delivery before reading the snapshot so an event published
        // while it loads is buffered rather than dropped.
        const liveBuffer = yield* Queue.unbounded<OrchestrationEvent>();
        yield* Effect.forkScoped(
          engine.streamDomainEvents.pipe(
            Stream.filter((event) => isGuestRelevantEvent(event, threadId)),
            Stream.runForEach((event) => Queue.offer(liveBuffer, event)),
          ),
        );

        const liveEvents = Stream.fromQueue(liveBuffer).pipe(
          Stream.mapEffect(
            (event): Effect.Effect<SharedThreadStreamEvent | null> =>
              Effect.gen(function* () {
                if (event.type === "thread.deleted") {
                  return {
                    version: 1,
                    type: "closed",
                    payload: { reason: "deleted" },
                  };
                }
                if (event.type === "thread.message-sent") {
                  const payload = event.payload;
                  return {
                    version: 1,
                    type: "message",
                    payload: {
                      messageId: payload.messageId,
                      role: payload.role,
                      text: payload.text,
                      author: payload.author ?? null,
                      speaker: employeeNameOf(payload.employeeId),
                      turnId: payload.turnId,
                      streaming: payload.streaming,
                      createdAt: payload.createdAt,
                      updatedAt: payload.updatedAt,
                    },
                  };
                }
                if (event.type === "thread.message-deleted") {
                  return {
                    version: 1,
                    type: "messagesRemoved",
                    payload: { messageIds: [event.payload.messageId] },
                  };
                }
                // Everything else only moves the agent indicator, and re-reading
                // the shell is cheaper and less error-prone than reconstructing
                // the settled value from each individual event shape.
                const thread = yield* readThreadShell(threadId);
                if (Option.isNone(thread)) {
                  return null;
                }
                return {
                  version: 1,
                  type: "agentState",
                  payload: {
                    agentState: agentStateOf(thread.value),
                    agentBusy: thread.value.session?.status === "running",
                  },
                };
              }),
          ),
          Stream.filter((event): event is SharedThreadStreamEvent => event !== null),
        );

        // A revoked share must end the room, otherwise the guest keeps watching
        // a conversation they were removed from.
        const shareWatch = Stream.fromPubSub(dirty).pipe(
          Stream.mapEffect(() =>
            store
              .findShare({ threadId, friendId: record.friendId })
              .pipe(Effect.catchCause(() => Effect.succeed(Option.none<FriendThreadShare>()))),
          ),
          Stream.filter(Option.isNone),
          Stream.map(
            () =>
              ({
                version: 1,
                type: "closed",
                payload: { reason: "unshared" },
              }) satisfies SharedThreadStreamEvent,
          ),
          Stream.take(1),
        );

        const participantUpdates = presence.changes.pipe(
          Stream.debounce(Duration.millis(150)),
          Stream.mapEffect(() =>
            participantsOf.pipe(
              Effect.map(
                (participants) =>
                  ({
                    version: 1,
                    type: "participants",
                    payload: { participants },
                  }) satisfies SharedThreadStreamEvent,
              ),
            ),
          ),
        );

        return Stream.concat(
          Stream.fromEffect(snapshot),
          Stream.merge(
            Stream.merge(
              liveEvents.pipe(Stream.mapError((cause) => streamFailure("internal", String(cause)))),
              participantUpdates.pipe(
                Stream.mapError((cause) => streamFailure("internal", String(cause))),
              ),
            ),
            shareWatch.pipe(Stream.mapError((cause) => streamFailure("internal", String(cause)))),
          ),
        );
      }),
    );

  const guestPostMessage: FriendServiceShape["guestPostMessage"] = (subject, input) =>
    Effect.gen(function* () {
      const record = yield* requireFriend(subject);
      const share = yield* requireShare(record.friendId, input.threadId);
      if (!share.canPrompt) {
        return yield* failure(
          "prompt-not-allowed",
          "You can follow this chat, but the host has not enabled sending messages.",
        );
      }
      const thread = yield* projections
        .getThreadShellById(input.threadId)
        .pipe(Effect.mapError(internal("getThreadShellById")));
      if (Option.isNone(thread)) {
        return yield* failure("thread-missing", "That chat no longer exists.");
      }

      const messageId = (yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(internal("randomUUID")),
      )) as MessageId;
      const commandId = (yield* crypto.randomUUIDv4.pipe(
        Effect.mapError(internal("randomUUID")),
      )) as CommandId;
      const createdAt = yield* nowIso;

      // A friend's prompt is an ordinary turn. Running it through the same
      // command as the owner's own composer is what makes queueing, interrupts,
      // and checkpoints behave identically for both people.
      const command: typeof ThreadTurnStartCommand.Type = {
        type: "thread.turn.start",
        commandId,
        threadId: input.threadId,
        message: {
          messageId,
          role: "user",
          text: input.text,
          attachments: [],
          author: authorOf(record),
        },
        runtimeMode: thread.value.runtimeMode,
        interactionMode: thread.value.interactionMode,
        createdAt,
      };

      yield* engine.dispatch(command).pipe(Effect.mapError(internal("dispatch")));
      yield* store.markSeen({ friendId: record.friendId, seenAt: createdAt }).pipe(Effect.ignore);
      return { messageId };
    });

  // A deleted thread's shares are dead weight: the guest views already skip them,
  // but leaving the rows behind would let the table grow forever and would make
  // a recycled thread id inherit an old audience.
  yield* Effect.forkScoped(
    engine.streamDomainEvents.pipe(
      Stream.filter((event) => event.type === "thread.deleted"),
      Stream.runForEach((event) =>
        store
          .removeSharesForThread(event.payload.threadId)
          .pipe(Effect.andThen(markDirty), Effect.ignore),
      ),
    ),
  );

  const guestPartyBeacon: FriendServiceShape["guestPartyBeacon"] = (subject, input) =>
    Effect.gen(function* () {
      const record = yield* requireFriend(subject);
      yield* Ref.update(partyBeacons, (current) => {
        const next = new Map(current);
        next.set(record.friendId, input.activity);
        return next;
      });
      yield* markDirty;
    });

  return {
    getSnapshot,
    snapshots,
    createInvite,
    redeemInvite,
    removeFriend,
    markAnnounced,
    getLinkCredential,
    updateProfile,
    shareThread,
    unshareThread,
    guestAnnounce,
    guestSharedThreads,
    guestSharedThread,
    guestPostMessage,
    guestPartyBeacon,
  } satisfies FriendServiceShape;
});

export const layer = Layer.effect(FriendService, make);
