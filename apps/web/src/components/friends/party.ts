/**
 * Party mode — live, mutual, explicitly opted-in activity between friends.
 *
 * Sharing is per friend and per direction: enabling it for a friend sends
 * them a coarse beacon (surface, a focus label, agent busy, a last-input
 * pulse), and says nothing about whether they send theirs. The beacon rides
 * the same guest link the shared chats use, and the receiving side reads it
 * off the friends snapshot it already subscribes to.
 *
 * Everything sent is deliberately coarse. Timestamps and titles, never
 * content, file paths, coordinates, or keys — "they are active in germ" is
 * the whole story a party member gets.
 */
import type {
  EnvironmentId,
  Friend,
  FriendPartyActivity,
  FriendPartySurface,
} from "@t3tools/contracts";
import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { useProjects, useThreadShells } from "~/state/entities";
import { sharedThreads } from "~/state/friends";
import { useAtomCommand } from "~/state/use-atom-command";

import { useFriends } from "./useFriends";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";

/** A beacon older than this renders as nothing at all. */
export const PARTY_ACTIVITY_FRESH_MS = 90_000;
/** Input newer than this shows the "actively clicking around" pulse. */
export const PARTY_INPUT_LIVE_MS = 15_000;
/** How often the sender re-evaluates and possibly sends. */
const SEND_TICK_MS = 15_000;
/** An unchanged beacon is still re-sent this often so it never reads stale. */
const HEARTBEAT_MS = 45_000;

export function resolvePartySurface(pathname: string): FriendPartySurface {
  if (pathname.startsWith("/settings/usage")) return "usage";
  if (pathname.startsWith("/settings") || pathname.startsWith("/projects")) return "settings";
  if (pathname.startsWith("/pull-requests")) return "pull-requests";
  if (pathname.startsWith("/friends")) return "friends";
  if (pathname.startsWith("/connect") || pathname.startsWith("/pair")) return "other";
  return "chat";
}

/**
 * The focus label a beacon carries. Only chat surfaces name anything, and only
 * when the path's trailing segment is a thread we actually know — a friend
 * gets "germ › Fix the auth flow", never a path or an id.
 */
export function composePartyDetail(input: {
  readonly pathname: string;
  readonly threads: ReadonlyArray<Pick<EnvironmentThreadShell, "id" | "projectId" | "title">>;
  readonly projectTitleById: ReadonlyMap<string, string>;
}): string | undefined {
  if (resolvePartySurface(input.pathname) !== "chat") {
    return undefined;
  }
  const segments = input.pathname.split("/").filter((segment) => segment.length > 0);
  const tail = segments[segments.length - 1];
  if (tail === undefined) {
    return undefined;
  }
  const thread = input.threads.find((candidate) => candidate.id === tail);
  if (thread === undefined) {
    return undefined;
  }
  const projectTitle = input.projectTitleById.get(thread.projectId);
  return projectTitle === undefined ? thread.title : `${projectTitle} › ${thread.title}`;
}

export function isAnyThreadWorking(
  threads: ReadonlyArray<Pick<EnvironmentThreadShell, "latestTurn">>,
): boolean {
  return threads.some((thread) => thread.latestTurn?.state === "running");
}

export interface PartyActivityView {
  /** "In germ › Fix the auth flow" / "In settings" — always present. */
  readonly headline: string;
  /** The beacon is recent enough to show at all. */
  readonly fresh: boolean;
  /** They touched mouse or keyboard moments ago. */
  readonly inputLive: boolean;
  readonly agentBusy: boolean;
}

const SURFACE_LABELS: Readonly<Record<FriendPartySurface, string>> = {
  chat: "In a chat",
  settings: "In settings",
  "pull-requests": "Reviewing pull requests",
  usage: "Checking usage",
  friends: "In the friends hub",
  other: "Around",
};

export function describePartyActivity(
  activity: FriendPartyActivity,
  nowMs: number,
): PartyActivityView {
  const updatedAtMs = Date.parse(activity.updatedAt);
  const lastInputMs = Date.parse(activity.lastInputAt);
  const fresh = Number.isFinite(updatedAtMs) && nowMs - updatedAtMs < PARTY_ACTIVITY_FRESH_MS;
  return {
    headline:
      activity.detail === undefined ? SURFACE_LABELS[activity.surface] : `In ${activity.detail}`,
    fresh,
    inputLive: fresh && Number.isFinite(lastInputMs) && nowMs - lastInputMs < PARTY_INPUT_LIVE_MS,
    agentBusy: fresh && activity.agentBusy,
  };
}

export function usePartySharingFriendIds(): ReadonlyArray<string> {
  return useClientSettings((settings) => settings.partySharingFriendIds);
}

/** Flip whether this device shares live activity with one friend. */
export function useSetPartySharing(): (friendId: string, enabled: boolean) => void {
  const sharingIds = usePartySharingFriendIds();
  const updateClientSettings = useUpdateClientSettings();
  return useCallback(
    (friendId, enabled) => {
      const without = sharingIds.filter((id) => id !== friendId);
      const already = without.length !== sharingIds.length;
      if (enabled === already) {
        return;
      }
      updateClientSettings({
        partySharingFriendIds: enabled ? [...without, friendId] : without,
      });
    },
    [sharingIds, updateClientSettings],
  );
}

interface PartyBeaconSenderInput {
  readonly environmentId: EnvironmentId | null;
  readonly friends: ReadonlyArray<Friend>;
  readonly pathname: string;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly projectTitleById: ReadonlyMap<string, string>;
}

/**
 * The sending half of party mode. Ticks a few times a minute while the window
 * is visible, composes the coarse activity, and pushes it to every linked
 * friend the user opted into. Deliberately quiet about failures: a friend who
 * is asleep just misses a heartbeat.
 */
export function usePartyBeaconSender(input: PartyBeaconSenderInput): void {
  const sharingIds = usePartySharingFriendIds();
  const sendBeacon = useAtomCommand(sharedThreads.partyBeacon, {
    label: "friends:party-beacon",
    reportFailure: false,
  });

  const lastInputAtRef = useRef<number>(Date.now());
  useEffect(() => {
    let throttleUntil = 0;
    const record = () => {
      const now = Date.now();
      // One ref write per second is plenty for a liveness pulse.
      if (now < throttleUntil) return;
      throttleUntil = now + 1_000;
      lastInputAtRef.current = now;
    };
    window.addEventListener("pointerdown", record, { capture: true, passive: true });
    window.addEventListener("keydown", record, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", record, { capture: true });
      window.removeEventListener("keydown", record, { capture: true });
    };
  }, []);

  // Snapshot the latest inputs in refs so the tick loop itself never restarts
  // (an interval that resets on every keystroke-driven render drifts forever).
  const latest = useRef(input);
  latest.current = input;
  const sharingRef = useRef(sharingIds);
  sharingRef.current = sharingIds;
  const lastSentRef = useRef<{ payload: string; at: number }>({ payload: "", at: 0 });

  useEffect(() => {
    const tick = () => {
      const { environmentId, friends, pathname, threads, projectTitleById } = latest.current;
      if (environmentId === null || document.hidden) {
        return;
      }
      const targets = friends.filter(
        (friend) => friend.linkStatus === "linked" && sharingRef.current.includes(friend.friendId),
      );
      if (targets.length === 0) {
        return;
      }
      const activity: FriendPartyActivity = {
        surface: resolvePartySurface(pathname),
        ...((detail) => (detail === undefined ? {} : { detail }))(
          composePartyDetail({ pathname, threads, projectTitleById }),
        ),
        agentBusy: isAnyThreadWorking(threads),
        lastInputAt: new Date(lastInputAtRef.current).toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // `updatedAt` changes every tick by construction; compare without it so
      // an unchanged scene only re-sends on the heartbeat.
      const { updatedAt: _updatedAt, ...comparable } = activity;
      const payload = JSON.stringify([comparable, targets.map((friend) => friend.friendId)]);
      const now = Date.now();
      if (payload === lastSentRef.current.payload && now - lastSentRef.current.at < HEARTBEAT_MS) {
        return;
      }
      lastSentRef.current = { payload, at: now };
      for (const friend of targets) {
        void sendBeacon({
          environmentId,
          friendId: friend.friendId,
          friendEnvironmentId: friend.profile.environmentId,
          activity,
        });
      }
    };
    tick();
    const interval = window.setInterval(tick, SEND_TICK_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [sendBeacon]);
}

/**
 * Party mode's sending half, composed from app state. Mounted once on the
 * chat shell beside friend-link completion, so beacons flow whenever the app
 * is open - not only while somebody is looking at the friends screens.
 */
export function usePartyBeacon(): void {
  const { environmentId, friends } = useFriends();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const threads = useThreadShells();
  const projects = useProjects();
  const projectTitleById = useMemo(
    () => new Map(projects.map((project) => [project.id as string, project.title] as const)),
    [projects],
  );
  usePartyBeaconSender({ environmentId, friends, pathname, threads, projectTitleById });
}
