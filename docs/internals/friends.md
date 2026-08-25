# Friends and shared threads

> For maintainers. Using ML Code? See [friends](../user/friends.md).

Two people, two environments, one conversation. A friend is another environment mutually linked with
this one, and a share is a per-thread grant that lets that friend read and post to exactly one
thread. Nothing about this introduces accounts, a directory service, or a broker: the link is a pair
of scoped credentials the two servers issue to each other.

## The containment story

Start here, because everything else is shaped by it.

An ordinary pairing grants
`orchestration:read orchestration:operate terminal:operate review:write relay:read`. That is a
terminal and a filesystem on the host machine, which is not something to hand a coworker. So friends
get a scope of their own, `friend:participate` ([auth.ts][auth]), and a friend session carries that
scope **and nothing else**.

Two consequences follow mechanically:

1. Every pre-existing RPC is mapped to a different scope in `RPC_REQUIRED_SCOPES`
   ([RpcAuthorization.ts][rpcauth]), so `authorizeEffect` in [ws.ts][ws] refuses all of them for a
   friend session without any friends-specific code being involved.
2. The only methods mapped to `friend:participate` are the four in `FRIEND_GUEST_WS_METHODS`
   ([rpc.ts][rpc]). `RpcAuthorization.test.ts` asserts that set equality, so mapping a fifth method
   to the friend scope fails the suite rather than silently widening access.

Holding a friend session is still not authorization to read a thread. Each guest handler resolves the
caller's session subject to a friend row (`requireFriend`) and then to a share row for the specific
thread named (`requireShare`) in [FriendService.ts][service]. There is no guest path that reads a
thread without passing both.

Approvals are deliberately not on the guest surface. A guest is told the agent is
`awaiting-host-approval`; the decision stays with the person whose machine would run the command.

## Forming a link

The handshake is mutual but not symmetric in time, because only one side starts it.

```text
Alice                                    Bob
  │  friends.createInvite                  │
  │  mints a one-time bootstrap token      │
  │  scoped friend:participate, subject    │
  │  friend-invite:<uuidA>                 │
  │                                        │
  │  ── friend code (out of band) ──────>  │
  │                                        │  friends.redeemInvite
  │  <── POST /oauth/token ──────────────  │  exchanges it for a session on Alice
  │  ── access_token ──────────────────>   │  stores Friend{Alice} with the outbound half
  │                                        │  mints its own invite, parks it as announceCode
  │                                        │
  │  <── friends.guestAnnounce ──────────  │  Bob's *client* delivers the reciprocal code
  │  creates Friend{Bob}, keyed by the     │
  │  calling session's subject             │
  │  ── POST /oauth/token ─────────────>   │  Alice redeems it; link is now mutual
```

Two details are load-bearing:

**Why the client delivers the announcement.** The reciprocal code has to reach Alice somehow, and
Bob's server has no socket to Alice — it only has an HTTP credential. Rather than teach the server to
be a WebSocket client purely to say hello, the code is parked on the friend row as `announceCode` and
Bob's client carries it over the guest link it is opening anyway
(`useFriendLinkCompletion` in [useFriends.ts][usefriends]). `guestAnnounce` is idempotent, so a
client that re-announces after a reconnect is harmless.

**Why the subject is the identity.** At invite time Alice does not know who will redeem. The grant's
subject (`friend-invite:<uuid>`) is fixed when the token is minted and cannot be chosen by the
client, so it is the one trustworthy identifier a guest call carries. `guestAnnounce` records it on
the friend row as `inviteSubject`, and every later guest call resolves through
`findByInviteSubject`.

Friend sessions get a 365-day TTL (`FRIEND_SESSION_TTL` in [EnvironmentAuth.ts][envauth]) rather than
the 30-day default. A friend link is a relationship, not a device login; expiring it silently would
drop people out of shared chats with no way back except trading codes again. Revocation is the
intended exit, and `friends.remove` performs it — it revokes every session on that subject before
deleting the row.

## What crosses the wire

The guest surface is a purpose-built projection, not a filtered `subscribeThread`.

`SharedThreadSummary` carries a title, a project title, and a busy flag. `SharedThreadMessage`
carries role, text, streaming state, and an author. Neither carries a workspace root, a worktree
path, a tool call, shell output, or a diff. That is a deliberate ceiling: filtering the host stream
would mean every future field added to a thread event is exposed by default and has to be
remembered as a redaction, whereas a separate projection exposes only what somebody added on
purpose.

Streaming works because the projection mirrors the host's own: deltas append, a settled row replaces,
and an empty settled row keeps the accumulated text (`reduceSharedRoom` in
[sharedRoom.logic.ts][reducer]).

## Attribution

`OrchestrationMessage.author` is optional and set only when a friend wrote the message. Its absence
means the environment owner wrote it, which is the overwhelmingly common case and keeps existing rows
untouched. It follows the same path `employeeId` already does — command → event payload → projector →
`projection_thread_messages.author_json` → snapshot query — so the host's timeline and the guest's
room agree about who said what.

A friend's prompt is dispatched as an ordinary `thread.turn.start`. Running it through the same
command as the owner's composer is what makes queueing, interrupts, and checkpointing behave
identically for both people; there is no second code path for "remote" turns.

## Client transport

Guest links do **not** go through `EnvironmentRegistry`. Its supervisor bootstraps every connection
by reading server config, which needs `orchestration:read`, so a friend session would sit permanently
blocked — and registering the link would make a coworker's machine appear as an environment in every
environment picker.

Instead [link.ts][link] keeps a small reference-counted pool: one socket per friend, lingering
briefly after the last reader releases it so switching between two shared chats does not reconnect.
Guest subscriptions reconnect on a fixed five-second schedule, because a link that is down is almost
always down because the other machine is asleep, and a backoff that has wandered up to minutes would
make the room slow to come back when it wakes.

## Where the code lives

| Concern                                   | File                                         |
| ----------------------------------------- | -------------------------------------------- |
| Schemas, guest stream events, errors      | [contracts/src/friends.ts][contracts]        |
| Friend code encode/decode                 | [shared/src/friendCode.ts][code]             |
| Links, shares, local profile              | [server/src/friends/FriendStore.ts][store]   |
| Handshake, sharing, guest projections     | [FriendService.ts][service]                  |
| Who is viewing which thread               | [FriendPresence.ts][presence]                |
| Scope table                               | [RpcAuthorization.ts][rpcauth]               |
| Client guest transport                    | [client-runtime/src/friends/link.ts][link]   |
| Owner atoms / guest atoms                 | `state/friends.ts`, `state/sharedThreads.ts` |
| Settings, share control, shared chat view | `apps/web/src/components/friends/`           |

## Not built

Listed to keep the model honest:

- mobile surfaces — the contracts and server are surface-agnostic, but no React Native screens exist;
- shared diffs and tool activity — a guest sees the conversation, not the work detail;
- group rooms — a share is a grant to one friend, and a thread with three friends is three grants;
- reaching a friend who is offline — there is no store-and-forward, by design.

[auth]: ../../packages/contracts/src/auth.ts
[contracts]: ../../packages/contracts/src/friends.ts
[rpc]: ../../packages/contracts/src/rpc.ts
[code]: ../../packages/shared/src/friendCode.ts
[store]: ../../apps/server/src/friends/FriendStore.ts
[service]: ../../apps/server/src/friends/FriendService.ts
[presence]: ../../apps/server/src/friends/FriendPresence.ts
[rpcauth]: ../../apps/server/src/auth/RpcAuthorization.ts
[envauth]: ../../apps/server/src/auth/EnvironmentAuth.ts
[ws]: ../../apps/server/src/ws.ts
[link]: ../../packages/client-runtime/src/friends/link.ts
[reducer]: ../../apps/web/src/components/friends/sharedRoom.logic.ts
[usefriends]: ../../apps/web/src/components/friends/useFriends.ts
