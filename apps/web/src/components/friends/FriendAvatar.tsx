import type { FriendAvatarColor } from "@t3tools/contracts";

import { cn } from "../../lib/utils";
import { friendAvatarClasses, friendInitials } from "./friendPresentation";

/**
 * A friend's face throughout the app. Presence rides on the avatar rather than a
 * separate badge so a row stays readable at a glance in a dense list.
 */
export function FriendAvatar({
  displayName,
  avatarColor,
  presence,
  size = "md",
  className,
}: {
  readonly displayName: string;
  readonly avatarColor: FriendAvatarColor;
  readonly presence?: "online" | "offline";
  readonly size?: "sm" | "md";
  readonly className?: string;
}) {
  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        aria-hidden
        className={cn(
          "inline-flex items-center justify-center rounded-full font-medium ring-1",
          friendAvatarClasses(avatarColor),
          size === "sm" ? "size-6 text-[10px]" : "size-9 text-xs",
        )}
      >
        {friendInitials(displayName)}
      </span>
      {presence === undefined ? null : (
        <span
          aria-hidden
          className={cn(
            "absolute right-0 bottom-0 rounded-full ring-2 ring-background",
            size === "sm" ? "size-2" : "size-2.5",
            presence === "online" ? "bg-green-500" : "bg-muted-foreground/40",
          )}
        />
      )}
      <span className="sr-only">
        {displayName}
        {presence === undefined ? "" : presence === "online" ? " (online)" : " (offline)"}
      </span>
    </span>
  );
}
