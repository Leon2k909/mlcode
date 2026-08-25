import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, Friend, FriendsSnapshot, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";

import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { useEnvironmentQuery } from "../../state/query";
import { friendsEnvironment, sharedThreads } from "../../state/friends";
import { useAtomCommand } from "../../state/use-atom-command";
import { sortFriends } from "./friendPresentation";

/**
 * How long to wait before re-offering a reciprocal code to a friend who did not
 * take it. Long enough that an unreachable friend is nearly free, short enough
 * that a link finishes within a minute of them opening the app.
 */
const ANNOUNCE_RETRY_MS = 30_000;

export interface FriendsView {
  readonly environmentId: EnvironmentId | null;
  readonly snapshot: FriendsSnapshot | null;
  readonly friends: ReadonlyArray<Friend>;
  readonly error: string | null;
  readonly isPending: boolean;
}

/** The friends list for the environment this device is signed into. */
export function useFriends(): FriendsView {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const query = useEnvironmentQuery(
    environmentId === null ? null : friendsEnvironment.snapshot({ environmentId, input: {} }),
  );
  const friends = useMemo(() => sortFriends(query.data?.friends ?? []), [query.data]);
  return {
    environmentId,
    snapshot: query.data,
    friends,
    error: query.error,
    isPending: query.isPending,
  };
}

/** Which friends a given chat is currently shared with. */
export function useThreadAudience(threadId: ThreadId | null): ReadonlyArray<{
  readonly friend: Friend;
  readonly canPrompt: boolean;
}> {
  const { snapshot, friends } = useFriends();
  return useMemo(() => {
    if (threadId === null || snapshot === null) {
      return [];
    }
    const byId = new Map(friends.map((friend) => [friend.friendId, friend]));
    return snapshot.shares
      .filter((share) => share.threadId === threadId)
      .flatMap((share) => {
        const friend = byId.get(share.friendId);
        return friend === undefined ? [] : [{ friend, canPrompt: share.canPrompt }];
      });
  }, [friends, snapshot, threadId]);
}

/**
 * Finishes half-formed links in the background.
 *
 * When you redeem someone's friend code your server mints a reciprocal one and
 * parks it on the friend row. Only a client can deliver it, because only a
 * client holds a socket to their machine — so this watches for a parked code and
 * hands it over the moment the friend is reachable, then tells our server to
 * stop asking.
 */
export function useFriendLinkCompletion(): void {
  const { environmentId, snapshot, friends } = useFriends();
  const announce = useAtomCommand(sharedThreads.announce, {
    label: "friends:announce",
    // A friend who is asleep is the expected reason this fails; it retries
    // later rather than shouting at the user.
    reportFailure: false,
  });
  const markAnnounced = useAtomCommand(friendsEnvironment.markAnnounced, {
    reportFailure: false,
  });
  const inFlight = useRef(new Set<string>());
  const nextAttemptAt = useRef(new Map<string, number>());

  useEffect(() => {
    if (environmentId === null || snapshot === null) {
      return;
    }
    // This cannot wait for the friend to look online: presence means *they*
    // hold a session on us, which is the very thing this announcement is about
    // to make possible. So it retries blind, and the throttle is what keeps a
    // friend who never comes back from costing a socket attempt every time
    // anything at all changes in the snapshot.
    const now = Date.now();
    for (const friend of friends) {
      const code = friend.announceCode;
      if (code === null || friend.linkStatus !== "linked") {
        continue;
      }
      if (inFlight.current.has(friend.friendId)) {
        continue;
      }
      if ((nextAttemptAt.current.get(friend.friendId) ?? 0) > now) {
        continue;
      }
      inFlight.current.add(friend.friendId);
      nextAttemptAt.current.set(friend.friendId, now + ANNOUNCE_RETRY_MS);
      void announce({
        environmentId,
        friendId: friend.friendId,
        friendEnvironmentId: friend.profile.environmentId,
        profile: snapshot.profile,
        reciprocalCode: code,
      })
        .then((result) => {
          if (result._tag !== "Success") {
            return undefined;
          }
          nextAttemptAt.current.delete(friend.friendId);
          return markAnnounced({
            environmentId,
            input: { friendId: friend.friendId },
          });
        })
        .finally(() => {
          inFlight.current.delete(friend.friendId);
        });
    }
  }, [announce, environmentId, friends, markAnnounced, snapshot]);
}
