import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, Friend, FriendsSnapshot, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";

import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { useEnvironmentQuery } from "../../state/query";
import { friendsEnvironment, sharedThreads } from "../../state/friends";
import { useAtomCommand } from "../../state/use-atom-command";
import { sortFriends } from "./friendPresentation";

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
    // A friend who is asleep is the expected reason this fails; it retries on
    // the next snapshot rather than shouting at the user.
    reportFailure: false,
  });
  const markAnnounced = useAtomCommand(friendsEnvironment.markAnnounced, {
    reportFailure: false,
  });
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    if (environmentId === null || snapshot === null) {
      return;
    }
    const pending = friends.filter(
      (friend) => friend.announceCode !== null && friend.linkStatus === "linked",
    );
    for (const friend of pending) {
      if (inFlight.current.has(friend.friendId)) {
        continue;
      }
      const code = friend.announceCode;
      if (code === null) {
        continue;
      }
      inFlight.current.add(friend.friendId);
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
