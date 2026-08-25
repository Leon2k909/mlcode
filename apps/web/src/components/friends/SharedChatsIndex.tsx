"use client";

import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId, Friend, SharedThreadSummary } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { MessagesSquareIcon, UsersRoundIcon } from "lucide-react";
import * as Option from "effect/Option";

import { sharedThreads } from "../../state/friends";
import { FriendAvatar } from "./FriendAvatar";
import { friendStatus } from "./friendPresentation";
import { useFriends } from "./useFriends";

const IDLE_LIST_ATOM = Atom.make(
  AsyncResult.initial<ReadonlyArray<SharedThreadSummary>, never>(false),
).pipe(Atom.withLabel("friends:shared-threads:idle"));

/**
 * One friend's shared chats. Rendered per friend rather than as a merged list
 * because each row is a live subscription to a different machine, and a friend
 * being unreachable should degrade only their own section.
 */
function FriendSection({
  environmentId,
  friend,
}: {
  readonly environmentId: EnvironmentId;
  readonly friend: Friend;
}) {
  const reachable = friend.linkStatus === "linked";
  const result = useAtomValue(
    reachable
      ? sharedThreads.list({
          environmentId,
          friendId: friend.friendId,
          friendEnvironmentId: friend.profile.environmentId,
        })
      : IDLE_LIST_ATOM,
  );
  const threads = Option.getOrElse(
    AsyncResult.value(result) as Option.Option<ReadonlyArray<SharedThreadSummary>>,
    () => [] as ReadonlyArray<SharedThreadSummary>,
  );
  const status = friendStatus(friend);

  return (
    <section className="space-y-1">
      <div className="flex items-center gap-2.5 px-1 py-2">
        <FriendAvatar
          displayName={friend.profile.displayName}
          avatarColor={friend.profile.avatarColor}
          presence={friend.presence}
          size="sm"
        />
        <h2 className="text-sm font-medium text-foreground">{friend.profile.displayName}</h2>
        <span className="text-xs text-muted-foreground">{status.label}</span>
      </div>
      {threads.length === 0 ? (
        <p className="px-1 pb-3 text-xs text-muted-foreground">
          {!reachable
            ? (status.detail ?? "Not reachable yet.")
            : friend.presence === "offline"
              ? "Offline — their shared chats appear when they are back."
              : "They have not shared any chats with you."}
        </p>
      ) : (
        <ul className="space-y-1 pb-3">
          {threads.map((thread) => (
            <li key={thread.threadId}>
              <Link
                to="/friends/$friendId/$threadId"
                params={{ friendId: friend.friendId, threadId: thread.threadId }}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-accent"
              >
                <MessagesSquareIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-foreground">{thread.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {thread.projectTitle}
                    {thread.canPrompt ? "" : " · read only"}
                  </span>
                </span>
                {thread.agentBusy ? (
                  <span className="shrink-0 text-[11px] text-muted-foreground">working…</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Everything your friends currently share with you, grouped by person. */
export function SharedChatsIndex() {
  const { environmentId, friends, isPending } = useFriends();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="flex items-center gap-2 pb-4">
        <UsersRoundIcon className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold tracking-[-0.025em] text-foreground">
          Shared with me
        </h1>
      </header>
      {environmentId === null || friends.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isPending
            ? "Loading…"
            : "No friends yet. Add one from Settings → Friends, then anything they share shows up here."}
        </p>
      ) : (
        friends.map((friend) => (
          <FriendSection key={friend.friendId} environmentId={environmentId} friend={friend} />
        ))
      )}
    </div>
  );
}
