/**
 * Friends — peer-to-peer collaboration between two ML Code environments.
 *
 * A friend is another person's environment that has been mutually linked with
 * this one. The link is a pair of narrowly scoped credentials: each side holds
 * a `friend:participate` session on the other. That scope grants access to
 * nothing except the threads its owner has explicitly shared, which is why a
 * friend can join a conversation without gaining a terminal, a filesystem, or
 * any visibility into the rest of the environment.
 *
 * Two RPC surfaces live here and they must not be confused:
 * - `friends.*` owner methods run against your own environment and need
 *   ordinary orchestration scopes;
 * - `friends.guest*` methods are the only things a friend session may call, and
 *   every one of them re-checks the share grant for the thread it names.
 */
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  MessageId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
} from "./baseSchemas.ts";

export const FriendId = TrimmedNonEmptyString.pipe(Schema.brand("FriendId"));
export type FriendId = typeof FriendId.Type;

export const FriendInviteId = TrimmedNonEmptyString.pipe(Schema.brand("FriendInviteId"));
export type FriendInviteId = typeof FriendInviteId.Type;

/**
 * Avatar colors come from the client color palette so a friend renders the same
 * way on every surface without a raw color value crossing the wire.
 */
export const FriendAvatarColor = Schema.Literals([
  "blue",
  "green",
  "purple",
  "orange",
  "pink",
  "teal",
  "amber",
  "rose",
]);
export type FriendAvatarColor = typeof FriendAvatarColor.Type;

export const FRIEND_AVATAR_COLORS = [
  "blue",
  "green",
  "purple",
  "orange",
  "pink",
  "teal",
  "amber",
  "rose",
] as const satisfies ReadonlyArray<FriendAvatarColor>;

export const DEFAULT_FRIEND_AVATAR_COLOR: FriendAvatarColor = "blue";

/**
 * How a person presents themselves to their friends. This is the only identity
 * in the system: there are no accounts, and an environment vouches for its own
 * name the way a machine on a LAN vouches for its hostname.
 */
export const FriendProfile = Schema.Struct({
  environmentId: EnvironmentId,
  displayName: TrimmedNonEmptyString,
  avatarColor: FriendAvatarColor,
});
export type FriendProfile = typeof FriendProfile.Type;

/**
 * Reachability of the outbound half of a link — whether we can open a session on
 * their environment. The inbound half is observed as presence instead.
 *
 * - `linked`: we hold a credential and an endpoint for them.
 * - `pending`: they redeemed our invite but the reciprocal exchange has not
 *   completed yet; retried in the background.
 * - `unreachable`: the reciprocal exchange failed and stays failed until the
 *   link is repaired by exchanging codes again.
 */
export const FriendLinkStatus = Schema.Literals(["linked", "pending", "unreachable"]);
export type FriendLinkStatus = typeof FriendLinkStatus.Type;

export const FriendPresence = Schema.Literals(["online", "offline"]);
export type FriendPresence = typeof FriendPresence.Type;

export const Friend = Schema.Struct({
  friendId: FriendId,
  profile: FriendProfile,
  /** Base URL we use to reach them. Null until the reciprocal link lands. */
  httpBaseUrl: Schema.NullOr(TrimmedNonEmptyString),
  linkStatus: FriendLinkStatus,
  /**
   * Reciprocal friend code we minted for them that still needs delivering. Our
   * own client hands it over on its next guest session, which is how the link
   * becomes mutual without the server opening an outbound socket. Null once
   * there is nothing left to deliver.
   */
  announceCode: Schema.NullOr(TrimmedNonEmptyString),
  /** Online while a friend session of theirs is connected to us. */
  presence: FriendPresence,
  /** Thread they currently have open, when it is one of ours. */
  viewingThreadId: Schema.NullOr(ThreadId),
  lastSeenAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
});
export type Friend = typeof Friend.Type;

/**
 * A share is the whole authorization story for a thread: a friend may read
 * exactly the threads carrying a row here. `canPrompt` is the second half of
 * that decision — false makes them a spectator who watches the conversation,
 * true lets them type into it and drive the agent.
 */
export const FriendThreadShare = Schema.Struct({
  threadId: ThreadId,
  friendId: FriendId,
  canPrompt: Schema.Boolean,
  createdAt: IsoDateTime,
});
export type FriendThreadShare = typeof FriendThreadShare.Type;

export const FriendInvite = Schema.Struct({
  inviteId: FriendInviteId,
  code: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type FriendInvite = typeof FriendInvite.Type;

/**
 * What a friend code carries before encoding. Deliberately short: the code gets
 * pasted into chat windows by hand.
 */
export const FriendCodePayload = Schema.Struct({
  v: Schema.Literal(1),
  /** Environment id of the inviter. */
  e: TrimmedNonEmptyString,
  /** Display name of the inviter. */
  n: TrimmedNonEmptyString,
  /** Avatar color of the inviter. */
  c: FriendAvatarColor,
  /** HTTP base URL the invitee should use to reach the inviter. */
  u: TrimmedNonEmptyString,
  /** One-time bootstrap credential, exchanged for a friend session. */
  t: TrimmedNonEmptyString,
});
export type FriendCodePayload = typeof FriendCodePayload.Type;

export const FRIEND_CODE_PREFIX = "mlfriend1_";

// ---------------------------------------------------------------------------
// Owner-side state
// ---------------------------------------------------------------------------

export const FriendsSnapshot = Schema.Struct({
  profile: FriendProfile,
  friends: Schema.Array(Friend),
  shares: Schema.Array(FriendThreadShare),
});
export type FriendsSnapshot = typeof FriendsSnapshot.Type;

export const FriendsStreamEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  payload: FriendsSnapshot,
});
export type FriendsStreamEvent = typeof FriendsStreamEvent.Type;

export const FriendsCreateInviteInput = Schema.Struct({});
export type FriendsCreateInviteInput = typeof FriendsCreateInviteInput.Type;

export const FriendsRedeemInviteInput = Schema.Struct({
  code: TrimmedNonEmptyString,
});
export type FriendsRedeemInviteInput = typeof FriendsRedeemInviteInput.Type;

export const FriendsRemoveInput = Schema.Struct({
  friendId: FriendId,
});
export type FriendsRemoveInput = typeof FriendsRemoveInput.Type;

export const FriendsUpdateProfileInput = Schema.Struct({
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
  avatarColor: Schema.optionalKey(FriendAvatarColor),
});
export type FriendsUpdateProfileInput = typeof FriendsUpdateProfileInput.Type;

export const FriendsShareThreadInput = Schema.Struct({
  threadId: ThreadId,
  friendId: FriendId,
  canPrompt: Schema.Boolean,
});
export type FriendsShareThreadInput = typeof FriendsShareThreadInput.Type;

export const FriendsUnshareThreadInput = Schema.Struct({
  threadId: ThreadId,
  friendId: FriendId,
});
export type FriendsUnshareThreadInput = typeof FriendsUnshareThreadInput.Type;

/**
 * Fetches the credential our own client needs to open a guest session on a
 * friend's environment. Deliberately a request rather than a field on `Friend`:
 * the friends snapshot is re-broadcast on every presence flicker, and a bearer
 * token has no business riding along with it.
 */
export const FriendsGetLinkCredentialInput = Schema.Struct({
  friendId: FriendId,
});
export type FriendsGetLinkCredentialInput = typeof FriendsGetLinkCredentialInput.Type;

export const FriendsLinkCredential = Schema.Struct({
  httpBaseUrl: TrimmedNonEmptyString,
  accessToken: TrimmedNonEmptyString,
});
export type FriendsLinkCredential = typeof FriendsLinkCredential.Type;

/** Clears a delivered `announceCode` so our client stops re-sending it. */
export const FriendsMarkAnnouncedInput = Schema.Struct({
  friendId: FriendId,
});
export type FriendsMarkAnnouncedInput = typeof FriendsMarkAnnouncedInput.Type;

export const FriendsEmptyResult = Schema.Struct({});
export type FriendsEmptyResult = typeof FriendsEmptyResult.Type;

// ---------------------------------------------------------------------------
// Guest-side surface — everything below is reachable with `friend:participate`
// ---------------------------------------------------------------------------

/**
 * Announcement a freshly linked friend sends over their new session so the
 * inviter learns who redeemed the code and how to reach them back.
 */
export const FriendsGuestAnnounceInput = Schema.Struct({
  profile: FriendProfile,
  /** Friend code for the announcer's own environment, closing the loop. */
  reciprocalCode: TrimmedNonEmptyString,
});
export type FriendsGuestAnnounceInput = typeof FriendsGuestAnnounceInput.Type;

/**
 * One shared thread as a guest sees it. Deliberately thin: a title, whose it is,
 * and whether the agent is busy. No workspace paths and no project root.
 */
export const SharedThreadSummary = Schema.Struct({
  threadId: ThreadId,
  title: TrimmedNonEmptyString,
  projectTitle: TrimmedNonEmptyString,
  host: FriendProfile,
  canPrompt: Schema.Boolean,
  agentBusy: Schema.Boolean,
  lastActivityAt: IsoDateTime,
});
export type SharedThreadSummary = typeof SharedThreadSummary.Type;

export const SharedThreadListEvent = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("snapshot"),
  payload: Schema.Struct({
    host: FriendProfile,
    threads: Schema.Array(SharedThreadSummary),
  }),
});
export type SharedThreadListEvent = typeof SharedThreadListEvent.Type;

/**
 * Who wrote a message. Absent on messages typed by the environment owner —
 * those are the host, and render with the host's own profile.
 */
export const MessageAuthor = Schema.Struct({
  friendId: FriendId,
  displayName: TrimmedNonEmptyString,
  avatarColor: FriendAvatarColor,
});
export type MessageAuthor = typeof MessageAuthor.Type;

export const SharedThreadMessageRole = Schema.Literals(["user", "assistant", "system"]);
export type SharedThreadMessageRole = typeof SharedThreadMessageRole.Type;

export const SharedThreadMessage = Schema.Struct({
  messageId: MessageId,
  role: SharedThreadMessageRole,
  text: Schema.String,
  /** Set when a friend wrote it; null means the host wrote it. */
  author: Schema.NullOr(MessageAuthor),
  /** Employee persona that produced an assistant row, when there is one. */
  speaker: Schema.NullOr(TrimmedNonEmptyString),
  turnId: Schema.NullOr(TurnId),
  streaming: Schema.Boolean,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SharedThreadMessage = typeof SharedThreadMessage.Type;

/**
 * Coarse agent state. A guest is told the host is being asked to approve
 * something, never what: approvals stay with the person whose machine would run
 * the command.
 */
export const SharedThreadAgentState = Schema.Literals([
  "idle",
  "running",
  "awaiting-host-approval",
  "error",
]);
export type SharedThreadAgentState = typeof SharedThreadAgentState.Type;

/**
 * Someone else with this thread open right now. The host is not listed: they own
 * the environment the agent runs in and render as the thread's owner instead.
 */
export const SharedThreadParticipant = Schema.Struct({
  friendId: FriendId,
  displayName: TrimmedNonEmptyString,
  avatarColor: FriendAvatarColor,
});
export type SharedThreadParticipant = typeof SharedThreadParticipant.Type;

const SharedThreadStreamBase = {
  version: Schema.Literal(1),
};

export const SharedThreadSnapshotEvent = Schema.Struct({
  ...SharedThreadStreamBase,
  type: Schema.Literal("snapshot"),
  payload: Schema.Struct({
    thread: SharedThreadSummary,
    messages: Schema.Array(SharedThreadMessage),
    agentState: SharedThreadAgentState,
    participants: Schema.Array(SharedThreadParticipant),
  }),
});
export type SharedThreadSnapshotEvent = typeof SharedThreadSnapshotEvent.Type;

export const SharedThreadMessageEvent = Schema.Struct({
  ...SharedThreadStreamBase,
  type: Schema.Literal("message"),
  payload: SharedThreadMessage,
});
export type SharedThreadMessageEvent = typeof SharedThreadMessageEvent.Type;

export const SharedThreadMessagesRemovedEvent = Schema.Struct({
  ...SharedThreadStreamBase,
  type: Schema.Literal("messagesRemoved"),
  payload: Schema.Struct({
    messageIds: Schema.Array(MessageId),
  }),
});
export type SharedThreadMessagesRemovedEvent = typeof SharedThreadMessagesRemovedEvent.Type;

export const SharedThreadAgentStateEvent = Schema.Struct({
  ...SharedThreadStreamBase,
  type: Schema.Literal("agentState"),
  payload: Schema.Struct({
    agentState: SharedThreadAgentState,
    agentBusy: Schema.Boolean,
  }),
});
export type SharedThreadAgentStateEvent = typeof SharedThreadAgentStateEvent.Type;

export const SharedThreadParticipantsEvent = Schema.Struct({
  ...SharedThreadStreamBase,
  type: Schema.Literal("participants"),
  payload: Schema.Struct({
    participants: Schema.Array(SharedThreadParticipant),
  }),
});
export type SharedThreadParticipantsEvent = typeof SharedThreadParticipantsEvent.Type;

/**
 * Terminal event for the stream. Sent when the host revokes the share or the
 * thread goes away, so the guest UI closes the room instead of hanging on a
 * silent subscription.
 */
export const SharedThreadClosedEvent = Schema.Struct({
  ...SharedThreadStreamBase,
  type: Schema.Literal("closed"),
  payload: Schema.Struct({
    reason: Schema.Literals(["unshared", "deleted"]),
  }),
});
export type SharedThreadClosedEvent = typeof SharedThreadClosedEvent.Type;

export const SharedThreadStreamEvent = Schema.Union([
  SharedThreadSnapshotEvent,
  SharedThreadMessageEvent,
  SharedThreadMessagesRemovedEvent,
  SharedThreadAgentStateEvent,
  SharedThreadParticipantsEvent,
  SharedThreadClosedEvent,
]);
export type SharedThreadStreamEvent = typeof SharedThreadStreamEvent.Type;

export const FriendsGuestSubscribeThreadsInput = Schema.Struct({});
export type FriendsGuestSubscribeThreadsInput = typeof FriendsGuestSubscribeThreadsInput.Type;

export const FriendsGuestSubscribeThreadInput = Schema.Struct({
  threadId: ThreadId,
});
export type FriendsGuestSubscribeThreadInput = typeof FriendsGuestSubscribeThreadInput.Type;

export const FriendsGuestPostMessageInput = Schema.Struct({
  threadId: ThreadId,
  text: TrimmedNonEmptyString,
});
export type FriendsGuestPostMessageInput = typeof FriendsGuestPostMessageInput.Type;

export const FriendsGuestPostMessageResult = Schema.Struct({
  messageId: MessageId,
});
export type FriendsGuestPostMessageResult = typeof FriendsGuestPostMessageResult.Type;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const FriendOperationFailureReason = Schema.Literals([
  "invalid-code",
  "expired-code",
  "self-link",
  "already-linked",
  "unknown-friend",
  "unreachable",
  "not-shared",
  "prompt-not-allowed",
  "thread-missing",
  "internal",
]);
export type FriendOperationFailureReason = typeof FriendOperationFailureReason.Type;

export class FriendOperationError extends Schema.TaggedErrorClass<FriendOperationError>()(
  "FriendOperationError",
  {
    reason: FriendOperationFailureReason,
    message: Schema.String,
  },
) {}

export class SharedThreadStreamError extends Schema.TaggedErrorClass<SharedThreadStreamError>()(
  "SharedThreadStreamError",
  {
    reason: FriendOperationFailureReason,
    message: Schema.String,
  },
) {}
