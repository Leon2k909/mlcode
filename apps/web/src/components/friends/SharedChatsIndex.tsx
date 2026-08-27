"use client";

import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import type {
  EnvironmentId,
  Friend,
  FriendPartyActivity,
  SharedThreadSummary,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { MessagesSquareIcon, PartyPopperIcon, UsersRoundIcon } from "lucide-react";
import { useEffect, useState } from "react";
import * as Option from "effect/Option";

import { sharedThreads } from "../../state/friends";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { FriendAvatar } from "./FriendAvatar";
import { friendStatus } from "./friendPresentation";
import { describePartyActivity, usePartySharingFriendIds, useSetPartySharing } from "./party";
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
        {reachable ? <PartyToggle friend={friend} /> : null}
      </div>
      {friend.partyActivity !== undefined ? (
        <PartyActivityLine activity={friend.partyActivity} />
      ) : null}
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

/**
 * Opt in or out of sharing your own live activity with this friend. Sharing is
 * one-directional consent: their toggle governs what you see, yours governs
 * what they see, and a party is simply both being on.
 */
function PartyToggle({ friend }: { readonly friend: Friend }) {
  const sharingIds = usePartySharingFriendIds();
  const setSharing = useSetPartySharing();
  const sharing = sharingIds.includes(friend.friendId);
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="ml-auto flex shrink-0" />}>
        <Toggle
          pressed={sharing}
          onPressedChange={(next) => setSharing(friend.friendId, next)}
          aria-label={
            sharing
              ? `Stop sharing your live activity with ${friend.profile.displayName}`
              : `Party with ${friend.profile.displayName} — share your live activity`
          }
          variant="ghost"
          size="sm"
        >
          <PartyPopperIcon className="size-4" />
        </Toggle>
      </TooltipTrigger>
      <TooltipPopup side="bottom" className="max-w-72">
        {sharing
          ? `Party mode is on: ${friend.profile.displayName} can see which project and thread you are in, when you are active, and whether your agent is working. Never content, files, or paths. Toggle to stop.`
          : `Party with ${friend.profile.displayName}: share which project and thread you are in, when you are active, and whether your agent is working. Never content, files, or paths. You see theirs when they turn it on too.`}
      </TooltipPopup>
    </Tooltip>
  );
}

/**
 * The friend's live activity, when they share it and it is recent. Re-renders
 * on a slow clock so a friend who walks away fades out without a refresh.
 */
function PartyActivityLine({ activity }: { readonly activity: FriendPartyActivity }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(interval);
  }, []);
  const view = describePartyActivity(activity, nowMs);
  if (!view.fresh) {
    return null;
  }
  return (
    <p className="flex items-center gap-1.5 px-1 pb-2 text-xs text-muted-foreground">
      <span
        aria-hidden
        className={
          view.inputLive
            ? "size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
            : "size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
        }
      />
      <span className="min-w-0 truncate">
        {view.headline}
        {view.agentBusy ? " · agent working" : ""}
        {view.inputLive ? " · active now" : ""}
      </span>
    </p>
  );
}

/** Everything your friends currently share with you, grouped by person. */
export function SharedChatsIndex() {
  const { environmentId, friends, isLoading } = useFriends();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="flex items-center gap-2 pb-4">
        <UsersRoundIcon className="size-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold tracking-[-0.025em] text-foreground">
          Shared with me
        </h1>
      </header>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : environmentId === null || friends.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No friends yet. Add one from Settings → Friends, then anything they share shows up here.
        </p>
      ) : (
        friends.map((friend) => (
          <FriendSection key={friend.friendId} environmentId={environmentId} friend={friend} />
        ))
      )}
    </div>
  );
}
