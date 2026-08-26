"use client";

import { useAtomValue } from "@effect/atom-react";
import type { FriendId, SharedThreadMessage, ThreadId } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { SendIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { sharedThreads } from "../../state/friends";
import { useAtomCommand } from "../../state/use-atom-command";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { FriendAvatar } from "./FriendAvatar";
import {
  agentStateLabel,
  EMPTY_SHARED_ROOM,
  reduceSharedRoom,
  type SharedRoomState,
} from "./sharedRoom.logic";
import { useFriends } from "./useFriends";

/** Stand-in while no room is selected, so hook order stays stable. */
const IDLE_ROOM_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("friends:shared-thread:idle"),
);

function MessageRow({
  message,
  hostName,
  hostColor,
}: {
  readonly message: SharedThreadMessage;
  readonly hostName: string;
  readonly hostColor: Parameters<typeof FriendAvatar>[0]["avatarColor"];
}) {
  if (message.role === "system") {
    return <p className="px-1 py-2 text-center text-xs text-muted-foreground">{message.text}</p>;
  }
  const isAgent = message.role === "assistant";
  // A user row is either the host's or a friend's; `author` is set only in the
  // second case, so its absence is what identifies the host.
  const name = isAgent ? (message.speaker ?? "Agent") : (message.author?.displayName ?? hostName);
  const color = isAgent ? "teal" : (message.author?.avatarColor ?? hostColor);

  return (
    <div className="flex gap-2.5 px-1 py-2">
      <FriendAvatar displayName={name} avatarColor={color} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="pb-0.5 text-xs font-medium text-foreground">{name}</p>
        {isAgent ? (
          <ChatMarkdown
            text={message.text}
            cwd={undefined}
            isStreaming={message.streaming}
            className="text-sm"
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap text-foreground">{message.text}</p>
        )}
      </div>
    </div>
  );
}

/**
 * A chat a friend has shared with us, live from their machine.
 *
 * This is deliberately not the full ChatView: a guest has no workspace, no
 * terminal, and no diff pane on somebody else's computer. What it does have is
 * the conversation — the same messages, the same streaming, attributed to
 * whoever typed them — which is the part that makes it collaborative.
 */
export function SharedChatView({
  friendId,
  threadId,
}: {
  readonly friendId: FriendId;
  readonly threadId: ThreadId;
}) {
  const { environmentId, friends } = useFriends();
  const friend = friends.find((candidate) => candidate.friendId === friendId) ?? null;
  const post = useAtomCommand(sharedThreads.post, { reportFailure: false });
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const roomAtom = useMemo(
    () =>
      environmentId === null || friend === null
        ? null
        : sharedThreads.room({
            environmentId,
            friendId,
            friendEnvironmentId: friend.profile.environmentId,
            threadId,
          }),
    [environmentId, friend, friendId, threadId],
  );

  const [room, setRoom] = useState<SharedRoomState>(EMPTY_SHARED_ROOM);
  const result = useAtomValue(roomAtom ?? IDLE_ROOM_ATOM);
  const latestEvent = AsyncResult.value(result);

  useEffect(() => {
    if (latestEvent._tag !== "Some") return;
    setRoom((current) => reduceSharedRoom(current, latestEvent.value));
  }, [latestEvent]);

  // Reset when switching rooms, otherwise the previous conversation would show
  // through until the new snapshot lands.
  useEffect(() => {
    setRoom(EMPTY_SHARED_ROOM);
    setDraft("");
    setSendError(null);
  }, [friendId, threadId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [room.messages]);

  if (friend === null || environmentId === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        That friend is no longer linked.
      </div>
    );
  }

  const hostName = friend.profile.displayName;
  const status = agentStateLabel(room.agentState, hostName);
  const canSend = room.thread?.canPrompt === true && room.closed === null;

  const send = () => {
    const text = draft.trim();
    if (text.length === 0 || !canSend) return;
    setSending(true);
    setSendError(null);
    void post({
      environmentId,
      friendId,
      friendEnvironmentId: friend.profile.environmentId,
      threadId,
      text,
    })
      .then((outcome) => {
        if (outcome._tag === "Success") {
          setDraft("");
          return;
        }
        setSendError("That message could not be delivered. They may have gone offline.");
      })
      .finally(() => setSending(false));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2.5 border-b border-border/60 px-4 py-2.5">
        <FriendAvatar
          displayName={hostName}
          avatarColor={friend.profile.avatarColor}
          presence={friend.presence}
          size="sm"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-foreground">
            {room.thread?.title ?? "Shared chat"}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {hostName}
            {room.thread ? ` · ${room.thread.projectTitle}` : ""}
          </p>
        </div>
        {room.participants.length > 0 ? (
          <span className="flex -space-x-1.5">
            {room.participants.map((participant) => (
              <FriendAvatar
                key={participant.friendId}
                displayName={participant.displayName}
                avatarColor={participant.avatarColor}
                size="sm"
              />
            ))}
          </span>
        ) : null}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {room.thread === null && room.closed === null ? (
          <p className="px-1 py-6 text-center text-sm text-muted-foreground">
            Connecting to {hostName}…
          </p>
        ) : null}
        {room.messages.map((message) => (
          <MessageRow
            key={message.messageId}
            message={message}
            hostName={hostName}
            hostColor={friend.profile.avatarColor}
          />
        ))}
        {status === null ? null : (
          <p className="px-1 py-2 text-xs text-muted-foreground">{status}</p>
        )}
      </div>

      {room.closed !== null ? (
        <p className="border-t border-border/60 px-4 py-3 text-sm text-muted-foreground">
          {room.closed === "unshared"
            ? `${hostName} stopped sharing this chat.`
            : `${hostName} deleted this chat.`}
        </p>
      ) : (
        <div className="border-t border-border/60 px-3 py-2.5">
          {canSend ? (
            <>
              <div className="flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  rows={2}
                  placeholder={`Message ${hostName} and the agent…`}
                  className="min-h-0 flex-1 resize-none"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={sending || draft.trim().length === 0}
                  onClick={send}
                  className="gap-1.5"
                >
                  <SendIcon className="size-3.5" />
                  Send
                </Button>
              </div>
              {sendError === null ? null : (
                <p className={cn("pt-1.5 text-xs text-destructive")}>{sendError}</p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {hostName} shared this chat with you to read. They have not enabled sending messages.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
