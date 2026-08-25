import type { FriendId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { FriendStore, layer as friendStoreLayer } from "./FriendStore.ts";

const layer = it.layer(friendStoreLayer.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

const CREATED_AT = "2026-08-25T10:00:00.000Z";

// One in-memory database is shared by the whole suite, so every case works on
// its own friend and thread rather than assuming a clean table.
const friendNamed = (name: string) => ({
  friendId: `friend-${name}` as FriendId,
  environmentId: `env-${name}`,
  displayName: name,
  avatarColor: "purple" as const,
  httpBaseUrl: "http://10.0.0.5:3773",
  accessToken: `token-for-${name}`,
  linkStatus: "linked" as const,
  inviteSubject: `friend-invite:${name}`,
  announceCode: "mlfriend1_reciprocal",
  createdAt: CREATED_AT,
});

const threadNamed = (name: string) => `thread-${name}` as ThreadId;

layer("FriendStore", (it) => {
  it.effect("resolves an authenticated friend session back to its link", () =>
    Effect.gen(function* () {
      const store = yield* FriendStore;
      const alice = friendNamed("resolves");
      yield* store.upsert(alice);

      // The session subject is the only thing a guest RPC can be trusted with,
      // so this lookup is the hinge the whole guest surface turns on.
      const found = yield* store.findByInviteSubject(alice.inviteSubject);
      assert.isTrue(Option.isSome(found));
      assert.equal(Option.getOrThrow(found).displayName, "resolves");

      const missing = yield* store.findByInviteSubject("friend-invite:nobody");
      assert.isTrue(Option.isNone(missing));
    }),
  );

  it.effect("grants and revokes access one thread at a time", () =>
    Effect.gen(function* () {
      const store = yield* FriendStore;
      const alice = friendNamed("grants");
      const threadId = threadNamed("grants");
      yield* store.upsert(alice);

      assert.isTrue(
        Option.isNone(yield* store.findShare({ threadId, friendId: alice.friendId })),
        "a linked friend starts with access to nothing",
      );

      yield* store.putShare({
        threadId,
        friendId: alice.friendId,
        canPrompt: false,
        createdAt: alice.createdAt,
      });
      const watching = yield* store.findShare({ threadId, friendId: alice.friendId });
      assert.equal(Option.getOrThrow(watching).canPrompt, false);

      // Re-sharing upgrades in place rather than stacking a second grant.
      yield* store.putShare({
        threadId,
        friendId: alice.friendId,
        canPrompt: true,
        createdAt: alice.createdAt,
      });
      const chatting = yield* store.listSharesForFriend(alice.friendId);
      assert.equal(chatting.length, 1);
      assert.equal(chatting[0]?.canPrompt, true);

      yield* store.removeShare({ threadId, friendId: alice.friendId });
      assert.isTrue(Option.isNone(yield* store.findShare({ threadId, friendId: alice.friendId })));
    }),
  );

  it.effect("takes every share with the friend when the friend is removed", () =>
    Effect.gen(function* () {
      const store = yield* FriendStore;
      const alice = friendNamed("removed");
      const threadId = threadNamed("removed");
      yield* store.upsert(alice);
      yield* store.putShare({
        threadId,
        friendId: alice.friendId,
        canPrompt: true,
        createdAt: alice.createdAt,
      });

      yield* store.remove(alice.friendId);

      assert.isTrue(Option.isNone(yield* store.findById(alice.friendId)));
      assert.equal((yield* store.listSharesForFriend(alice.friendId)).length, 0);
    }),
  );

  it.effect("drops a deleted thread's audience", () =>
    Effect.gen(function* () {
      const store = yield* FriendStore;
      const alice = friendNamed("deleted-thread");
      const threadId = threadNamed("deleted-thread");
      yield* store.upsert(alice);
      yield* store.putShare({
        threadId,
        friendId: alice.friendId,
        canPrompt: true,
        createdAt: alice.createdAt,
      });

      yield* store.removeSharesForThread(threadId);

      assert.equal((yield* store.listSharesForFriend(alice.friendId)).length, 0);
      assert.isTrue(Option.isSome(yield* store.findById(alice.friendId)), "the friend remains");
    }),
  );

  it.effect("keeps the outbound credential out of a half-formed link", () =>
    Effect.gen(function* () {
      const store = yield* FriendStore;
      const alice = friendNamed("half-formed");
      yield* store.upsert({
        ...alice,
        httpBaseUrl: null,
        accessToken: null,
        linkStatus: "pending",
        announceCode: null,
      });

      const pending = Option.getOrThrow(yield* store.findById(alice.friendId));
      assert.equal(pending.linkStatus, "pending");
      assert.isNull(pending.accessToken);

      yield* store.setOutboundLink({
        friendId: alice.friendId,
        httpBaseUrl: alice.httpBaseUrl,
        accessToken: alice.accessToken,
        linkStatus: "linked",
      });
      const linked = Option.getOrThrow(yield* store.findById(alice.friendId));
      assert.equal(linked.linkStatus, "linked");
      assert.equal(linked.accessToken, alice.accessToken);
    }),
  );

  it.effect("clears the reciprocal code once it has been delivered", () =>
    Effect.gen(function* () {
      const store = yield* FriendStore;
      const alice = friendNamed("announced");
      yield* store.upsert(alice);
      yield* store.clearAnnounceCode(alice.friendId);
      assert.isNull(Option.getOrThrow(yield* store.findById(alice.friendId)).announceCode);
    }),
  );

  it.effect("remembers the profile this environment shows to friends", () =>
    Effect.gen(function* () {
      const store = yield* FriendStore;
      assert.isTrue(Option.isNone(yield* store.readIdentity()));

      yield* store.writeIdentity({
        displayName: "Leon",
        avatarColor: "teal",
        updatedAt: CREATED_AT,
      });
      yield* store.writeIdentity({
        displayName: "Leon S",
        avatarColor: "rose",
        updatedAt: CREATED_AT,
      });

      const identity = Option.getOrThrow(yield* store.readIdentity());
      assert.deepEqual(identity, { displayName: "Leon S", avatarColor: "rose" });
    }),
  );
});
