"use client";

import { CheckIcon, CopyIcon, LinkIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { FRIEND_AVATAR_COLORS, type Friend, type FriendAvatarColor } from "@t3tools/contracts";
import { looksLikeFriendCode } from "@t3tools/shared/friendCode";
import { useEffect, useState } from "react";

import { cn } from "../../lib/utils";
import { friendsEnvironment } from "../../state/friends";
import { useAtomCommand } from "../../state/use-atom-command";
import { FriendAvatar } from "../friends/FriendAvatar";
import { friendStatus, friendSwatchClasses } from "../friends/friendPresentation";
import { useFriends } from "../friends/useFriends";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { searchableSetting } from "./settingsSearch";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

function CopyableCode({ code }: { readonly code: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1_800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex w-full items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-border/60 bg-muted/40 px-3 py-2 font-mono text-xs text-foreground">
        {code}
      </code>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => setCopied(true));
        }}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

function AvatarColorPicker({
  value,
  onChange,
}: {
  readonly value: FriendAvatarColor;
  readonly onChange: (color: FriendAvatarColor) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FRIEND_AVATAR_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={color === value}
          onClick={() => onChange(color)}
          className={cn(
            "size-6 rounded-full ring-offset-2 ring-offset-background transition-shadow",
            friendSwatchClasses(color),
            color === value ? "ring-2 ring-foreground/70" : "hover:ring-2 hover:ring-border",
          )}
        />
      ))}
    </div>
  );
}

function FriendRow({
  friend,
  sharedCount,
  onRemove,
  removing,
}: {
  readonly friend: Friend;
  readonly sharedCount: number;
  readonly onRemove: () => void;
  readonly removing: boolean;
}) {
  const status = friendStatus(friend);
  return (
    <SettingsRow
      title={
        <span className="flex items-center gap-2.5">
          <FriendAvatar
            displayName={friend.profile.displayName}
            avatarColor={friend.profile.avatarColor}
            presence={friend.presence}
          />
          <span className="min-w-0">
            <span className="block truncate">{friend.profile.displayName}</span>
            <span className="block text-xs font-normal text-muted-foreground">
              {status.label}
              {sharedCount > 0
                ? ` · ${sharedCount} shared ${sharedCount === 1 ? "chat" : "chats"}`
                : ""}
            </span>
          </span>
        </span>
      }
      description={status.detail ?? undefined}
      control={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1.5 text-muted-foreground hover:text-destructive"
          disabled={removing}
          onClick={onRemove}
        >
          <Trash2Icon className="size-3.5" />
          Remove
        </Button>
      }
    />
  );
}

export function FriendsSettings() {
  const { environmentId, snapshot, friends, error, isPending } = useFriends();
  const setting = searchableSetting("friends");

  const createInvite = useAtomCommand(friendsEnvironment.createInvite);
  const redeemInvite = useAtomCommand(friendsEnvironment.redeemInvite, { reportFailure: false });
  const removeFriend = useAtomCommand(friendsEnvironment.removeFriend);
  const updateProfile = useAtomCommand(friendsEnvironment.updateProfile);

  const [myCode, setMyCode] = useState<string | null>(null);
  const [pastedCode, setPastedCode] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"invite" | "redeem" | "remove" | null>(null);
  const [draftName, setDraftName] = useState<string | null>(null);

  const profile = snapshot?.profile ?? null;
  const displayName = draftName ?? profile?.displayName ?? "";
  const sharesByFriend = new Map<string, number>();
  for (const share of snapshot?.shares ?? []) {
    sharesByFriend.set(share.friendId, (sharesByFriend.get(share.friendId) ?? 0) + 1);
  }

  const commitName = () => {
    if (environmentId === null || draftName === null) return;
    const trimmed = draftName.trim();
    setDraftName(null);
    if (trimmed.length === 0 || trimmed === profile?.displayName) return;
    void updateProfile({ environmentId, input: { displayName: trimmed } });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection {...setting} icon={<UsersIcon className="size-5" />}>
        <SettingsRow
          title="How you appear"
          description="The name and color your friends see next to anything you say in a shared chat."
          control={
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Input
                value={displayName}
                disabled={environmentId === null}
                onChange={(event) => setDraftName(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
                className="w-full sm:w-52"
                placeholder="Your name"
              />
            </div>
          }
        >
          {profile === null ? null : (
            <div className="flex items-center gap-3 pt-3 pb-2">
              <FriendAvatar
                displayName={displayName}
                avatarColor={profile.avatarColor}
                presence="online"
              />
              <AvatarColorPicker
                value={profile.avatarColor}
                onChange={(avatarColor) => {
                  if (environmentId === null) return;
                  void updateProfile({ environmentId, input: { avatarColor } });
                }}
              />
            </div>
          )}
        </SettingsRow>

        <SettingsRow
          title="Invite a friend"
          description="Send them this code. It works once, expires in a week, and lets their copy of ML Code connect straight to yours."
          control={
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={environmentId === null || busy === "invite"}
              onClick={() => {
                if (environmentId === null) return;
                setBusy("invite");
                void createInvite({ environmentId, input: {} })
                  .then((result) => {
                    if (result._tag === "Success") {
                      setMyCode(result.value.code);
                    }
                  })
                  .finally(() => setBusy(null));
              }}
            >
              <LinkIcon className="size-3.5" />
              {myCode === null ? "Create code" : "New code"}
            </Button>
          }
        >
          {myCode === null ? null : (
            <div className="pt-3 pb-2">
              <CopyableCode code={myCode} />
              <p className="pt-2 text-xs text-muted-foreground">
                Treat this like a password: anyone holding it can link to you until it is used.
              </p>
            </div>
          )}
        </SettingsRow>

        <SettingsRow
          title="Add a friend"
          description="Paste the code they sent you."
          control={
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Input
                value={pastedCode}
                placeholder="mlfriend1_…"
                disabled={environmentId === null}
                onChange={(event) => {
                  setPastedCode(event.target.value);
                  setLinkError(null);
                }}
                className="w-full sm:w-64"
              />
              <Button
                type="button"
                size="sm"
                disabled={
                  environmentId === null || busy === "redeem" || !looksLikeFriendCode(pastedCode)
                }
                onClick={() => {
                  if (environmentId === null) return;
                  setBusy("redeem");
                  setLinkError(null);
                  void redeemInvite({ environmentId, input: { code: pastedCode.trim() } })
                    .then((result) => {
                      if (result._tag === "Success") {
                        setPastedCode("");
                        return;
                      }
                      const failure = result.cause;
                      setLinkError(
                        failure !== undefined && "message" in (failure as object)
                          ? String((failure as { message?: string }).message ?? "")
                          : "That code could not be used.",
                      );
                    })
                    .finally(() => setBusy(null));
                }}
              >
                Link
              </Button>
            </div>
          }
        >
          {linkError === null ? null : (
            <p className="pt-2 pb-2 text-xs text-destructive">{linkError}</p>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Your friends" icon={<UsersIcon className="size-5" />}>
        {error !== null ? (
          <SettingsRow title="Could not load friends" description={error} />
        ) : friends.length === 0 ? (
          <SettingsRow
            title="Nobody yet"
            description={
              isPending
                ? "Loading…"
                : "Swap friend codes with a coworker, then share a chat with them from its menu."
            }
          />
        ) : (
          friends.map((friend) => (
            <FriendRow
              key={friend.friendId}
              friend={friend}
              sharedCount={sharesByFriend.get(friend.friendId) ?? 0}
              removing={busy === "remove"}
              onRemove={() => {
                if (environmentId === null) return;
                setBusy("remove");
                void removeFriend({
                  environmentId,
                  input: { friendId: friend.friendId },
                }).finally(() => setBusy(null));
              }}
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection title="What a friend can see" icon={<UsersIcon className="size-5" />}>
        <SettingsRow
          title="Only the chats you share"
          description="A friend link grants nothing on its own. Friends see a chat only after you share it from that chat's menu, and they see nothing else on this machine — no other projects, no terminal, no files."
          control={<Badge variant="secondary">Per-chat</Badge>}
        />
        <SettingsRow
          title="You approve, they don't"
          description="When the agent asks permission to run something, that decision stays with you. Friends see that you are being asked, never the buttons."
          control={<Badge variant="secondary">Host only</Badge>}
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
