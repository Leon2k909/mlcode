import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { Friend, FriendPartyActivity, FriendsGuestPartyBeaconInput } from "./friends.ts";

const decodeFriend = Schema.decodeUnknownSync(Friend);
const decodeBeacon = Schema.decodeUnknownSync(FriendsGuestPartyBeaconInput);
const encodeActivity = Schema.encodeSync(FriendPartyActivity);

const BASE_FRIEND = {
  friendId: "friend-1",
  profile: {
    environmentId: "environment-2",
    displayName: "Robin",
    avatarColor: "blue",
  },
  httpBaseUrl: "https://robin.example",
  linkStatus: "linked",
  announceCode: null,
  presence: "online",
  viewingThreadId: null,
  lastSeenAt: null,
  createdAt: "2026-08-27T19:00:00.000Z",
};

describe("party contract", () => {
  it("still decodes a Friend written before party mode existed", () => {
    // Old servers and old snapshots never mention partyActivity; the field
    // must stay optional forever or every mixed-version link breaks.
    const friend = decodeFriend(BASE_FRIEND);
    expect(friend.partyActivity).toBeUndefined();
  });

  it("carries a beacon through decode and encode unchanged", () => {
    const activity = {
      surface: "chat",
      detail: "germ › Fix the auth flow",
      agentBusy: true,
      lastInputAt: "2026-08-27T19:59:55.000Z",
      updatedAt: "2026-08-27T20:00:00.000Z",
    } as const;
    const decoded = decodeBeacon({ activity });
    expect(decoded.activity).toEqual(activity);
    expect(encodeActivity(decoded.activity)).toEqual(activity);
  });

  it("accepts a detail-less beacon - some surfaces have nothing to name", () => {
    const decoded = decodeBeacon({
      activity: {
        surface: "settings",
        agentBusy: false,
        lastInputAt: "2026-08-27T19:59:55.000Z",
        updatedAt: "2026-08-27T20:00:00.000Z",
      },
    });
    expect(decoded.activity.detail).toBeUndefined();
  });

  it("attaches a beacon to a Friend row without disturbing its other fields", () => {
    const friend = decodeFriend({
      ...BASE_FRIEND,
      partyActivity: {
        surface: "usage",
        agentBusy: false,
        lastInputAt: "2026-08-27T19:59:55.000Z",
        updatedAt: "2026-08-27T20:00:00.000Z",
      },
    });
    expect(friend.partyActivity?.surface).toBe("usage");
    expect(friend.presence).toBe("online");
  });
});
