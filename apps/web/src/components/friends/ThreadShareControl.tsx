import type { EnvironmentId, Friend, ThreadId } from "@t3tools/contracts";
import { UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../../lib/utils";
import { friendsEnvironment } from "../../state/friends";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { FriendAvatar } from "./FriendAvatar";
import { friendStatus } from "./friendPresentation";
import { useFriends, useThreadAudience } from "./useFriends";

type ShareLevel = "off" | "watch" | "chat";

const LEVEL_LABELS: Readonly<Record<ShareLevel, string>> = {
  off: "Off",
  watch: "Can watch",
  chat: "Can chat",
};

/**
 * The three states are the whole permission model for a chat, so they are shown
 * together rather than hidden behind a toggle: seeing "Off / Can watch / Can
 * chat" side by side is what makes it obvious that sharing is per-chat and that
 * watching is not the same as driving.
 */
function ShareLevelPicker({
  value,
  disabled,
  onChange,
}: {
  readonly value: ShareLevel;
  readonly disabled: boolean;
  readonly onChange: (level: ShareLevel) => void;
}) {
  return (
    <div
      role="group"
      className="inline-flex shrink-0 overflow-hidden rounded-lg border border-border/70"
    >
      {(["off", "watch", "chat"] as const).map((level) => (
        <button
          key={level}
          type="button"
          disabled={disabled}
          aria-pressed={value === level}
          onClick={() => onChange(level)}
          className={cn(
            "px-2 py-1 text-[11px] transition-colors disabled:opacity-50",
            value === level
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {LEVEL_LABELS[level]}
        </button>
      ))}
    </div>
  );
}

function FriendShareRow({
  friend,
  level,
  busy,
  onChange,
}: {
  readonly friend: Friend;
  readonly level: ShareLevel;
  readonly busy: boolean;
  readonly onChange: (level: ShareLevel) => void;
}) {
  const status = friendStatus(friend);
  const unreachable = friend.linkStatus !== "linked";
  return (
    <div className="flex items-center gap-2.5 px-1 py-1.5">
      <FriendAvatar
        displayName={friend.profile.displayName}
        avatarColor={friend.profile.avatarColor}
        presence={friend.presence}
        size="sm"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">
          {friend.profile.displayName}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{status.label}</span>
      </span>
      <ShareLevelPicker value={level} disabled={busy || unreachable} onChange={onChange} />
    </div>
  );
}

/**
 * Who this chat is shared with, and the control for changing it. Lives in the
 * chat header because sharing is a property of the conversation you are looking
 * at, not a global setting.
 */
export function ThreadShareControl({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { friends, environmentId: primaryEnvironmentId } = useFriends();
  const audience = useThreadAudience(threadId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const shareThread = useAtomCommand(friendsEnvironment.shareThread);
  const unshareThread = useAtomCommand(friendsEnvironment.unshareThread);

  const levels = useMemo(() => {
    const map = new Map<string, ShareLevel>();
    for (const entry of audience) {
      map.set(entry.friend.friendId, entry.canPrompt ? "chat" : "watch");
    }
    return map;
  }, [audience]);

  // Sharing is only meaningful for chats living on the environment that holds
  // the friend links; a thread on another machine is that machine's to share.
  if (friends.length === 0 || primaryEnvironmentId !== environmentId) {
    return null;
  }

  const applyLevel = (friendId: string, level: ShareLevel) => {
    setBusy(true);
    const done = () => setBusy(false);
    if (level === "off") {
      void unshareThread({
        environmentId,
        input: { threadId, friendId: friendId as Friend["friendId"] },
      }).finally(done);
      return;
    }
    void shareThread({
      environmentId,
      input: {
        threadId,
        friendId: friendId as Friend["friendId"],
        canPrompt: level === "chat",
      },
    }).finally(done);
  };

  const sharedWith = audience.map((entry) => entry.friend);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={
                    sharedWith.length === 0
                      ? "Share this chat with a friend"
                      : `Shared with ${sharedWith.length} ${sharedWith.length === 1 ? "friend" : "friends"}`
                  }
                  className="h-7 gap-1.5 px-2"
                >
                  {sharedWith.length === 0 ? (
                    <UserPlusIcon className="size-3.5" />
                  ) : (
                    <span className="flex -space-x-1.5">
                      {sharedWith.slice(0, 3).map((friend) => (
                        <FriendAvatar
                          key={friend.friendId}
                          displayName={friend.profile.displayName}
                          avatarColor={friend.profile.avatarColor}
                          presence={friend.presence}
                          size="sm"
                        />
                      ))}
                    </span>
                  )}
                  {sharedWith.length > 3 ? (
                    <span className="text-[11px] text-muted-foreground">
                      +{sharedWith.length - 3}
                    </span>
                  ) : null}
                </Button>
              }
            />
          }
        />
        <TooltipPopup side="bottom">
          {sharedWith.length === 0
            ? "Share this chat"
            : `Shared with ${sharedWith.map((friend) => friend.profile.displayName).join(", ")}`}
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup side="bottom" align="end" className="w-80 max-w-none">
        <div className="p-[var(--floating-content-inset)]">
          <p className="px-1 pb-1 text-xs font-medium text-foreground">Share this chat</p>
          <p className="px-1 pb-2 text-[11px] leading-relaxed text-muted-foreground">
            They see this conversation and nothing else on this machine. You still approve anything
            the agent wants to run.
          </p>
          <div className="max-h-72 overflow-y-auto">
            {friends.map((friend) => (
              <FriendShareRow
                key={friend.friendId}
                friend={friend}
                level={levels.get(friend.friendId) ?? "off"}
                busy={busy}
                onChange={(level) => applyLevel(friend.friendId, level)}
              />
            ))}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}
