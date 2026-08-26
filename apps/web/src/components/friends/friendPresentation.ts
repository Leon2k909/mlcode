import {
  DEFAULT_FRIEND_AVATAR_COLOR,
  type Friend,
  type FriendAvatarColor,
  type FriendLinkStatus,
} from "@t3tools/contracts";

/**
 * Avatar colors map to the same palette tokens the rest of the app uses, so a
 * friend's dot matches whatever theme is active instead of carrying its own
 * hard-coded hex around.
 */
const AVATAR_CLASSES: Readonly<Record<FriendAvatarColor, string>> = {
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-blue-500/30",
  green: "bg-green-500/15 text-green-600 dark:text-green-400 ring-green-500/30",
  purple: "bg-purple-500/15 text-purple-600 dark:text-purple-400 ring-purple-500/30",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-400 ring-orange-500/30",
  pink: "bg-pink-500/15 text-pink-600 dark:text-pink-400 ring-pink-500/30",
  teal: "bg-teal-500/15 text-teal-600 dark:text-teal-400 ring-teal-500/30",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500/30",
  rose: "bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-rose-500/30",
};

const SWATCH_CLASSES: Readonly<Record<FriendAvatarColor, string>> = {
  blue: "bg-blue-500",
  green: "bg-green-500",
  purple: "bg-purple-500",
  orange: "bg-orange-500",
  pink: "bg-pink-500",
  teal: "bg-teal-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
};

export function friendAvatarClasses(color: FriendAvatarColor | undefined): string {
  return AVATAR_CLASSES[color ?? DEFAULT_FRIEND_AVATAR_COLOR];
}

export function friendSwatchClasses(color: FriendAvatarColor): string {
  return SWATCH_CLASSES[color];
}

/**
 * One or two letters, taken from word starts. Falls back to a neutral glyph so
 * an empty display name never renders an empty circle.
 */
export function friendInitials(displayName: string): string {
  const words = displayName
    .split(/\s+/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
  if (words.length === 0) {
    return "?";
  }
  const first = words[0]?.[0] ?? "";
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${second}`.toLocaleUpperCase();
}

export interface FriendStatusPresentation {
  readonly label: string;
  /** Longer explanation, shown when the short label needs justifying. */
  readonly detail: string | null;
  readonly tone: "online" | "offline" | "warning";
}

/**
 * Presence and link health are two different failures wearing similar clothes.
 * Offline means "their machine is asleep"; a half-formed link means "we never
 * finished exchanging credentials", and only the second one needs the user to
 * do something.
 */
export function friendStatus(friend: {
  readonly presence: Friend["presence"];
  readonly linkStatus: FriendLinkStatus;
}): FriendStatusPresentation {
  if (friend.linkStatus === "unreachable") {
    return {
      label: "Link incomplete",
      detail:
        "They can reach you, but you cannot reach them. Ask them for a fresh friend code to finish the connection.",
      tone: "warning",
    };
  }
  if (friend.linkStatus === "pending") {
    return {
      label: "Finishing up",
      detail: "Waiting for them to come online so the connection can finish setting up.",
      tone: "warning",
    };
  }
  return friend.presence === "online"
    ? { label: "Online", detail: null, tone: "online" }
    : { label: "Offline", detail: null, tone: "offline" };
}

/** Sorts online friends first, then alphabetically — the order people scan in. */
export function sortFriends<T extends Friend>(friends: ReadonlyArray<T>): ReadonlyArray<T> {
  return [...friends].sort((left, right) => {
    if (left.presence !== right.presence) {
      return left.presence === "online" ? -1 : 1;
    }
    return left.profile.displayName.localeCompare(right.profile.displayName);
  });
}
